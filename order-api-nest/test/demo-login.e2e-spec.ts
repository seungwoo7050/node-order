import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { DemoUserCleanupJob } from "../src/leader/demo-user-cleanup.job.js";
import { LeaderElection } from "../src/leader/leader-election.js";
import { adminDb } from "./admin-db.js";

describe("데모 로그인", () => {
  let app: INestApplication;
  let baseUrl: string;
  const before = process.env.DEMO_LOGIN;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.use(cookieParser());
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김", role: "admin" }, { id: "lee", name: "이" }] });
    await adminDb.product.createMany({ data: [{ name: "가", price: 1000, stock: 5 }, { name: "나", price: 2000, stock: 5 }, { name: "다", price: 3000, stock: 5 }] });
  });

  afterAll(async () => {
    process.env.DEMO_LOGIN = before;
    await app.close();
    await adminDb.$disconnect();
  });

  const demo = (as: string) =>
    fetch(`${baseUrl}/auth/demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ as }) });
  const roleOf = async (res: Response) => {
    const { accessToken } = (await res.json()) as { accessToken: string };
    return app.get(JwtService, { strict: false }).decode<{ sub: string; role: string }>(accessToken);
  };

  it("꺼져 있으면 404이고, 화면에도 꺼져 있다고 알린다", async () => {
    process.env.DEMO_LOGIN = "0";
    expect((await demo("admin")).status).toBe(404);
    expect(await (await fetch(`${baseUrl}/auth/demo`)).json()).toEqual({ enabled: false });
  });

  it("누를 때마다 새 임시 사용자를 만들고 refresh 쿠키도 준다", async () => {
    process.env.DEMO_LOGIN = "1";
    const first = await demo("user");
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toMatch(/^refresh_token=/);
    const a = await roleOf(first);
    const b = await roleOf(await demo("user"));
    expect(a).toMatchObject({ sub: expect.stringMatching(/^demo-[0-9a-f]{8}$/), role: "user" });
    expect(b.sub).not.toBe(a.sub);
    const { expiresAt } = await adminDb.user.findUniqueOrThrow({ where: { id: a.sub } });
    expect(expiresAt!.getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  it("관리자로 들어가면 임시 데모 관리자다", async () => {
    process.env.DEMO_LOGIN = "1";
    expect(await roleOf(await demo("admin"))).toMatchObject({ sub: expect.stringMatching(/^demo-/), role: "demo_admin" });
  });

  it("임시 사용자에게는 품목이 든 견본 주문이 1~2건 있고, 재고는 그대로다", async () => {
    process.env.DEMO_LOGIN = "1";
    const { sub } = await roleOf(await demo("user"));
    const orders = await adminDb.order.findMany({ where: { userId: sub }, include: { items: true } });
    expect(orders.length).toBeGreaterThanOrEqual(1);
    expect(orders.length).toBeLessThanOrEqual(2);
    for (const o of orders) expect(o.items.length).toBeGreaterThan(0);
    expect((await adminDb.product.findMany({ orderBy: { id: "asc" } })).map((p) => p.stock)).toEqual([5, 5, 5]);
  });

  it("만료된 임시 사용자는 정리 작업이 주문·토큰과 함께 지우고, 결제 대기 주문의 재고는 돌려준다", async () => {
    process.env.DEMO_LOGIN = "1";
    const { sub } = await roleOf(await demo("user"));
    await adminDb.order.create({ data: { userId: sub, price: 2000, paid: false, items: { create: [{ productId: 1, quantity: 2, unitPrice: 1000 }] } } });
    await adminDb.product.update({ where: { id: 1 }, data: { stock: { decrement: 2 } } });
    await adminDb.user.update({ where: { id: sub }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const leader = vi.spyOn(app.get(LeaderElection, { strict: false }), "isLeader", "get").mockReturnValue(true);
    await app.get(DemoUserCleanupJob, { strict: false }).run();
    leader.mockRestore();

    expect(await adminDb.user.count({ where: { id: sub } })).toBe(0);
    expect(await adminDb.order.count({ where: { userId: sub } })).toBe(0);
    expect(await adminDb.refreshToken.count({ where: { userId: sub } })).toBe(0);
    expect((await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock).toBe(5);
    expect(await adminDb.user.count()).toBe(2);
  });

  it("정해진 두 값 말고는 400", async () => {
    process.env.DEMO_LOGIN = "1";
    expect((await demo("root")).status).toBe(400);
  });
});
