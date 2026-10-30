import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { SEARCH_ENGINE, type SearchEngine } from "../search/search-engine.js";
import { LeaderElection } from "./leader-election.js";

const BATCH = 200;

// search_dirty(상품·카테고리 트리거가 쓰는 outbox)를 가져가 검색 문서에 반영한다.
// 행을 FOR UPDATE SKIP LOCKED로 잡은 채 색인하고, 성공하면 지운다. 실패하면 트랜잭션이 되돌아가 행이 남고 다음 회차에 다시 한다.
// 색인 중에 같은 상품이 또 바뀌면 그 트리거는 이 행의 잠금을 기다렸다가(ON CONFLICT DO UPDATE) 지워진 뒤 다시 넣는다.
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
      this.logger.warn(`검색 색인 실패(다음 회차에 다시): ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // 한 회차: 최대 BATCH개를 반영하고 그 수를 돌려준다. 예외는 그대로 던진다(행은 남는다)
  async indexOnce(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ product_id: number }[]>`
          SELECT product_id FROM search_dirty ORDER BY marked_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return 0;
        const ids = rows.map((r) => r.product_id);
        await this.engine.index(ids);
        await tx.$executeRaw`DELETE FROM search_dirty WHERE product_id = ANY(${ids}::int[])`;
        return ids.length;
      },
      { timeout: 30_000 },
    );
  }
}
