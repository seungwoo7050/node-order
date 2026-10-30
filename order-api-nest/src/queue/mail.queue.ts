import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { FakeMailer } from "../mail/fake-mailer.js";
import { mailJobsCompleted, mailJobsFailed } from "../metrics/metrics.js";

// template·subject는 relay가 이벤트 종류로 정한다(src/mail/templates.ts). 28 전에 쌓인 job에는 없다
export type OrderEmailJob = { to: string; orderId: number; template?: string; subject?: string };

// 테스트는 다른 이름(test/setup-env.ts)을 써서 개발 API의 워커가 테스트 메일을 가져가지 않게 한다
const QUEUE_NAME = process.env.MAIL_QUEUE_NAME ?? "mail";

@Injectable()
export class MailQueue implements OnModuleDestroy {
  private readonly logger = new Logger(MailQueue.name);
  private readonly connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  private readonly workerConnection = this.connection.duplicate();
  private readonly queue = new Queue<OrderEmailJob>(QUEUE_NAME, { connection: this.connection });
  private readonly worker: Worker<OrderEmailJob>;
  constructor(private readonly mailer: FakeMailer) {
    this.worker = new Worker<OrderEmailJob>(
      QUEUE_NAME,
      (job: Job<OrderEmailJob>) => this.mailer.send(
        { to: job.data.to, orderId: job.data.orderId, template: job.data.template ?? "generic", subject: job.data.subject ?? `주문 #${job.data.orderId} 확인` },
        job.attemptsMade + 1,
      ),
      { connection: this.workerConnection, concurrency: Number(process.env.MAIL_CONCURRENCY ?? 5) },
    );
    const warn = (err: Error) => this.logger.warn(`Redis 연결 오류: ${err.message}`);
    this.connection.on("error", warn);
    this.workerConnection.on("error", warn);
    this.queue.on("error", warn);
    this.worker.on("error", warn);
    this.worker.on("completed", () => mailJobsCompleted.inc());
    this.worker.on("failed", (job, err) => {
      const final = job && job.attemptsMade >= (job.opts.attempts ?? 1);
      if (final) mailJobsFailed.inc();
      this.logger.warn(`메일 job ${job?.id} 실패(${job?.attemptsMade}회째)${final ? " - 재시도 소진, failed로 이동" : ""}: ${err.message}`);
    });
  }

  // jobId가 이벤트마다 하나라 relay가 같은 이벤트를 다시 넣어도 메일은 한 통이다.
  // 이벤트 시각을 붙인다: 테스트가 DB를 비우면 이벤트 id가 1부터 다시 시작해, 남아 있던 완료 job과 겹치지 않게
  async enqueueOrderEmail(event: { id: number; createdAt: Date }, data: OrderEmailJob) {
    await this.queue.add("order-email", data, {
      jobId: `order-email-${event.id}-${event.createdAt.getTime()}`,
      attempts: 4, 
      backoff: { type: "exponential", delay: 500 }, 
    });
  }

  async onModuleDestroy() {
    await this.worker.close();
    this.logger.log("메일 워커 종료");
    await this.queue.close();
    await Promise.all([this.connection.quit(), this.workerConnection.quit()]);
  }
}