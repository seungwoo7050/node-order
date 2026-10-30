import type { INestApplication } from "@nestjs/common";
import { adminDb } from "./admin-db.js";
import { demoAdminToken, seedPaymentData, startPaymentApp } from "./payment-app.js";

// 비밀값 분리: 비밀값(PG 키, 오류 추적 DSN, LLM 키 등)은 환경변수에만 있고, 설정 API·관리자 화면이 쓰는 응답 어디에도 실리지 않는다.
// 응답 전체(본문과 헤더)를 문자열로 만들어 비밀값이 한 조각이라도 있는지 본다
const PLANTED = {
  TOSS_SECRET_KEY: "test_sk_planted-toss-secret-9f2c",
  TOSS_CLIENT_KEY: "test_ck_planted-public-client-key", // 위젯용 공개 키(비밀이 아니다)
  STRIPE_SECRET_KEY: "sk_test_planted-stripe-secret-7d1a",
  STRIPE_WEBHOOK_SECRET: "whsec_planted-webhook-secret-41be",
  SENTRY_DSN: "https://planted-dsn-key-5a9e@errors.example.com/42",
  LLM_API_KEY: "llm-planted-api-key-c3d8",
};
// .env에서 읽힌 다른 비밀값도 같이 본다(짧은 자리표시자는 뺀다)
const FROM_ENV = ["JWT_SECRET", "GITHUB_CLIENT_SECRET", "S3_SECRET_KEY", "DEMO_PASSWORD"];

describe("비밀값 분리 - 설정 API·관리자 응답", () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokens: { user: string; admin: string };
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of [...Object.keys(PLANTED), "STRIPE_SIMULATOR_URL", "TOSS_SIMULATOR_URL"]) saved[k] = process.env[k];
    Object.assign(process.env, PLANTED);
    delete process.env.STRIPE_SIMULATOR_URL;
    delete process.env.TOSS_SIMULATOR_URL;
    ({ app, baseUrl } = await startPaymentApp());
    tokens = await seedPaymentData(baseUrl);
    await adminDb.reconciliationIssue.deleteMany();
    await adminDb.reconciliationIssue.create({ data: { provider: "toss", kind: "amount_mismatch", paymentKey: "pk-1", businessDate: new Date(), ourValue: { amount: 1 }, pgValue: { amount: 2 } } });
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    await app.close();
  });

  const secrets = () => {
    const values = Object.entries(PLANTED).filter(([k]) => k !== "TOSS_CLIENT_KEY").map(([, v]) => v);
    for (const k of FROM_ENV) if ((process.env[k]?.length ?? 0) >= 8) values.push(process.env[k]!);
    // DSN은 통째로도, 키 조각만으로도 나오면 안 된다
    values.push("planted-dsn-key-5a9e");
    return values;
  };

  const PATHS = [
    "/admin/settings", "/admin/dashboard", "/admin/reconciliation/issues?state=all", "/admin/reconciliation/runs",
    "/admin/legal/terms", "/admin/legal/privacy", "/admin/legal/refund", "/features", "/store", "/legal/privacy",
  ];

  it.each([["관리자", "admin"], ["데모 관리자", "demo"]] as const)("%s가 받는 응답 전체에 환경변수 비밀값이 없다", async (_label, who) => {
    const token = who === "admin" ? tokens.admin : await demoAdminToken(baseUrl);
    for (const path of PATHS) {
      const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status, path).toBe(200);
      const whole = `${JSON.stringify([...res.headers.entries()])}\n${await res.text()}`;
      for (const secret of secrets()) expect(whole.includes(secret), `${path}에 비밀값이 있다`).toBe(false);
    }
  });

  it("설정 응답의 칸은 상점 정보와 정책 값뿐이다(비밀 칸이 스키마에 없다)", async () => {
    const res = await fetch(`${baseUrl}/admin/settings`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
    expect(Object.keys(await res.json()).sort()).toEqual([
      "address", "businessNumber", "email", "freeShippingThreshold", "lowStockThreshold", "mailOrderNumber", "phone", "privacyOfficer",
      "representative", "returnShippingFee", "shippingFee", "storeName", "updatedAt", "version",
    ]);
  });

  it("기능 표시는 연결됨·없음(참·거짓)뿐이다", async () => {
    const body = (await (await fetch(`${baseUrl}/features`)).json()) as { integrations: Record<string, unknown> };
    expect(body.integrations).toEqual({ toss: true, stripe: true, errorTracking: true, llm: true });
    for (const v of Object.values(body.integrations)) expect(typeof v).toBe("boolean");
  });
});
