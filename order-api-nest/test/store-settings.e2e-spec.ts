import type { INestApplication } from "@nestjs/common";
import { Redis } from "ioredis";
import { SETTINGS_CHANNEL, StoreSettingsService } from "../src/admin/store-settings.service.js";
import { adminDb } from "./admin-db.js";
import { startSimulator, type Simulator } from "./fake-pg.js";
import { CONSENT, SHIPPING, client, demoAdminToken, paymentOf, seedPaymentData, startPaymentApp } from "./payment-app.js";

// 상점 설정(낙관적 잠금, 사업자등록번호 체크섬, 캐시 무효화)과 배송비 설정이 새 주문에만 적용되는지.
// 상품 7,000원 1개 = 상품 합계 7,000원(배송비 기본 3,000원)
const DEFAULTS = {
  storeName: "Brown Store", representative: "대표자", businessNumber: "1234567891", mailOrderNumber: "제0000-서울강남-00000호",
  address: "서울특별시 강남구 테헤란로 123", phone: "02-000-0000", email: "help@example.com", privacyOfficer: "개인정보 보호책임자",
  shippingFee: 3_000, freeShippingThreshold: 50_000, returnShippingFee: 6_000, lowStockThreshold: 5,
};

describe("상점 설정", () => {
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
    await sim.reset();
    tokens = await seedPaymentData(baseUrl);
  });

  // 다른 테스트 파일이 기본 배송비(3,000원)를 기대하므로 처음 값으로 돌려놓는다
  afterEach(async () => {
    const current = await admin().get("/admin/settings");
    const res = await admin().put("/admin/settings", DEFAULTS, { "If-Match": `"${current.body.version}"` });
    expect(res.status).toBe(200);
  });

  afterAll(async () => {
    delete process.env.TOSS_SIMULATOR_URL;
    await sim.stop();
    await app.close();
  });

  const admin = () => client(baseUrl, tokens.admin);
  const read = async () => {
    const res = await admin().get("/admin/settings");
    expect(res.status).toBe(200);
    return res;
  };
  const save = (body: Record<string, unknown>, version: number | string | undefined) =>
    admin().put("/admin/settings", { ...DEFAULTS, ...body }, version === undefined ? {} : { "If-Match": typeof version === "number" ? `"${version}"` : version });

  it("읽으면 version이 ETag로 오고, 그 version으로 저장하면 version이 하나 오르며 공개 정보(/store)에 바로 보인다", async () => {
    const before = await read();
    expect(before.headers.get("etag")).toBe(`"${before.body.version}"`);
    // 캐시를 채워 둔다(저장이 무효화하는지 보려고)
    expect((await (await fetch(`${baseUrl}/store`)).json()).storeName).toBe(before.body.storeName);

    const saved = await save({ storeName: "새 상호" }, before.body.version);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ storeName: "새 상호", version: before.body.version + 1 });
    expect(saved.headers.get("etag")).toBe(`"${before.body.version + 1}"`);
    const store = await (await fetch(`${baseUrl}/store`)).json();
    expect(store).toMatchObject({ storeName: "새 상호", businessNumber: "1234567891", shippingFee: 3_000 });
    expect(store).not.toHaveProperty("lowStockThreshold");
    expect(store).not.toHaveProperty("version");
  });

  it("오래된 version으로 저장하면 409와 지금 version을 돌려주고 아무것도 바뀌지 않는다. If-Match가 없으면 428", async () => {
    const { body } = await read();
    expect((await save({ storeName: "먼저 저장" }, body.version)).status).toBe(200);
    const stale = await save({ storeName: "나중 저장" }, body.version);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ currentVersion: body.version + 1, current: { storeName: "먼저 저장" } });
    expect((await save({ storeName: "W 형식" }, `W/"${body.version}"`)).status).toBe(409);
    expect((await save({ storeName: "헤더 없음" }, undefined)).status).toBe(428);
    expect((await read()).body).toMatchObject({ storeName: "먼저 저장", version: body.version + 1 });
  });

  it("사업자등록번호: 체크섬이 맞으면 하이픈을 빼고 저장하고, 틀리면 칸별 오류와 함께 400", async () => {
    const { body } = await read();
    const ok = await save({ businessNumber: "220-81-62517" }, body.version);
    expect(ok.status).toBe(200);
    expect(ok.body.businessNumber).toBe("2208162517");

    for (const wrong of ["220-81-62510", "1234567890", "12345", "abcdefghij"]) {
      const res = await save({ businessNumber: wrong }, ok.body.version);
      expect(res.status, wrong).toBe(400);
      expect(res.body.fields.businessNumber, wrong).toMatch(/사업자등록번호/);
    }
    expect((await read()).body).toMatchObject({ businessNumber: "2208162517", version: ok.body.version });
  });

  it("칸마다 검증하고 틀린 칸을 모두 알려 준다(빈 상호, 이메일 형식, 음수 배송비)", async () => {
    const { body } = await read();
    const res = await save({ storeName: " ", email: "not-mail", shippingFee: -1 }, body.version);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(["email", "shippingFee", "storeName"]);
  });

  it("설정 스키마에 없는 칸(비밀값 등)은 받지 않는다", async () => {
    const { body } = await read();
    const res = await save({ tossSecretKey: "sk-should-not-be-saved" }, body.version);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("sk-should-not-be-saved");
    expect(JSON.stringify(await adminDb.storeSettings.findUniqueOrThrow({ where: { id: 1 } }))).not.toContain("sk-should-not-be-saved");
  });

  it("저장하면 Redis로 알리고, 알림을 받은 인스턴스는 메모리 캐시를 버린다(인스턴스가 둘일 때의 무효화)", async () => {
    const service = app.get(StoreSettingsService);
    await service.subscribed();
    const listener = new Redis(process.env.REDIS_URL!);
    try {
      const messages: string[] = [];
      listener.on("message", (channel, message) => channel === SETTINGS_CHANNEL && messages.push(message));
      await listener.subscribe(SETTINGS_CHANNEL);
      const { body } = await read();
      expect((await save({ storeName: "알림" }, body.version)).status).toBe(200);
      await expect.poll(() => messages, { timeout: 2_000 }).toContain(String(body.version + 1));

      // 다른 인스턴스가 저장한 것처럼: DB만 바꾸면 이 인스턴스는 캐시된 값을 보다가, 알림을 받으면 새 값을 본다
      expect((await (await fetch(`${baseUrl}/store`)).json()).storeName).toBe("알림");
      await adminDb.storeSettings.update({ where: { id: 1 }, data: { storeName: "다른 인스턴스가 저장", version: { increment: 1 } } });
      expect((await (await fetch(`${baseUrl}/store`)).json()).storeName).toBe("알림");
      await listener.publish(SETTINGS_CHANNEL, String(body.version + 2));
      await expect.poll(async () => (await (await fetch(`${baseUrl}/store`)).json()).storeName, { timeout: 2_000 }).toBe("다른 인스턴스가 저장");
    } finally {
      await listener.quit();
    }
  });

  it("배송비 설정을 바꾸면 새 주문에만 적용되고, 지난 주문의 total_amount와 PG 승인 금액 대조는 그대로다", async () => {
    const checkout = () => client(baseUrl, tokens.user).post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], shipping: SHIPPING, ...CONSENT, provider: "toss" });
    const old = await checkout();
    expect(old.body).toMatchObject({ price: 10_000, shippingFee: 3_000 });

    const { body } = await read();
    expect((await save({ shippingFee: 2_500, freeShippingThreshold: 30_000 }, body.version)).status).toBe(200);
    expect((await (await fetch(`${baseUrl}/store`)).json())).toMatchObject({ shippingFee: 2_500, freeShippingThreshold: 30_000 });

    const fresh = await checkout();
    expect(fresh.body).toMatchObject({ price: 9_500, shippingFee: 2_500 });

    // 설정을 바꾼 뒤 지난 주문을 결제해도 금액은 주문에 저장한 10,000원이고 PG 승인 금액 대조를 통과한다
    const payment = await paymentOf(old.body.id);
    expect(payment.amount).toBe(10_000);
    const { paymentKey } = await sim.post<{ paymentKey: string }>("/__sim/authorize", { orderId: payment.providerOrderId, amount: 10_000 });
    const confirmed = await client(baseUrl, tokens.user).post("/payments/toss/confirm", { paymentKey, orderId: payment.providerOrderId, amount: 10_000 });
    expect(confirmed.status).toBe(200);
    expect(await adminDb.order.findUniqueOrThrow({ where: { id: old.body.id } })).toMatchObject({ totalAmount: 10_000, shippingFee: 3_000, status: "paid" });
    expect(await adminDb.order.findUniqueOrThrow({ where: { id: fresh.body.id } })).toMatchObject({ totalAmount: 9_500, shippingFee: 2_500 });
    // 지난 주문 금액(10,000원)과 다른 금액으로 승인하려 하면 여전히 거절한다
    const freshPayment = await paymentOf(fresh.body.id);
    const sneaky = await sim.post<{ paymentKey: string }>("/__sim/authorize", { orderId: freshPayment.providerOrderId, amount: 10_000 });
    expect((await client(baseUrl, tokens.user).post("/payments/toss/confirm", { paymentKey: sneaky.paymentKey, orderId: freshPayment.providerOrderId, amount: 10_000 })).status).toBe(400);
  });

  it("데모 관리자는 설정을 읽을 수 있고 저장은 403", async () => {
    const demo = client(baseUrl, await demoAdminToken(baseUrl));
    const res = await demo.get("/admin/settings");
    expect(res.status).toBe(200);
    expect((await demo.put("/admin/settings", DEFAULTS, { "If-Match": `"${res.body.version}"` })).status).toBe(403);
    expect((await client(baseUrl, tokens.user).get("/admin/settings")).status).toBe(403);
    expect((await read()).body.version).toBe(res.body.version);
  });
});
