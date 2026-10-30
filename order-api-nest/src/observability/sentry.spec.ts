import * as Sentry from "@sentry/nestjs";
import { initSentry } from "./sentry.js";

describe("initSentry", () => {
  it("SENTRY_DSN이 없으면 SDK를 초기화하지 않는다", () => {
    expect(initSentry({ NODE_ENV: "test", SENTRY_RELEASE: "blue-1" })).toBe(false);
    expect(initSentry({ SENTRY_DSN: "" })).toBe(false);
    expect(Sentry.getClient()).toBeUndefined();
    expect(Sentry.isInitialized()).toBe(false);
  });
});
