import type { INestApplication } from "@nestjs/common";
import { BusinessMetricsJob } from "../src/leader/business-metrics.job.js";
import { adminDb } from "./admin-db.js";
import { startSimulator, type Simulator } from "./fake-pg.js";
import { CONSENT, SHIPPING, client, paymentOf, seedPaymentData, startPaymentApp } from "./payment-app.js";

const MINUTE = 60_000;
const DAY = 86_400_000;

// 라벨 이름은 이 목록 밖으로 나가지 않는다(손님 정보·주문 id·사용자 id를 라벨로 만들지 않는다).
// 기본 지표(prom-client collectDefaultMetrics)의 라벨도 포함한다
const ALLOWED_LABELS = new Set([
  "method", "route", "status_code", // HTTP
  "type", "result", "kind", "provider", "reason", "bucket", "feature", "model", "direction", "tool", // 업무·결제·LLM·MCP
  "le", // 히스토그램 구간
  "version", "major", "minor", "patch", "space", // 기본 지표(nodejs_version_info, 힙 공간, GC 종류)
]);
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /(?:\+?82|0)1\d[-. ]?\d{3,4}[-. ]?\d{4}/;

type Sample = { name: string; labels: Record<string, string>; value: number };
function parse(text: string): Sample[] {
  const samples: Sample[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)/.exec(line);
    if (!m) throw new Error(`읽을 수 없는 줄: ${line}`);
    const labels: Record<string, string> = {};
    for (const l of (m[2] ?? "").matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]!] = l[2]!;
    samples.push({ name: m[1]!, labels, value: Number(m[3]) });
  }
  return samples;
}

describe("업무 지표(/metrics)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let sim: Simulator;
  let tokens: { user: string; admin: string };

  beforeAll(async () => {
    ({ app, baseUrl } = await startPaymentApp());
    sim = await startSimulator("toss", baseUrl);
    process.env.TOSS_SIMULATOR_URL = sim.url;
    tokens = await seedPaymentData(baseUrl);
    await adminDb.$executeRaw`TRUNCATE reconciliation_issues, reconciliation_runs, search_dirty RESTART IDENTITY`;
  });

  afterAll(async () => {
    await adminDb.$executeRaw`TRUNCATE reconciliation_issues, reconciliation_runs, search_dirty RESTART IDENTITY`;
    delete process.env.TOSS_SIMULATOR_URL;
    await sim.stop();
    await app.close();
  });

  it("업무 게이지와 결제 승인 실패 카운터가 나오고, 라벨에 주문 id·이메일·연락처가 없다", async () => {
    const now = new Date();
    // 손님 연락처·주소가 있는 주문을 만들고, 금액을 바꿔 승인을 시도한다(실패 카운터)
    const started = await client(baseUrl, tokens.user).post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], shipping: SHIPPING, ...CONSENT, provider: "toss" });
    expect(started.status).toBe(201);
    const orderId = started.body.id as number;
    const payment = await paymentOf(orderId);
    const { paymentKey } = await sim.post<{ paymentKey: string }>("/__sim/authorize", { orderId: payment.providerOrderId, amount: payment.amount });
    expect((await client(baseUrl, tokens.user).post("/payments/toss/confirm", { paymentKey, orderId: payment.providerOrderId, amount: 1 })).status).toBe(400);

    // 결제 완료 뒤 5일 지난 주문(처리 지연), 결과 미상 환불(2시간 전), 미해결 대사 불일치, 15분 밀린 색인
    await adminDb.order.update({ where: { id: orderId }, data: { status: "paid", paid: true, statusChangedAt: new Date(now.getTime() - 5 * DAY) } });
    await adminDb.refund.create({ data: { paymentId: payment.id, amount: 1_000, reason: "테스트", idempotencyKey: `metrics-${orderId}`, status: "requested", createdAt: new Date(now.getTime() - 120 * MINUTE) } });
    await adminDb.reconciliationIssue.create({ data: { provider: "toss", businessDate: new Date("2026-01-15"), kind: "amount_mismatch", paymentKey: "pk-metrics", orderId } });
    await adminDb.searchDirty.create({ data: { productId: 1, markedAt: new Date(now.getTime() - 15 * MINUTE) } });

    await app.get(BusinessMetricsJob).collect(now);
    const text = await (await fetch(`${baseUrl}/metrics`)).text();
    const samples = parse(text);
    const value = (name: string, labels: Record<string, string> = {}) =>
      samples.find((s) => s.name === name && Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value;

    expect(value("reconciliation_open_issues")).toBe(1);
    expect(value("fulfillment_overdue_orders")).toBe(1);
    expect(value("refunds_unresolved_oldest_seconds")).toBeGreaterThanOrEqual(7_200);
    expect(value("search_index_lag_seconds")).toBeGreaterThanOrEqual(15 * 60);
    expect(value("outbox_oldest_unpublished_seconds")).toBeGreaterThanOrEqual(0);
    expect(value("payments_confirm_attempts_total", { provider: "toss" })).toBeGreaterThanOrEqual(1);
    expect(value("payments_confirm_failed_total", { provider: "toss", reason: "amount_mismatch" })).toBeGreaterThanOrEqual(1);
    expect(value("llm_daily_token_budget")).toBeGreaterThan(0);
    for (const name of ["mail_jobs_failed_total", "reconciliation_consecutive_failures", "llm_tokens_total", "mcp_tool_calls_total"]) {
      expect(text).toContain(`# TYPE ${name} `);
    }

    // 라벨 검사: 이름은 허용 목록 안, 값에 이메일·전화번호·주문번호(PG 주문 id)·사용자 id가 없다
    for (const s of samples) {
      for (const [k, v] of Object.entries(s.labels)) {
        expect(ALLOWED_LABELS, `${s.name}의 라벨 ${k}`).toContain(k);
        expect(v, `${s.name}{${k}}`).not.toMatch(EMAIL);
        expect(v, `${s.name}{${k}}`).not.toMatch(PHONE);
        expect(v).not.toContain(payment.providerOrderId);
        expect(v).not.toBe("kim");
        if (k !== "le" && k !== "status_code") expect(v, `${s.name}{${k}}에 주문 id`).not.toBe(String(orderId));
      }
    }
    expect(text).not.toContain(SHIPPING.recipientPhone);
    expect(text).not.toContain(SHIPPING.address1);
  });

  it("리더가 아니면 업무 게이지를 0으로 돌린다(옛 리더의 낡은 값이 남지 않게)", async () => {
    const job = app.get(BusinessMetricsJob);
    await job.collect(new Date());
    const leader = (app.get(BusinessMetricsJob) as unknown as { leaderElection: { leader: boolean } }).leaderElection;
    const was = leader.leader;
    leader.leader = false;
    try {
      expect(await job.run()).toBe(false);
      const text = await (await fetch(`${baseUrl}/metrics`)).text();
      expect(text).toMatch(/^reconciliation_open_issues 0$/m);
      expect(text).toMatch(/^fulfillment_overdue_orders 0$/m);
    } finally {
      leader.leader = was;
    }
  });
});
