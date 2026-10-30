import type { INestApplication } from "@nestjs/common";
import { adminDb } from "./admin-db.js";
import { startSimulator, type Simulator } from "./fake-pg.js";
import { CONSENT, SHIPPING, client, demoAdminToken, paymentOf, seedPaymentData, startPaymentApp } from "./payment-app.js";

// DEMO_LOGIN=1이면 누구나 데모 관리자가 된다. 데모 관리자가 읽는 관리자 API 응답 어디에도 손님의 배송지·연락처 원문이 없어야 한다
// 상점 주소(공개 정보, 설정의 address)와 겹치지 않는 손님 배송지
const SHIP = { ...SHIPPING, recipientName: "박손님", recipientPhone: "010-4321-8765", postalCode: "48058", address1: "부산광역시 해운대구 센텀중앙로 77", address2: "1203호", deliveryMemo: "경비실에 맡겨 주세요" };
const RAW = [
  SHIP.recipientPhone, "01043218765", "4321-8765", SHIP.recipientName, "센텀중앙로", SHIP.address2, SHIP.deliveryMemo, SHIP.postalCode, "연락 주세요 010-9999-8888",
];

describe("데모 관리자 응답의 개인정보 가리기", () => {
  let app: INestApplication;
  let baseUrl: string;
  let sim: Simulator;
  let tokens: { user: string; admin: string };
  let orderId: number;

  beforeAll(async () => {
    ({ app, baseUrl } = await startPaymentApp());
    sim = await startSimulator("toss", baseUrl);
    process.env.TOSS_SIMULATOR_URL = sim.url;
    tokens = await seedPaymentData(baseUrl, 20_000);
    const user = client(baseUrl, tokens.user);
    const admin = client(baseUrl, tokens.admin);
    const started = await user.post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], shipping: SHIP, ...CONSENT, provider: "toss" });
    orderId = started.body.id;
    const payment = await paymentOf(orderId);
    const { paymentKey } = await sim.post<{ paymentKey: string }>("/__sim/authorize", { orderId: payment.providerOrderId, amount: payment.amount });
    await user.post("/payments/toss/confirm", { paymentKey, orderId: payment.providerOrderId, amount: payment.amount });
    await admin.post(`/admin/orders/${orderId}/prepare`);
    await admin.post(`/admin/orders/${orderId}/shipment`, { carrier: "cj", trackingNumber: "123456789012" });
    await admin.post(`/admin/orders/${orderId}/deliver`);
    const returned = await user.post(`/me/orders/${orderId}/returns`, { kind: "exchange", reason: "defective", detail: "연락 주세요 010-9999-8888", items: [{ productId: 1, quantity: 1 }] });
    expect(returned.status).toBe(201);
    await adminDb.reconciliationIssue.deleteMany();
    await adminDb.reconciliationIssue.create({ data: { provider: "toss", kind: "status_mismatch", paymentKey, orderId, businessDate: new Date(), ourValue: { status: "paid" }, pgValue: { status: "refunded" } } });
  });

  afterAll(async () => {
    delete process.env.TOSS_SIMULATOR_URL;
    await sim.stop();
    await app.close();
  });

  const paths = () => [
    "/admin/orders", "/admin/orders?status=delivered", "/admin/orders?returns=requested", `/admin/orders/${orderId}`,
    "/admin/dashboard", "/admin/reconciliation/issues?state=all", "/admin/reconciliation/runs", "/admin/settings", "/admin/legal/privacy",
  ];

  it("데모 관리자가 받는 관리자 API 응답 전체에 배송지·연락처 원문이 없고, 가린 값은 보인다", async () => {
    const demo = await demoAdminToken(baseUrl);
    for (const path of paths()) {
      const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${demo}` } });
      expect(res.status, path).toBe(200);
      const text = await res.text();
      for (const raw of RAW) expect(text.includes(raw), `${path}에 원문 "${raw}"`).toBe(false);
    }
    const detail = await client(baseUrl, demo).get(`/admin/orders/${orderId}`);
    expect(detail.body.shipping).toEqual({ recipientName: "박*님", recipientPhone: "010-****-8765", postalCode: "480**", address1: "부산광역시 해운대구 ***", address2: "***", deliveryMemo: "***" });
    expect(detail.body.returns[0].detail).toBe("***");
    expect((await client(baseUrl, demo).get("/admin/orders")).body.items[0].recipientName).toBe("박*님");
  });

  it("진짜 관리자와 손님 자신은 원문을 본다", async () => {
    const admin = await client(baseUrl, tokens.admin).get(`/admin/orders/${orderId}`);
    expect(admin.body.shipping).toMatchObject({ recipientPhone: SHIP.recipientPhone, address1: SHIP.address1 });
    const mine = await client(baseUrl, tokens.user).get(`/me/orders/${orderId}`);
    expect(mine.body.shipping).toMatchObject({ recipientPhone: SHIP.recipientPhone, address1: SHIP.address1 });
  });
});
