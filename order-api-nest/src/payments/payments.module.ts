import { Module } from "@nestjs/common";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { StripeGateway } from "./stripe.gateway.js";

@Module({
  controllers: [PaymentsController],
  providers: [StripeGateway, PaymentsService],
  exports: [StripeGateway],
})
export class PaymentsModule {}
