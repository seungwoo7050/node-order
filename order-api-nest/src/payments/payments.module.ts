import { Module } from "@nestjs/common";
import { StripeGateway } from "./stripe.gateway.js";

@Module({
  providers: [StripeGateway],
  exports: [StripeGateway],
})
export class PaymentsModule {}
