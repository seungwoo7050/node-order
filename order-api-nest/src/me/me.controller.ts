import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";

const orderSelect = { id: true, price: true, paid: true, createdAt: true } as const;

@Controller("me")
@UseGuards(AuthGuard("jwt"))
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("orders")
  myOrders(@Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    return this.prisma.order.findMany({ where: { userId }, select: orderSelect, orderBy: { id: "asc" } });
  }
}
