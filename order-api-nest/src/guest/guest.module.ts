import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { GuestOrdersController } from "./guest-orders.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [GuestOrdersController],
})
export class GuestModule {}
