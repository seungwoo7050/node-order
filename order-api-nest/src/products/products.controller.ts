import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CatalogCache } from "../cache/catalog-cache.js";
import { ProductPageQueryDto } from "../pagination/page-query.dto.js";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { listProducts } from "./product-list.js";

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
}
