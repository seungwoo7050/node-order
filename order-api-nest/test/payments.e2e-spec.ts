import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import Stripe from "stripe";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { StripeGateway } from "../src/payments/stripe.gateway.js";
import { adminDb } from "./admin-db.js";
import { FakeStripeGateway } from "./fake-stripe.js";

const WEBHOOK_SECRET = "whsec_test_secret";

describe("Stripe 결제 - 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeGateway).useClass(FakeStripeGateway).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, stripe_events, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw") } });
    await adminDb.product.create({ data: { name: "마우스", price: 30000, stock: 10 } });
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kim", password: "pw" }),
    });
    token = (await res.json()).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  const checkout = async (quantity = 1) => {
    const res = await fetch(`${baseUrl}/orders/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [{ productId: 1, quantity }] }),
    });
    return (await res.json()) as { id: number; paid: boolean; checkoutUrl: string };
  };

  const sendWebhook = (event: { id: string; type: string; session: Record<string, unknown> }, secret = WEBHOOK_SECRET) => {
    const payload = JSON.stringify({ id: event.id, object: "event", type: event.type, data: { object: { object: "checkout.session", ...event.session } } }, null, 2);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return fetch(`${baseUrl}/payments/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: payload });
  };
  const paidEvent = (orderId: number, eventId = "evt_paid_1") =>
    ({ id: eventId, type: "checkout.session.completed", session: { id: `cs_test_fake_${orderId}`, payment_status: "paid" } });
  const stock = async () => (await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock;
  const paidNotices = () => adminDb.outboxEvent.count({ where: { type: "order.paid" } });

  it("결제를 누르면 주문은 결제 대기, 재고는 예약되고, 결제 화면 주소가 온다", async () => {
    const order = await checkout(2);
    expect(order.paid).toBe(false);
    expect(order.checkoutUrl).toBe(`https://checkout.stripe.com/c/pay/cs_test_fake_${order.id}`);
    expect(await stock()).toBe(8);
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: order.id } })).stripeSessionId).toBe(`cs_test_fake_${order.id}`);
  });

  it("서명이 맞는 completed 웹훅이 오면 결제 완료가 되고 알림이 한 번 기록된다", async () => {
    const order = await checkout();
    const res = await sendWebhook(paidEvent(order.id));
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("processed");
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: order.id } })).paid).toBe(true);
    expect(await paidNotices()).toBe(1);
  });

  it("같은 이벤트가 다시 와도(순서대로든 동시에든) 한 번만 처리한다", async () => {
    const order = await checkout();
    await sendWebhook(paidEvent(order.id));
    expect((await (await sendWebhook(paidEvent(order.id))).json()).result).toBe("duplicate");
    const results = await Promise.all(Array.from({ length: 5 }, () => sendWebhook(paidEvent(order.id)).then((r) => r.status)));
    expect(results.every((s) => s === 200)).toBe(true);
    expect(await paidNotices()).toBe(1);
  });

  it("서명이 틀리면 400이고 주문은 그대로다", async () => {
    const order = await checkout();
    const res = await sendWebhook(paidEvent(order.id), "whsec_wrong");
    expect(res.status).toBe(400);
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: order.id } })).paid).toBe(false);
  });

  it("결제하지 않고 세션이 만료되면 주문이 취소되고 재고가 돌아온다", async () => {
    const order = await checkout(3);
    expect(await stock()).toBe(7);
    await sendWebhook({ id: "evt_expired_1", type: "checkout.session.expired", session: { id: `cs_test_fake_${order.id}`, payment_status: "unpaid" } });
    expect((await adminDb.order.findUniqueOrThrow({ where: { id: order.id } })).canceledAt).not.toBeNull();
    expect(await stock()).toBe(10);
  });

  it("우리가 만들지 않은 세션의 이벤트는 무시한다(200)", async () => {
    const res = await sendWebhook({ id: "evt_other", type: "checkout.session.completed", session: { id: "cs_test_someone_else", payment_status: "paid" } });
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("ignored");
  });
});