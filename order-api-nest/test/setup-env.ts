process.loadEnvFile();
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL이 없습니다 - 개발 DB를 지우지 않도록 테스트를 멈춥니다");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!process.env.TEST_ADMIN_DATABASE_URL) throw new Error("TEST_ADMIN_DATABASE_URL이 없습니다");
process.env.ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL;

process.env.CATALOG_CACHE_KEY = "test:catalog";
process.env.SEARCH_STATS_PREFIX = "test:search";
// 색인 작업은 테스트가 indexOnce()로 직접 돌린다(타이머가 끼어들어 search_dirty를 비우지 않게)
process.env.SEARCH_INDEX_INTERVAL_MS = "3600000";
