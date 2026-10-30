import { readFile } from "node:fs/promises";
import { adminDb } from "./admin-db.js";

// 0032의 백필 문장을 옛 모양의 주문(status가 기본값 pending_payment) 위에서 다시 돌려 본다
const migration = new URL("../prisma/migrations/0032_fulfillment/migration.sql", import.meta.url);

describe("0032 백필 - paid·canceled_at → orders.status", () => {
  let backfill: string;

  beforeAll(async () => {
    const sql = await readFile(migration, "utf8");
    backfill = sql.slice(sql.indexOf("-- backfill"));
    expect(backfill).toMatch(/^-- backfill[\s\S]*UPDATE "orders"/);
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, stripe_events, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.create({ data: { id: "kim", name: "김" } });
    const created = new Date("2026-10-01T00:00:00Z");
    const approved = new Date("2026-10-01T00:05:00Z");
    const canceled = new Date("2026-10-02T00:00:00Z");
    await adminDb.order.createMany({
      data: [
        { userId: "kim", totalAmount: 10_000, paid: true, createdAt: created }, // 1 결제 완료(결제 행 있음)
        { userId: "kim", totalAmount: 20_000, paid: true, createdAt: created }, // 2 결제 완료(결제 행 없음)
        { userId: "kim", totalAmount: 30_000, paid: false, canceledAt: canceled, createdAt: created }, // 3 취소
        { userId: "kim", totalAmount: 40_000, paid: false, createdAt: created }, // 4 결제 대기
      ],
    });
    await adminDb.payment.create({ data: { orderId: 1, provider: "manual", providerOrderId: "order-1", amount: 10_000, status: "paid", approvedAt: approved } });
  });

  it("결제 완료는 paid(결제 시각), 취소는 canceled(취소 시각), 나머지는 pending_payment. 두 번 돌려도 같다", async () => {
    await adminDb.$executeRawUnsafe(backfill);
    const first = await adminDb.order.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, statusChangedAt: true } });
    await adminDb.$executeRawUnsafe(backfill);
    const second = await adminDb.order.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, statusChangedAt: true } });
    expect(second).toEqual(first);
    expect(first.map((o) => [o.id, o.status, o.statusChangedAt.toISOString()])).toEqual([
      [1, "paid", "2026-10-01T00:05:00.000Z"],
      [2, "paid", "2026-10-01T00:00:00.000Z"],
      [3, "canceled", "2026-10-02T00:00:00.000Z"],
      [4, "pending_payment", expect.any(String)],
    ]);
  });

  it("이미 상태 기계로 움직인 주문(shipped 등)은 건드리지 않는다", async () => {
    await adminDb.order.update({ where: { id: 1 }, data: { status: "shipped" } });
    await adminDb.$executeRawUnsafe(backfill);
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: 1 } })).status).toBe("shipped");
  });
});
