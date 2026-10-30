import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { describeError } from "../logger/describe-error.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SEARCH_ENGINE, type SearchEngine } from "../search/search-engine.js";
import { LeaderElection } from "./leader-election.js";

const BATCH = 200;
const LEASE_SECONDS = 60; // 가져간 뒤 이만큼 반영되지 않으면(프로세스가 죽는 등) 다시 가져간다

type Claim = { product_id: number; version: bigint };

// search_dirty(상품·카테고리 트리거가 쓰는 outbox)를 가져가 검색 문서에 반영한다. 잠금을 짧게 두려고 셋으로 나눈다.
//   1. 가져가기: 문장 하나(FOR UPDATE SKIP LOCKED + claimed_at 임대)로 행과 그 version을 읽는다. 잠금은 이 문장 동안만
//   2. 반영: 잠금 없이 엔진에 색인한다. 그동안의 상품 수정·카테고리 변경은 트리거가 version을 바꾸고 임대를 풀 뿐 기다리지 않는다
//   3. 지우기: 가져간 version 그대로인 행만 지운다. 색인하는 동안 들어온 변경은 남아 다음 회차에 반영된다
// 반영이 실패하면 임대를 풀어 행을 남긴다(다음 회차에 다시 한다).
@Injectable()
export class SearchIndexJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SearchIndexJob.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderElection: LeaderElection,
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(process.env.SEARCH_INDEX_INTERVAL_MS ?? 2000);
    this.timer = setInterval(() => void this.run(), interval);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    if (!this.leaderElection.isLeader || this.running) return;
    this.running = true;
    try {
      const done = await this.indexOnce();
      if (done > 0) this.logger.log(`검색 색인: ${done}개 반영`);
    } catch (err) {
      this.logger.warn(`검색 색인 실패(다음 회차에 다시): ${describeError(err)}`);
    } finally {
      this.running = false;
    }
  }

  // 한 회차: 최대 BATCH개를 반영하고 지운 행 수를 돌려준다. 예외는 그대로 던진다(행은 남는다)
  async indexOnce(): Promise<number> {
    const claims = await this.prisma.$queryRaw<Claim[]>`
      UPDATE search_dirty d SET claimed_at = now()
      FROM (
        SELECT product_id FROM search_dirty
        WHERE claimed_at IS NULL OR claimed_at < now() - make_interval(secs => ${LEASE_SECONDS})
        ORDER BY marked_at LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      ) c
      WHERE d.product_id = c.product_id
      RETURNING d.product_id, d.version`;
    if (claims.length === 0) return 0;
    const ids = claims.map((c) => c.product_id);
    const versions = claims.map((c) => c.version.toString());
    try {
      await this.engine.index(ids);
    } catch (err) {
      await this.prisma.$executeRaw`
        UPDATE search_dirty d SET claimed_at = NULL
        FROM unnest(${ids}::int[], ${versions}::bigint[]) AS c(product_id, version)
        WHERE d.product_id = c.product_id AND d.version = c.version`.catch(() => {}); // 못 풀면 임대가 지난 뒤 다시 가져간다
      throw err;
    }
    // 지우는 사이에 트리거가 쥔 행(커밋 전 변경)은 건너뛴다. 그 행은 version이 바뀌어 어차피 남는다
    return this.prisma.$executeRaw`
      DELETE FROM search_dirty d
      USING unnest(${ids}::int[], ${versions}::bigint[]) AS c(product_id, version)
      WHERE d.product_id = c.product_id AND d.version = c.version
        AND d.product_id IN (SELECT product_id FROM search_dirty WHERE product_id = ANY(${ids}::int[]) FOR UPDATE SKIP LOCKED)`;
  }
}
