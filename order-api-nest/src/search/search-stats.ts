import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { normalizeQuery } from "./bigram.js";

// 인기 검색어: 일별 ZSET에 정규화한 검색어를 더하고 7일치를 합쳐 상위를 낸다.
// 정확도가 중요하지 않고 쓰기가 잦아 DB가 아니라 Redis에 둔다. Redis가 안 되면 세지 않고 검색은 그대로 답한다.
const PREFIX = process.env.SEARCH_STATS_PREFIX ?? "search";
const DAYS = 7;
const DAY_TTL_SECONDS = 8 * 24 * 3600; // 7일을 합칠 때 가장 오래된 날이 남아 있게 하루 더
const SEEN_TTL_SECONDS = 3600; // 같은 IP·같은 검색어는 1시간에 한 번만 센다
const KST_OFFSET_MS = 9 * 3600_000;

export type QueryCount = { query: string; count: number };

const dayKey = (kind: "popular" | "zero", daysAgo: number, now = Date.now()) => {
  const d = new Date(now + KST_OFFSET_MS - daysAgo * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
  return `${PREFIX}:${kind}:${d}`;
};

@Injectable()
export class SearchStats implements OnModuleDestroy {
  private readonly logger = new Logger(SearchStats.name);
  private readonly redis = new Redis(process.env.REDIS_URL!, { enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 200 });

  constructor() {
    this.redis.on("error", () => {});
  }

  // 결과가 있으면 popular, 0건이면 zero에 센다(판매자가 손님이 못 찾은 것을 본다)
  async record(rawQuery: string, ip: string, found: boolean): Promise<void> {
    const query = normalizeQuery(rawQuery);
    if (!query) return;
    try {
      const first = await this.redis.set(`${PREFIX}:seen:${ip}:${query}`, "1", "EX", SEEN_TTL_SECONDS, "NX");
      if (first !== "OK") return;
      const key = dayKey(found ? "popular" : "zero", 0);
      await this.redis.multi().zincrby(key, 1, query).expire(key, DAY_TTL_SECONDS).exec();
    } catch (err) {
      this.logger.warn(`검색어를 세지 못했다: ${(err as Error).message}`);
    }
  }

  popular(limit = 10): Promise<QueryCount[]> {
    return this.top("popular", limit);
  }

  zeroResults(limit = 10): Promise<QueryCount[]> {
    return this.top("zero", limit);
  }

  private async top(kind: "popular" | "zero", limit: number): Promise<QueryCount[]> {
    const keys = Array.from({ length: DAYS }, (_, i) => dayKey(kind, i));
    try {
      const flat = await this.redis.zunion(keys.length, ...keys, "WITHSCORES");
      const rows: QueryCount[] = [];
      for (let i = 0; i < flat.length; i += 2) rows.push({ query: flat[i]!, count: Number(flat[i + 1]) });
      return rows.sort((a, b) => b.count - a.count || a.query.localeCompare(b.query)).slice(0, limit);
    } catch (err) {
      this.logger.warn(`인기 검색어를 읽지 못했다: ${(err as Error).message}`);
      return [];
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => {});
  }
}
