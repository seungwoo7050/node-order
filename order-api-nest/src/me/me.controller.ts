import { Controller, Get, NotFoundException, Param, ParseIntPipe, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { orderSelect } from "./order-select.js";

@Controller("me")
@UseGuards(AuthGuard("jwt"))
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("orders")
  myOrders(@Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    return this.prisma.asUser(userId, (tx) => tx.order.findMany({ where: { userId }, select: orderSelect, orderBy: { id: "asc" } }));
  }

  @Get("orders/:id")
  async myOrder(@Param("id", ParseIntPipe) id: number, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    const order = await this.prisma.asUser(userId, (tx) => tx.order.findFirst({ where: { id, userId }, select: orderSelect }));
    if (!order) throw new NotFoundException(`order ${id} not found`);
    return order;
  }
}
