import {
  BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma, Refund } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { refundRequests } from "../metrics/metrics.js";
import { PgError, type PgRefund, type ProviderId } from "./payment-gateway.js";
import { PaymentGateways } from "./payment-gateways.js";
import { syncRefundedStatus } from "./payment-state.js";

type LockedPayment = { id: number; provider: string; provider_payment_key: string | null; amount: number; status: string };
export type RefundView = {
  id: number; amount: number; reason: string; status: Refund["status"]; failureReason: string | null;
  payment: { id: number; status: string; amount: number; refunded: number; remaining: number };
};
export type RefundOutcome = { httpStatus: 200 | 201 | 202; refund: RefundView };

// 환불: 잠금 → requested 커밋 → PG 호출(트랜잭션 밖) → succeeded·failed.
// PG 호출을 트랜잭션 안에서 하지 않는다: 외부 호출 동안 결제 행 잠금을 쥐게 되고, 롤백해도 돈은 이미 나갔다.
// 이번 단계는 돈만 다룬다(주문 취소·재고 복구는 28의 상태 기계가 이 서비스를 불러서 한다)
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGateways,
  ) {}

  async request(orderId: number, input: { amount: number; reason: string }, idempotencyKey: string | undefined): Promise<RefundOutcome> {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key 헤더가 필요합니다");
    if (idempotencyKey.length > 200) throw new BadRequestException("Idempotency-Key는 200자 이하입니다");

    const prepared = await this.prisma.asAdmin(async (tx) => {
      // 같은 결제의 환불 요청은 여기서 줄을 선다. 누적 환불액 확인과 requested 기록이 한 덩어리가 된다
      const [payment] = await tx.$queryRaw<LockedPayment[]>`
        SELECT id, provider::text, provider_payment_key, amount, status::text FROM payments WHERE order_id = ${orderId} FOR UPDATE`;
      if (!payment) throw new NotFoundException(`주문 ${orderId}의 결제가 없습니다`);

      // 잠근 뒤에 멱등 키를 본다: 같은 키로 동시에 온 두 번째 요청은 첫 요청이 커밋한 행을 본다
      const existing = await tx.refund.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.paymentId !== payment.id || existing.amount !== input.amount) {
          throw new UnprocessableEntityException("같은 Idempotency-Key로 다른 환불을 보냈다");
        }
        return { replay: existing, payment };
      }

      if (payment.status !== "paid" && payment.status !== "partial_refunded") throw new ConflictException(`환불할 수 없는 결제 상태입니다(${payment.status})`);
      if (payment.provider === "manual" || !payment.provider_payment_key) throw new ConflictException("PG를 거치지 않은 결제는 환불할 수 없습니다");
      const remaining = payment.amount - (await reservedAmount(tx, payment.id));
      if (input.amount > remaining) throw new ConflictException(`환불할 수 있는 금액은 ${remaining.toLocaleString("ko-KR")}원입니다`);

      const refund = await tx.refund.create({ data: { paymentId: payment.id, amount: input.amount, reason: input.reason, idempotencyKey } });
      return { refund, payment };
    });

    if ("replay" in prepared && prepared.replay) {
      // 같은 키의 재요청: PG를 다시 부르지 않는다. requested면 결과를 아직 모르는 것이다(payments:resolve-refunds가 확정한다)
      this.logger.log(`환불 멱등 재응답: key=${idempotencyKey} → #${prepared.replay.id} ${prepared.replay.status}`);
      return { httpStatus: prepared.replay.status === "requested" ? 202 : 200, refund: await this.view(prepared.replay.id) };
    }
    const { refund, payment } = prepared as { refund: Refund; payment: LockedPayment };
    const provider = payment.provider as ProviderId;

    let pgRefund: PgRefund;
    try {
      pgRefund = await this.gateways.get(provider).refund(payment.provider_payment_key!, { amount: refund.amount, reason: refund.reason, refundId: refund.id }, idempotencyKey);
    } catch (err) {
      if (err instanceof PgError && err.unknownOutcome) {
        refundRequests.inc({ provider, result: "requested" });
        this.logger.warn(`환불 결과 모름(${err.kind}): #${refund.id} ${refund.amount}원 - requested로 남긴다: ${err.message}`);
        return { httpStatus: 202, refund: await this.view(refund.id) };
      }
      if (err instanceof PgError) {
        await this.markFailed(refund.id, `${err.code ?? "REJECTED"}: ${err.message}`);
        refundRequests.inc({ provider, result: "failed" });
        throw new BadGatewayException(`PG가 환불을 거절했습니다: ${err.code ?? ""} ${err.message}`.trim());
      }
      throw err; // 우리 쪽 오류. 돈이 나갔는지 모르므로 requested로 남긴다
    }
    await this.markSucceeded(refund.id, pgRefund.key);
    refundRequests.inc({ provider, result: "succeeded" });
    this.logger.log(`환불: 주문 #${orderId} ${refund.amount}원 (#${refund.id}, ${provider} ${pgRefund.key})`);
    return { httpStatus: 201, refund: await this.view(refund.id) };
  }

  async list(orderId: number): Promise<RefundView[]> {
    const refunds = await this.prisma.asAdmin((tx) => tx.refund.findMany({ where: { payment: { orderId } }, select: { id: true }, orderBy: { id: "asc" } }));
    return Promise.all(refunds.map((r) => this.view(r.id)));
  }

  async markSucceeded(refundId: number, providerRefundKey: string): Promise<boolean> {
    return this.prisma.asAdmin(async (tx) => {
      const { count } = await tx.refund.updateMany({ where: { id: refundId, status: "requested" }, data: { status: "succeeded", providerRefundKey } });
      if (count === 0) return false;
      const { paymentId } = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, select: { paymentId: true } });
      await syncRefundedStatus(tx, paymentId);
      return true;
    });
  }

  async markFailed(refundId: number, failureReason: string): Promise<void> {
    await this.prisma.asAdmin((tx) => tx.refund.updateMany({ where: { id: refundId, status: "requested" }, data: { status: "failed", failureReason } }));
  }

  async view(refundId: number): Promise<RefundView> {
    return this.prisma.asAdmin(async (tx) => {
      const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
      const { _sum } = await tx.refund.aggregate({ where: { paymentId: r.paymentId, status: "succeeded" }, _sum: { amount: true } });
      const reserved = await reservedAmount(tx, r.paymentId);
      return {
        id: r.id, amount: r.amount, reason: r.reason, status: r.status, failureReason: r.failureReason,
        payment: { id: r.payment.id, status: r.payment.status, amount: r.payment.amount, refunded: _sum.amount ?? 0, remaining: r.payment.amount - reserved },
      };
    });
  }
}

// 이미 나갔거나(succeeded) 나갔을 수 있는(requested) 환불액. 결과를 모르는 환불도 남은 금액에서 뺀다(이중 환불 방지)
async function reservedAmount(tx: Prisma.TransactionClient, paymentId: number): Promise<number> {
  const { _sum } = await tx.refund.aggregate({ where: { paymentId, status: { in: ["requested", "succeeded"] } }, _sum: { amount: true } });
  return _sum.amount ?? 0;
}
