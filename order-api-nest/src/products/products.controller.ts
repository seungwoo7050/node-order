import { Controller, Get, Query } from "@nestjs/common";
import { ProductPageQueryDto } from "../pagination/page-query.dto.js";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { listProducts } from "./product-list.js";

@Controller("products")
export class ProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  list(@Query(PAGE_QUERY) query: ProductPageQueryDto) {
    return listProducts(this.prisma, this.storage, query);
  }
}
