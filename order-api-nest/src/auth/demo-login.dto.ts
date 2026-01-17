import { IsIn } from "class-validator";

export class DemoLoginDto {
  @IsIn(["user", "admin"]) as!: "user" | "admin";
}
