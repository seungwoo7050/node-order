import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { AdminGuard } from "../auth/admin.guard.js";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { CatalogCache } from "../cache/catalog-cache.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { categoryPaths } from "./product-list.js";

export class CreateVariantDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsInt()
  priceDelta?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  categoryId?: number | null;

  @IsOptional()
  @IsString()
  materialInfo?: string;

  @IsOptional()
  @IsString()
  sizeGuide?: string;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants?: CreateVariantDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageKeys?: string[];
}

export class UpdateVariantItemDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsInt()
  priceDelta?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateAdminProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  categoryId?: number | null;

  @IsOptional()
  @IsString()
  materialInfo?: string;

  @IsOptional()
  @IsString()
  sizeGuide?: string;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateVariantItemDto)
  variants?: UpdateVariantItemDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageKeys?: string[];
}

@ApiTags("admin-products")
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard("jwt"))
export class AdminProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CatalogCache,
  ) {}

  @Get("admin/products")
  @UseGuards(AdminViewGuard)
  async listAdminProducts(@Query("categoryId") categoryId?: string) {
    const catId = categoryId ? Number(categoryId) : undefined;
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(catId ? { categoryId: catId } : {}),
      },
      select: {
        id: true,
        name: true,
        price: true,
        stock: true,
        description: true,
        imageKey: true,
        isVisible: true,
        deletedAt: true,
        materialInfo: true,
        sizeGuide: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
        variants: {
          select: { id: true, name: true, sku: true, priceDelta: true, stock: true, sortOrder: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
        images: {
          select: { id: true, imageKey: true, sortOrder: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
      orderBy: { id: "asc" },
    });

    const pathOf = await categoryPaths(this.prisma, [...new Set(products.flatMap((p) => (p.categoryId ? [p.categoryId] : [])))]);

    return Promise.all(
      products.map(async (p) => {
        const categories = (p.categoryId && pathOf.get(p.categoryId)) || [];
        const imagesWithUrl = await Promise.all(
          p.images.map(async (img) => ({
            ...img,
            imageUrl: await this.storage.createDownloadUrl(img.imageKey, 600),
          })),
        );

        return {
          ...p,
          categories,
          categoryPath: categories.map((c) => c.name),
          imageUrl: p.imageKey ? await this.storage.createDownloadUrl(p.imageKey, 600) : (imagesWithUrl[0]?.imageUrl ?? null),
          images: imagesWithUrl,
        };
      }),
    );
  }

  @Get("admin/products/:id")
  @UseGuards(AdminViewGuard)
  async getAdminProductDetail(@Param("id", ParseIntPipe) id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        price: true,
        stock: true,
        description: true,
        imageKey: true,
        isVisible: true,
        deletedAt: true,
        materialInfo: true,
        sizeGuide: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
        variants: {
          select: { id: true, name: true, sku: true, priceDelta: true, stock: true, sortOrder: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
        images: {
          select: { id: true, imageKey: true, sortOrder: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!product || product.deletedAt !== null) {
      throw new NotFoundException(`product ${id} not found`);
    }

    const pathOf = await categoryPaths(this.prisma, product.categoryId ? [product.categoryId] : []);
    const categories = (product.categoryId && pathOf.get(product.categoryId)) || [];
    const imagesWithUrl = await Promise.all(
      product.images.map(async (img) => ({
        ...img,
        imageUrl: await this.storage.createDownloadUrl(img.imageKey, 600),
      })),
    );

    return {
      ...product,
      categories,
      categoryPath: categories.map((c) => c.name),
      imageUrl: product.imageKey ? await this.storage.createDownloadUrl(product.imageKey, 600) : (imagesWithUrl[0]?.imageUrl ?? null),
      images: imagesWithUrl,
    };
  }

  @Post(["admin/products", "products"])
  @UseGuards(AdminGuard)
  async createProduct(@Body() dto: CreateProductDto) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException("상품 이름을 입력해 주세요.");
    }
    if (dto.price === undefined || dto.price < 0) {
      throw new BadRequestException("가격은 0원 이상이어야 합니다.");
    }

    const variants = dto.variants ?? [];
    const computedStock = variants.length > 0
      ? variants.reduce((sum, v) => sum + (v.stock ?? 0), 0)
      : (dto.stock ?? 0);

    const imageKeys = dto.imageKeys ?? [];
    const primaryImage = imageKeys[0] ?? null;

    const created = await this.prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          name: dto.name.trim(),
          price: dto.price,
          stock: computedStock,
          description: dto.description?.trim() ?? "",
          categoryId: dto.categoryId ?? null,
          materialInfo: dto.materialInfo?.trim() ?? "",
          sizeGuide: dto.sizeGuide?.trim() ?? "",
          isVisible: dto.isVisible ?? true,
          imageKey: primaryImage,
          variants: {
            create: variants.map((v, i) => ({
              name: v.name.trim(),
              sku: v.sku?.trim() ?? "",
              priceDelta: v.priceDelta ?? 0,
              stock: v.stock ?? 0,
              sortOrder: v.sortOrder ?? i,
            })),
          },
          images: {
            create: imageKeys.map((key, i) => ({
              imageKey: key,
              sortOrder: i,
            })),
          },
        },
        include: {
          variants: true,
          images: true,
          category: true,
        },
      });
      return p;
    });

    await this.cache.invalidate();
    return created;
  }

  @Patch(["admin/products/:id", "admin/products/:id/full"])
  @Put("admin/products/:id")
  @UseGuards(AdminGuard)
  async updateAdminProduct(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateAdminProductDto) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: { variants: true, images: true },
    });
    if (!existing || existing.deletedAt !== null) {
      throw new NotFoundException(`product ${id} not found`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      let nextStock = dto.stock ?? existing.stock;

      // Handle variants update if provided
      if (dto.variants !== undefined) {
        const incoming = dto.variants;
        const incomingIds = incoming.filter((v) => v.id).map((v) => v.id!);

        // Delete variants not in incoming list
        await tx.productVariant.deleteMany({
          where: { productId: id, id: { notIn: incomingIds } },
        });

        // Upsert variants
        for (let i = 0; i < incoming.length; i++) {
          const v = incoming[i]!;
          if (v.id) {
            await tx.productVariant.update({
              where: { id: v.id },
              data: {
                name: v.name.trim(),
                sku: v.sku?.trim() ?? "",
                priceDelta: v.priceDelta ?? 0,
                stock: v.stock ?? 0,
                sortOrder: v.sortOrder ?? i,
              },
            });
          } else {
            await tx.productVariant.create({
              data: {
                productId: id,
                name: v.name.trim(),
                sku: v.sku?.trim() ?? "",
                priceDelta: v.priceDelta ?? 0,
                stock: v.stock ?? 0,
                sortOrder: v.sortOrder ?? i,
              },
            });
          }
        }

        if (incoming.length > 0) {
          nextStock = incoming.reduce((sum, v) => sum + (v.stock ?? 0), 0);
        }
      }

      // Handle images update if provided
      if (dto.imageKeys !== undefined) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        await tx.productImage.createMany({
          data: dto.imageKeys.map((key, i) => ({
            productId: id,
            imageKey: key,
            sortOrder: i,
          })),
        });
      }

      const primaryImageKey = dto.imageKeys !== undefined
        ? (dto.imageKeys[0] ?? null)
        : existing.imageKey;

      const p = await tx.product.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.price !== undefined ? { price: dto.price } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.materialInfo !== undefined ? { materialInfo: dto.materialInfo.trim() } : {}),
          ...(dto.sizeGuide !== undefined ? { sizeGuide: dto.sizeGuide.trim() } : {}),
          ...(dto.isVisible !== undefined ? { isVisible: dto.isVisible } : {}),
          ...(primaryImageKey !== undefined ? { imageKey: primaryImageKey } : {}),
          stock: nextStock,
        },
        include: {
          variants: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
          images: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
          category: true,
        },
      });

      return p;
    });

    await this.cache.invalidate();
    return updated;
  }

  @Delete(["admin/products/:id", "products/:id"])
  @UseGuards(AdminGuard)
  async deleteProduct(@Param("id", ParseIntPipe) id: number, @Query("mode") mode?: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`product ${id} not found`);

    const orderCount = await this.prisma.orderItem.count({ where: { productId: id } });
    const returnCount = await this.prisma.returnItem.count({ where: { productId: id } });
    const hasOrderHistory = orderCount > 0 || returnCount > 0;

    if (hasOrderHistory || mode === "soft") {
      // Soft-delete: hide product and zero out stock to prevent future orders
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.productVariant.updateMany({ where: { productId: id }, data: { stock: 0 } });
        return tx.product.update({
          where: { id },
          data: {
            isVisible: false,
            deletedAt: new Date(),
            stock: 0,
          },
        });
      });
      await this.cache.invalidate();
      return { id, action: "soft_deleted", isVisible: false, deletedAt: updated.deletedAt };
    }

    // Hard-delete: No order history
    await this.prisma.$transaction(async (tx) => {
      await tx.searchDirty.deleteMany({ where: { productId: id } });
      await tx.productSearch.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });

    await this.cache.invalidate();
    return { id, action: "deleted" };
  }

  @Post(["admin/products/upload-url", "products/upload-url"])
  @UseGuards(AdminGuard)
  async getUploadUrl(@Body() body: { filename: string; mimeType: string; size?: number }) {
    if (!body.mimeType || !body.mimeType.startsWith("image/")) {
      throw new BadRequestException("이미지 파일만 올릴 수 있습니다.");
    }
    const ext = body.filename.includes(".") ? body.filename.split(".").pop() : "png";
    const key = `catalog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const size = body.size ?? 2 * 1024 * 1024;
    const uploadUrl = await this.storage.createUploadUrl(key, body.mimeType, size, 300);
    return { key, uploadUrl };
  }
}
