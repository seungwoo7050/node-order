import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { CatalogCache } from "../src/cache/catalog-cache.js";
import { adminDb } from "./admin-db.js";

describe("페이지네이션 - 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;
  let kimToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = await app.getUrl();
    kimToken = app.get(JwtService, { strict: false }).sign({ sub: "kim", role: "admin" });
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김", role: "admin" }, { id: "lee", name: "이" }] });
    const same = new Date("2026-01-31T00:00:00Z");
    await adminDb.order.createMany({
      data: [
        { userId: "kim", price: 1, paid: true, createdAt: new Date("2026-01-30T00:00:00Z") },
        { userId: "kim", price: 2, paid: true, createdAt: same },
        { userId: "kim", price: 3, paid: true, createdAt: same },
        { userId: "kim", price: 4, paid: false, createdAt: same },
        { userId: "kim", price: 5, paid: true, createdAt: new Date("2026-02-01T00:00:00Z") },
        { userId: "lee", price: 6, paid: true, createdAt: new Date("2026-02-02T00:00:00Z") },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = async (path: string, query: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    const res = await fetch(`${baseUrl}${path}?${qs}`, { headers: { Authorization: `Bearer ${kimToken}` } });
    return { status: res.status, body: await res.json() };
  };
  const ids = (body: { items: { id: number }[] }) => body.items.map((o) => o.id);

  async function walk(path: string) {
    const all: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const { body } = await get(path, { limit: 2, ...(cursor && { cursor }) });
      all.push(...ids(body));
      cursor = body.nextCursor;
      pages++;
    } while (cursor);
    return { ids: all, pages };
  }

  it("내 주문: 최신순으로 2건씩, 같은 시각끼리는 id가 큰 것부터. 남의 주문은 없다", async () => {
    expect(await walk("/me/orders")).toEqual({ ids: [5, 4, 3, 2, 1], pages: 3 });
  });

  it("전체 주문(관리자): cursor로 끝까지 넘기면 모든 주문을 한 번씩 본다", async () => {
    expect(await walk("/orders")).toEqual({ ids: [6, 5, 4, 3, 2, 1], pages: 3 });
  });

  it("전체 주문: offset으로 건너뛴 뒤 받은 cursor로 이어 읽는다", async () => {
    const jump = await get("/orders", { limit: 2, offset: 2 });
    expect(ids(jump.body)).toEqual([4, 3]);
    const next = await get("/orders", { limit: 2, cursor: jump.body.nextCursor });
    expect(ids(next.body)).toEqual([2, 1]);
    expect(next.body.nextCursor).toBeNull();
  });

  it("전체 주문: paid=false로 걸러도 페이지 모양은 같다", async () => {
    const { body } = await get("/orders", { paid: "false" });
    expect(body).toMatchObject({ items: [{ id: 4, paid: false }], nextCursor: null });
  });

  it("잘못된 cursor, 너무 큰 limit, 불리언이 아닌 paid는 400", async () => {
    expect((await get("/orders", { cursor: "not-a-cursor" })).status).toBe(400);
    expect((await get("/orders", { limit: 101 })).status).toBe(400);
    expect((await get("/orders", { paid: "yes" })).status).toBe(400);
  });

  it("상품: id 순으로, cursor는 마지막 상품의 id", async () => {
    await adminDb.product.createMany({ data: [1, 2, 3].map((i) => ({ name: `상품 ${i}`, price: 1000, stock: 1 })) });
    await app.get(CatalogCache).invalidate();
    const first = await get("/products", { limit: 2 });
    expect(first.body).toMatchObject({ items: [{ id: 1 }, { id: 2 }], nextCursor: 2 });
    const last = await get("/products", { limit: 2, cursor: 2 });
    expect(last.body).toMatchObject({ items: [{ id: 3 }], nextCursor: null });
  });

  it("tRPC의 me.orders도 REST와 같은 페이지를 준다", async () => {
    const input = encodeURIComponent(JSON.stringify({ limit: 2 }));
    const res = await fetch(`${baseUrl}/trpc/me.orders?input=${input}`, { headers: { Authorization: `Bearer ${kimToken}` } });
    const rest = await get("/me/orders", { limit: 2 });
    expect((await res.json()).result.data).toEqual(rest.body);
  });
});
