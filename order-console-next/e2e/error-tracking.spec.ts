import { expect, test } from "@playwright/test";
import { FakeSentry } from "../../order-api-nest/test/fake-sentry";
import { E2E_SENTRY_PORT, E2E_SENTRY_RELEASE } from "./support/error-tracking";

// 콘솔 서버 컴포넌트에서 던진 오류가 오류 추적(가짜 수집 서버)에 release와 함께 도착하고,
// 연락처·Authorization·Cookie 원문이 이벤트에 없는지 본다. playwright.config.ts가 띄우는 서버는
// SENTRY_DSN을 이 가짜 서버(E2E_SENTRY_PORT)로, OPS_ERROR_CHECK=1로 띄운다
const BEARER = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJlMmUifQ.d2ViLWUyZS1zaWduYXR1cmU";
const COOKIE_SECRET = "web-e2e-session-cookie-secret";

test.describe("오류 추적", () => {
  const collector = new FakeSentry();

  test.beforeAll(async () => {
    await collector.start(E2E_SENTRY_PORT);
  });

  test.afterAll(async () => {
    await collector.stop();
  });

  test("서버 컴포넌트의 오류가 release와 함께 도착하고 연락처·Authorization·Cookie 원문이 없다", async ({ request }) => {
    const res = await request.get("/ops/error-check", {
      headers: { Authorization: `Bearer ${BEARER}`, Cookie: `authjs.session-token=${COOKIE_SECRET}` },
    });
    test.skip(res.status() === 404, "3000에 떠 있는 서버가 OPS_ERROR_CHECK 없이 떴다(다시 쓴 개발 서버)");

    const event = await collector.waitForEvent((e) => JSON.stringify(e).includes("오류 추적 확인"), 10_000);
    expect(event.release).toBe(E2E_SENTRY_RELEASE);
    expect(JSON.stringify(event)).toContain("010-****-6789");

    const raw = collector.envelopes.map((e) => e.raw).join("\n");
    for (const secret of ["010-2345-6789", "kim.customer@example.com", BEARER, COOKIE_SECRET]) {
      expect(raw).not.toContain(secret);
    }
  });
});
