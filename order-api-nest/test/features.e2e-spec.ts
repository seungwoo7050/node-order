import type { INestApplication } from "@nestjs/common";
import { SHIPPING, client, seedPaymentData, startPaymentApp } from "./payment-app.js";

// 키가 있는 결제 수단만 켠다. 키는 환경변수에서만 읽는다(요청마다 다시 본다)
describe("GET /features - 결제 수단", () => {
  let app: INestApplication;
  let baseUrl: string;
  const keys = ["TOSS_CLIENT_KEY", "TOSS_SECRET_KEY", "TOSS_SIMULATOR_URL", "STRIPE_SECRET_KEY", "STRIPE_SIMULATOR_URL"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  beforeAll(async () => {
    ({ app, baseUrl } = await startPaymentApp());
  });
  beforeEach(() => keys.forEach((k) => delete process.env[k]));
  afterAll(async () => {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    await app.close();
  });

  const features = async () => (await fetch(`${baseUrl}/features`)).json();

  it("토스 키만 있으면 토스만, 위젯 클라이언트 키와 공식 SDK 주소를 준다(시크릿 키는 주지 않는다)", async () => {
    process.env.TOSS_CLIENT_KEY = "ck-example";
    process.env.TOSS_SECRET_KEY = "sk-example-secret";
    const body = await features();
    expect(body).toEqual({ payments: ["toss"], toss: { clientKey: "ck-example", sdkUrl: "https://js.tosspayments.com/v2/standard" } });
    expect(JSON.stringify(body)).not.toContain("sk-example-secret");
  });

  it("토스 키가 하나만 있으면 끈다", async () => {
    process.env.TOSS_CLIENT_KEY = "ck-example";
    expect(await features()).toEqual({ payments: [] });
  });

  it("Stripe 키만 있으면 Stripe만", async () => {
    process.env.STRIPE_SECRET_KEY = "stripe-example";
    expect(await features()).toEqual({ payments: ["stripe"] });
  });

  it("둘 다 있으면 둘 다(토스 먼저)", async () => {
    process.env.STRIPE_SIMULATOR_URL = "http://localhost:4100";
    process.env.TOSS_SIMULATOR_URL = "http://localhost:4200";
    expect((await features()).payments).toEqual(["toss", "stripe"]);
  });

  it("둘 다 없으면 빈 목록이고, 결제를 시작하면 주문을 만들기 전에 400", async () => {
    expect(await features()).toEqual({ payments: [] });
    const { user } = await seedPaymentData(baseUrl);
    const res = await client(baseUrl, user).post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], shipping: SHIPPING });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("켜진 결제 수단이 없습니다");
    const toss = await client(baseUrl, user).post("/orders/checkout", { items: [{ productId: 1, quantity: 1 }], shipping: SHIPPING, provider: "toss" });
    expect(toss.status).toBe(400);
    expect((await client(baseUrl, user).get("/me/orders")).body.items).toEqual([]);
  });
});
