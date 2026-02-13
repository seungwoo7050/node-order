import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class UpdateProductDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsInt() @Min(0) price?: number;
}
