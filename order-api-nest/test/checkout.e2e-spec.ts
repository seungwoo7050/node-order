import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { hashPassword } from "../src/auth/password.js";

describe("POST /orders/checkout - 동시성 회귀 테스트", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0);
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await prisma.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword(process.env.DEMO_PASSWORD!) } });
    await prisma.product.create({ data: { name: "테스트 상품", price: 1000, stock: 5 } }); // id 1
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
    });
    token = ((await res.json()) as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const checkout = (headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/orders/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify({ items: [{ productId: 1, quantity: 1 }] }),
    });

  it("재고 5개에 동시 요청 20개 → 정확히 5건만 성공하고 재고는 0", async () => {
    const statuses = await Promise.all(Array.from({ length: 20 }, () => checkout().then((r) => r.status)));

    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(15);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: 1 } });
    expect(product.stock).toBe(0);
    const sold = await prisma.orderItem.aggregate({ where: { productId: 1 }, _sum: { quantity: true } });
    expect(sold._sum.quantity).toBe(5);
  });

  it("같은 Idempotency-Key로 동시 요청 10개 → 주문은 1건, 응답은 모두 같은 주문", async () => {
    const bodies = await Promise.all(
      Array.from({ length: 10 }, () => checkout({ "Idempotency-Key": "same-key" }).then((r) => r.json() as Promise<{ id: number }>)),
    );

    expect(new Set(bodies.map((b) => b.id)).size).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });
});