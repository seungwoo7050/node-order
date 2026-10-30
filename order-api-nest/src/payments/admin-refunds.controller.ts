import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminGuard } from "../auth/admin.guard.js";
import { RefundDto } from "./payments.dto.js";
import { RefundsService } from "./refunds.service.js";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/orders/:id/refunds")
@UseGuards(AuthGuard("jwt"), AdminGuard)
export class AdminRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  // 201 환불됨 · 200 같은 키의 재요청 · 202 PG 결과를 아직 모름(requested, payments:resolve-refunds가 확정)
  @Post()
  async create(
    @Param("id", ParseIntPipe) orderId: number,
    @Body() dto: RefundDto,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const { httpStatus, refund } = await this.refunds.request(orderId, dto, idempotencyKey);
    res.status(httpStatus);
    return refund;
  }

  @Get()
  list(@Param("id", ParseIntPipe) orderId: number) {
    return this.refunds.list(orderId);
  }
}
