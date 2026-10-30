import { readFile } from "node:fs/promises";
import { adminDb } from "./admin-db.js";

// 0030의 백필 문장을 옛 모양의 주문(payments 행 없음) 위에서 다시 돌려 본다
const migration = new URL("../prisma/migrations/0030_payments_refunds/migration.sql", import.meta.url);

describe("0030 백필 - 기존 주문 → payments", () => {
  let backfill: string;

  beforeAll(async () => {
    const sql = await readFile(migration, "utf8");
    backfill = sql.slice(sql.indexOf("-- backfill"));
    expect(backfill).toMatch(/^-- backfill[\s\S]*INSERT INTO "payments"/);
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, stripe_events, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.create({ data: { id: "kim", name: "김" } });
    const day = new Date("2026-10-01T00:00:00Z");
    await adminDb.order.createMany({
      data: [
        { userId: "kim", totalAmount: 10_000, paid: true, stripeSessionId: "cs_old_paid", createdAt: day }, // 1 Stripe 결제 완료
        { userId: "kim", totalAmount: 20_000, paid: true, createdAt: day }, // 2 관리자·seed가 만든 결제 완료
        { userId: "kim", totalAmount: 30_000, paid: false, stripeSessionId: "cs_old_open" }, // 3 결제 대기
        { userId: "kim", totalAmount: 40_000, paid: false, stripeSessionId: "cs_old_expired", canceledAt: day }, // 4 기한 지나 취소
        { userId: "kim", totalAmount: 50_000, paid: false }, // 5 결제를 시작하지 않은 주문
      ],
    });
  });

  it("결제 완료 주문마다 paid인 payments 행이 하나씩, 금액·승인 시각이 옮겨지고, 두 번 돌려도 같다", async () => {
    await adminDb.$executeRawUnsafe(backfill);
    await adminDb.$executeRawUnsafe(backfill);

    const rows = await adminDb.payment.findMany({ orderBy: { orderId: "asc" } });
    expect(rows.map((r) => [r.orderId, r.provider, r.providerOrderId, r.amount, r.status])).toEqual([
      [1, "stripe", "cs_old_paid", 10_000, "paid"],
      [2, "manual", "order-2", 20_000, "paid"],
      [3, "stripe", "cs_old_open", 30_000, "ready"],
      [4, "stripe", "cs_old_expired", 40_000, "canceled"],
    ]);
    expect(rows.filter((r) => r.status === "paid").every((r) => r.approvedAt?.toISOString() === "2026-10-01T00:00:00.000Z")).toBe(true);

    const paidOrders = await adminDb.order.findMany({ where: { paid: true }, include: { payment: true } });
    expect(paidOrders.every((o) => o.payment?.status === "paid")).toBe(true);
  });
});
