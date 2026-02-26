import { randomUUID } from "node:crypto";
import { BadRequestException, Body, Controller, NotFoundException, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { EXTENSIONS, looksLike } from "./image-signature.js";
import { ConfirmImageDto, UploadUrlDto } from "./product-image.dto.js";
import { AdminGuard } from "../auth/admin.guard.js";
import { CatalogCache } from "../cache/catalog-cache.js";

export const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES ?? 2 * 1024 * 1024); // 2MB
const UPLOAD_URL_TTL_SECONDS = Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 60);

@ApiTags("products")
@ApiBearerAuth()
@Controller("products/:id/image")
@UseGuards(AuthGuard("jwt"), AdminGuard)
export class ProductImagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CatalogCache,
  ) {}

  @Post("upload-url")
  async createUploadUrl(@Param("id", ParseIntPipe) id: number, @Body() dto: UploadUrlDto) {
    if (dto.size > MAX_IMAGE_BYTES) throw new BadRequestException(`이미지는 ${MAX_IMAGE_BYTES}바이트 이하여야 합니다`);
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`product ${id} not found`);
    const key = `products/${id}/${randomUUID()}.${EXTENSIONS[dto.contentType]}`;
    const uploadUrl = await this.storage.createUploadUrl(key, dto.contentType, dto.size, UPLOAD_URL_TTL_SECONDS);
    return { key, uploadUrl, expiresIn: UPLOAD_URL_TTL_SECONDS };
  }

  @Post("confirm")
  async confirm(@Param("id", ParseIntPipe) id: number, @Body() dto: ConfirmImageDto) {
    if (!dto.key.startsWith(`products/${id}/`)) throw new BadRequestException("이 상품의 키가 아니다");
    const meta = await this.storage.head(dto.key);
    if (!meta) throw new BadRequestException("업로드된 파일이 없다");
    if (meta.size > MAX_IMAGE_BYTES) throw new BadRequestException("파일이 너무 크다");
    if (!looksLike(meta.contentType, await this.storage.readFirstBytes(dto.key, 12))) {
      await this.storage.delete(dto.key);
      throw new BadRequestException("이미지 파일이 아니다");
    }
    const before = await this.prisma.product.findUnique({ where: { id }, select: { imageKey: true } });
    await this.prisma.product.update({ where: { id }, data: { imageKey: dto.key } });
    await this.cache.invalidate();
    if (before?.imageKey && before.imageKey !== dto.key) await this.storage.delete(before.imageKey);
    return { key: dto.key, imageUrl: await this.storage.createDownloadUrl(dto.key, 600) };
  }
}