import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StoreSettingsService } from "../admin/store-settings.service.js";
import { cancelUnpaidOrder } from "../payments/cancel-unpaid-order.js";
import type { PgPayment } from "../payments/payment-gateway.js";
import { PaymentGateways } from "../payments/payment-gateways.js";
import { markPaid } from "../payments/payment-state.js";
import { RefundsService, type RefundView } from "../payments/refunds.service.js";
import { afterOrder, encodeOrderCursor, orderListOrder, toPage } from "../pagination/cursor.js";
import { CARRIERS, TRACKING_NUMBER, normalizeTrackingNumber, type CarrierCode } from "./carriers.js";
import { ORDER_STATUS_LABEL, nextReturnStatus, type OrderStatus, type ReturnStatus } from "./order-state.js";
import {
  AUTO_CONFIRM_DAYS, AUTO_DELIVER_DAYS, DAY_MS, UNPAID_ORDER_TTL_HOURS, returnDeadline, returnRefundAmount, type ReturnReason,
} from "./policy.js";
import { TransitionConflict, attemptTransition, restoreOrderStock, transitionOrder, type ActorRef } from "./transitions.js";
import { RETURN_REFUND_KEY, adminOrderView, customerOrderView, returnableQuantities } from "./views.js";

type Tx = Prisma.TransactionClient;

const RETURN_LABEL: Record<ReturnStatus, string> = { requested: "요청됨", approved: "승인됨", rejected: "거절됨", completed: "완료" };
const returnConflict = (current: ReturnStatus, what: string) =>
  new TransitionConflict(current, `반품 요청이 ${RETURN_LABEL[current]} 상태라 ${what}할 수 없습니다`);

export type ReturnRequest = { kind: "refund" | "exchange"; reason: ReturnReason; detail?: string; items: { productId: number; variantId?: number; quantity: number }[] };
export type AutoAdvanceResult = { expired: number; paidOnRecheck: number; delivered: number; confirmed: number; returnsCompleted: number };

