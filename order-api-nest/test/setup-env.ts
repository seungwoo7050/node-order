process.loadEnvFile();
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL이 없습니다 - 개발 DB를 지우지 않도록 테스트를 멈춥니다");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!process.env.TEST_ADMIN_DATABASE_URL) throw new Error("TEST_ADMIN_DATABASE_URL이 없습니다");
process.env.ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL;