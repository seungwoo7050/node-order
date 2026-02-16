import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard.js";
import { CatalogCache } from "../cache/catalog-cache.js";
import { ProductPageQueryDto } from "../pagination/page-query.dto.js";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { getProduct, listProducts } from "./product-list.js";
import { UpdateProductDto } from "./update-product.dto.js";

@ApiTags("products")
@Controller("products")
export class ProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CatalogCache,
  ) {}

  @Get()
  list(@Query(PAGE_QUERY) query: ProductPageQueryDto) {
    return listProducts({ prisma: this.prisma, storage: this.storage, cache: this.cache }, query);
  }

  @Get(":id")
  async detail(@Param("id", ParseIntPipe) id: number) {
    const product = await getProduct({ prisma: this.prisma, storage: this.storage, cache: this.cache }, id);
    if (!product) throw new NotFoundException(`product ${id} not found`);
    return product;
  }

  @Patch(":id")
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  async update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    const { count } = await this.prisma.product.updateMany({ where: { id }, data: dto });
    if (count === 0) throw new NotFoundException(`product ${id} not found`);
    await this.cache.invalidate();
    return this.prisma.product.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, price: true } });
  }
}
