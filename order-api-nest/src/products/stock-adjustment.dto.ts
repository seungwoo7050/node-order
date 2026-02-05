import { IsInt, Max, Min, NotEquals } from "class-validator";

export class StockAdjustmentDto {
  @IsInt() @NotEquals(0) @Min(-100000) @Max(100000) delta!: number;
}
