import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { adminDb } from "./admin-db.js";

describe("POST /products/:id/stock-adjustments - 동시성 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0);
    baseUrl = await app.getUrl();
    adminToken = app.get(JwtService, { strict: false }).sign({ sub: "kim", role: "admin" });
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.product.create({ data: { name: "테스트 상품", price: 1000, stock: 3 } }); // id 1
  });

  afterAll(async () => {
    await app.close();
  });

  const adjust = (delta: unknown, productId = 1) =>
    fetch(`${baseUrl}/products/${productId}/stock-adjustments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ delta }),
    });
  const stock = async () => (await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock;

  it("+1 20번과 -1 2번을 한꺼번에 보내도 모두 반영된다: 3 + 20 - 2", async () => {
    const deltas = [...Array(20).fill(1), -1, -1];
    const statuses = await Promise.all(deltas.map((d) => adjust(d).then((r) => r.status)));
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(await stock()).toBe(21);
  });

  it("재고 3에서 -1을 한꺼번에 5번 보내면 3번만 성공하고 2번은 409다. 음수가 되지 않는다", async () => {
    const statuses = await Promise.all(Array.from({ length: 5 }, () => adjust(-1).then((r) => r.status)));
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
    expect(await stock()).toBe(0);
  });

  it("delta가 0이거나 정수가 아니면 400, 없는 상품은 404", async () => {
    expect((await adjust(0)).status).toBe(400);
    expect((await adjust(1.5)).status).toBe(400);
    expect((await adjust("10")).status).toBe(400);
    expect((await adjust(1, 999)).status).toBe(404);
  });
});
