// 검색 측정: npm run search:bench -w order-api-nest [-- 상품수]
// 테스트 DB(이름이 _test로 끝나는 DB)에만 상품 1만 개를 넣고, LIKE '%검색어%'와 새 검색 쿼리의
// EXPLAIN (ANALYZE, BUFFERS)와 p50·p95(앱과 같은 Prisma 연결로 왕복 포함)를 마크다운으로 찍는다.
// 테스트 DB의 상품·주문 품목·검색 문서를 지운다(e2e 테스트도 매번 지우는 DB다).
import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client.js";
import { bigrams, normalizeQuery, toTsQuery } from "../src/search/bigram.js";
import { PgSearchEngine, SEARCH_SQL } from "../src/search/pg-search-engine.js";

if (existsSync(".env")) process.loadEnvFile();
const url = process.env.TEST_ADMIN_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("TEST_ADMIN_DATABASE_URL이 _test DB를 가리켜야 합니다 - 개발·운영 DB에는 넣지 않습니다");
const COUNT = Number(process.argv[2] ?? 10_000);
const RUNS = 200;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const engine = new PgSearchEngine(prisma);

// 1. 시드: 수식어 × 품목 × 색 조합(같은 이름이 고르게 퍼지도록 결정적으로)
const mods = ["무선", "유선", "휴대용", "여행용", "대용량", "미니", "접이식", "방수", "가죽", "원목", "블루투스", "무소음", "초경량", "스테인리스", "프리미엄", "캠핑용", "사무용", "어린이", "충전식", "빈티지"];
const items = ["가방", "이어폰", "키보드", "마우스", "텀블러", "머그컵", "주전자", "지갑", "백팩", "스피커", "충전기", "케이블", "램프", "의자", "책상", "선풍기", "가습기", "캐리어", "우산", "모자", "헤드폰", "보조배터리", "도마", "냄비", "시계"];
const colors = ["블랙", "화이트", "그레이", "네이비", "베이지", "카키", "레드", "민트"];
const phrases = ["가볍고 튼튼합니다", "선물용으로 좋습니다", "매일 쓰기 편합니다", "오래 쓸 수 있습니다", "세척이 쉽습니다", "공간을 적게 차지합니다", "소음이 적습니다"];

await prisma.$executeRaw`TRUNCATE order_items, products, product_search, search_dirty RESTART IDENTITY CASCADE`;
const started = Date.now();
for (let i = 0; i < COUNT; i += 1000) {
  const rows = Array.from({ length: Math.min(1000, COUNT - i) }, (_, k) => {
    const n = i + k;
    return {
      name: `${mods[n % mods.length]} ${items[Math.floor(n / mods.length) % items.length]} ${colors[n % colors.length]} ${n}`,
      price: 1000 + (n % 50) * 1000,
      stock: n % 30,
      description: `${phrases[n % phrases.length]}. ${phrases[(n * 3) % phrases.length]}.`,
    };
  });
  await prisma.$executeRaw`
    INSERT INTO products (name, price, stock, description)
    SELECT name, price, stock, description FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS d(name text, price int, stock int, description text)`;
}
const { indexed } = await engine.reindexAll();
await prisma.$executeRaw`DELETE FROM search_dirty`;
await prisma.$executeRaw`VACUUM ANALYZE products`;
await prisma.$executeRaw`VACUUM ANALYZE product_search`;
console.log(`시드: 상품 ${COUNT}개, 문서 ${indexed}개 (${Date.now() - started}ms)\n`);

// 2. 쿼리
const like = (q: string) => Prisma.sql`
  SELECT id, name FROM products WHERE name LIKE ${`%${q}%`} OR description LIKE ${`%${q}%`} ORDER BY id LIMIT 100`;
const token = (q: string) => SEARCH_SQL.token(normalizeQuery(q), toTsQuery(bigrams(q)), 100);

async function explain(sql: Prisma.Sql, withThreshold = false) {
  return prisma.$transaction(async (tx) => {
    if (withThreshold) await tx.$executeRaw(SEARCH_SQL.threshold());
    const rows = await tx.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
  });
}

async function timing(run: () => Promise<unknown>) {
  for (let i = 0; i < 20; i++) await run(); // 데우기
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await run();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  const at = (p: number) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))]!.toFixed(2);
  return { p50: at(50), p95: at(95) };
}

const cases = [
  { q: "가방", note: "2-gram 1개, 흔한 품목" },
  { q: "블루투스 이어폰", note: "두 단어(토큰 5개 AND)" },
  { q: "여행가방", note: "띄어쓰기 없음(2-gram 결과 0 → 오타 보충)" },
  { q: "블르투스 이어폰", note: "오타(2-gram 결과 0 → 오타 보충)" },
];

console.log("| 검색어 | 경우 | LIKE 결과 | LIKE p50 / p95 (ms) | 새 검색 결과 | 새 검색 p50 / p95 (ms) | 새 검색 1위 |");
console.log("| --- | --- | ---: | ---: | ---: | ---: | --- |");
for (const c of cases) {
  const likeRows = await prisma.$queryRaw<unknown[]>(like(c.q));
  const likeT = await timing(() => prisma.$queryRaw(like(c.q)));
  const hits = (await engine.search(c.q, { page: 1, pageSize: 100 })).hits;
  const newT = await timing(() => engine.search(c.q, { page: 1, pageSize: 20 }));
  console.log(`| ${c.q} | ${c.note} | ${likeRows.length} | ${likeT.p50} / ${likeT.p95} | ${hits.length} | ${newT.p50} / ${newT.p95} | ${hits[0]?.name ?? "-"} |`);
}

console.log("\n### LIKE '%블루투스 이어폰%' (products)\n\n```text");
console.log(await explain(like("블루투스 이어폰")));
console.log("```\n\n### 2-gram 일치 '블루투스 이어폰' (product_search.tokens GIN)\n\n```text");
console.log(await explain(token("블루투스 이어폰")));
console.log("```\n\n### 오타 보충 '블르투스 이어폰' (product_search.name GIN trgm)\n\n```text");
console.log(await explain(SEARCH_SQL.similar(normalizeQuery("블르투스 이어폰"), [], 100), true));
console.log("```");

await prisma.$executeRaw`TRUNCATE order_items, products, product_search, search_dirty RESTART IDENTITY CASCADE`;
await prisma.$disconnect();
