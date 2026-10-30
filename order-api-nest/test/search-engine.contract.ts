// SearchEngine 계약 테스트 묶음. 구현마다 *.e2e-spec.ts에서 searchEngineContract(이름, 준비 함수)로 부른다.
// 원본(products·categories)은 어느 구현이든 같은 DB이므로 여기서 adminDb로 만들고, 엔진에는 index만 시킨다.
import type { SearchEngine } from "../src/search/search-engine.js";
import { adminDb } from "./admin-db.js";

export type ContractFixture = {
  engine: SearchEngine;
  // 엔진의 문서를 모두 지운다(원본은 계약 테스트가 비운다)
  clearIndex(): Promise<void>;
};

const PAGE = { page: 1, pageSize: 20 };

export function searchEngineContract(name: string, setup: () => Promise<ContractFixture>) {
  describe(`SearchEngine 계약 - ${name}`, () => {
    let fx: ContractFixture;
    const ids: Record<string, number> = {};

    beforeAll(async () => {
      fx = await setup();
    });

    beforeEach(async () => {
      await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users, search_dirty RESTART IDENTITY CASCADE`;
      await fx.clearIndex();
      const bag = await adminDb.category.create({ data: { name: "가방" } });
      const audio = await adminDb.category.create({ data: { name: "음향" } });
      const rows = [
        { name: "여행용 가방", categoryId: bag.id, description: "바퀴 달린 기내용" },
        { name: "블루투스 이어폰", categoryId: audio.id, description: "노이즈 캔슬링" },
        { name: "블루투스 스피커", categoryId: audio.id, description: "방수" },
        { name: "유선 이어폰", categoryId: audio.id, description: "" },
        { name: "가죽 지갑", categoryId: bag.id, description: "" },
      ];
      for (const r of rows) ids[r.name] = (await adminDb.product.create({ data: { ...r, price: 10_000, stock: 5 } })).id;
      await fx.engine.index(Object.values(ids));
    });

    const names = async (q: string) => (await fx.engine.search(q, PAGE)).hits.map((h) => h.name);

    it("2-gram: 단어 일부와 띄어쓰기 없는 검색어로 찾는다", async () => {
      expect(await names("가방")).toContain("여행용 가방");
      expect(await names("여행가방")).toContain("여행용 가방");
    });

    it("카테고리 이름으로도 찾는다", async () => {
      expect(await names("음향")).toEqual(expect.arrayContaining(["블루투스 이어폰", "블루투스 스피커", "유선 이어폰"]));
    });

    it("오타: 한 글자 틀린 검색어도 찾는다", async () => {
      expect((await names("블루투스 이어펀"))[0]).toBe("블루투스 이어폰");
      expect((await names("블르투스 이어폰"))[0]).toBe("블루투스 이어폰");
    });

    it("정확히 맞춘 상품이 오타 보충 결과보다 위에 있다", async () => {
      const { hits } = await fx.engine.search("블루투스 이어폰", PAGE);
      expect(hits[0]).toMatchObject({ name: "블루투스 이어폰", match: "token" });
      const firstSimilar = hits.findIndex((h) => h.match !== "token");
      if (firstSimilar !== -1) expect(hits.slice(firstSimilar).every((h) => h.match !== "token")).toBe(true);
    });

    it("1글자 검색어는 오류 없이 빈 결과나 이름 접두 일치로 답한다", async () => {
      const { hits } = await fx.engine.search("가", PAGE);
      for (const h of hits) expect(h.name.startsWith("가") || h.match === "token").toBe(true);
      expect(hits.map((h) => h.name)).toContain("가죽 지갑");
    });

    it("맞는 것이 없으면 빈 결과", async () => {
      expect(await names("냉장고")).toEqual([]);
    });

    it("쪽 나누기: pageSize만큼 주고 다음 쪽이 있는지 알린다", async () => {
      const first = await fx.engine.search("음향", { page: 1, pageSize: 2 });
      expect(first.hits).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      const second = await fx.engine.search("음향", { page: 2, pageSize: 2 });
      expect(second.hits).toHaveLength(1);
      expect(second.hasMore).toBe(false);
      expect(new Set([...first.hits, ...second.hits].map((h) => h.id)).size).toBe(3);
    });

    it("suggest는 이름만 보고 limit개까지 준다", async () => {
      const items = await fx.engine.suggest("블루", 8);
      expect(items.map((i) => i.name).sort()).toEqual(["블루투스 스피커", "블루투스 이어폰"]);
      expect(await fx.engine.suggest("블루", 1)).toHaveLength(1);
      expect(await fx.engine.suggest("음향", 8)).toEqual([]); // 카테고리 이름으로는 자동완성하지 않는다
    });

    it("index는 원본을 다시 읽는다: 바뀐 이름으로 찾고 지워진 상품은 빠진다", async () => {
      await adminDb.product.update({ where: { id: ids["여행용 가방"] }, data: { name: "캠핑 배낭" } });
      await adminDb.product.delete({ where: { id: ids["가죽 지갑"] } });
      await fx.engine.index([ids["여행용 가방"]!, ids["가죽 지갑"]!]);
      expect(await names("배낭")).toEqual(["캠핑 배낭"]);
      expect(await names("여행용")).toEqual([]);
      expect(await names("지갑")).toEqual([]);
    });

    it("remove는 문서를 지운다", async () => {
      await fx.engine.remove([ids["유선 이어폰"]!]);
      expect(await names("유선")).toEqual([]);
    });

    it("reindexAll은 여러 번 돌려도 상품 수만큼이고 결과가 같다", async () => {
      await fx.clearIndex();
      const first = await fx.engine.reindexAll();
      const before = await names("블루투스");
      const second = await fx.engine.reindexAll();
      expect(first.indexed).toBe(5);
      expect(second.indexed).toBe(5);
      expect(await names("블루투스")).toEqual(before);
    });
  });
}
