import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { normalizeQuery } from "./bigram.js";

// 인기 검색어: 일별 ZSET에 정규화한 검색어를 더하고 7일치를 합쳐 상위를 낸다.
// 정확도가 중요하지 않고 쓰기가 잦아 DB가 아니라 Redis에 둔다. Redis가 안 되면 세지 않고 검색은 그대로 답한다.
//   search:popular:YYYYMMDD     ZSET  결과가 1건 이상이었던 검색어 → 횟수(같은 IP·같은 검색어는 1시간에 한 번)
//   search:ips:YYYYMMDD:<검색어> HLL   그 검색어를 찾은 IP(서로 다른 IP 수를 어림한다)
//   search:zero:YYYYMMDD        ZSET  결과가 0건인 검색어(관리자용, 걸러내지 않는다)
// 공개 API(popular)는 아무나 칩에 글을 올리지 못하게 POPULAR_RULES를 모두 통과한 검색어만 낸다.
const PREFIX = process.env.SEARCH_STATS_PREFIX ?? "search";
const DAYS = 7;
const DAY_TTL_SECONDS = 8 * 24 * 3600; // 7일을 합칠 때 가장 오래된 날이 남아 있게 하루 더
const SEEN_TTL_SECONDS = 3600; // 같은 IP·같은 검색어는 1시간에 한 번만 센다
const KST_OFFSET_MS = 9 * 3600_000;

export const POPULAR_RULES = {
  minDistinctIps: Number(process.env.SEARCH_POPULAR_MIN_IPS ?? 3), // 서로 다른 IP가 이만큼 찾아야 공개한다
  minLength: 2,
  maxLength: 20,
  allowed: /^[\p{L}\p{N}][\p{L}\p{N} .\-+]*$/u, // 글자·숫자로 시작하고 공백과 . - +만 섞는다(URL, 기호 도배를 막는다)
  candidates: 50, // 거르기 전에 볼 상위 개수
};

export type QueryCount = { query: string; count: number };

export function isPublicQuery(query: string): boolean {
  const length = Array.from(query).length;
  return length >= POPULAR_RULES.minLength && length <= POPULAR_RULES.maxLength && POPULAR_RULES.allowed.test(query);
}

const day = (daysAgo: number, now = Date.now()) =>
  new Date(now + KST_OFFSET_MS - daysAgo * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
const dayKey = (kind: "popular" | "zero", daysAgo: number) => `${PREFIX}:${kind}:${day(daysAgo)}`;
const ipsKey = (query: string, daysAgo: number) => `${PREFIX}:ips:${day(daysAgo)}:${query}`;

@Injectable()
export class SearchStats implements OnModuleDestroy {
  private readonly logger = new Logger(SearchStats.name);
  private readonly redis = new Redis(process.env.REDIS_URL!, { enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 200 });

  constructor() {
    this.redis.on("error", () => {});
  }

  async record(rawQuery: string, ip: string, found: boolean): Promise<void> {
    const query = normalizeQuery(rawQuery);
    if (!query) return;
    if (found && !isPublicQuery(query)) return; // 공개할 수 없는 검색어는 인기 검색어로 세지 않는다
    try {
      const first = await this.redis.set(`${PREFIX}:seen:${ip}:${query}`, "1", "EX", SEEN_TTL_SECONDS, "NX");
      if (first !== "OK") return;
      const key = dayKey(found ? "popular" : "zero", 0);
      const tx = this.redis.multi().zincrby(key, 1, query).expire(key, DAY_TTL_SECONDS);
      if (found) tx.pfadd(ipsKey(query, 0), ip).expire(ipsKey(query, 0), DAY_TTL_SECONDS);
      await tx.exec();
    } catch (err) {
      this.logger.warn(`검색어를 세지 못했다: ${(err as Error).message}`);
    }
  }

  // 공개용: 결과가 있었고, 서로 다른 IP가 minDistinctIps곳 이상이며, 길이·문자 제한을 통과한 검색어
  async popular(limit = 10): Promise<QueryCount[]> {
    const candidates = (await this.counts("popular")).filter((c) => isPublicQuery(c.query)).slice(0, POPULAR_RULES.candidates);
    if (candidates.length === 0) return [];
    try {
      const pipe = this.redis.pipeline();
      for (const c of candidates) pipe.pfcount(...Array.from({ length: DAYS }, (_, i) => ipsKey(c.query, i)));
      const ips = (await pipe.exec()) ?? [];
      return candidates.filter((_, i) => Number(ips[i]?.[1] ?? 0) >= POPULAR_RULES.minDistinctIps).slice(0, limit);
    } catch (err) {
      this.logger.warn(`인기 검색어를 읽지 못했다: ${(err as Error).message}`);
      return [];
    }
  }

  // 관리자용: 결과가 0건인 검색어(거르지 않는다)
  async zeroResults(limit = 10): Promise<QueryCount[]> {
    return (await this.counts("zero")).slice(0, limit);
  }

  // 7일치를 합친 횟수(많은 순). 거르지 않는다
  async counts(kind: "popular" | "zero"): Promise<QueryCount[]> {
    const keys = Array.from({ length: DAYS }, (_, i) => dayKey(kind, i));
    try {
      const flat = await this.redis.zunion(keys.length, ...keys, "WITHSCORES");
      const rows: QueryCount[] = [];
      for (let i = 0; i < flat.length; i += 2) rows.push({ query: flat[i]!, count: Number(flat[i + 1]) });
      return rows.sort((a, b) => b.count - a.count || a.query.localeCompare(b.query));
    } catch (err) {
      this.logger.warn(`검색어 집계를 읽지 못했다: ${(err as Error).message}`);
      return [];
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => {});
  }
}
