import { IsInt, IsPositive, ValidateIf } from "class-validator";

export class MoveCategoryDto {
  @ValidateIf((_, v) => v !== null) @IsInt() @IsPositive() parentId!: number | null;
}