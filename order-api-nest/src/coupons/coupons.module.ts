import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { CouponsController } from "./coupons.controller.js";
import { AdminCouponsController } from "./admin-coupons.controller.js";
import { CouponsService } from "./coupons.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [CouponsController, AdminCouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
