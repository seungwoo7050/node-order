import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CouponsService } from "./coupons.service.js";
import { ValidateCouponDto } from "./dto/coupon.dto.js";

@ApiTags("coupons")
@Controller("coupons")
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Post("validate")
  @HttpCode(200)
  validatePost(@Body() dto: ValidateCouponDto) {
    return this.couponsService.validateCoupon(dto.code, dto.subtotal);
  }

  @Get("validate")
  validateGet(@Query("code") code: string, @Query("subtotal") subtotal?: string) {
    return this.couponsService.validateCoupon(code || "", Number(subtotal) || 0);
  }
}
