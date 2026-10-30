import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { categoryPaths } from "../products/product-list.js";
import { bigrams, normalizeQuery, toTsQuery, toTsVector, words } from "./bigram.js";
import { SEARCH_MAX_PAGES, type SearchEngine, type SearchHit, type SearchPage } from "./search-engine.js";

// 순위 가중치는 여기 한 곳에 둔다
export const RANK = {
  tsRank: 1, // 2-gram 일치(ts_rank: 이름 A > 카테고리 B > 설명 C)
  nameSimilarity: 0.5, // 검색어와 이름의 word_similarity(0~1)
  fuzzyWhenFewerThan: 5, // 2-gram 결과가 이보다 적을 때만 오타 보충을 섞는다
  fuzzyThreshold: 0.3, // 오타 보충의 word_similarity 하한("블르투스 이어폰" → "블루투스 이어폰"이 0.56)
} as const;

const BATCH = 500;
type Row = { id: number; name: string };

// 검색 쿼리. 측정 스크립트(scripts/search-bench.ts)가 같은 SQL을 EXPLAIN하도록 밖에 둔다
export const SEARCH_SQL = {
  // 2-gram AND 일치(GIN tokens). 순위 = ts_rank × tsRank + 이름 word_similarity × nameSimilarity
  token: (text: string, tsq: string, limit: number) => Prisma.sql`
    SELECT s.product_id AS id, s.name
    FROM product_search s, CAST(${tsq} AS tsquery) AS q
    WHERE s.tokens @@ q
    ORDER BY ts_rank(s.tokens, q) * ${RANK.tsRank}::float8 + word_similarity(${text}, s.name) * ${RANK.nameSimilarity}::float8 DESC, s.product_id
    LIMIT ${limit}`,
  // 오타 보충(GIN trgm name). pg_trgm.word_similarity_threshold를 같은 트랜잭션에서 먼저 정한다
  // word_similarity는 검색어의 한 단어만 맞아도 같은 값이 나오므로("블르투스 이어폰" → "… 이어폰 …") 이름 전체 similarity로 동점을 가른다
  similar: (text: string, seen: number[], limit: number) => Prisma.sql`
    SELECT product_id AS id, name FROM product_search
    WHERE ${text} <% name AND product_id <> ALL(${seen}::int[])
    ORDER BY word_similarity(${text}, name) DESC, similarity(${text}, name) DESC, product_id
    LIMIT ${limit}`,
  // 1글자 검색어의 이름 접두 일치(text_pattern_ops)
  prefix: (pattern: string, seen: number[], limit: number) => Prisma.sql`
    SELECT product_id AS id, name FROM product_search
    WHERE name LIKE ${pattern} AND product_id <> ALL(${seen}::int[])
    ORDER BY name, product_id LIMIT ${limit}`,
  threshold: () => Prisma.sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(RANK.fuzzyThreshold)}, true)`,
};

export class PgSearchEngine implements SearchEngine {
  constructor(private readonly db: PrismaClient) {}

  async search(query: string, { page, pageSize }: { page: number; pageSize: number }): Promise<SearchPage> {
    // 순위를 매길 후보는 최대 쪽 수(5쪽 × 20)까지만 본다
    const hits = await this.rank(query, { limit: SEARCH_MAX_PAGES * pageSize, nameOnly: false });
    const start = (page - 1) * pageSize;
    return { hits: hits.slice(start, start + pageSize), hasMore: page < SEARCH_MAX_PAGES && hits.length > start + pageSize };
  }

  async suggest(query: string, limit: number) {
    const hits = await this.rank(query, { limit, nameOnly: true });
    return hits.map(({ id, name }) => ({ id, name }));
  }

  // 1. 2-gram AND 일치를 ts_rank + 이름 유사도로 정렬
  // 2. 결과가 적으면 오타 보충(trigram word_similarity)을 뒤에 붙인다
  // 3. 1글자 검색어는 trigram이 안 되므로 이름 접두 일치를 붙인다
  private async rank(query: string, { limit, nameOnly }: { limit: number; nameOnly: boolean }): Promise<SearchHit[]> {
    const text = normalizeQuery(query);
    const tokens = bigrams(text);
    if (tokens.length === 0) return [];
    const tsq = toTsQuery(tokens, nameOnly ? "A" : "");
    const exact = await this.db.$queryRaw<Row[]>(SEARCH_SQL.token(text, tsq, limit));
    const hits: SearchHit[] = exact.map((r) => ({ ...r, match: "token" }));
    if (hits.length >= Math.min(limit, RANK.fuzzyWhenFewerThan)) return hits;

    const seen = hits.map((h) => h.id);
    const singleChar = words(text).every((w) => Array.from(w).length === 1);
    if (singleChar) {
      const pattern = `${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await this.db.$queryRaw<Row[]>(SEARCH_SQL.prefix(pattern, seen, limit - hits.length));
      return [...hits, ...rows.map((r) => ({ ...r, match: "prefix" as const }))];
    }
    const similar = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw(SEARCH_SQL.threshold());
      return tx.$queryRaw<Row[]>(SEARCH_SQL.similar(text, seen, limit - hits.length));
    });
    return [...hits, ...similar.map((r) => ({ ...r, match: "similar" as const }))];
  }

  async index(productIds: number[]): Promise<void> {
    const ids = [...new Set(productIds)];
    for (let i = 0; i < ids.length; i += BATCH) await this.indexBatch(ids.slice(i, i + BATCH));
  }

  private async indexBatch(ids: number[]) {
    if (ids.length === 0) return;
    const products = await this.db.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, description: true, categoryId: true },
    });
    const pathOf = await categoryPaths(this.db, [...new Set(products.flatMap((p) => (p.categoryId ? [p.categoryId] : [])))]);
    const docs = products.map((p) => {
      const categories = ((p.categoryId && pathOf.get(p.categoryId)) || []).map((c) => c.name).join(" > ");
      return {
        id: p.id,
        name: p.name,
        category_names: categories,
        description: p.description,
        tokens: toTsVector([[p.name, "A"], [categories, "B"], [p.description, "C"]]),
      };
    });
    if (docs.length > 0) {
      await this.db.$executeRaw`
        INSERT INTO product_search (product_id, name, category_names, description, tokens, indexed_at)
        SELECT d.id, d.name, d.category_names, d.description, d.tokens::tsvector, now()
        FROM jsonb_to_recordset(${JSON.stringify(docs)}::jsonb) AS d(id int, name text, category_names text, description text, tokens text)
        ON CONFLICT (product_id) DO UPDATE SET
          name = EXCLUDED.name, category_names = EXCLUDED.category_names, description = EXCLUDED.description,
          tokens = EXCLUDED.tokens, indexed_at = EXCLUDED.indexed_at`;
    }
    const found = new Set(products.map((p) => p.id));
    await this.remove(ids.filter((id) => !found.has(id)));
  }

  async remove(productIds: number[]): Promise<void> {
    if (productIds.length === 0) return;
    await this.db.$executeRaw`DELETE FROM product_search WHERE product_id = ANY(${productIds}::int[])`;
  }

  async reindexAll(): Promise<{ indexed: number }> {
    let cursor = 0;
    let indexed = 0;
    for (;;) {
      const page = await this.db.product.findMany({ where: { id: { gt: cursor } }, select: { id: true }, orderBy: { id: "asc" }, take: BATCH });
      if (page.length === 0) break;
      await this.indexBatch(page.map((p) => p.id));
      indexed += page.length;
      cursor = page[page.length - 1]!.id;
    }
    await this.db.$executeRaw`DELETE FROM product_search s WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = s.product_id)`;
    return { indexed };
  }
}
