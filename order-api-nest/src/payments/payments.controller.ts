import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards, type RawBodyRequest } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import type Stripe from "stripe";
import { PaymentsService } from "./payments.service.js";
import { StripeGateway } from "./stripe.gateway.js";
import { TossPaymentsService } from "./toss-payments.service.js";
import { TossConfirmDto } from "./payments.dto.js";

const userIdOf = (req: Request) => (req.user as { userId: string }).userId;

@ApiTags("payments")
@Controller("payments")
export class PaymentsController {
  constructor(
    private readonly stripe: StripeGateway,
    private readonly payments: PaymentsService,
    private readonly toss: TossPaymentsService,
  ) {}

  // Stripe 웹훅: 서명을 검증한 본문을 믿는다
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

  @Get("toss/checkout/:orderId")
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"))
  tossCheckout(@Param("orderId", ParseIntPipe) orderId: number, @Req() req: Request) {
    return this.toss.checkoutInfo(userIdOf(req), orderId);
  }

  @Post("toss/confirm")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"))
  tossConfirm(@Body() dto: TossConfirmDto, @Req() req: Request) {
    return this.toss.confirm(userIdOf(req), dto);
  }

  // 토스 결제 상태 웹훅: 본문을 믿지 않고 PG에 다시 묻는다. 본문이 무엇이든 200
  @Post("toss/webhook")
  @HttpCode(200)
  async tossWebhook(@Body() body: unknown) {
    return { received: true, result: await this.toss.webhook(body) };
  }
}
