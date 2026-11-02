import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { NotificationsGateway } from "../notifications/notifications.gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mailFor } from "../mail/templates.js";
import { MailQueue } from "../queue/mail.queue.js";

type PendingEvent = { id: number; type: string; user_id: string; payload: Record<string, unknown>; created_at: Date };

export function orderIdOf(e: Pick<PendingEvent, "type" | "payload">): number {
  // order.created는 주문 자체를 싣고(id), 상태 전이·반품 알림은 orderId를 싣는다
  return Number(e.type === "order.created" ? e.payload.id : (e.payload.orderId ?? e.payload.id));
}

@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
    private readonly mailQueue: MailQueue,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), 500);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.publishBatch();
      if (sent > 0) this.logger.log(`outbox 이벤트 ${sent}건 발행`);
    } catch (err) {
      this.logger.error("outbox 발행 실패 - 다음 회차에 다시 시도합니다", err as Error);
    } finally {
      this.running = false;
    }
  }

  async publishBatch(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const events = await tx.$queryRaw<PendingEvent[]>`
        SELECT id, type, user_id, payload, created_at FROM outbox_events
        WHERE published_at IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`;
      for (const e of events) {
        this.notifications.notifyUser(e.user_id, e.type, { eventId: e.id, ...e.payload });
        this.notifications.notifyAdmins(e.type, { eventId: e.id, userId: e.user_id, ...e.payload });
        const orderId = orderIdOf(e);
        await this.mailQueue.enqueueOrderEmail({ id: e.id, createdAt: e.created_at }, { to: `${e.user_id}@example.com`, orderId, ...mailFor(e.type, orderId, e.payload) });
      }
      if (events.length > 0) {
        await tx.outboxEvent.updateMany({
          where: { id: { in: events.map((e) => e.id) } }, data: { publishedAt: new Date() },
        });
      }
      return events.length;
    });
  }
}