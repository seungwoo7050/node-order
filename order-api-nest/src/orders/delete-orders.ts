import type { Prisma } from "../generated/prisma/client.js";

// 주문 지우기. 대금결제 기록(stripe·toss)은 주문과 함께 사라지면 안 된다(payments·refunds FK가 RESTRICT, 0031).
// 지워도 되는 결제 행만 여기서 먼저 명시적으로 지운다. 그 밖의 결제가 남은 주문을 지우면 외래 키 위반(P2003)으로 실패한다

type Tx = Prisma.TransactionClient;

async function deleteOrderRows(tx: Tx, orderIds: number[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  const { count } = await tx.order.deleteMany({ where: { id: { in: orderIds } } });
  return count;
}

// 데모 사용자(만료되는 임시 사용자)의 주문: 결제 수단과 관계없이 그 사용자의 결제·환불 기록까지 지운다
export async function deleteDemoUserOrders(tx: Tx, userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const demo = await tx.user.count({ where: { id: { in: userIds }, expiresAt: null } });
  if (demo > 0) throw new Error("데모 사용자(expires_at이 있는 사용자)의 주문만 결제 기록과 함께 지울 수 있습니다");
  const orders = await tx.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await tx.refund.deleteMany({ where: { payment: { orderId: { in: orderIds } } } });
  await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  return deleteOrderRows(tx, orderIds);
}

// 그 밖의 주문(seed의 견본 사용자 등): manual 결제와 결제가 없는 주문만 지운다.
// stripe·toss 결제가 있는 주문은 남기고 그 수를 돌려준다
export async function deleteOrdersKeepingPgPayments(tx: Tx, userIds: string[]): Promise<{ deleted: number; kept: number }> {
  const orders = await tx.order.findMany({ where: { userId: { in: userIds } }, select: { id: true, payment: { select: { provider: true } } } });
  const removable = orders.filter((o) => !o.payment || o.payment.provider === "manual").map((o) => o.id);
  await tx.payment.deleteMany({ where: { orderId: { in: removable }, provider: "manual" } });
  return { deleted: await deleteOrderRows(tx, removable), kept: orders.length - removable.length };
}
