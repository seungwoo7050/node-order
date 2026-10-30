import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { PageQueryDto } from "../pagination/page-query.dto.js";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { listMyOrders } from "./my-orders.js";
import { customerOrderView } from "../fulfillment/views.js";

@ApiTags("me")
@ApiBearerAuth()
@Controller("me")
@UseGuards(AuthGuard("jwt"))
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("orders")
  myOrders(@Req() req: Request, @Query(PAGE_QUERY) query: PageQueryDto) {
    const userId = (req.user as { userId: string }).userId;
    return this.prisma.asUser(userId, (tx) => listMyOrders(tx, userId, query));
  }

  @Get("orders/:id")
  async myOrder(@Param("id", ParseIntPipe) id: number, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    // 상태 이력·송장 조회 링크·반품 요청과 구매확정·반품 신청 가능 여부까지 싣는다
    const order = await this.prisma.asUser(userId, (tx) => customerOrderView(tx, userId, id));
    if (!order) throw new NotFoundException(`order ${id} not found`);
    return order;
  }
}
