import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { adminDb } from "./admin-db.js";

describe("RLS - 회귀 테스트", () => {
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
    // 새 API가 쓰는 모양(status를 옛 칸과 같이)으로 넣는다. status 없이 paid만 넣으면 0034 트리거가 동기화 이력을 남긴다
    await adminDb.order.createMany({ data: [{ userId: "kim", totalAmount: 1000, paid: true, status: "paid" }, { userId: "lee", totalAmount: 2000, paid: true, status: "paid" }] });
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
    await expect(prisma.asUser("kim", (tx) => tx.order.create({ data: { userId: "lee", totalAmount: 1, paid: true } })))
      .rejects.toMatchObject({ meta: { driverAdapterError: { cause: { originalCode: "42501" } } } });
  });

  it("상태 이력·송장·반품도 그 주문을 볼 수 있는 사람만 본다(0032)", async () => {
    await adminDb.product.create({ data: { name: "마우스", price: 1000, stock: 1 } });
    await adminDb.orderStatusHistory.create({ data: { orderId: 2, fromStatus: "paid", toStatus: "preparing", actorType: "admin" } });
    await adminDb.shipment.create({ data: { orderId: 2, carrier: "cj", trackingNumber: "123456789012" } });
    await adminDb.return.create({ data: { orderId: 2, kind: "refund", reason: "defective", items: { create: [{ productId: 1, quantity: 1, unitPrice: 1000 }] } } });
    const seen = (userId: string) => prisma.asUser(userId, async (tx) => [
      await tx.orderStatusHistory.count(), await tx.shipment.count(), await tx.return.count(), await tx.returnItem.count(),
    ]);
    expect(await seen("kim")).toEqual([0, 0, 0, 0]);
    expect(await seen("lee")).toEqual([1, 1, 1, 1]);
    await expect(prisma.asUser("kim", (tx) => tx.return.create({ data: { orderId: 2, kind: "refund", reason: "defective" } })))
      .rejects.toMatchObject({ meta: { driverAdapterError: { cause: { originalCode: "42501" } } } });
  });

  it("트랜잭션이 끝나면 설정이 남지 않는다", async () => {
    await prisma.asUser("kim", (tx) => tx.order.findMany());
    expect(await prisma.order.count()).toBe(0);
  });
});