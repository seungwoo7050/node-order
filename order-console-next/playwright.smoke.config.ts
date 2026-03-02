import { defineConfig } from "@playwright/test";

const baseURL = process.env.SMOKE_URL;
if (!baseURL) throw new Error("SMOKE_URL이 없다(웹 주소, 예: http://localhost:8080)");
const token = process.env.DEPLOY_SLOT_TOKEN;

export default defineConfig({
  testDir: "smoke",
  testMatch: "*.smoke.ts",
  retries: 1,
  use: {
    baseURL,
    storageState: token
      ? { cookies: [{ name: "deploy_slot", value: token, domain: new URL(baseURL).hostname, path: "/", expires: -1, httpOnly: false, secure: baseURL.startsWith("https:"), sameSite: "Lax" }], origins: [] }
      : undefined,
  },
});
