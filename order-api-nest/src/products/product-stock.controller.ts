import { Body, ConflictException, Controller, HttpCode, NotFoundException, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AdminGuard } from "../auth/admin.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StockAdjustmentDto } from "./stock-adjustment.dto.js";

@Controller("products/:id")
@UseGuards(AuthGuard("jwt"), AdminGuard)
export class ProductStockController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("stock-adjustments")
  @HttpCode(200)
  async adjust(@Param("id", ParseIntPipe) id: number, @Body() dto: StockAdjustmentDto) {
    const rows = await this.prisma.$queryRaw<{ id: number; stock: number }[]>`
      UPDATE products SET stock = stock + ${dto.delta}
      WHERE id = ${id} AND stock + ${dto.delta} >= 0
      RETURNING id, stock`;
    if (rows[0]) return rows[0];
    const product = await this.prisma.product.findUnique({ where: { id }, select: { stock: true } });
    if (!product) throw new NotFoundException(`product ${id} not found`);
    throw new ConflictException(`재고가 ${product.stock}개라 ${-dto.delta}개를 뺄 수 없습니다`);
  }
}
