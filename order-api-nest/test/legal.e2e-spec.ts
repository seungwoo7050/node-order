import type { INestApplication } from "@nestjs/common";
import { adminDb } from "./admin-db.js";
import { startSimulator, type Simulator } from "./fake-pg.js";
import { SHIPPING, client, demoAdminToken, seedPaymentData, startPaymentApp } from "./payment-app.js";

// 약관·개인정보처리방침·청약철회 안내의 버전과 결제할 때의 개인정보 수집·이용 동의
describe("법적 고지와 결제 동의", () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokens: { user: string; admin: string };
  let sim: Simulator;

  beforeAll(async () => {
    ({ app, baseUrl } = await startPaymentApp());
    sim = await startSimulator("toss", baseUrl);
    process.env.TOSS_SIMULATOR_URL = sim.url;
  });

  beforeEach(async () => {
    tokens = await seedPaymentData(baseUrl);
  });

  // 다른 테스트 파일은 개인정보처리방침 1판에 동의한다(test/payment-app.ts의 CONSENT)
  afterEach(async () => {
    await adminDb.legalDocument.deleteMany({ where: { version: { gt: 1 } } });
  });

  afterAll(async () => {
    delete process.env.TOSS_SIMULATOR_URL;
    await sim.stop();
    await app.close();
  });

  const admin = () => client(baseUrl, tokens.admin);
  const pub = async (path: string) => {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const checkout = (body: Record<string, unknown>) =>
    client(baseUrl, tokens.user).post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], shipping: SHIPPING, provider: "toss", ...body });

  it("세 문서 모두 1판이 있고 누구나 읽는다. 없는 종류는 400", async () => {
    for (const kind of ["terms", "privacy", "refund"]) {
      const res = await pub(`/legal/${kind}`);
      expect(res.status, kind).toBe(200);
      expect(res.body).toMatchObject({ kind, version: 1, current: true });
      expect(res.body.versions.map((v: { version: number }) => v.version)).toEqual([1]);
    }
    expect((await pub("/legal/cookies")).status).toBe(400);
  });

  it("개인정보처리방침을 고치면 새 판이 생기고 지난 판은 그대로 열람된다", async () => {
    const v1 = (await pub("/legal/privacy")).body;
    const saved = await admin().post("/admin/legal/privacy", { title: "개인정보처리방침", body: "2판 본문: 수집 항목에 이메일을 더합니다" });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ kind: "privacy", version: 2, current: true });

    const now = (await pub("/legal/privacy")).body;
    expect(now).toMatchObject({ version: 2, body: "2판 본문: 수집 항목에 이메일을 더합니다" });
    expect(now.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const old = await pub("/legal/privacy/versions/1");
    expect(old.status).toBe(200);
    expect(old.body).toMatchObject({ version: 1, body: v1.body, current: false });
    expect((await pub("/legal/privacy/versions/9")).status).toBe(404);
    // 다른 문서는 그대로
    expect((await pub("/legal/terms")).body.version).toBe(1);
  });

  it("시행일이 미래인 판은 목록에만 있고, 지금 판은 시행 중인 판이다", async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect((await admin().post("/admin/legal/terms", { title: "이용약관", body: "다음 주부터", effectiveAt: future })).status).toBe(201);
    const now = (await pub("/legal/terms")).body;
    expect(now).toMatchObject({ version: 1, current: true });
    expect(now.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect((await admin().post("/admin/legal/terms", { title: "이용약관", body: " " })).status).toBe(400);
  });

  it("결제할 때 동의하지 않으면(판이 없거나 지금 판이 아니면) 400이고 주문을 만들지 않는다. 동의하면 주문에 판과 시각이 남는다", async () => {
    expect((await checkout({})).status).toBe(400);
    expect((await checkout({ privacyConsentVersion: 0 })).status).toBe(400);
    await admin().post("/admin/legal/privacy", { title: "개인정보처리방침", body: "2판" });
    const outdated = await checkout({ privacyConsentVersion: 1 });
    expect(outdated.status).toBe(400);
    expect(outdated.body.message).toMatch(/개인정보처리방침이 바뀌었습니다\(2판\)/);
    expect(await adminDb.order.count()).toBe(0);

    const before = Date.now();
    const ok = await checkout({ privacyConsentVersion: 2 });
    expect(ok.status).toBe(201);
    const order = await adminDb.order.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(order.privacyConsentVersion).toBe(2);
    expect(order.privacyConsentedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect((await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock).toBe(9);
  });

  it("데모 관리자는 문서를 읽을 수 있고 새 판 저장은 403", async () => {
    const demo = client(baseUrl, await demoAdminToken(baseUrl));
    expect((await demo.get("/admin/legal/privacy")).status).toBe(200);
    expect((await demo.post("/admin/legal/privacy", { title: "x", body: "x" })).status).toBe(403);
    expect((await client(baseUrl, tokens.user).post("/admin/legal/privacy", { title: "x", body: "x" })).status).toBe(403);
    expect((await pub("/legal/privacy")).body.version).toBe(1);
  });
});