// 주문 이행: 배송 준비 → 송장 → 배송 완료 → 구매확정, 취소, 반품·교환.
// 상태 전이와 재고는 한 트랜잭션, 환불(27의 RefundsService)은 커밋 뒤 멱등 키로 부른다:
//   다시 눌러도 조건부 update가 지고 멱등 키가 같아서 재고 복구와 PG 환불은 한 번만 일어난다
@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: RefundsService,
    private readonly gateways: PaymentGateways,
    private readonly settings: StoreSettingsService,
  ) {}

  // ── 관리자 ────────────────────────────────────────────

  async list(query: { limit: number; cursor?: string; status?: OrderStatus; returns?: "requested"; guest?: boolean; q?: string }) {
    const q = query.q?.trim();
    const where: Prisma.OrderWhereInput = {
      status: query.status,
      ...(query.returns ? { returns: { some: { status: query.returns } } } : {}),
      ...(query.guest !== undefined ? { isGuest: query.guest } : {}),
      ...afterOrder(query.cursor),
    };
    if (q) {
      if (/^\d+$/.test(q)) {
        where.OR = [
          { id: Number(q) },
          { userId: { contains: q, mode: "insensitive" } },
          { recipientName: { contains: q, mode: "insensitive" } },
          { recipientPhone: { contains: q } },
        ];
      } else {
        where.OR = [
          { userId: { contains: q, mode: "insensitive" } },
          { user: { name: { contains: q, mode: "insensitive" } } },
          { recipientName: { contains: q, mode: "insensitive" } },
          { recipientPhone: { contains: q } },
          { address1: { contains: q, mode: "insensitive" } },
        ];
      }
    }
    const rows = await this.prisma.asAdmin((tx) => tx.order.findMany({
      where,
      select: { id: true, userId: true, status: true, totalAmount: true, shippingFee: true, recipientName: true, createdAt: true, statusChangedAt: true, isGuest: true },
      orderBy: [...orderListOrder],
      take: query.limit + 1,
    }));
    const page = toPage(rows, query.limit, encodeOrderCursor);
    return { items: page.items.map(({ totalAmount, ...r }) => ({ ...r, price: totalAmount })), nextCursor: page.nextCursor };
  }

  async adminDetail(orderId: number) {
    const view = await this.prisma.asAdmin((tx) => adminOrderView(tx, orderId));
    if (!view) throw new NotFoundException(`order ${orderId} not found`);
    return view;
  }

  async prepare(orderId: number, adminId: string) {
    await this.prisma.asAdmin((tx) => transitionOrder(tx, orderId, "prepare", admin(adminId)));
    return this.adminDetail(orderId);
  }

  async ship(orderId: number, adminId: string, input: { carrier: CarrierCode; trackingNumber: string }) {
    const trackingNumber = checkTrackingNumber(input.trackingNumber);
    await this.prisma.asAdmin(async (tx) => {
      // 송장 알림(order.shipped)에 택배사·송장번호를 싣는다
      const notice = { carrier: input.carrier, carrierName: CARRIERS[input.carrier].name, trackingNumber };
      await transitionOrder(tx, orderId, "ship", admin(adminId), { notice });
      await tx.shipment.create({ data: { orderId, carrier: input.carrier, trackingNumber } });
    });
    this.logger.log(`송장 입력: 주문 #${orderId} ${input.carrier} ${trackingNumber}`);
    return this.adminDetail(orderId);
  }

  async deliver(orderId: number, adminId: string) {
    await this.prisma.asAdmin((tx) => transitionOrder(tx, orderId, "deliver", admin(adminId), { reason: "관리자가 배송 완료 처리" }));
    return this.adminDetail(orderId);
  }

  // 취소: 상태 전이 + 재고 복구(한 트랜잭션) → 커밋 뒤 전액 환불(멱등 키 cancel-<주문id>).
  // 이미 관리자 취소된 주문을 다시 누르면 전이는 지고(재고 그대로) 같은 멱등 키로 환불만 다시 확인한다(PG 호출 없음)
  async cancel(orderId: number, adminId: string, reason = "관리자 취소") {
    let replayed = false;
    try {
      await this.prisma.asAdmin(async (tx) => {
        await transitionOrder(tx, orderId, "cancel", admin(adminId), { reason });
        await restoreOrderStock(tx, orderId);
      });
      this.logger.log(`주문 취소: #${orderId} (재고 복구) - ${reason}`);
    } catch (err) {
      if (!(err instanceof TransitionConflict) || err.currentStatus !== "canceled" || !(await this.wasCanceledAfterPayment(orderId))) throw err;
      replayed = true;
    }
    const refund = await this.refundOrder(orderId, `cancel-${orderId}`, reason);
    return { replayed, refund, order: await this.adminDetail(orderId) };
  }

  async approveReturn(returnId: number, adminId: string) {
    const now = new Date();
    let replayed = false;
    try {
      await this.prisma.asAdmin(async (tx) => {
        const r = await this.lockedReturn(tx, returnId);
        if (!nextReturnStatus(r.status, "approve", "admin").ok) throw returnConflict(r.status, "승인");
        // 동일 주문에서 이미 승인·완료된 단순변심(change_of_mind) 환불 반품이 있으면 왕복 배송비는 중복 차감하지 않는다(0원)
        const priorChangeOfMind = await tx.return.findFirst({
          where: {
            orderId: r.orderId,
            id: { not: returnId },
            kind: "refund",
            reason: "change_of_mind",
            status: { in: ["approved", "completed"] },
          },
        });
        const returnShippingFee = priorChangeOfMind ? 0 : r.order.returnShippingFee;
        const refundAmount = r.kind === "refund" ? returnRefundAmount(r.items, r.reason, returnShippingFee) : null;
        const { count } = await tx.return.updateMany({ where: { id: returnId, status: "requested" }, data: { status: "approved", decidedAt: now, refundAmount } });
        if (count === 0) throw returnConflict(r.status, "승인");
        if (r.kind === "exchange") {
          // 교환품을 먼저 뺀다(재고가 모자라면 409, 트랜잭션이 통째로 롤백돼 아무것도 바뀌지 않는다)
          for (const i of r.items) {
            if (i.variantId) {
              const takenVar = await tx.$executeRaw`UPDATE product_variants SET stock = stock - ${i.quantity} WHERE id = ${i.variantId} AND stock >= ${i.quantity}`;
              if (takenVar === 0) throw new ConflictException(`교환품 재고가 모자랍니다(옵션 #${i.variantId} ${i.quantity}개)`);
              await tx.$executeRaw`UPDATE products SET stock = stock - ${i.quantity} WHERE id = ${i.productId}`;
            } else {
              const taken = await tx.$executeRaw`UPDATE products SET stock = stock - ${i.quantity} WHERE id = ${i.productId} AND stock >= ${i.quantity}`;
              if (taken === 0) throw new ConflictException(`교환품 재고가 모자랍니다(상품 #${i.productId} ${i.quantity}개)`);
            }
          }
        }
        // 반품 수량은 재고로 돌려놓는다
        for (const i of r.items) {
          if (i.variantId) {
            await tx.productVariant.update({ where: { id: i.variantId }, data: { stock: { increment: i.quantity } } });
            await tx.product.update({ where: { id: i.productId }, data: { stock: { increment: i.quantity } } });
          } else {
            await tx.product.update({ where: { id: i.productId }, data: { stock: { increment: i.quantity } } });
          }
        }
        await tx.outboxEvent.create({
          data: { type: "return.approved", userId: r.order.userId, payload: { orderId: r.orderId, returnId, kind: r.kind, refundAmount } },
        });
      });
      this.logger.log(`반품 승인: #${returnId} (재고 복구, 관리자 ${adminId})`);
    } catch (err) {
      if (!(err instanceof TransitionConflict) || (err.currentStatus !== "approved" && err.currentStatus !== "completed")) throw err;
      replayed = true;
    }

    const r = await this.prisma.asAdmin((tx) => tx.return.findUniqueOrThrow({ where: { id: returnId } }));
    let refund: RefundView | null = null;
    if (r.kind === "refund" && r.status === "approved") {
      refund = await this.refundOrder(r.orderId, `return-${returnId}`, `반품 #${returnId}`, r.refundAmount ?? 0);
      // 환불이 끝났거나 돌려줄 돈이 없으면 완료. 결과를 모르면(시간 초과) approved로 두고 payments:resolve-refunds 뒤 자동 작업이 완료한다
      if (!refund || refund.status === "succeeded") await this.completeReturn(returnId, { type: "system" });
    }
    return { replayed, refund, order: await this.adminDetail(r.orderId) };
  }

  async rejectReturn(returnId: number, adminId: string, reason: string) {
    const orderId = await this.prisma.asAdmin(async (tx) => {
      const r = await this.lockedReturn(tx, returnId);
      if (!nextReturnStatus(r.status, "reject", "admin").ok) throw returnConflict(r.status, "거절");
      await tx.return.update({ where: { id: returnId }, data: { status: "rejected", decidedAt: new Date(), rejectReason: reason } });
      await tx.outboxEvent.create({ data: { type: "return.rejected", userId: r.order.userId, payload: { orderId: r.orderId, returnId, reason } } });
      return r.orderId;
    });
    this.logger.log(`반품 거절: #${returnId} (관리자 ${adminId})`);
    return this.adminDetail(orderId);
  }

  // 교환품 발송: 승인된 교환 요청에 새 송장을 붙이고 요청을 완료한다
  async shipExchange(returnId: number, adminId: string, input: { carrier: CarrierCode; trackingNumber: string }) {
    const trackingNumber = checkTrackingNumber(input.trackingNumber);
    const orderId = await this.prisma.asAdmin(async (tx) => {
      const r = await this.lockedReturn(tx, returnId);
      if (r.kind !== "exchange") throw new ConflictException("교환 요청에만 교환품 송장을 넣을 수 있습니다");
      if (!nextReturnStatus(r.status, "complete", "admin").ok) throw returnConflict(r.status, "교환품 발송");
      await tx.shipment.create({ data: { orderId: r.orderId, returnId, carrier: input.carrier, trackingNumber } });
      await tx.return.update({ where: { id: returnId }, data: { status: "completed", completedAt: new Date() } });
      return r.orderId;
    });
    this.logger.log(`교환품 발송: 반품 #${returnId} ${input.carrier} ${trackingNumber} (관리자 ${adminId})`);
    return this.adminDetail(orderId);
  }

  // PG가 거절한(failed) 환불 다시 시도. 같은 멱등 키로는 PG가 첫 결과(거절)를 돌려주므로 새 시도 키를 쓴다:
  //   <처음 키>-r<n> (n = 지금까지의 시도 수). 두 번 눌러도 같은 n이라 같은 키가 되어 한 번만 나간다.
  //   이미 진행 중(requested)이거나 성공한 시도가 있으면 409. 누적 환불 한도는 RefundsService가 그대로 검사한다
  //   반품 환불(return-<id>)이 성공하면 반품을 완료한다
  async retryRefund(orderId: number, refundId: number, adminId: string) {
    const failed = await this.prisma.asAdmin((tx) => tx.refund.findFirst({ where: { id: refundId, payment: { orderId } } }));
    if (!failed) throw new NotFoundException(`주문 ${orderId}의 환불 #${refundId}가 없습니다`);
    if (failed.status !== "failed") throw new ConflictException(`실패한 환불만 다시 시도할 수 있습니다(지금 ${failed.status})`);
    const base = failed.idempotencyKey.replace(/-r\d+$/, "");
    const attempts = (await this.prisma.asAdmin((tx) => tx.refund.findMany({
      where: { paymentId: failed.paymentId, idempotencyKey: { startsWith: base } }, select: { id: true, idempotencyKey: true, status: true },
    }))).filter((r) => r.idempotencyKey === base || (r.idempotencyKey.startsWith(`${base}-r`) && /^\d+$/.test(r.idempotencyKey.slice(base.length + 2))));
    const live = attempts.find((r) => r.status !== "failed");
    if (live) throw new ConflictException(`이미 다시 시도한 환불이 있습니다(#${live.id} ${live.status})`);
    const key = `${base}-r${attempts.length}`;
    this.logger.log(`환불 재시도: 주문 #${orderId} 환불 #${refundId} → ${key} (관리자 ${adminId})`);
    const { httpStatus, refund } = await this.refunds.request(orderId, { amount: failed.amount, reason: failed.reason }, key);
    const returnId = base.match(RETURN_REFUND_KEY)?.[1];
    if (returnId && refund.status === "succeeded") await this.completeReturn(Number(returnId), admin(adminId));
    return { httpStatus, refund, order: await this.adminDetail(orderId) };
  }

  // ── 손님 ──────────────────────────────────────────────

  async customerDetail(userId: string, orderId: number) {
    const view = await this.prisma.asUser(userId, (tx) => customerOrderView(tx, userId, orderId));
    if (!view) throw new NotFoundException(`order ${orderId} not found`);
    return view;
  }

  // 고객 직접 취소 (결제 대기 또는 결제 완료 상태)
  async customerCancel(userId: string, orderId: number, reason = "고객 직접 취소") {
    try {
      await this.prisma.asUser(userId, async (tx) => {
        const [order] = await tx.$queryRaw<{ status: OrderStatus; paid: boolean }[]>`
          SELECT status::text AS status, paid FROM orders WHERE id = ${orderId} AND user_id = ${userId} FOR UPDATE`;
        if (!order) throw new NotFoundException(`order ${orderId} not found`);
        if (order.status !== "pending_payment" && order.status !== "paid") {
          throw new BadRequestException("결제 대기 또는 결제 완료 상태의 주문만 취소할 수 있습니다");
        }
        if (order.status === "pending_payment") {
          await cancelUnpaidOrder(tx, orderId);
        } else {
          await transitionOrder(tx, orderId, "cancel", { type: "admin", id: userId }, { reason });
          await restoreOrderStock(tx, orderId);
        }
      });
      this.logger.log(`고객 주문 취소: #${orderId} (${userId}) (재고 복구) - ${reason}`);
    } catch (err) {
      if (!(err instanceof TransitionConflict) || err.currentStatus !== "canceled" || !(await this.wasCanceledAfterPayment(orderId))) throw err;
    }
    await this.refundOrder(orderId, `cancel-${orderId}`, reason);
    return this.customerDetail(userId, orderId);
  }

  // 구매확정과 반품 신청은 같은 주문 행 잠금(FOR UPDATE)으로 줄을 선다: 반품 신청이 먼저 커밋하면 여기서 그 요청을 보고 409,
  // 구매확정이 먼저면 반품 신청이 confirmed를 보고 409. 잠그지 않으면 둘 다 "아직 없음"을 읽고 둘 다 성공한다
  async confirm(userId: string, orderId: number) {
    await this.prisma.asUser(userId, async (tx) => {
      const [order] = await tx.$queryRaw<{ status: OrderStatus }[]>`
        SELECT status::text AS status FROM orders WHERE id = ${orderId} AND user_id = ${userId} FOR UPDATE`;
      if (!order) throw new NotFoundException(`order ${orderId} not found`);
      if (await tx.return.count({ where: { orderId, status: "requested" } })) {
        throw new TransitionConflict(order.status, "처리 중인 반품·교환 요청이 있어 구매확정할 수 없습니다");
      }
      await transitionOrder(tx, orderId, "confirm", { type: "customer", id: userId }, { reason: "손님이 구매확정" });
    });
    return this.customerDetail(userId, orderId);
  }

  // 반품·교환 신청: 배송 완료 뒤 7일 안(청약철회 기간), 구매확정 전. 주문 행을 잠가 같은 상품을 두 번 넘게 신청하지 못하게 한다
  async requestReturn(userId: string, orderId: number, input: ReturnRequest, now = new Date()) {
    const created = await this.prisma.asUser(userId, async (tx) => {
      const [order] = await tx.$queryRaw<{ status: OrderStatus; delivered_at: Date | null }[]>`
        SELECT status::text AS status, delivered_at FROM orders WHERE id = ${orderId} AND user_id = ${userId} FOR UPDATE`;
      if (!order) throw new NotFoundException(`order ${orderId} not found`);
      if (order.status !== "delivered") {
        throw new TransitionConflict(order.status, `${ORDER_STATUS_LABEL[order.status]} 주문은 반품·교환을 신청할 수 없습니다(배송 완료 뒤, 구매확정 전에만 됩니다)`);
      }
      if (!order.delivered_at || now > returnDeadline(order.delivered_at)) {
        throw new TransitionConflict(order.status, "청약철회 기간(배송 완료 뒤 7일)이 지나 반품·교환을 신청할 수 없습니다");
      }
      const row = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          items: { select: { quantity: true, unitPrice: true, variantKey: true, variantId: true, variantLabel: true, product: { select: { id: true, name: true } } } },
          returns: { select: { status: true, items: { select: { productId: true, variantKey: true, variantId: true, quantity: true } } } },
        },
      });
      const left = returnableQuantities(row);
      const items = input.items.map((i) => {
        const ordered = i.variantId
          ? row.items.find((o) => o.product.id === i.productId && o.variantId === i.variantId)
          : row.items.find((o) => o.product.id === i.productId);
        if (!ordered) throw new BadRequestException(`이 주문에 없는 상품입니다(#${i.productId})`);
        const max = left.get(`${i.productId}:${ordered.variantKey}`) ?? left.get(i.productId) ?? 0;
        if (i.quantity > max) throw new BadRequestException(`${ordered.product.name}은(는) ${max}개까지 반품·교환할 수 있습니다`);
        return {
          productId: i.productId,
          variantKey: ordered.variantKey,
          variantId: ordered.variantId,
          variantLabel: ordered.variantLabel,
          quantity: i.quantity,
          unitPrice: ordered.unitPrice,
        };
      });
      return tx.return.create({
        data: { orderId, kind: input.kind, reason: input.reason, detail: input.detail?.trim() || null, requestedAt: now, items: { create: items } },
        select: { id: true },
      });
    });
    this.logger.log(`반품·교환 신청: 주문 #${orderId} → 요청 #${created.id} (${input.kind}, ${input.reason})`);
    return this.customerDetail(userId, orderId);
  }

  async exportOrdersCsv(query: { status?: OrderStatus; returns?: "requested"; guest?: boolean; q?: string }, isDemoAdmin = false): Promise<string> {
    const q = query.q?.trim();
    const where: Prisma.OrderWhereInput = {
      status: query.status,
      ...(query.returns ? { returns: { some: { status: query.returns } } } : {}),
      ...(query.guest !== undefined ? { isGuest: query.guest } : {}),
    };
    if (q) {
      if (/^\d+$/.test(q)) {
        where.OR = [
          { id: Number(q) },
          { userId: { contains: q, mode: "insensitive" } },
          { recipientName: { contains: q, mode: "insensitive" } },
          { recipientPhone: { contains: q } },
        ];
      } else {
        where.OR = [
          { userId: { contains: q, mode: "insensitive" } },
          { user: { name: { contains: q, mode: "insensitive" } } },
          { recipientName: { contains: q, mode: "insensitive" } },
          { recipientPhone: { contains: q } },
          { address1: { contains: q, mode: "insensitive" } },
        ];
      }
    }

    const orders = await this.prisma.asAdmin((tx) =>
      tx.order.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          status: true,
          isGuest: true,
          userId: true,
          recipientName: true,
          recipientPhone: true,
          postalCode: true,
          address1: true,
          address2: true,
          deliveryMemo: true,
          totalAmount: true,
          shippingFee: true,
          items: {
            select: {
              quantity: true,
              unitPrice: true,
              variantLabel: true,
              product: { select: { name: true } },
            },
          },
        },
        orderBy: { id: "desc" },
        take: 1000,
      }),
    );

    const header = "주문번호,주문일시,상태,구분,주문자ID,수령인,연락처,우편번호,주소,상세주소,배송메모,주문상품,결제금액,배송비";
    const rows = orders.map((o) => {
      let recName = o.recipientName ?? "";
      let recPhone = o.recipientPhone ?? "";
      let pCode = o.postalCode ?? "";
      let addr1 = o.address1 ?? "";
      let addr2 = o.address2 ?? "";
      let memo = o.deliveryMemo ?? "";

      if (isDemoAdmin) {
        if (recName) recName = recName.length > 2 ? `${recName[0]}*${recName.slice(-1)}` : `${recName[0]}*`;
        if (recPhone) recPhone = recPhone.replace(/(\d{3})-?(\d{3,4})-?(\d{4})/, "$1-****-$3");
        if (pCode) pCode = `${pCode.slice(0, 2)}***`;
        if (addr1) addr1 = addr1.split(" ").slice(0, 2).join(" ") + " ***";
        if (addr2) addr2 = "***";
        if (memo) memo = "***";
      }

      const itemsSummary = o.items
        .map((it) => `${it.product.name}${it.variantLabel ? ` (${it.variantLabel})` : ""} x ${it.quantity}`)
        .join(" / ");

      const escape = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;

      return [
        o.id,
        escape(o.createdAt.toISOString()),
        escape(ORDER_STATUS_LABEL[o.status] ?? o.status),
        escape(o.isGuest ? "비회원" : "회원"),
        escape(o.userId),
        escape(recName),
        escape(recPhone),
        escape(pCode),
        escape(addr1),
        escape(addr2),
        escape(memo),
        escape(itemsSummary),
        o.totalAmount,
        o.shippingFee,
      ].join(",");
    });

    return "\uFEFF" + [header, ...rows].join("\r\n");
  }

  // ── 자동 전이(리더 작업) ──────────────────────────────
  // pending_payment 24시간 → canceled + 재고 복구(PG에서 이미 승인됐으면 paid로 반영),
  // shipped 뒤 5일 → delivered, delivered 뒤 7일 → confirmed(처리 중인 반품 요청이 있으면 미룬다),
  // 환불이 끝난(payments:resolve-refunds가 확정한) 승인 반품 → completed.
  // 시각을 받아(시계 주입) 테스트가 같은 시각으로 두 번 돌려 볼 수 있다. 모두 조건부 update라 여러 번 돌아도 같다
  async autoAdvance(now: Date, limit = 200): Promise<AutoAdvanceResult> {
    const system: ActorRef = { type: "system" };
    const due = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const [toDeliver, toConfirm] = await this.prisma.asAdmin((tx) => Promise.all([
      tx.order.findMany({ where: { status: "shipped", statusChangedAt: { lte: due(AUTO_DELIVER_DAYS) } }, select: { id: true }, orderBy: { id: "asc" }, take: limit }),
      tx.order.findMany({
        where: { status: "delivered", statusChangedAt: { lte: due(AUTO_CONFIRM_DAYS) }, returns: { none: { status: "requested" } } },
        select: { id: true }, orderBy: { id: "asc" }, take: limit,
      }),
    ]));
    const result: AutoAdvanceResult = { expired: 0, paidOnRecheck: 0, delivered: 0, confirmed: 0, returnsCompleted: 0 };
    await this.expireUnpaid(now, limit, result);
    for (const { id } of toDeliver) {
      const moved = await this.prisma.asAdmin((tx) => attemptTransition(tx, id, "deliver", system, { now, reason: `발송 ${AUTO_DELIVER_DAYS}일 경과` }));
      if (moved.ok) result.delivered++;
    }
    for (const { id } of toConfirm) {
      const moved = await this.prisma.asAdmin(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`; // 손님 구매확정과 같은 잠금(반품 신청과 줄 세우기)
        if (await tx.return.count({ where: { orderId: id, status: "requested" } })) return { ok: false };
        return attemptTransition(tx, id, "confirm", system, { now, reason: `배송 완료 ${AUTO_CONFIRM_DAYS}일 경과` });
      });
      if (moved.ok) result.confirmed++;
    }
    const approved = await this.prisma.asAdmin((tx) => tx.return.findMany({ where: { status: "approved", kind: "refund" }, select: { id: true }, take: limit }));
    if (approved.length > 0) {
      // 첫 시도(return-<id>)든 관리자의 재시도(return-<id>-r<n>)든 성공한 환불이 있으면 완료
      const ids = new Set(approved.map((r) => r.id));
      const settled = await this.prisma.asAdmin((tx) => tx.refund.findMany({
        where: { OR: approved.map((r) => ({ idempotencyKey: { startsWith: `return-${r.id}` } })), status: "succeeded" }, select: { idempotencyKey: true },
      }));
      const done = new Set(settled.map((r) => Number(r.idempotencyKey.match(RETURN_REFUND_KEY)?.[1])).filter((id) => ids.has(id)));
      for (const id of done) {
        if (await this.completeReturn(id, system, now)) result.returnsCompleted++;
      }
    }
    if (Object.values(result).some((n) => n > 0)) this.logger.log(`자동 전이: ${JSON.stringify(result)}`);
    return result;
  }

  // 결제 기한이 지난 주문. 토스는 위젯에 가기 전에 떠나면 웹훅이 오지 않아 우리가 끝내야 한다(Stripe는 세션 만료 웹훅도 온다).
  // 취소하기 전에 PG에 다시 묻는다: 승인돼 있으면(승인 응답·웹훅을 잃었다) 결제 완료로 반영하고, PG에 묻지 못하면 다음 회차로 미룬다
  private async expireUnpaid(now: Date, limit: number, result: AutoAdvanceResult): Promise<void> {
    const stale = await this.prisma.asAdmin((tx) => tx.order.findMany({
      // 옛 칸과 결제 행도 본다(expand 기간에 옛 API가 결제·취소한 주문은 status가 늦을 수 있다. 0034 트리거와 cancelUnpaidOrder가 한 번 더 막는다)
      where: {
        status: "pending_payment", paid: false, canceledAt: null, OR: [{ payment: null }, { payment: { status: "ready" } }],
        createdAt: { lte: new Date(now.getTime() - UNPAID_ORDER_TTL_HOURS * 60 * 60 * 1000) },
      },
      select: { id: true, payment: { select: { id: true, provider: true, providerOrderId: true, providerPaymentKey: true, amount: true, status: true } } },
      orderBy: { id: "asc" }, take: limit,
    }));
    for (const order of stale) {
      const p = order.payment;
      if (p && p.status === "ready" && p.provider !== "manual") {
        let pg: PgPayment | null;
        try {
          const gateway = this.gateways.get(p.provider);
          const key = p.providerPaymentKey ?? (await gateway.findPaymentKey(p.providerOrderId));
          pg = key ? await gateway.fetchPayment(key) : null;
        } catch (err) {
          this.logger.warn(`결제 기한 취소 보류: 주문 #${order.id} PG(${p.provider}) 조회 실패 - ${(err as Error).message}`);
          continue;
        }
        if (pg?.status === "paid") {
          if (pg.totalAmount !== p.amount || (pg.providerOrderId && pg.providerOrderId !== p.providerOrderId)) {
            this.logger.error(`결제 기한 취소 보류: 주문 #${order.id} PG 승인 금액·주문번호가 다르다(${pg.totalAmount}원 ≠ ${p.amount}원) - 사람이 확인한다`);
            continue;
          }
          const paid = await this.prisma.asAdmin((tx) => markPaid(tx, p.id, { paymentKey: pg.paymentKey, approvedAt: pg.approvedAt }));
          if (paid) result.paidOnRecheck++;
          this.logger.warn(`결제 기한 재조회: 주문 #${order.id}은 PG에서 이미 승인됨 → 결제 완료로 반영`);
          continue;
        }
      }
      const canceled = await this.prisma.asAdmin((tx) => cancelUnpaidOrder(tx, order.id, { now, reason: `결제 기한(${UNPAID_ORDER_TTL_HOURS}시간) 지남` }));
      if (canceled) result.expired++;
    }
  }

  // ── 내부 ──────────────────────────────────────────────

  private async lockedReturn(tx: Tx, returnId: number) {
    const [locked] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM returns WHERE id = ${returnId} FOR UPDATE`;
    if (!locked) throw new NotFoundException(`return ${returnId} not found`);
    return tx.return.findUniqueOrThrow({
      where: { id: returnId },
      include: { items: { orderBy: { productId: "asc" } }, order: { select: { userId: true, returnShippingFee: true } } },
    });
  }

  private async completeReturn(returnId: number, actor: ActorRef, now = new Date()): Promise<boolean> {
    if (!nextReturnStatus("approved", "complete", actor.type).ok) return false;
    const { count } = await this.prisma.asAdmin((tx) => tx.return.updateMany({ where: { id: returnId, status: "approved" }, data: { status: "completed", completedAt: now } }));
    return count > 0;
  }

  private async wasCanceledAfterPayment(orderId: number): Promise<boolean> {
    const row = await this.prisma.asAdmin((tx) => tx.orderStatusHistory.findFirst({
      where: { orderId, toStatus: "canceled", fromStatus: { in: ["paid", "preparing"] } }, select: { id: true },
    }));
    return row !== null;
  }

  // 커밋 뒤 환불(27). PG를 거치지 않은 결제(manual)나 결제가 없는 주문, 0원은 돌려줄 PG 결제가 없어 건너뛴다.
  // amount가 없으면 전액: 결제 금액에서 이 키가 아닌 환불(나갔거나 나갔을 수 있는 것)을 뺀 값. 다시 불러도 같은 금액이 나와야 같은 키로 재응답된다
  private async refundOrder(orderId: number, key: string, reason: string, amount?: number): Promise<RefundView | null> {
    const payment = await this.prisma.asAdmin((tx) => tx.payment.findUnique({ where: { orderId }, select: { id: true, provider: true, amount: true, status: true } }));
    if (!payment || payment.provider === "manual" || payment.status === "ready" || payment.status === "canceled") {
      this.logger.log(`환불 건너뜀: 주문 #${orderId} (${payment ? `${payment.status} 결제` : "결제 없음"}) - ${key}`);
      return null;
    }
    let refundAmount = amount;
    if (refundAmount === undefined) {
      const { _sum } = await this.prisma.asAdmin((tx) => tx.refund.aggregate({
        where: { paymentId: payment.id, status: { in: ["requested", "succeeded"] }, idempotencyKey: { not: key } }, _sum: { amount: true },
      }));
      refundAmount = payment.amount - (_sum.amount ?? 0);
    }
    if (refundAmount <= 0) return null;
    const { refund } = await this.refunds.request(orderId, { amount: refundAmount, reason }, key);
    return refund;
  }
}

const admin = (id: string): ActorRef => ({ type: "admin", id });

function checkTrackingNumber(raw: string): string {
  const n = normalizeTrackingNumber(raw);
  if (!TRACKING_NUMBER.test(n)) throw new BadRequestException("송장번호는 숫자 8~20자리입니다");
  return n;
}
