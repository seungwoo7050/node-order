import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module.js";
import { AdminFulfillmentController, MyFulfillmentController } from "./fulfillment.controller.js";
import { FulfillmentService } from "./fulfillment.service.js";

@Module({
  imports: [PaymentsModule],
  controllers: [AdminFulfillmentController, MyFulfillmentController],
  providers: [FulfillmentService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
