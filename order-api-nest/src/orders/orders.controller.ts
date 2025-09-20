import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";
import { CreateOrderDto } from "./dto/create-order.dto.js";
import { OrdersService } from "./orders.service.js";
import { CheckoutDto } from "./dto/checkout.dto.js";

@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@Query("paid") paid?: string) {
    return this.ordersService.list(paid === undefined ? undefined : paid === "true");
  }

  @Get("totals")
  totals() {
    return this.ordersService.totals();
  }

  @Post("checkout")
  @UseGuards(AuthGuard("jwt"))
  checkout(@Body() dto: CheckoutDto, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    return this.ordersService.checkout(userId, dto.items);
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.ordersService.findOne(id);
  }

  @Post()
  @UseGuards(AuthGuard("jwt"))
  create(@Body() dto: CreateOrderDto, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    return this.ordersService.create(dto, userId);
  }
}
