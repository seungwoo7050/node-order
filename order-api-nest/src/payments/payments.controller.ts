import { BadRequestException, Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import type Stripe from "stripe";
import { PaymentsService } from "./payments.service.js";
import { StripeGateway } from "./stripe.gateway.js";

@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly stripe: StripeGateway,
    private readonly payments: PaymentsService,
  ) {}

  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature?: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.constructWebhookEvent(req.rawBody!, signature);
    } catch (err) {
      throw new BadRequestException(`웹훅 서명 검증 실패: ${(err as Error).message}`);
    }
    return { received: true, result: await this.payments.handle(event) };
  }
}