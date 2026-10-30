import { createHash } from "node:crypto";
import {
  BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { cancelUnpaidOrder } from "./cancel-unpaid-order.js";
import { PgError, type PgPayment } from "./payment-gateway.js";
import { markPaid } from "./payment-state.js";
import { TossGateway } from "./toss.gateway.js";
import { tossEvents } from "../metrics/metrics.js";

export type TossWebhookResult = "processed" | "duplicate" | "ignored";
type ReadyPayment = { id: number; orderId: number; providerOrderId: string; amount: number };

@Injectable()
export class TossPaymentsService {
  private readonly logger = new Logger(TossPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toss: TossGateway,
  ) {}

  // 위젯 페이지가 그릴 값. 금액과 주문번호는 서버가 정한다(브라우저가 정하지 않는다)
  async checkoutInfo(userId: string, orderId: number) {
    const order = await this.prisma.asUser(userId, (tx) => tx.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, payment: true, items: { select: { quantity: true, product: { select: { name: true } } } } },
    }));
    if (!order?.payment || order.payment.provider !== "toss") throw new NotFoundException(`토스 결제를 시작한 주문 ${orderId}이 없습니다`);
    if (order.payment.status !== "ready") throw new ConflictException(`이미 끝난 결제입니다(${order.payment.status})`);
    const [first, ...rest] = order.items;
    return {
      orderId: order.id,
      providerOrderId: order.payment.providerOrderId,
      amount: order.payment.amount,
      orderName: rest.length > 0 ? `${first.product.name} 외 ${rest.length}건` : (first?.product.name ?? `주문 #${order.id}`),
      // 위젯의 구매자 키(22~50자). 사용자 id를 그대로 보내지 않는다
      customerKey: `user_${createHash("sha256").update(`toss-customer:${userId}`).digest("hex").slice(0, 32)}`,
      ...this.toss.widgetConfig(),
    };
  }

  // 성공 리다이렉트를 받은 콘솔이 부른다. 쿼리의 금액은 믿지 않는다: DB의 주문 금액과 다르면 PG를 부르지 않고 400
  async confirm(userId: string, input: { paymentKey: string; orderId: string; amount: number }) {
    const payment = await this.prisma.asUser(userId, (tx) => tx.payment.findFirst({
      where: { provider: "toss", providerOrderId: input.orderId, order: { userId } },
    }));
    if (!payment) throw new NotFoundException(`주문번호 ${input.orderId}의 결제가 없습니다`);
    if (payment.status !== "ready") {
      if (payment.providerPaymentKey === input.paymentKey) return { orderId: payment.orderId, status: payment.status }; // 같은 승인을 다시 보냈다
      throw new ConflictException(`이미 끝난 결제입니다(${payment.status})`);
    }
    if (input.amount !== payment.amount) {
      this.logger.warn(`토스 승인 금액 위조 의심: 주문 #${payment.orderId} ${payment.amount}원 ≠ 요청 ${input.amount}원`);
      tossEvents.inc({ kind: "confirm", result: "amount_mismatch" });
      throw new BadRequestException("결제 금액이 주문 금액과 다릅니다");
    }

    const pg = await this.approve(payment, input.paymentKey);
    this.verify(pg, payment);
    if (pg.status !== "paid") throw new ConflictException(`승인되지 않은 결제입니다(${pg.status})`);
    const changed = await this.prisma.asAdmin((tx) => markPaid(tx, payment.id, pg));
    if (!changed) {
      const now = await this.prisma.asAdmin((tx) => tx.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } }));
      if (now.status === "canceled") {
        // 승인 사이에 주문이 취소됐다(결제 기한 등). 돈은 PG에서 나갔으므로 관리자가 환불해야 한다
        this.logger.error(`토스 승인됐지만 주문 #${payment.orderId}은 이미 취소됨 - 환불이 필요하다 (paymentKey ${pg.paymentKey})`);
        throw new ConflictException("주문이 이미 취소되어 결제를 반영하지 못했습니다");
      }
    }
    tossEvents.inc({ kind: "confirm", result: changed ? "processed" : "duplicate" });
    this.logger.log(`토스 승인: 주문 #${payment.orderId} ${pg.totalAmount}원 (${changed ? "결제 완료" : "이미 반영됨"})`);
    return { orderId: payment.orderId, status: "paid" as const };
  }

  // PG 승인. 멱등 키가 (결제, paymentKey)마다 같아서 두 번 와도 PG에서 한 번만 승인된다
  private async approve(payment: ReadyPayment, paymentKey: string): Promise<PgPayment> {
    try {
      return await this.toss.confirm({ providerOrderId: payment.providerOrderId, amount: payment.amount, paymentKey }, `confirm-${payment.id}-${paymentKey}`);
    } catch (err) {
      if (!(err instanceof PgError)) throw err;
      // 이미 승인됐거나(웹훅·다른 요청이 먼저), 결과를 모르면(시간 초과·같은 멱등 키 처리 중) PG에 다시 묻는다
      if (err.unknownOutcome || err.code === "ALREADY_PROCESSED_PAYMENT") {
        const pg = await this.toss.fetchPayment(paymentKey).catch(() => null);
        if (pg?.status === "paid") return pg;
        if (err.unknownOutcome) throw new ServiceUnavailableException("결제 승인 결과를 아직 모릅니다. 잠시 뒤 다시 시도해 주세요");
      }
      tossEvents.inc({ kind: "confirm", result: "rejected" });
      throw new BadGatewayException(`토스가 승인을 거절했습니다: ${err.code ?? ""} ${err.message}`.trim());
    }
  }

  private verify(pg: PgPayment, payment: ReadyPayment) {
    if (pg.providerOrderId !== payment.providerOrderId || pg.totalAmount !== payment.amount) {
      this.logger.error(`토스 응답이 주문과 다름: 주문 #${payment.orderId} ${payment.providerOrderId}/${payment.amount} ≠ ${pg.providerOrderId}/${pg.totalAmount}`);
      throw new BadGatewayException("토스 결제 정보가 주문과 다릅니다");
    }
  }

  // 결제 상태 웹훅. 본문은 paymentKey를 고르는 데만 쓰고 상태·금액·주문번호는 PG 조회 결과를 따른다.
  // 본문이 무엇이든 200으로 답한다(토스가 같은 웹훅을 계속 다시 보내지 않게). PG에 묻지 못했을 때만 503으로 다시 받는다
  async webhook(body: unknown): Promise<TossWebhookResult> {
    const result = await this.processWebhook(body);
    tossEvents.inc({ kind: "webhook", result });
    return result;
  }

  private async processWebhook(body: unknown): Promise<TossWebhookResult> {
    const event = body as { eventType?: unknown; data?: { paymentKey?: unknown } } | null;
    const paymentKey = event?.data?.paymentKey;
    if (event?.eventType !== "PAYMENT_STATUS_CHANGED" || typeof paymentKey !== "string" || paymentKey.length === 0 || paymentKey.length > 200) return "ignored";

    let pg: PgPayment;
    try {
      pg = await this.toss.fetchPayment(paymentKey);
    } catch (err) {
      if (err instanceof PgError && !err.unknownOutcome) return "ignored"; // 토스에 없는 결제(NOT_FOUND_PAYMENT 등)
      throw new ServiceUnavailableException("토스 결제 조회에 실패했습니다");
    }

    return this.prisma.asAdmin(async (tx): Promise<TossWebhookResult> => {
      const payment = await tx.payment.findUnique({ where: { provider_providerOrderId: { provider: "toss", providerOrderId: pg.providerOrderId ?? "" } } });
      if (!payment) return "ignored";
      if (pg.totalAmount !== payment.amount) {
        this.logger.error(`토스 웹훅: 금액 불일치 주문 #${payment.orderId} ${payment.amount}원 ≠ PG ${pg.totalAmount}원`);
        return "ignored";
      }
      if (pg.status === "paid") {
        const changed = await markPaid(tx, payment.id, pg);
        this.logger.log(`토스 웹훅: 주문 #${payment.orderId} 결제 완료 ${changed ? "반영" : "(이미 반영됨)"}`);
        return changed ? "processed" : "duplicate";
      }
      if (pg.status === "canceled" && payment.status === "ready") {
        await cancelUnpaidOrder(tx, payment.orderId);
        this.logger.log(`토스 웹훅: 주문 #${payment.orderId} 결제 중단 → 주문 취소, 재고 복구`);
        return "processed";
      }
      return "ignored";
    });
  }
}
