import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { FakeMailer } from "../mail/fake-mailer.js";

export type OrderEmailJob = { to: string; orderId: number };

const QUEUE_NAME = "mail";

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
      (job: Job<OrderEmailJob>) => this.mailer.send(job.data.to, `주문 #${job.data.orderId} 확인`, job.attemptsMade + 1),
      { connection: this.workerConnection, concurrency: Number(process.env.MAIL_CONCURRENCY ?? 5) },
    );
    const warn = (err: Error) => this.logger.warn(`Redis 연결 오류: ${err.message}`);
    this.connection.on("error", warn);
    this.workerConnection.on("error", warn);
    this.queue.on("error", warn);
    this.worker.on("error", warn);
    this.worker.on("failed", (job, err) => {
      const final = job && job.attemptsMade >= (job.opts.attempts ?? 1);
      this.logger.warn(`메일 job ${job?.id} 실패(${job?.attemptsMade}회째)${final ? " — 재시도 소진, failed로 이동" : ""}: ${err.message}`);
    });
  }

  async enqueueOrderEmail(eventId: number, data: OrderEmailJob) {
    await this.queue.add("order-email", data, {
      jobId: `order-email-${eventId}`,
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