// 검색 엔진 경계. 첫 구현은 PostgreSQL(pg-search-engine.ts)이고, 다른 구현(Elasticsearch 등)은
// test/search-engine.contract.ts의 같은 계약 테스트를 통과해야 한다.
// 원본은 늘 products·categories 테이블이다. index는 그 상품들을 원본에서 다시 읽어 문서를 만든다.

export const SEARCH_ENGINE = Symbol("SEARCH_ENGINE");

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MAX_PAGES = 5; // 순위 정렬이라 id 커서를 쓸 수 없어 쪽 번호로 넘기고, 깊이를 막는다
export const SUGGEST_LIMIT = 8;

export type SearchHit = {
  id: number;
  name: string;
  // token: 검색어의 2-gram이 모두 들어 있다 / similar: 오타 보충(trigram) / prefix: 1글자 검색어의 이름 접두 일치
  match: "token" | "similar" | "prefix";
};

export type SearchPage = { hits: SearchHit[]; hasMore: boolean };

export interface SearchEngine {
  // page는 1부터. 결과는 순위 순이고 2-gram으로 찾은 것이 오타 보충보다 먼저다
  search(query: string, opts: { page: number; pageSize: number }): Promise<SearchPage>;
  // 자동완성: 상품 이름 최대 limit개
  suggest(query: string, limit: number): Promise<{ id: number; name: string }[]>;
  // 원본에서 이 상품들을 다시 읽어 문서를 쓴다. 원본에 없는 상품은 문서를 지운다
  index(productIds: number[]): Promise<void>;
  remove(productIds: number[]): Promise<void>;
  // 모든 상품을 다시 색인하고 원본에 없는 문서를 지운다. 여러 번 돌려도 결과가 같다
  reindexAll(): Promise<{ indexed: number }>;
}
