import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import { Transform } from "class-transformer";

export class CreateAdminUserDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsIn(["user", "admin", "demo_admin"])
  role?: "user" | "admin" | "demo_admin";

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsIn(["user", "admin", "demo_admin"])
  role?: "user" | "admin" | "demo_admin";

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AdminUserQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true ? true : value === "false" || value === false ? false : undefined)
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true ? true : value === "false" || value === false ? false : undefined)
  @IsBoolean()
  guest?: boolean;
}
