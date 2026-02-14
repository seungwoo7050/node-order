import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { CatalogCache } from "../src/cache/catalog-cache.js";
import { catalogLoads } from "../src/metrics/metrics.js";
import { adminDb } from "./admin-db.js";

describe("카탈로그 캐시 - 회귀 테스트", () => {
  let app: INestApplication;
  let tokenOf: (role: string) => string;
  const list = () => request(app.getHttpServer()).get("/products").expect(200);
  const loads = async () => (await catalogLoads.get()).values[0]?.value ?? 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    tokenOf = (role) => app.get(JwtService, { strict: false }).sign({ sub: "kim", role });
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.create({ data: { id: "kim", name: "김", role: "admin" } });
    const parent = await adminDb.category.create({ data: { name: "전자기기" } });
    const leaf = await adminDb.category.create({ data: { name: "키보드", parentId: parent.id } });
    await adminDb.product.create({ data: { name: "키보드", price: 1000, stock: 5, categoryId: leaf.id } });
    await app.get(CatalogCache).invalidate();
  });

  afterAll(async () => {
    await app.close();
    await adminDb.$disconnect();
  });

  it("두 번째 목록은 캐시에서 온다. DB의 가격을 직접 바꿔도 그대로다. 카테고리 경로가 붙는다", async () => {
    expect((await list()).body.items[0]).toMatchObject({ price: 1000, categoryPath: ["전자기기", "키보드"] });
    await adminDb.product.update({ where: { id: 1 }, data: { price: 9999 } });
    expect((await list()).body.items[0].price).toBe(1000);
  });

  it("재고는 캐시하지 않는다. 바뀐 재고가 바로 보인다", async () => {
    await list();
    await adminDb.product.update({ where: { id: 1 }, data: { stock: 2 } });
    expect((await list()).body.items[0].stock).toBe(2);
  });

  it("관리자가 수정하면 캐시를 지워 새 가격이 보인다. 재고는 받지 않는다", async () => {
    await list();
    await request(app.getHttpServer()).patch("/products/1").set("Authorization", `Bearer ${tokenOf("admin")}`).send({ price: 2000, stock: 0 }).expect(200);
    expect((await list()).body.items[0]).toMatchObject({ price: 2000, stock: 5 });
  });

  it("REST와 tRPC가 같은 캐시를 본다", async () => {
    const input = encodeURIComponent(JSON.stringify({ limit: 20 }));
    await request(app.getHttpServer()).get(`/trpc/products.list?input=${input}`).expect(200);
    await adminDb.product.update({ where: { id: 1 }, data: { price: 9999 } });
    expect((await list()).body.items[0].price).toBe(1000);
  });

  it("비어 있는 칸을 동시에 50개가 읽어도 DB에서는 한 번만 읽는다(single-flight)", async () => {
    const before = await loads();
    await Promise.all(Array.from({ length: 50 }, () => list()));
    expect((await loads()) - before).toBe(1);
  });

  it("Redis에 닿지 않으면 DB에서 읽어 바로 응답한다(fail-open)", async () => {
    const saved = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://localhost:1";
    const broken = new CatalogCache();
    process.env.REDIS_URL = saved;
    const start = Date.now();
    expect(await broken.getOrLoad("x", async () => "from-db")).toBe("from-db");
    expect(Date.now() - start).toBeLessThan(1000);
    await broken.onModuleDestroy();
  });
});
