import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./cursor.js";

export class PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LIMIT) limit: number = DEFAULT_LIMIT;
  @IsOptional() @IsString() cursor?: string;
}

export class ProductPageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LIMIT) limit: number = DEFAULT_LIMIT;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) cursor?: number;
}

export class AdminOrderQueryDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value)) @IsBoolean() paid?: boolean;
}
