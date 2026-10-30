import { Logger } from "@nestjs/common";

// 토큰 단위 분당 도구 호출 제한(MCP_RATE_LIMIT_PER_MINUTE, 기본 60).
// 세는 곳은 Redis(인스턴스가 여럿이어도 같은 수). Redis가 안 되면 열지도(fail-open) 닫지도(fail-closed) 않고
// 이 프로세스 안의 같은 창 카운터로 센다:
//   - 열면 에이전트가 루프에 빠졌을 때 돈·재고를 움직이는 도구가 제한 없이 불린다
//   - 닫으면 캐시 장애 하나로 판매자의 도구 전체가 멈춘다(Redis는 이 API에서 캐시·큐 등급이다)
//   - 운영은 API 한 대라 프로세스 카운터로도 한도가 같고, 여러 대여도 한도가 대수 배까지만 늘어난다
export type CounterStore = { hit(key: string, ttlSeconds: number): Promise<number> };

const WINDOW_SECONDS = 60;
export const mcpLimitPerMinute = () => Number(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? 60) || 60;

export class McpRateLimiter {
  private readonly logger = new Logger(McpRateLimiter.name);
  private readonly local = new Map<string, number>();

  constructor(private readonly store: CounterStore) {}

  // 이 호출을 세고, 한도 안이면 true. retryAfter는 다음 창까지 남은 초
  async allow(tokenId: number, now = Date.now()): Promise<{ ok: boolean; limit: number; retryAfter: number }> {
    const limit = mcpLimitPerMinute();
    const window = Math.floor(now / 1000 / WINDOW_SECONDS);
    const key = `rate:mcp:${tokenId}:${window}`;
    let count: number;
    try {
      count = await this.store.hit(key, WINDOW_SECONDS);
    } catch (err) {
      this.logger.warn(`MCP 호출 수를 Redis에서 세지 못해 프로세스 안에서 센다: ${(err as Error).message}`);
      count = this.hitLocal(key, window);
    }
    return { ok: count <= limit, limit, retryAfter: (window + 1) * WINDOW_SECONDS - Math.floor(now / 1000) };
  }

  private hitLocal(key: string, window: number): number {
    for (const k of this.local.keys()) if (!k.endsWith(`:${window}`)) this.local.delete(k); // 지난 창은 버린다
    const count = (this.local.get(key) ?? 0) + 1;
    this.local.set(key, count);
    return count;
  }
}
