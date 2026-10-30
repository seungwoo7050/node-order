import type { INestApplication } from "@nestjs/common";
import { Redis } from "ioredis";
import { DashboardService } from "../src/admin/dashboard.service.js";
import { StoreSettingsService } from "../src/admin/store-settings.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { kstDate } from "../src/reconciliation/reconciliation.service.js";
import { SearchStats } from "../src/search/search-stats.js";
import { adminDb } from "./admin-db.js";
import { client, demoAdminToken, seedPaymentData, startPaymentApp } from "./payment-app.js";

const MINUTE = 60_000;

// 대시보드 타일. 하루 경계는 Asia/Seoul 자정이다(서버·DB 시간대와 상관없이)
describe("GET /admin/dashboard", () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokens: { user: string; admin: string };
  const redis = new Redis(process.env.REDIS_URL!);

  beforeAll(async () => {
    ({ app, baseUrl } = await startPaymentApp());
  });

  beforeEach(async () => {
    tokens = await seedPaymentData(baseUrl);
    await adminDb.$executeRaw`TRUNCATE reconciliation_issues, reconciliation_runs RESTART IDENTITY`;
    const keys = await redis.keys("test:search:*");
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
    await app.close();
  });

  // 결제(와 환불)가 붙은 주문을 시각을 정해 만든다
  const order = async (input: {
    status: "paid" | "preparing" | "shipped" | "delivered" | "canceled";
    amount: number; approvedAt: Date; paymentStatus: "paid" | "partial_refunded" | "refunded" | "canceled";
    refunds?: { amount: number; status: "requested" | "succeeded" | "failed"; createdAt: Date }[];
  }) => {
    const o = await adminDb.order.create({ data: { userId: "kim", totalAmount: input.amount, paid: true, status: input.status, createdAt: input.approvedAt } });
    const p = await adminDb.payment.create({
      data: { orderId: o.id, provider: "toss", providerOrderId: `order-${o.id}`, providerPaymentKey: `pk-${o.id}`, amount: input.amount, status: input.paymentStatus, approvedAt: input.approvedAt },
    });
    for (const [i, r] of (input.refunds ?? []).entries()) {
      await adminDb.refund.create({ data: { paymentId: p.id, amount: r.amount, reason: "테스트", idempotencyKey: `r-${o.id}-${i}`, status: r.status, createdAt: r.createdAt } });
    }
    return o.id;
  };

  it("자정(Asia/Seoul) 앞뒤로 만든 주문과 부분 환불이 섞여도 오늘 주문 수·순매출·처리 대기·재고 부족·0건 검색어가 기대값과 같다", async () => {
    const midnight = new Date(`${kstDate()}T00:00:00+09:00`); // 오늘 0시(한국)
    const before = new Date(midnight.getTime() - MINUTE); // 어제 23:59
    const after = new Date(midnight.getTime() + MINUTE); // 오늘 00:01

    // 어제 23:59 결제 10,000원 → 오늘 00:01 3,000원 부분 환불(오늘 매출에서 뺀다, 주문 수에는 안 든다)
    const yesterday = await order({ status: "shipped", amount: 10_000, approvedAt: before, paymentStatus: "partial_refunded", refunds: [{ amount: 3_000, status: "succeeded", createdAt: after }] });
    // 오늘 00:01 결제 20,000원 → 5,000원 부분 환불
    await order({ status: "paid", amount: 20_000, approvedAt: after, paymentStatus: "partial_refunded", refunds: [{ amount: 5_000, status: "succeeded", createdAt: after }] });
    // 오늘 결제 15,000원, 실패한 환불(빼지 않는다)
    await order({ status: "preparing", amount: 15_000, approvedAt: after, paymentStatus: "paid", refunds: [{ amount: 2_000, status: "failed", createdAt: after }] });
    // 오늘 결제 5,000원, 결과를 아직 모르는 환불(빼지 않는다)
    await order({ status: "paid", amount: 5_000, approvedAt: after, paymentStatus: "paid", refunds: [{ amount: 1_000, status: "requested", createdAt: after }] });
    // 어제 23:59 결제 7,000원(오늘 것이 아니다)
    await order({ status: "delivered", amount: 7_000, approvedAt: before, paymentStatus: "paid" });
    // 오늘 결제됐다가 전액 환불(주문 수에 들고, 환불액도 뺀다)
    await order({ status: "canceled", amount: 4_000, approvedAt: after, paymentStatus: "refunded", refunds: [{ amount: 4_000, status: "succeeded", createdAt: after }] });
    // 결제되지 않은 주문(결제 대기 중 취소)
    const unpaid = await adminDb.order.create({ data: { userId: "kim", totalAmount: 9_000, paid: false, status: "canceled" } });
    await adminDb.payment.create({ data: { orderId: unpaid.id, provider: "toss", providerOrderId: `order-${unpaid.id}`, amount: 9_000, status: "canceled" } });

    // 반품 요청 2건(하나는 이미 승인)
    await adminDb.return.create({ data: { orderId: yesterday, kind: "refund", reason: "defective", status: "requested" } });
    await adminDb.return.create({ data: { orderId: yesterday, kind: "exchange", reason: "wrong_item", status: "approved" } });

    // 재고: 기본 기준 5개 이하(상품 #1은 10개)
    for (const [name, stock] of [["품절", 0], ["세 개", 3], ["다섯 개", 5], ["여섯 개", 6]] as const) {
      await adminDb.product.create({ data: { name, price: 1_000, stock } });
    }

    // 0건 검색어(26의 집계를 그대로 쓴다). 같은 IP·같은 검색어는 1시간에 한 번 센다
    const stats = app.get(SearchStats);
    await stats.record("보라색 우산", "10.0.0.1", false);
    await stats.record("보라색 우산", "10.0.0.2", false);
    await stats.record("보라색 우산", "10.0.0.2", false);
    await stats.record("텐트", "10.0.0.1", false);
    await stats.record("이어폰", "10.0.0.1", true); // 결과가 있었던 검색어는 들지 않는다

    // 미해결 대사 불일치 1건(해결한 것은 세지 않는다)
    await adminDb.reconciliationIssue.create({ data: { provider: "toss", kind: "amount_mismatch", paymentKey: "pk-a", businessDate: midnight } });
    await adminDb.reconciliationIssue.create({ data: { provider: "toss", kind: "status_mismatch", paymentKey: "pk-b", businessDate: midnight, resolvedAt: new Date(), resolutionNote: "확인" } });

    const res = await client(baseUrl, tokens.admin).get("/admin/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.today).toEqual({ date: kstDate(), orders: 4, paidAmount: 44_000, refundedAmount: 12_000, netSales: 32_000, href: "/admin/orders" });
    expect(res.body.pending).toEqual({
      paid: { count: 2, href: "/admin/orders?status=paid" },
      preparing: { count: 1, href: "/admin/orders?status=preparing" },
      returnsRequested: { count: 1, href: "/admin/orders?returns=requested" },
    });
    expect(res.body.lowStock).toMatchObject({ threshold: 5, count: 3, href: "/admin/products" });
    expect(res.body.lowStock.items.map((p: { name: string; stock: number }) => [p.name, p.stock])).toEqual([["품절", 0], ["세 개", 3], ["다섯 개", 5]]);
    expect(res.body.zeroResultQueries.items).toEqual([{ query: "보라색 우산", count: 2 }, { query: "텐트", count: 1 }]);
    expect(res.body.reconciliation).toEqual({ unresolved: 1, href: "/admin/reconciliation" });

    // 타일 링크: 반품 요청 타일이 가리키는 목록은 처리하지 않은 반품이 있는 주문만이다
    const linked = await client(baseUrl, tokens.admin).get("/admin/orders?returns=requested");
    expect(linked.body.items.map((o: { id: number }) => o.id)).toEqual([yesterday]);
  });

  it("DB 세션 시간대가 UTC가 아니어도 같은 날을 오늘로 센다(쿼리가 Asia/Seoul을 적는다)", async () => {
    const midnight = new Date(`${kstDate()}T00:00:00+09:00`);
    await order({ status: "paid", amount: 1_000, approvedAt: new Date(midnight.getTime() + MINUTE), paymentStatus: "paid" });
    await order({ status: "paid", amount: 2_000, approvedAt: new Date(midnight.getTime() - MINUTE), paymentStatus: "paid" });
    // 세션 시간대를 바꾼 연결로 같은 서비스를 돌린다(서버 시간대에 기댔다면 경계가 어긋난다)
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("options", "-c TimeZone=America/Los_Angeles");
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString();
    const prisma = new PrismaService();
    process.env.DATABASE_URL = saved;
    try {
      expect((await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`)[0]!.tz).toBe("America/Los_Angeles");
      const dashboard = new DashboardService(prisma, app.get(SearchStats), app.get(StoreSettingsService));
      expect((await dashboard.get()).today).toMatchObject({ orders: 1, paidAmount: 1_000, netSales: 1_000 });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("데모 관리자는 대시보드를 읽을 수 있고, 손님은 403", async () => {
    expect((await client(baseUrl, await demoAdminToken(baseUrl)).get("/admin/dashboard")).status).toBe(200);
    expect((await client(baseUrl, tokens.user).get("/admin/dashboard")).status).toBe(403);
  });
});
