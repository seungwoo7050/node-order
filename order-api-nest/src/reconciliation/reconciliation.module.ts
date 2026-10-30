import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module.js";
import { ReconciliationController } from "./reconciliation.controller.js";
import { ReconciliationService } from "./reconciliation.service.js";

@Module({
  imports: [PaymentsModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
