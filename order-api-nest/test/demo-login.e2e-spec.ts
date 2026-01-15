import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
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

  it("켜져 있으면 일반은 lee, 관리자는 kim으로 들어가고 refresh 쿠키도 받는다", async () => {
    process.env.DEMO_LOGIN = "1";
    expect(await (await fetch(`${baseUrl}/auth/demo`)).json()).toEqual({ enabled: true });

    const user = await demo("user");
    expect(user.status).toBe(200);
    expect(user.headers.get("set-cookie")).toMatch(/^refresh_token=/);
    expect(await roleOf(user)).toMatchObject({ sub: "lee", role: "user" });

    expect(await roleOf(await demo("admin"))).toMatchObject({ sub: "kim", role: "admin" });
  });

  it("정해진 두 값 말고는 400", async () => {
    process.env.DEMO_LOGIN = "1";
    expect((await demo("root")).status).toBe(400);
  });
});
