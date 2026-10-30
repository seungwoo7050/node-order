import type { Prisma } from "../generated/prisma/client.js";

// 결제되지 않은 주문을 취소하고 재고를 돌려놓는다.
// 결제 행을 먼저 바꾼다: 결제 완료(markPaid)도 결제 행부터 잠그므로 두 전이가 같은 순서로 잠가 교착되지 않는다
export async function cancelUnpaidOrder(tx: Prisma.TransactionClient, orderId: number): Promise<boolean> {
  await tx.payment.updateMany({ where: { orderId, status: "ready" }, data: { status: "canceled" } });
  const { count } = await tx.order.updateMany({ where: { id: orderId, paid: false, canceledAt: null }, data: { canceledAt: new Date() } });
  if (count === 0) return false;
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for (const item of items) await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
  return true;
}

// PG를 거치지 않고 결제 완료로 만드는 주문(관리자 POST /orders, seed, 데모 사용자 견본)에도 결제 행을 둔다
export function manualPayment(orderId: number, amount: number, approvedAt = new Date()) {
  return { orderId, provider: "manual" as const, providerOrderId: `order-${orderId}`, amount, status: "paid" as const, approvedAt };
}
