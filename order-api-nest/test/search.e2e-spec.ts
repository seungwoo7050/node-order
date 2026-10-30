import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Logger, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { Redis } from "ioredis";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { LeaderElection } from "../src/leader/leader-election.js";
import { SearchIndexJob } from "../src/leader/search-index.job.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { SEARCH_ENGINE, type SearchEngine } from "../src/search/search-engine.js";
import { SearchStats } from "../src/search/search-stats.js";
import { adminDb } from "./admin-db.js";

const run = promisify(execFile);
type Item = { id: number; name: string; stock: number; imageUrl: string | null; categoryPath: string[]; match: string };
type Page = { items: Item[]; page: number; nextPage: number | null };

describe("상품 검색 API", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let token: string;
  let job: SearchIndexJob;
  let engine: SearchEngine;
  let stats: SearchStats;
  const redis = new Redis(process.env.REDIS_URL!);
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.use(cookieParser());
    app.set("trust proxy", "loopback");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0);
    baseUrl = await app.getUrl();
    job = app.get(SearchIndexJob);
    engine = app.get(SEARCH_ENGINE);
    stats = app.get(SearchStats);
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users, product_search, search_dirty RESTART IDENTITY CASCADE`;
    const keys = await redis.keys("test:search:*");
    if (keys.length) await redis.del(...keys);
    await adminDb.user.create({ data: { id: "kim", name: "김", role: "admin", passwordHash: await hashPassword("pw-for-test") } });
    const bag = await adminDb.category.create({ data: { name: "가방" } });
    const audio = await adminDb.category.create({ data: { name: "음향" } });
    for (const [name, categoryId] of [["여행용 가방", bag.id], ["블루투스 이어폰", audio.id], ["블루투스 스피커", audio.id], ["유선 이어폰", audio.id]] as const) {
      ids[name] = (await adminDb.product.create({ data: { name, categoryId, price: 10_000, stock: 3 } })).id;
    }
    await job.indexOnce(); // 상품을 만든 트리거가 search_dirty에 남긴 행을 반영
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "kim", password: "pw-for-test" }),
    });
    token = ((await res.json()) as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await adminDb.$disconnect();
  });

  const search = async (q: string, ip = "192.0.2.1", page?: number) => {
    const res = await fetch(`${baseUrl}/products/search?q=${encodeURIComponent(q)}${page ? `&page=${page}` : ""}`, { headers: { "X-Forwarded-For": ip } });
    return { status: res.status, body: (await res.json()) as Page };
  };
  const names = async (q: string) => (await search(q)).body.items.map((i) => i.name);
  const patch = (id: number, data: object) =>
    fetch(`${baseUrl}/products/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(data) });
  const dirtyCount = async () => (await adminDb.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM search_dirty`)[0]!.n;

  describe("검색", () => {
    it("2-gram: '가방'과 '여행가방'으로 '여행용 가방'이 나오고, 목록과 같은 모양(재고, 이미지, 카테고리)이다", async () => {
      const { status, body } = await search("가방");
      expect(status).toBe(200);
      expect(body.items[0]).toMatchObject({ name: "여행용 가방", stock: 3, imageUrl: null, categoryPath: ["가방"] });
      expect(await names("여행가방")).toContain("여행용 가방");
    });

    it("1글자 검색어는 400이 아니다", async () => {
      const { status, body } = await search("가");
      expect(status).toBe(200);
      for (const item of body.items) expect(item.name.startsWith("가") || item.match === "token").toBe(true);
    });

    it("오타: '블루투스 이어펀'과 '블르투스 이어폰'의 첫 결과가 '블루투스 이어폰'이고, 정확히 맞춘 결과가 오타 보충보다 위다", async () => {
      expect((await names("블루투스 이어펀"))[0]).toBe("블루투스 이어폰");
      expect((await names("블르투스 이어폰"))[0]).toBe("블루투스 이어폰");
      const { body } = await search("블루투스 이어폰");
      expect(body.items[0]).toMatchObject({ name: "블루투스 이어폰", match: "token" });
      expect(body.items.slice(1).every((i) => i.match !== "token")).toBe(true);
    });

    it("검색어가 없거나 6쪽 이상이면 400, 5쪽까지는 된다", async () => {
      expect((await fetch(`${baseUrl}/products/search`)).status).toBe(400);
      expect((await fetch(`${baseUrl}/products/search?q=%20`)).status).toBe(400);
      expect((await search("가방", undefined, 6)).status).toBe(400);
      expect((await search("가방", undefined, 5)).body).toEqual({ items: [], page: 5, nextPage: null });
    });

    it("자동완성은 상품 이름을 최대 8개 준다", async () => {
      for (let i = 0; i < 10; i++) await adminDb.product.create({ data: { name: `블루투스 키보드 ${i}`, price: 1, stock: 1 } });
      await job.indexOnce();
      const res = await fetch(`${baseUrl}/products/suggest?q=${encodeURIComponent("블루")}`);
      const { items } = (await res.json()) as { items: { id: number; name: string }[] };
      expect(res.status).toBe(200);
      expect(items).toHaveLength(8);
      expect(items.every((i) => i.name.includes("블루"))).toBe(true);
    });
  });

  describe("색인 반영(search_dirty)", () => {
    it("상품 이름을 바꾸고 색인을 한 번 돌리면 새 이름으로 나오고 옛 이름으로는 안 나온다", async () => {
      expect((await patch(ids["여행용 가방"]!, { name: "캠핑 배낭" })).status).toBe(200);
      expect(await names("배낭")).toEqual([]); // 색인 전
      await job.indexOnce();
      expect(await names("배낭")).toEqual(["캠핑 배낭"]);
      expect(await names("여행용")).toEqual([]);
    });

    it("카테고리 이름을 바꾸면 그 카테고리 상품이 새 카테고리 이름으로 나온다", async () => {
      await adminDb.category.update({ where: { id: 2 }, data: { name: "오디오" } });
      expect(await dirtyCount()).toBe(3);
      await job.indexOnce();
      expect((await names("오디오")).sort()).toEqual(["블루투스 스피커", "블루투스 이어폰", "유선 이어폰"]);
      expect(await names("음향")).toEqual([]);
    });

    it("같은 상품을 연달아 3번 고쳐도 search_dirty는 1행이고, 재고만 바꾸면 기록하지 않는다", async () => {
      for (const name of ["가방 1", "가방 2", "가방 3"]) expect((await patch(ids["여행용 가방"]!, { name })).status).toBe(200);
      expect(await dirtyCount()).toBe(1);
      await job.indexOnce();
      await adminDb.product.update({ where: { id: ids["여행용 가방"] }, data: { stock: 9 } });
      expect(await dirtyCount()).toBe(0);
    });

    it("색인하는 동안의 상품 수정·카테고리 변경은 기다리지 않고, 그 변경은 남아 다음 회차에 반영된다", async () => {
      const id = ids["여행용 가방"]!;
      expect((await patch(id, { name: "캠핑 배낭" })).status).toBe(200);
      const index = engine.index.bind(engine);
      let entered!: () => void;
      let release!: () => void;
      const inIndex = new Promise<void>((r) => (entered = r));
      const gate = new Promise<void>((r) => (release = r));
      vi.spyOn(engine, "index").mockImplementationOnce(async (productIds) => {
        await index(productIds); // "캠핑 배낭"을 색인한 뒤
        entered();
        await gate; // 반영이 끝나기 전에 멈춘다
      });
      const round = job.indexOnce();
      await inIndex;

      const within = <T>(p: Promise<T>) => Promise.race([p, new Promise<"기다림">((r) => setTimeout(() => r("기다림"), 2000))]);
      expect(await within(patch(id, { name: "등산 배낭" }).then((r) => r.status))).toBe(200);
      expect(await within(adminDb.category.update({ where: { id: 2 }, data: { name: "오디오" } }).then(() => "끝"))).toBe("끝");
      release();
      await round;

      const doc = await adminDb.$queryRaw<{ name: string }[]>`SELECT name FROM product_search WHERE product_id = ${id}`;
      expect(doc).toEqual([{ name: "캠핑 배낭" }]); // 이번 회차는 가져간 뒤 읽은 값
      const left = await adminDb.$queryRaw<{ product_id: number }[]>`SELECT product_id FROM search_dirty ORDER BY product_id`;
      expect(left.map((r) => r.product_id)).toEqual([id, ids["블루투스 이어폰"], ids["블루투스 스피커"], ids["유선 이어폰"]].sort((a, b) => a! - b!));

      await job.indexOnce();
      expect(await names("등산")).toEqual(["등산 배낭"]);
      expect(await names("캠핑")).toEqual([]);
      expect(await names("오디오")).toHaveLength(3);
      expect(await dirtyCount()).toBe(0);
    });

    it("상품을 지우면 색인에서도 빠진다", async () => {
      await adminDb.product.delete({ where: { id: ids["유선 이어폰"] } });
      await job.indexOnce();
      expect(await names("유선")).toEqual([]);
    });
  });

  describe("장애 격리", () => {
    it("색인 작업이 예외를 던져도 검색과 상품 수정은 200이고, dirty 행이 남아 다음 회차에 반영된다", async () => {
      vi.spyOn(engine, "index").mockRejectedValueOnce(new Error("색인 엔진이 응답하지 않음"));
      expect((await patch(ids["여행용 가방"]!, { name: "캠핑 배낭" })).status).toBe(200);
      await expect(job.indexOnce()).rejects.toThrow("색인 엔진이 응답하지 않음");
      expect(await dirtyCount()).toBe(1);

      // 리더 타이머 경로는 예외를 삼키고, 원인(code·meta·cause)이 보이는 경고를 남긴다
      vi.spyOn(app.get(LeaderElection), "isLeader", "get").mockReturnValue(true);
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
      const prismaLike = Object.assign(new Error(""), { name: "PrismaClientKnownRequestError", code: "P2010", meta: { driverAdapterError: "ConnectionClosed" }, cause: new Error("connection terminated") });
      vi.spyOn(engine, "index").mockRejectedValueOnce(prismaLike);
      await expect(job.run()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/검색 색인 실패.*code=P2010.*ConnectionClosed.*cause=\[Error: connection terminated\]/));
      expect((await search("가방")).status).toBe(200);
      expect((await patch(ids["여행용 가방"]!, { price: 12_000 })).status).toBe(200);
      expect(await dirtyCount()).toBe(1);

      await job.indexOnce();
      expect(await dirtyCount()).toBe(0);
      expect(await names("배낭")).toEqual(["캠핑 배낭"]);
    });
  });

  describe("재색인 명령", () => {
    it("npm run search:reindex를 두 번 돌려도 문서 수가 상품 수와 같고 결과가 같다", async () => {
      await adminDb.$executeRaw`DELETE FROM product_search`;
      await adminDb.$executeRaw`INSERT INTO product_search (product_id, name, tokens) VALUES (999, '사라진 상품', '''사라''')`;
      const counts = async () => (await adminDb.$queryRaw<{ docs: number; products: number }[]>`
        SELECT (SELECT count(*)::int FROM product_search) AS docs, (SELECT count(*)::int FROM products) AS products`)[0]!;
      const reindex = () => run("npm", ["run", "search:reindex"], { cwd: new URL("..", import.meta.url).pathname, env: process.env });

      await reindex();
      const first = { counts: await counts(), result: await names("블루투스") };
      await reindex();
      expect(first.counts).toEqual({ docs: 4, products: 4 });
      expect(await counts()).toEqual(first.counts);
      expect(await names("블루투스")).toEqual(first.result);
      expect(first.result).toHaveLength(2);
    }, 30_000);
  });

  describe("인기 검색어", () => {
    const popular = async () => ((await (await fetch(`${baseUrl}/search/popular`)).json()) as { items: { query: string; count: number }[] }).items;

    it("같은 IP가 같은 검색어를 10번 검색해도 1로 세고, 다른 IP 3곳이면 3이다", async () => {
      for (let i = 0; i < 10; i++) await search("블루투스", "198.51.100.1");
      expect(await stats.counts("popular")).toEqual([{ query: "블루투스", count: 1 }]);
      await search("블루투스", "198.51.100.2");
      await search(" 블루투스 ", "198.51.100.3"); // 정규화해서 같은 검색어
      expect(await stats.counts("popular")).toEqual([{ query: "블루투스", count: 3 }]);
    });

    it("공개 API는 서로 다른 IP가 3곳 이상인 검색어만 낸다(한 IP가 여러 시간 찾아도 1곳)", async () => {
      await search("블루투스", "198.51.100.1");
      await search("블루투스", "198.51.100.2");
      await redis.del(`test:search:seen:198.51.100.1:블루투스`); // 1시간이 지나 같은 IP가 또 센 것과 같다
      await search("블루투스", "198.51.100.1");
      expect(await stats.counts("popular")).toEqual([{ query: "블루투스", count: 3 }]);
      expect(await popular()).toEqual([]);
      await search("블루투스", "198.51.100.3");
      expect(await popular()).toEqual([{ query: "블루투스", count: 4 }]);
    });

    it("길이·문자 제한을 통과하지 못한 검색어는 결과가 있어도 공개하지 않는다", async () => {
      await adminDb.product.create({ data: { name: "가 https://spam.example 가방", price: 1, stock: 1 } });
      await job.indexOnce();
      for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
        await search("가", ip); // 1글자(이름 접두 일치로 결과는 있다)
        await search("https://spam.example", ip);
        await search("가방", ip);
      }
      expect((await search("https://spam.example")).body.items.length).toBeGreaterThan(0);
      expect(await popular()).toEqual([{ query: "가방", count: 3 }]);
    });

    it("결과가 0건인 검색어는 공개하지 않고 관리자용으로 따로 쌓인다(거르지 않는다)", async () => {
      for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) await search("냉장고", ip);
      await search("<x>", "198.51.100.1");
      expect(await stats.zeroResults()).toEqual([{ query: "냉장고", count: 3 }, { query: "<x>", count: 1 }]);
      expect(await stats.counts("popular")).toEqual([]);
      expect(await popular()).toEqual([]);
    });
  });
});
