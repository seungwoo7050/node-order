import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { PageQueryDto } from "../pagination/page-query.dto.js";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { listMyOrders } from "./my-orders.js";
import { orderDetailSelect } from "./order-select.js";

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
    const order = await this.prisma.asUser(userId, (tx) => tx.order.findFirst({ where: { id, userId }, select: orderDetailSelect }));
    if (!order) throw new NotFoundException(`order ${id} not found`);
    return order;
  }
}
