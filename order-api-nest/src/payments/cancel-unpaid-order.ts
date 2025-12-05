import type { Prisma } from "../generated/prisma/client.js";

export async function cancelUnpaidOrder(tx: Prisma.TransactionClient, orderId: number): Promise<boolean> {
  const { count } = await tx.order.updateMany({ where: { id: orderId, paid: false, canceledAt: null }, data: { canceledAt: new Date() } });
  if (count === 0) return false;
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for (const item of items) await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
  return true;
}