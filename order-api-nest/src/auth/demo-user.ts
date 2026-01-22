import { randomBytes } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { cancelUnpaidOrder } from "../payments/cancel-unpaid-order.js";

export const DEMO_USER_TTL_MS = Number(process.env.DEMO_USER_TTL_SECONDS ?? 24 * 60 * 60) * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DemoKind = "user" | "admin";

export const newDemoUserId = () => `demo-${randomBytes(4).toString("hex")}`;

export async function createDemoUser(tx: Prisma.TransactionClient, id: string, as: DemoKind): Promise<void> {
  await tx.user.create({
    data: {
      id,
      name: as === "admin" ? "데모 관리자" : "데모 방문자",
      role: as === "admin" ? "demo_admin" : "user",
      expiresAt: new Date(Date.now() + DEMO_USER_TTL_MS),
    },
  });
  await createSampleOrders(tx, id);
}

async function createSampleOrders(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const products = await tx.product.findMany({ where: { stock: { gt: 0 } }, select: { id: true, price: true } });
  const picked = products.sort(() => Math.random() - 0.5).slice(0, 3);
  const groups = [picked.slice(0, 2), picked.slice(2)].filter((g) => g.length > 0);
  for (const [i, group] of groups.entries()) {
    const items = group.map((p) => ({ productId: p.id, quantity: 1 + Math.floor(Math.random() * 2), unitPrice: p.price }));
    await tx.order.create({
      data: {
        userId,
        price: items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0),
        paid: i === 0,
        canceledAt: i === 0 ? null : new Date(),
        createdAt: new Date(Date.now() - (groups.length - i) * DAY_MS),
        items: { create: items },
      },
    });
  }
}

export async function deleteUsers(tx: Prisma.TransactionClient, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const pending = await tx.order.findMany({ where: { userId: { in: ids }, paid: false, canceledAt: null }, select: { id: true } });
  for (const o of pending) await cancelUnpaidOrder(tx, o.id);
  await tx.orderItem.deleteMany({ where: { order: { userId: { in: ids } } } });
  await tx.order.deleteMany({ where: { userId: { in: ids } } });
  await tx.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await tx.idempotencyKey.deleteMany({ where: { userId: { in: ids } } });
  await tx.outboxEvent.deleteMany({ where: { userId: { in: ids } } });
  const { count } = await tx.user.deleteMany({ where: { id: { in: ids } } });
  return count;
}
