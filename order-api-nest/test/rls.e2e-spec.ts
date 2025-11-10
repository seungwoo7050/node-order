import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { adminDb } from "./admin-db.js";

describe("RLS — 회귀 테스트", () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    close = () => app.close();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김" }, { id: "lee", name: "이" }] });
    await adminDb.order.createMany({ data: [{ userId: "kim", price: 1000, paid: true }, { userId: "lee", price: 2000, paid: true }] });
  });

  afterAll(async () => {
    await close();
    await adminDb.$disconnect();
  });

  it("누구인지 설정하지 않으면 아무 주문도 안 보인다", async () => {
    expect(await prisma.order.count()).toBe(0);
  });

  it("kim으로 설정하면 kim의 주문만 보인다", async () => {
    const rows = await prisma.asUser("kim", (tx) => tx.order.findMany());
    expect(rows.map((r) => r.userId)).toEqual(["kim"]);
  });

  it("kim으로 설정한 채 lee 명의의 주문을 넣으면 DB가 거부한다", async () => {
    await expect(prisma.asUser("kim", (tx) => tx.order.create({ data: { userId: "lee", price: 1, paid: true } })))
      .rejects.toMatchObject({ meta: { driverAdapterError: { cause: { originalCode: "42501" } } } });
  });

  it("트랜잭션이 끝나면 설정이 남지 않는다", async () => {
    await prisma.asUser("kim", (tx) => tx.order.findMany());
    expect(await prisma.order.count()).toBe(0);
  });
});