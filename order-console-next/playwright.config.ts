import { defineConfig } from "@playwright/test";
import { E2E_SENTRY_PORT, E2E_SENTRY_RELEASE } from "./e2e/support/error-tracking";

export default defineConfig({
  testDir: "e2e",
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      ...(process.env as Record<string, string>),
      SENTRY_DSN: `http://e2epublickey@127.0.0.1:${E2E_SENTRY_PORT}/1`,
      SENTRY_RELEASE: E2E_SENTRY_RELEASE,
      OPS_ERROR_CHECK: "1",
    },
  },
  use: { baseURL: "http://localhost:3000" },
  workers: 1,
});
