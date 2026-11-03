import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard.js";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { CouponsService } from "./coupons.service.js";
import { CreateCouponDto, UpdateCouponDto } from "./dto/coupon.dto.js";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/coupons")
@UseGuards(AuthGuard("jwt"))
export class AdminCouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  @UseGuards(AdminViewGuard)
  list() {
    return this.couponsService.list();
  }

  @Get(":id")
  @UseGuards(AdminViewGuard)
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.couponsService.findOne(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateCouponDto) {
    return this.couponsService.create(dto);
  }

  @Patch(":id")
  @UseGuards(AdminGuard)
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateCouponDto) {
    return this.couponsService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  delete(@Param("id", ParseIntPipe) id: number) {
    return this.couponsService.delete(id);
  }
}
