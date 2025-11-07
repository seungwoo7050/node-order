import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

describe("카테고리 트리 - 회귀 테스트", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let token: string;

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
    await prisma.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await prisma.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw-for-test") } });
    for (const [name, parentId] of [["가", null], ["나", 1], ["다", 2]] as const) await prisma.category.create({ data: { name, parentId } });
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "kim", password: "pw-for-test" }),
    });
    token = ((await res.json()) as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const move = (id: number, parentId: number | null) =>
    fetch(`${baseUrl}/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ parentId }),
    });

  it("자기 후손 아래로는 옮길 수 없습니다", async () => {
    expect((await move(1, 3)).status).toBe(400);
    expect((await move(1, 1)).status).toBe(400);
    expect((await move(3, 1)).status).toBe(200);
  });

  it("이미 순환이 생긴 데이터에서도 경로 조회가 끝난다(CYCLE 절)", async () => {
    await prisma.$executeRaw`UPDATE categories SET parent_id = 3 WHERE id = 1`;
    const res = await fetch(`${baseUrl}/categories/3/path`, { signal: AbortSignal.timeout(3000) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBe(3);
  });

  it("자식이 있는 카테고리는 지울 수 없다", async () => {
    const res = await fetch(`${baseUrl}/categories/2`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(409);
  });
});