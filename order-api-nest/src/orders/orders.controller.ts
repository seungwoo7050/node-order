import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards, Headers } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";
import { CreateOrderDto } from "./dto/create-order.dto.js";
import { OrdersService } from "./orders.service.js";
import { CheckoutDto } from "./dto/checkout.dto.js";
import { AdminGuard } from "../auth/admin.guard.js";

@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  list(@Query("paid") paid?: string) {
    return this.ordersService.list(paid === undefined ? undefined : paid === "true");
  }

  @Get("totals")
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  totals() {
    return this.ordersService.totals();
  }

  @Post("checkout")
  @UseGuards(AuthGuard("jwt"))
  checkout(@Body() dto: CheckoutDto, @Req() req: Request, @Headers("idempotency-key") idempotencyKey?: string) {
    const userId = (req.user as { userId: string }).userId;
    return this.ordersService.checkout(userId, dto.items, idempotencyKey);
  }

  @Get(":id")
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.ordersService.findOne(id);
  }

  @Post()
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  create(@Body() dto: CreateOrderDto, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    return this.ordersService.create(dto, userId);
  }
}
