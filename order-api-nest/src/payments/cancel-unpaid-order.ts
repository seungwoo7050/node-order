import type { Prisma } from "../generated/prisma/client.js";
import { attemptTransition, restoreOrderStock } from "../fulfillment/transitions.js";

// 결제되지 않은 주문을 취소하고 재고를 돌려놓는다.
// 결제 행 → 주문 행 순서로 잠근다: 결제 완료(markPaid)도 결제 행부터 잠그므로 두 전이가 같은 순서로 잠가 교착되지 않는다.
// status만 믿지 않는다: expand 기간에 옛 API(27)가 옛 칸(paid, canceled_at)과 결제 행만 바꾼 주문은 status가 늦을 수 있다
// (0034 트리거가 같은 트랜잭션에서 맞추지만, 잠근 뒤 옛 칸·결제 행을 한 번 더 본다). 이미 결제됐거나 취소된 주문이면 아무것도 하지 않는다
export async function cancelUnpaidOrder(
  tx: Prisma.TransactionClient,
  orderId: number,
  opts: { now?: Date; reason?: string } = {},
): Promise<boolean> {
  const [payment] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM payments WHERE order_id = ${orderId} FOR UPDATE`;
  if (payment && payment.status !== "ready" && payment.status !== "canceled") return false;
  const [order] = await tx.$queryRaw<{ paid: boolean; canceled_at: Date | null }[]>`SELECT paid, canceled_at FROM orders WHERE id = ${orderId} FOR UPDATE`;
  if (!order || order.paid || order.canceled_at) return false;
  await tx.payment.updateMany({ where: { orderId, status: "ready" }, data: { status: "canceled" } });
  // 주문 상태 기계: pending_payment → canceled (조건부 update라 웹훅·결제 기한·결제 시작 실패가 겹쳐도 한 번)
  const moved = await attemptTransition(tx, orderId, "expire", { type: "system" }, { reason: opts.reason ?? "결제되지 않은 주문 취소", now: opts.now });
  if (!moved.ok) return false;
  await restoreOrderStock(tx, orderId);
  return true;
}

// PG를 거치지 않고 결제 완료로 만드는 주문(관리자 POST /orders, seed, 데모 사용자 견본)에도 결제 행을 둔다
export function manualPayment(orderId: number, amount: number, approvedAt = new Date()) {
  return { orderId, provider: "manual" as const, providerOrderId: `order-${orderId}`, amount, status: "paid" as const, approvedAt };
}
