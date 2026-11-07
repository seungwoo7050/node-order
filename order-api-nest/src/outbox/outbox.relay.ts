import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { NotificationsGateway } from "../notifications/notifications.gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { mailFor } from "../mail/templates.js";
import { MailQueue } from "../queue/mail.queue.js";

export type PendingEvent = { id: number; type: string; user_id: string; payload: Record<string, unknown>; created_at: Date };

export function orderIdOf(e: Pick<PendingEvent, "type" | "payload">): number {
  // order.created는 주문 자체를 싣고(id), 상태 전이·반품 알림은 orderId를 싣는다
  return Number(e.type === "order.created" ? e.payload.id : (e.payload.orderId ?? e.payload.id));
}

// services/pgrelay/pkg/relay/signer.go 의 v1=<hex(hmac-sha256(secret, "<ts>.<payload>"))> 규격 검증
export function verifyPgRelaySignature(
  secret: string,
  sigHeader: string | undefined,
  tsHeader: string | undefined,
  rawBody: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!secret || !sigHeader || !tsHeader) return false;
  const trimmed = sigHeader.trim();
  if (!trimmed.startsWith("v1=")) return false;
  const ts = Number(tsHeader);
  if (!Number.isInteger(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const actualHex = trimmed.slice(3);
  if (actualHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(actualHex)) return false;
  const expectedHex = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return timingSafeEqual(Buffer.from(actualHex, "hex"), Buffer.from(expectedHex, "hex"));
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

  async dispatchLocal(e: PendingEvent): Promise<void> {
    this.notifications.notifyUser(e.user_id, e.type, { eventId: e.id, ...e.payload });
    this.notifications.notifyAdmins(e.type, { eventId: e.id, userId: e.user_id, ...e.payload });
    const orderId = orderIdOf(e);
    await this.mailQueue.enqueueOrderEmail(
      { id: e.id, createdAt: new Date(e.created_at) },
      { to: `${e.user_id}@example.com`, orderId, ...mailFor(e.type, orderId, e.payload) },
    );
  }

  async publishBatch(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const events = await tx.$queryRaw<PendingEvent[]>`
        SELECT id, type, user_id, payload, created_at FROM outbox_events
        WHERE published_at IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`;
      const pgrelayUrl = process.env.PGRELAY_URL;
      const callbackUrl = `${process.env.INTERNAL_API_URL || "http://api:4000"}/internal/outbox-dispatch`;
      for (const e of events) {
        if (pgrelayUrl) {
          const res = await fetch(`${pgrelayUrl}/v1/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: `outbox_${e.id}`,
              topic: e.type,
              endpoint: callbackUrl,
              payload: e,
            }),
          });
          if (!res.ok) throw new Error(`pgrelay enqueue failed: ${res.status}`);
        } else {
          await this.dispatchLocal(e);
        }
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
