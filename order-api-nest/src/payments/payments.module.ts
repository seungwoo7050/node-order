import { Module } from "@nestjs/common";
import { AdminRefundsController } from "./admin-refunds.controller.js";
import { FeaturesController } from "./features.controller.js";
import { PaymentGateways } from "./payment-gateways.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { RefundsService } from "./refunds.service.js";
import { StripeGateway } from "./stripe.gateway.js";
import { TossGateway } from "./toss.gateway.js";
import { TossPaymentsService } from "./toss-payments.service.js";

@Module({
  controllers: [PaymentsController, AdminRefundsController, FeaturesController],
  providers: [StripeGateway, TossGateway, PaymentGateways, PaymentsService, TossPaymentsService, RefundsService],
  exports: [StripeGateway, TossGateway, PaymentGateways, RefundsService],
})
export class PaymentsModule {}
