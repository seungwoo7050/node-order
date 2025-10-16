import { randomUUID } from "node:crypto";
import { BadRequestException, Body, Controller, NotFoundException, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { EXTENSIONS, looksLike } from "./image-signature.js";
import { ConfirmImageDto, UploadUrlDto } from "./product-image.dto.js";

export const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES ?? 2 * 1024 * 1024); // 2MB
const UPLOAD_URL_TTL_SECONDS = Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 60);

@Controller("products/:id/image")
@UseGuards(AuthGuard("jwt"))
export class ProductImagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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
}