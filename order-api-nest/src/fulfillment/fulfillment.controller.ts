import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AdminGuard } from "../auth/admin.guard.js";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { AdminFulfillmentQueryDto, CancelOrderDto, RejectReturnDto, ReturnRequestDto, ShipmentDto } from "./fulfillment.dto.js";
import { FulfillmentService } from "./fulfillment.service.js";

const userIdOf = (req: Request) => (req.user as { userId: string }).userId;

// 관리자 주문 이행. 읽기는 데모 관리자도 되고(AdminViewGuard), 바꾸는 동작은 진짜 관리자만(AdminGuard)
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(AuthGuard("jwt"))
export class AdminFulfillmentController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  @Get("orders")
  @UseGuards(AdminViewGuard)
  list(@Query(PAGE_QUERY) query: AdminFulfillmentQueryDto) {
    return this.fulfillment.list(query);
  }

  @Get("orders/:id")
  @UseGuards(AdminViewGuard)
  detail(@Param("id", ParseIntPipe) id: number) {
    return this.fulfillment.adminDetail(id);
  }

  @Post("orders/:id/prepare")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  prepare(@Param("id", ParseIntPipe) id: number, @Req() req: Request) {
    return this.fulfillment.prepare(id, userIdOf(req));
  }

  @Post("orders/:id/shipment")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  ship(@Param("id", ParseIntPipe) id: number, @Body() dto: ShipmentDto, @Req() req: Request) {
    return this.fulfillment.ship(id, userIdOf(req), dto);
  }

  @Post("orders/:id/deliver")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  deliver(@Param("id", ParseIntPipe) id: number, @Req() req: Request) {
    return this.fulfillment.deliver(id, userIdOf(req));
  }

  @Post("orders/:id/cancel")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  cancel(@Param("id", ParseIntPipe) id: number, @Body() dto: CancelOrderDto, @Req() req: Request) {
    return this.fulfillment.cancel(id, userIdOf(req), dto.reason?.trim() || undefined);
  }

  @Post("returns/:id/approve")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  approve(@Param("id", ParseIntPipe) id: number, @Req() req: Request) {
    return this.fulfillment.approveReturn(id, userIdOf(req));
  }

  @Post("returns/:id/reject")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  reject(@Param("id", ParseIntPipe) id: number, @Body() dto: RejectReturnDto, @Req() req: Request) {
    return this.fulfillment.rejectReturn(id, userIdOf(req), dto.reason.trim());
  }

  @Post("returns/:id/shipment")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  shipExchange(@Param("id", ParseIntPipe) id: number, @Body() dto: ShipmentDto, @Req() req: Request) {
    return this.fulfillment.shipExchange(id, userIdOf(req), dto);
  }
}

// 손님: 구매확정, 반품·교환 신청(주문 상세는 GET /me/orders/:id, tRPC me.order)
@ApiTags("me")
@ApiBearerAuth()
@Controller("me/orders")
@UseGuards(AuthGuard("jwt"))
export class MyFulfillmentController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  @Post(":id/confirm")
  @HttpCode(200)
  confirm(@Param("id", ParseIntPipe) id: number, @Req() req: Request) {
    return this.fulfillment.confirm(userIdOf(req), id);
  }

  @Post(":id/returns")
  requestReturn(@Param("id", ParseIntPipe) id: number, @Body() dto: ReturnRequestDto, @Req() req: Request) {
    return this.fulfillment.requestReturn(userIdOf(req), id, dto);
  }
}
