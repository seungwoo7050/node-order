import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import { ReconciliationJob } from "../src/leader/reconciliation.job.js";
import { LeaderElection } from "../src/leader/leader-election.js";
import { ReconciliationService, kstDate } from "../src/reconciliation/reconciliation.service.js";
import { adminDb } from "./admin-db.js";
import { startSimulator, type Simulator } from "./fake-pg.js";
import { CONSENT, SHIPPING, client, demoAdminToken, paymentOf, seedPaymentData, startPaymentApp } from "./payment-app.js";

const run = promisify(execFile);

// PG 대사: 토스·Stripe 시뮬레이터에 불일치를 하나씩 심고 대사가 맞는 종류로 기록하는지 본다.
// 상품 7,000원 1개 = 결제 10,000원(배송비 3,000원)
describe("PG 대사", () => {
  let app: INestApplication;
  let baseUrl: string;
  let toss: Simulator;
  let stripe: Simulator;
  let tokens: { user: string; admin: string };
  let service: ReconciliationService;
  const today = kstDate();

  beforeAll(async () => {
    process.env.PAYMENT_TIMEOUT_MS = "400";
    ({ app, baseUrl } = await startPaymentApp());
    toss = await startSimulator("toss", baseUrl);
    stripe = await startSimulator("stripe", baseUrl);
    process.env.TOSS_SIMULATOR_URL = toss.url;
    process.env.STRIPE_SIMULATOR_URL = stripe.url;
    service = app.get(ReconciliationService);
  });

  beforeEach(async () => {
    await toss.reset();
    await stripe.reset();
    tokens = await seedPaymentData(baseUrl);
    await adminDb.product.update({ where: { id: 1 }, data: { stock: 100 } });
    await adminDb.$executeRaw`TRUNCATE reconciliation_issues, reconciliation_runs RESTART IDENTITY`;
  });

  afterAll(async () => {
    delete process.env.TOSS_SIMULATOR_URL;
    delete process.env.STRIPE_SIMULATOR_URL;
    delete process.env.PAYMENT_TIMEOUT_MS;
    await toss.stop();
    await stripe.stop();
    await app.close();
  });

  const admin = () => client(baseUrl, tokens.admin);
  const checkout = async (provider: "toss" | "stripe") => {
    const started = await client(baseUrl, tokens.user).post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], shipping: SHIPPING, ...CONSENT, provider });
    expect(started.status).toBe(201);
    return { orderId: started.body.id as number, payment: await paymentOf(started.body.id) };
  };
  const paidToss = async () => {
    const { orderId, payment } = await checkout("toss");
    const { paymentKey } = await toss.post<{ paymentKey: string }>("/__sim/authorize", { orderId: payment.providerOrderId, amount: payment.amount });
    expect((await client(baseUrl, tokens.user).post("/payments/toss/confirm", { paymentKey, orderId: payment.providerOrderId, amount: payment.amount })).status).toBe(200);
    return { orderId, paymentKey };
  };
  const paidStripe = async () => {
    const { orderId, payment } = await checkout("stripe");
    const res = await fetch(`${stripe.url}/c/pay/${payment.providerOrderId}/complete`, { method: "POST", redirect: "manual" });
    expect(res.status).toBe(303);
    const paid = await paymentOf(orderId);
    expect(paid.status).toBe("paid");
    return { orderId, paymentKey: paid.providerPaymentKey! };
  };
  const refund = (orderId: number, amount: number) =>
    admin().post(`/admin/orders/${orderId}/refunds`, { amount, reason: "고객 요청" }, { "Idempotency-Key": `recon-${orderId}-${amount}` });
  const issueSet = async () =>
    (await adminDb.reconciliationIssue.findMany()).map((i) => `${i.provider}:${i.kind}:${i.paymentKey}`).sort();

  it("불일치 다섯 종류를 하나씩 심으면 각각 맞는 종류로 기록되고, 일치하는 결제는 기록되지 않는다. 두 번 돌려도 같다", async () => {
    const amount = await paidToss();
    const status = await paidToss();
    const missingInPg = await paidToss();
    const refunded = await paidToss();
    const okPartial = await paidToss();
    const okStripe = await paidStripe();
    const okStripeRefunded = await paidStripe();

    // 일치하는 부분 환불(양쪽 다 3,000원)
    expect((await refund(okPartial.orderId, 3_000)).status).toBe(201);
    expect((await refund(okStripeRefunded.orderId, 2_000)).status).toBe(201);
    // 1. amount_mismatch: PG 쪽 결제 금액이 12,000원(잔액도 같이 올려 취소액은 0원 그대로)
    await toss.post(`/__sim/payments/${amount.paymentKey}/patch`, { totalAmount: 12_000, balanceAmount: 12_000 });
    // 2. status_mismatch: PG 관리 화면에서 취소된 것처럼 상태만 바뀌었다(우리는 paid)
    await toss.post(`/__sim/payments/${status.paymentKey}/patch`, { status: "CANCELED" });
    // 3. missing_in_db: PG에만 있는 결제(웹훅 누락)
    const pgOnly = await toss.post<{ paymentKey: string }>("/__sim/payments", { orderId: "order-999-lost", amount: 8_000 });
    // 4. missing_in_pg: 우리는 승인됐다고 적었는데 PG 목록에 없다
    await toss.post(`/__sim/payments/${missingInPg.paymentKey}/delete`);
    // 5. refund_mismatch: 우리는 3,000원 환불 성공, PG의 취소 금액은 2,000원
    expect((await refund(refunded.orderId, 3_000)).status).toBe(201);
    await toss.post(`/__sim/payments/${refunded.paymentKey}/patch`, { cancelAmounts: [2_000], balanceAmount: 8_000 });

    const first = await service.run(today);
    expect(first.failed).toBe(false);
    expect(first.runs.map((r) => [r.provider, r.error])).toEqual([["toss", null], ["stripe", null]]);
    const expected = [
      `toss:amount_mismatch:${amount.paymentKey}`,
      `toss:missing_in_db:${pgOnly.paymentKey}`,
      `toss:missing_in_pg:${missingInPg.paymentKey}`,
      `toss:refund_mismatch:${refunded.paymentKey}`,
      `toss:status_mismatch:${status.paymentKey}`,
    ].sort();
    expect(await issueSet()).toEqual(expected);
    const byKind = Object.fromEntries((await adminDb.reconciliationIssue.findMany()).map((i) => [i.kind, i]));
    expect(byKind.amount_mismatch).toMatchObject({ orderId: amount.orderId, ourValue: { amount: 10_000 }, pgValue: { amount: 12_000 } });
    expect(byKind.status_mismatch).toMatchObject({ orderId: status.orderId, ourValue: { status: "paid" }, pgValue: { status: "refunded" } });
    expect(byKind.missing_in_db).toMatchObject({ orderId: null, ourValue: null, pgValue: { amount: 8_000, providerOrderId: "order-999-lost" } });
    expect(byKind.missing_in_pg).toMatchObject({ orderId: missingInPg.orderId, pgValue: null });
    expect(byKind.refund_mismatch).toMatchObject({ orderId: refunded.orderId, ourValue: { refunded: 3_000 }, pgValue: { refunded: 2_000 } });
    // 일치한 결제(부분 환불 포함, Stripe 둘)는 기록되지 않는다
    const recorded = new Set((await adminDb.reconciliationIssue.findMany()).map((i) => i.orderId));
    for (const ok of [okPartial, okStripe, okStripeRefunded]) expect(recorded.has(ok.orderId)).toBe(false);
    const runs = await adminDb.reconciliationRun.findMany({ orderBy: { id: "asc" } });
    expect(runs.map((r) => [r.provider, r.pgCount, r.issueCount, r.error, r.finishedAt !== null])).toEqual([["toss", 5, 5, null, true], ["stripe", 2, 0, null, true]]);

    const ids = (await adminDb.reconciliationIssue.findMany({ orderBy: { id: "asc" } })).map((i) => i.id);
    const second = await service.run(today);
    expect(second.runs.map((r) => r.issueCount)).toEqual([5, 0]);
    expect(await issueSet()).toEqual(expected);
    expect((await adminDb.reconciliationIssue.findMany({ orderBy: { id: "asc" } })).map((i) => i.id)).toEqual(ids);
  });

  it("해결한 건은 값이 그대로면 해결 상태를 유지하고, 값이 바뀌면 다시 열린다", async () => {
    const a = await paidToss();
    await toss.post(`/__sim/payments/${a.paymentKey}/patch`, { totalAmount: 12_000, balanceAmount: 12_000 });
    await service.run(today);
    const listed = await admin().get("/admin/reconciliation/issues?kind=amount_mismatch");
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.counts).toMatchObject({ open: 1, amount_mismatch: 1 });
    const id = listed.body.items[0].id;

    expect((await admin().patch(`/admin/reconciliation/issues/${id}`, { resolved: true })).status).toBe(400); // 메모 없이는 안 된다
    const resolved = await admin().patch(`/admin/reconciliation/issues/${id}`, { resolved: true, note: "PG 관리 화면에서 금액 정정 요청함" });
    expect(resolved.status).toBe(200);
    const resolvedAt = resolved.body.resolvedAt;

    await service.run(today);
    expect(await adminDb.reconciliationIssue.findUniqueOrThrow({ where: { id } })).toMatchObject({ resolutionNote: "PG 관리 화면에서 금액 정정 요청함" });
    expect((await adminDb.reconciliationIssue.findUniqueOrThrow({ where: { id } })).resolvedAt?.toISOString()).toBe(resolvedAt);
    expect((await admin().get("/admin/reconciliation/issues")).body.items).toHaveLength(0); // 기본은 미해결만
    expect((await admin().get("/admin/reconciliation/issues?state=resolved")).body.items).toHaveLength(1);

    await toss.post(`/__sim/payments/${a.paymentKey}/patch`, { totalAmount: 13_000, balanceAmount: 13_000 });
    await service.run(today);
    const reopened = await adminDb.reconciliationIssue.findUniqueOrThrow({ where: { id } });
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.pgValue).toEqual({ amount: 13_000 });
    expect(await adminDb.reconciliationIssue.count()).toBe(1);
  });

  it("먼저 결과 미상 환불을 확정한 뒤 대사한다(시간 초과 환불이 refund_mismatch로 남지 않는다)", async () => {
    const a = await paidToss();
    await toss.fault("cancel", "timeout", { delayMs: 1_500 });
    expect((await refund(a.orderId, 3_000)).status).toBe(202); // 결과 모름: requested
    const result = await service.run(today, { refundsOlderThanMs: 0 });
    expect(result.refunds).toMatchObject({ checked: 1, succeeded: 1 });
    expect(await adminDb.reconciliationIssue.count()).toBe(0);
  });

  it("토스의 거래 조회가 500이어도 Stripe는 대사되고, run에 실패가 남고, 명령의 종료 코드가 0이 아니다", async () => {
    await paidToss();
    const s = await paidStripe();
    await stripe.post(`/__sim/intents/${s.paymentKey}/patch`, { amount: 11_000 });
    await toss.fault("transactions", "internal");

    const result = await service.run(today);
    expect(result.failed).toBe(true);
    const [tossRun, stripeRun] = result.runs;
    expect(tossRun).toMatchObject({ provider: "toss", issueCount: 0 });
    expect(tossRun!.error).toMatch(/500/);
    expect(stripeRun).toMatchObject({ provider: "stripe", error: null, pgCount: 1, issueCount: 1 });
    expect(await issueSet()).toEqual([`stripe:amount_mismatch:${s.paymentKey}`]);
    const runs = await admin().get("/admin/reconciliation/runs");
    expect(runs.body.map((r: { provider: string; error: string | null }) => [r.provider, r.error !== null])).toEqual([["stripe", false], ["toss", true]]);

    // 명령: 실패한 provider가 있으면 종료 코드 1, 없으면 0 (같은 시뮬레이터·테스트 DB를 쓴다)
    const env = { ...process.env, TOSS_SIMULATOR_URL: toss.url, STRIPE_SIMULATOR_URL: stripe.url };
    await toss.fault("transactions", "internal");
    const failed = await run("npx", ["tsx", "scripts/reconcile.ts", `--date=${today}`], { env }).then(() => 0, (err: { code: number; stdout: string }) => {
      expect(err.stdout).toMatch(/toss: 실패/);
      expect(err.stdout).toMatch(/stripe: PG 1건, 우리 \d+건, 불일치 1건/);
      return err.code;
    });
    expect(failed).toBe(1);
    const ok = await run("npx", ["tsx", "scripts/reconcile.ts", `--date=${today}`], { env });
    expect(ok.stdout).toMatch(/toss: PG 1건/);
    expect(await issueSet()).toEqual([`stripe:amount_mismatch:${s.paymentKey}`]);
  }, 60_000);

  it("정기 작업은 04:00(Asia/Seoul) 전에는 돌지 않고, 뒤에는 전날 분을 하루 한 번만 돈다", async () => {
    const job = app.get(ReconciliationJob);
    vi.spyOn(app.get(LeaderElection), "isLeader", "get").mockReturnValue(true);
    try {
      const day = new Date(`${today}T00:00:00+09:00`).getTime();
      expect(await job.tick(new Date(day + 3 * 3600_000 + 59 * 60_000))).toBe(false); // 03:59
      expect(await adminDb.reconciliationRun.count()).toBe(0);
      expect(await job.tick(new Date(day + 4 * 3600_000))).toBe(true); // 04:00
      const runs = await adminDb.reconciliationRun.findMany();
      expect(runs.map((r) => r.periodStart.toISOString())).toEqual(
        expect.arrayContaining([new Date(`${kstDate(new Date(day), 1)}T00:00:00+09:00`).toISOString()]),
      );
      expect(await job.tick(new Date(day + 5 * 3600_000))).toBe(false); // 이미 돌았다
      expect(await adminDb.reconciliationRun.count()).toBe(runs.length);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("데모 관리자는 불일치 목록과 실행 기록을 읽을 수 있고 해결 표시는 403", async () => {
    const issue = await adminDb.reconciliationIssue.create({ data: { provider: "toss", kind: "missing_in_pg", paymentKey: "pk-x", businessDate: new Date() } });
    const demo = client(baseUrl, await demoAdminToken(baseUrl));
    expect((await demo.get("/admin/reconciliation/issues")).status).toBe(200);
    expect((await demo.get("/admin/reconciliation/runs")).status).toBe(200);
    expect((await demo.patch(`/admin/reconciliation/issues/${issue.id}`, { resolved: true, note: "x" })).status).toBe(403);
    expect((await client(baseUrl, tokens.user).get("/admin/reconciliation/issues")).status).toBe(403);
    expect((await adminDb.reconciliationIssue.findUniqueOrThrow({ where: { id: issue.id } })).resolvedAt).toBeNull();
  });
});
