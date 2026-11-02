import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, ValidateIf } from "class-validator";

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @IsPositive()
  parentId?: number | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class MoveCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt()
  @IsPositive()
  parentId?: number | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCategoryDto extends MoveCategoryDto {}
