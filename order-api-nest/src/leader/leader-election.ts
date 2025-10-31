import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import pg from "pg";

const LEADER_LOCK_KEY = 726_001;

@Injectable()
export class LeaderElection implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LeaderElection.name);
  private client?: pg.Client;
  private timer?: NodeJS.Timeout;
  private leader = false;

  get isLeader() {
    return this.leader;
  }

  onApplicationBootstrap() {
    void this.tryBecomeLeader();
    this.timer = setInterval(() => void this.tryBecomeLeader(), 2000);
  }

  private async tryBecomeLeader() {
    if (this.leader) return;
    try {
      if (!this.client) {
        this.client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        this.client.on("error", () => this.stepDown("DB 연결 오류"));
        this.client.on("end", () => this.stepDown("DB 연결 종료"));
        await this.client.connect();
      }
      const { rows } = await this.client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LEADER_LOCK_KEY]);
      if (rows[0].ok) {
        this.leader = true;
        this.logger.log(`리더가 됐다(pid ${process.pid}, PORT ${process.env.PORT})`);
      }
    } catch (err) {
      this.stepDown(`리더 시도 실패: ${(err as Error).message}`);
    }
  }

  private stepDown(reason: string) {
    if (this.leader) this.logger.warn(`리더 자격 상실 - ${reason}`);
    this.leader = false;
    this.client = undefined;
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    const client = this.client;
    this.client = undefined;
    this.leader = false;
    await client?.end();
    if (client) this.logger.log("리더 연결 종료(잠금 해제)");
  }
}