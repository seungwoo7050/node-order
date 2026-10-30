import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StockAdjustmentDto } from "./stock-adjustment.dto.js";
import { adjustStock } from "./stock.js";

@ApiTags("products")
@ApiBearerAuth()
@Controller("products/:id")
@UseGuards(AuthGuard("jwt"), AdminGuard)
export class ProductStockController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("stock-adjustments")
  @HttpCode(200)
  adjust(@Param("id", ParseIntPipe) id: number, @Body() dto: StockAdjustmentDto) {
    return adjustStock(this.prisma, id, dto.delta);
  }
}
