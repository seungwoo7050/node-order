import { defineConfig } from "vitest/config";

export default defineConfig({
  // e2e/**/*.unit.ts: e2e 도우미의 단위 테스트(playwright는 *.spec.ts만 돌린다)
  test: { include: ["lib/**/*.test.ts", "e2e/**/*.unit.ts"] },
});
