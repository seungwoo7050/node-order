import type { INestApplication } from "@nestjs/common";
import { adminDb } from "./admin-db.js";
import { startSimulator, type Simulator } from "./fake-pg.js";
import { CONSENT, SHIPPING, client, paidNotices, paymentOf, seedPaymentData, startPaymentApp } from "./payment-app.js";

describe("토스 결제 - 승인·웹훅", () => {
  let app: INestApplication;
  let baseUrl: string;
  let sim: Simulator;
  let tokens: { user: string; admin: string };

  beforeAll(async () => {
    ({ app, baseUrl } = await startPaymentApp());
    sim = await startSimulator("toss", baseUrl);
    process.env.TOSS_SIMULATOR_URL = sim.url;
  });

  beforeEach(async () => {
    await sim.reset();
    tokens = await seedPaymentData(baseUrl);
  });

  afterAll(async () => {
    delete process.env.TOSS_SIMULATOR_URL;
    await sim.stop();
    await app.close();
  });

  const user = () => client(baseUrl, tokens.user);
  // 주문을 만들고 위젯 인증까지(승인 전)
  const authorized = async () => {
    const started = await user().post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], shipping: SHIPPING, ...CONSENT, provider: "toss" });
    expect(started.status).toBe(201);
    const payment = await paymentOf(started.body.id);
    const { paymentKey } = await sim.post<{ paymentKey: string }>("/__sim/authorize", { orderId: payment.providerOrderId, amount: payment.amount });
    return { orderId: started.body.id as number, providerOrderId: payment.providerOrderId, paymentKey, checkoutUrl: started.body.checkoutUrl as string };
  };
  const confirm = (body: { paymentKey: string; orderId: string; amount: number }) => user().post("/payments/toss/confirm", body);
  const webhook = (body: unknown) =>
    fetch(`${baseUrl}/payments/toss/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("결제를 시작하면 콘솔의 위젯 페이지로 보내고, 그 페이지가 쓸 금액·주문번호는 서버가 준다", async () => {
    const { orderId, providerOrderId, checkoutUrl } = await authorized();
    expect(checkoutUrl).toBe(`${process.env.FRONTEND_URL}/checkout/toss/${orderId}`);
    expect(providerOrderId).toMatch(new RegExp(`^order-${orderId}-[0-9a-f]{8}$`));
    const info = await user().get(`/payments/toss/checkout/${orderId}`);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ orderId, providerOrderId, amount: 10_000, orderName: "마우스", clientKey: "test_ck_simulator", sdkUrl: `${sim.url}/v2/standard` });
    expect(info.body.customerKey).toMatch(/^user_[0-9a-f]{32}$/);
  });

  it("금액 위조: 주문 10,000원에 amount=1000으로 승인하면 400, 주문은 미결제, 시뮬레이터에 승인 호출이 없다", async () => {
    const { orderId, providerOrderId, paymentKey } = await authorized();
    const res = await confirm({ paymentKey, orderId: providerOrderId, amount: 1_000 });
    expect(res.status).toBe(400);
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: orderId } })).paid).toBe(false);
    expect((await paymentOf(orderId)).status).toBe("ready");
    expect((await sim.calls()).confirm).toBe(0);
  });

  it("같은 승인 요청을 두 번(차례로, 동시에) 보내도 paid 전이와 order.paid는 한 번", async () => {
    const { orderId, providerOrderId, paymentKey } = await authorized();
    const body = { paymentKey, orderId: providerOrderId, amount: 10_000 };
    const results = await Promise.all([confirm(body), confirm(body)]);
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(results.every((r) => r.status < 500 || r.status === 503)).toBe(true);
    const again = await confirm(body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ orderId, status: "paid" });
    expect((await paymentOf(orderId)).status).toBe("paid");
    expect(await paidNotices()).toBe(1);
  });

  it("승인 요청과 웹훅이 동시에 와도 paid 전이와 order.paid는 한 번", async () => {
    const { orderId, providerOrderId, paymentKey } = await authorized();
    const [confirmed] = await Promise.all([
      confirm({ paymentKey, orderId: providerOrderId, amount: 10_000 }),
      // 승인 직후 토스가 보내는 DONE 웹훅을 흉내 낸다(같은 순간에 여러 번)
      ...Array.from({ length: 3 }, () => sim.post("/__sim/webhook", { paymentKey, status: "DONE" })),
    ]);
    expect(confirmed.status).toBe(200);
    await sim.post("/__sim/webhook", { paymentKey });
    expect((await paymentOf(orderId)).status).toBe("paid");
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: orderId } })).paid).toBe(true);
    expect(await paidNotices()).toBe(1);
  });

  it("PG가 이미 처리된 결제라고 하면(웹훅이 먼저 반영) PG 조회로 확인하고 성공으로 답한다", async () => {
    const { orderId, providerOrderId, paymentKey } = await authorized();
    await sim.fault("confirm", "already_processed");
    await sim.post(`/__sim/payments/${paymentKey}/status`, { status: "DONE" });
    expect((await confirm({ paymentKey, orderId: providerOrderId, amount: 10_000 })).status).toBe(200);
    expect((await paymentOf(orderId)).status).toBe("paid");
    expect(await paidNotices()).toBe(1);
  });

  it("승인이 시간 초과되면 503, 다시 보내면 같은 멱등 키라 PG에서 두 번 승인되지 않는다", async () => {
    process.env.PAYMENT_TIMEOUT_MS = "300";
    try {
      const { orderId, providerOrderId, paymentKey } = await authorized();
      await sim.fault("confirm", "timeout", { delayMs: 1_000 });
      await sim.fault("fetch", "timeout", { delayMs: 1_000 });
      const body = { paymentKey, orderId: providerOrderId, amount: 10_000 };
      expect((await confirm(body)).status).toBe(503);
      expect((await paymentOf(orderId)).status).toBe("ready");
      expect((await confirm(body)).status).toBe(200); // 시뮬레이터가 첫 응답(DONE)을 돌려준다
      expect(await paidNotices()).toBe(1);
    } finally {
      delete process.env.PAYMENT_TIMEOUT_MS;
    }
  });

  it("PG가 금액이 다르다고 거절하면 502이고 주문은 미결제로 남는다", async () => {
    const { orderId, providerOrderId, paymentKey } = await authorized();
    await sim.fault("confirm", "amount_mismatch");
    expect((await confirm({ paymentKey, orderId: providerOrderId, amount: 10_000 })).status).toBe(502);
    expect((await paymentOf(orderId)).status).toBe("ready");
  });

  it("다른 사람의 주문번호로는 승인할 수 없다(404)", async () => {
    const { providerOrderId, paymentKey } = await authorized();
    const res = await client(baseUrl, tokens.admin).post("/payments/toss/confirm", { paymentKey, orderId: providerOrderId, amount: 10_000 });
    expect(res.status).toBe(404);
  });

  it("웹훅 재조회: 본문은 DONE인데 PG가 아직 승인 전이면 PG를 따른다(미결제 유지), 응답은 200", async () => {
    const { orderId, paymentKey } = await authorized();
    const res = await sim.post<{ status: number; body: { result: string } }>("/__sim/webhook", { paymentKey, status: "DONE" });
    expect(res).toEqual({ status: 200, body: { received: true, result: "ignored" } });
    expect((await paymentOf(orderId)).status).toBe("ready");
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: orderId } })).paid).toBe(false);
    expect(await paidNotices()).toBe(0);
  });

  it("웹훅 재조회: 본문은 DONE인데 PG가 중단(ABORTED)이면 결제·주문을 취소하고 재고를 돌려놓는다", async () => {
    const { orderId, paymentKey } = await authorized();
    expect((await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock).toBe(9);
    await sim.post(`/__sim/payments/${paymentKey}/status`, { status: "ABORTED" });
    const res = await sim.post<{ status: number; body: { result: string } }>("/__sim/webhook", { paymentKey, status: "DONE" });
    expect(res).toEqual({ status: 200, body: { received: true, result: "processed" } });
    expect((await paymentOf(orderId)).status).toBe("canceled");
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: orderId } })).canceledAt).not.toBeNull();
    expect((await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock).toBe(10);
  });

  it("웹훅 재조회: PG가 DONE이면 승인 요청이 오지 않아도 결제 완료로 반영한다", async () => {
    const { orderId, paymentKey } = await authorized();
    await sim.post(`/__sim/payments/${paymentKey}/status`, { status: "DONE" });
    const res = await sim.post<{ status: number; body: { result: string } }>("/__sim/webhook", { paymentKey, status: "CANCELED" }); // 본문은 거짓
    expect(res.body.result).toBe("processed");
    expect((await paymentOf(orderId)).status).toBe("paid");
    expect(await paidNotices()).toBe(1);
  });

  it("웹훅은 본문이 무엇이든 200이다(모르는 이벤트, 없는 결제, 깨진 본문)", async () => {
    for (const body of [{}, { eventType: "DEPOSIT_CALLBACK" }, { eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: "nope", status: "DONE" } }, { eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: 1 } }, [1, 2]]) {
      const res = await webhook(body);
      expect(res.status).toBe(200);
      expect((await res.json()).result).toBe("ignored");
    }
    const broken = await fetch(`${baseUrl}/payments/toss/webhook`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{not json" });
    expect(broken.status).toBe(200);
  });
});
