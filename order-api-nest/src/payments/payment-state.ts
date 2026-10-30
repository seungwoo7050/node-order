import type { Prisma } from "../generated/prisma/client.js";
import { attemptTransition } from "../fulfillment/transitions.js";

// 결제 상태 전이. 모두 조건부 update(WHERE status = ...)라서 승인 요청·웹훅·재시도가 동시에 와도 한 번만 일어난다.
// 같은 트랜잭션에서 주문 상태를 paid로 옮기고(orders.paid도 같이 맞춘다) outbox에 order.paid를 남긴다

export async function markPaid(
  tx: Prisma.TransactionClient,
  paymentId: number,
  pg: { paymentKey: string | null; approvedAt: Date | null },
): Promise<boolean> {
  const { count } = await tx.payment.updateMany({
    where: { id: paymentId, status: "ready" },
    data: { status: "paid", providerPaymentKey: pg.paymentKey, approvedAt: pg.approvedAt ?? new Date() },
  });
  if (count === 0) return false;
  const { orderId } = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { orderId: true } });
  // 주문 상태 기계: pending_payment → paid (이력과 order.paid 알림도 여기서 남는다)
  const moved = await attemptTransition(tx, orderId, "pay", { type: "system" }, { reason: "PG 결제 승인" });
  if (!moved.ok) {
    // 상태 기계 밖에 있던 주문(백필 전 옛 행 등): 27까지처럼 옛 칸과 알림만 맞춘다
    const order = await tx.order.update({ where: { id: orderId }, data: { paid: true }, select: { id: true, userId: true } });
    await tx.outboxEvent.create({ data: { type: "order.paid", userId: order.userId, payload: { orderId: order.id } } });
  }
  return true;
}

// 환불이 succeeded로 바뀐 뒤 결제 상태를 누적 환불액으로 다시 정한다(결제 행을 잠그고 센다)
export async function syncRefundedStatus(tx: Prisma.TransactionClient, paymentId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { amount: true } });
  const { _sum } = await tx.refund.aggregate({ where: { paymentId, status: "succeeded" }, _sum: { amount: true } });
  const refunded = _sum.amount ?? 0;
  await tx.payment.updateMany({
    where: { id: paymentId, status: { in: ["paid", "partial_refunded"] } },
    data: { status: refunded === 0 ? "paid" : refunded >= payment.amount ? "refunded" : "partial_refunded" },
  });
}
