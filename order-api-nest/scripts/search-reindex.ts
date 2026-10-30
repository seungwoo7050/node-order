// 검색 문서를 원본(products·categories)에서 모두 다시 만든다: npm run search:reindex
// 여러 번 돌려도 결과가 같다(있는 문서는 덮어쓰고, 원본에 없는 문서는 지운다).
// 이미 설정된 환경변수(DATABASE_URL 등)는 .env보다 앞선다.
import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PgSearchEngine } from "../src/search/pg-search-engine.js";

if (existsSync(".env")) process.loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL이 없습니다");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const started = Date.now();
try {
  const { indexed } = await new PgSearchEngine(prisma).reindexAll();
  const [{ docs }] = await prisma.$queryRaw<{ docs: number }[]>`SELECT count(*)::int AS docs FROM product_search`;
  console.log(`재색인: 상품 ${indexed}개, 문서 ${docs}개 (${Date.now() - started}ms)`);
} finally {
  await prisma.$disconnect();
}
