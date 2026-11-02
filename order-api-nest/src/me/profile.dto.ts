import { IsOptional, IsString, Length } from "class-validator";

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 50, { message: "이름은 1~50자 사이여야 합니다" })
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  address1?: string;

  @IsOptional()
  @IsString()
  address2?: string;

  @IsOptional()
  @IsString()
  deliveryMemo?: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @Length(8, 100, { message: "새 비밀번호는 8자 이상이어야 합니다" })
  newPassword!: string;
}
