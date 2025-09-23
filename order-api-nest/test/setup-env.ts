process.loadEnvFile();
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL이 없습니다 - 개발 DB를 지우지 않도록 테스트를 멈춥니다");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;