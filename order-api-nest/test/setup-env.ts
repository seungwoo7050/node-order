process.loadEnvFile();
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL이 없습니다 - 개발 DB를 지우지 않도록 테스트를 멈춥니다");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!process.env.TEST_ADMIN_DATABASE_URL) throw new Error("TEST_ADMIN_DATABASE_URL이 없습니다");
process.env.ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL;

process.env.CATALOG_CACHE_KEY = "test:catalog";
process.env.SEARCH_STATS_PREFIX = "test:search";
// 색인 작업은 테스트가 indexOnce()로 직접 돌린다(타이머가 끼어들어 search_dirty를 비우지 않게)
process.env.SEARCH_INDEX_INTERVAL_MS = "3600000";
// 메일 큐를 개발 API와 나눈다(개발 API의 워커가 테스트 메일을 가져가면 fake mailer 수를 셀 수 없다)
process.env.MAIL_QUEUE_NAME = "test-mail";
process.env.MAIL_DELAY_MS = "0";
