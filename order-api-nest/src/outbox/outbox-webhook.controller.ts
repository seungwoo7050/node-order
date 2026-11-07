import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { OutboxRelay, verifyPgRelaySignature, type PendingEvent } from "./outbox.relay.js";

// services/pgrelay 사이드카 데몬이 FOR UPDATE SKIP LOCKED 선점 및 Full Jitter 백오프를 거쳐
// X-PGRelay-Signature(HMAC-SHA256)와 함께 호출하는 내부 아웃박스 수신 엔드포인트
@ApiExcludeController()
@Controller("internal/outbox-dispatch")
export class OutboxWebhookController {
  constructor(private readonly relay: OutboxRelay) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Headers("x-pgrelay-signature") signature: string | undefined,
    @Headers("x-pgrelay-timestamp") timestamp: string | undefined,
    @Body() body: PendingEvent,
  ): Promise<{ ok: true; id: number }> {
    const secret = process.env.PGRELAY_WEBHOOK_SECRET || "pgrelay-default-secret";
    const rawBody = JSON.stringify(body);
    if (!verifyPgRelaySignature(secret, signature, timestamp, rawBody)) {
      throw new UnauthorizedException("유효하지 않은 pgrelay 서명입니다");
    }
    await this.relay.dispatchLocal({
      ...body,
      created_at: body.created_at ? new Date(body.created_at) : new Date(),
    });
    return { ok: true, id: body.id };
  }
}
