import { IsBoolean, IsNotEmpty, IsNumber, IsPositive, IsString } from 'class-validator';

export class CreateOrderDto {
  @IsString() @IsNotEmpty() user!: string;
  @IsNumber() @IsPositive() price!: number;
  @IsBoolean() paid!: boolean;
}
