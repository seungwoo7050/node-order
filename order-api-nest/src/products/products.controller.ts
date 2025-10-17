import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

@Controller("products")
export class ProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async list() {
    const products = await this.prisma.product.findMany({ orderBy: { id: "asc" } });
    return Promise.all(
      products.map(async ({ imageKey, ...p }) => ({
        ...p,
        imageUrl: imageKey ? await this.storage.createDownloadUrl(imageKey, 600) : null,
      })),
    );
  }
}