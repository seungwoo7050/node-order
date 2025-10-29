import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

describe("refresh token 회전 - 회귀 테스트", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();

    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0);
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await prisma.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw-for-test") } });
  });

  afterAll(async () => {
    await app.close();
  });

  const login = async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kim", password: "pw-for-test" }),
    });
    return res.headers.getSetCookie()[0].split(";")[0];
  };
  const refresh = (cookie: string) => fetch(`${baseUrl}/auth/refresh`, { method: "POST", headers: { Cookie: cookie } });

  it("한 번 쓴 refresh token을 다시 쓰면 401이고, 그 사이 발급된 토큰까지 회수된다", async () => {
    const a = await login();
    const first = await refresh(a);
    expect(first.status).toBe(200);
    const b = first.headers.getSetCookie()[0].split(";")[0];
    expect(b).not.toBe(a);

    expect((await refresh(a)).status).toBe(401);
    expect((await refresh(b)).status).toBe(401);
  });

  it("같은 토큰으로 동시에 10번 refresh해도 성공은 1번뿐이다", async () => {
    const a = await login();
    const statuses = await Promise.all(Array.from({ length: 10 }, () => refresh(a).then((r) => r.status)));

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });
});