import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class CreateUserDto {
  @IsString() @IsNotEmpty() id!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @MinLength(8) password!: string;
}