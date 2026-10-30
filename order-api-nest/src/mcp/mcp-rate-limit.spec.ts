import { McpRateLimiter, type CounterStore } from "./mcp-rate-limit.js";

describe("MCP 토큰 단위 호출 제한", () => {
  const T0 = Date.parse("2026-10-30T06:00:10Z");

  afterEach(() => {
    delete process.env.MCP_RATE_LIMIT_PER_MINUTE;
  });

  const memoryStore = (): CounterStore => {
    const counts = new Map<string, number>();
    return { hit: async (key) => counts.set(key, (counts.get(key) ?? 0) + 1).get(key)! };
  };

  it("토큰마다 분당 한도까지만 통과시키고, 다음 창에서 다시 센다", async () => {
    process.env.MCP_RATE_LIMIT_PER_MINUTE = "3";
    const limiter = new McpRateLimiter(memoryStore());
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await limiter.allow(1, T0)).ok);
    expect(results).toEqual([true, true, true, false]);
    expect((await limiter.allow(2, T0)).ok).toBe(true); // 다른 토큰은 따로
    expect((await limiter.allow(1, T0)).retryAfter).toBe(50);
    expect((await limiter.allow(1, T0 + 60_000)).ok).toBe(true);
  });

  it("Redis가 안 되면 열지 않고 프로세스 안에서 같은 한도로 센다", async () => {
    process.env.MCP_RATE_LIMIT_PER_MINUTE = "2";
    const limiter = new McpRateLimiter({ hit: async () => { throw new Error("ECONNREFUSED"); } });
    const results = [];
    for (let i = 0; i < 3; i++) results.push((await limiter.allow(1, T0)).ok);
    expect(results).toEqual([true, true, false]);
    expect((await limiter.allow(1, T0 + 60_000)).ok).toBe(true);
  });
});
