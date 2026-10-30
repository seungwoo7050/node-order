import { PgError } from "./payment-gateway.js";
import { mapLimit, parseRetryAfter, withPgRetry } from "./pg-retry.js";

const opts = (waits: number[]) => ({ attempts: 4, baseMs: 200, maxMs: 5_000, sleep: async (ms: number) => void waits.push(ms) });
const failing = (errors: PgError[], value = "ok") => {
  let calls = 0;
  const fn = vi.fn(async () => {
    const err = errors[calls++];
    if (err) throw err;
    return value;
  });
  return fn;
};
const http = (status: number, retryAfterMs?: number) => new PgError(status >= 500 ? "network" : "rejected", `HTTP ${status}`, "X", status, retryAfterMs);

describe("PG 조회 재시도", () => {
  it("5xx는 200 → 400 → 800ms로 기다리며 다시 보내고, 성공하면 그 값을 돌려준다", async () => {
    const waits: number[] = [];
    const fn = failing([http(500), http(503), http(502)]);
    expect(await withPgRetry(fn, opts(waits))).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([200, 400, 800]);
  });

  it("429는 Retry-After보다 일찍 다시 보내지 않는다(백오프보다 길면 Retry-After, 짧으면 백오프)", async () => {
    const waits: number[] = [];
    expect(await withPgRetry(failing([http(429, 2_000), http(429, 0)]), opts(waits))).toBe("ok");
    expect(waits).toEqual([2_000, 400]);
  });

  it("한 번 기다림은 5초를 넘지 않는다", async () => {
    const waits: number[] = [];
    await withPgRetry(failing([http(429, 60_000)]), opts(waits));
    expect(waits).toEqual([5_000]);
  });

  it("횟수 상한(4번)을 넘으면 마지막 오류를 던진다", async () => {
    const waits: number[] = [];
    const fn = failing(Array.from({ length: 10 }, () => http(429)));
    await expect(withPgRetry(fn, opts(waits))).rejects.toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(4);
    expect(waits).toHaveLength(3);
  });

  it("404·400과 상태 코드가 없는 오류(시간 초과 등)는 다시 보내지 않는다", async () => {
    for (const err of [http(404), http(400), new PgError("timeout", "느림"), new Error("버그")]) {
      const fn = vi.fn(async () => { throw err; });
      await expect(withPgRetry(fn, opts([]))).rejects.toBe(err);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("Retry-After는 초와 HTTP 날짜를 읽는다", () => {
    expect(parseRetryAfter("3")).toBe(3_000);
    expect(parseRetryAfter("Fri, 30 Oct 2026 05:00:10 GMT", Date.parse("2026-10-30T05:00:00Z"))).toBe(10_000);
    expect(parseRetryAfter("내일")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe("동시성 상한", () => {
  it("한 번에 limit개까지만 돌리고 결과 순서는 입력 순서다", async () => {
    let inFlight = 0;
    let max = 0;
    const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (n) => {
      max = Math.max(max, ++inFlight);
      await new Promise((r) => setTimeout(r, 5 + (n % 3)));
      inFlight--;
      return n * 10;
    });
    expect(max).toBe(4);
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
