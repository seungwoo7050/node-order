import type { Prisma } from "../generated/prisma/client.js";
import { afterOrder, encodeOrderCursor, orderListOrder, toPage } from "../pagination/cursor.js";
import { orderSelect } from "./order-select.js";

export async function listMyOrders(tx: Prisma.TransactionClient, userId: string, page: { limit: number; cursor?: string | null }) {
  const rows = await tx.order.findMany({
    where: { userId, ...afterOrder(page.cursor) },
    select: orderSelect,
    orderBy: [...orderListOrder],
    take: page.limit + 1,
  });
  return toPage(rows, page.limit, encodeOrderCursor);
}
