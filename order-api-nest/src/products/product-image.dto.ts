import { IsIn, IsInt, IsPositive, IsString, Matches } from "class-validator";
import { ALLOWED_IMAGE_TYPES } from "./image-signature.js";

export class UploadUrlDto {
  @IsIn(ALLOWED_IMAGE_TYPES) contentType!: string;
  @IsInt() @IsPositive() size!: number;
}

export class ConfirmImageDto {
  @IsString() @Matches(/^products\/\d+\/[0-9a-f-]{36}\.(png|jpg|webp)$/) key!: string;
}