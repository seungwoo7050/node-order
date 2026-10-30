import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import type { Request } from "express";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { AccessTokensService, MAX_EXPIRES_DAYS, SCOPES, type Scope } from "./access-tokens.js";

class IssueTokenDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value)) @IsString() @Matches(/\S/, { message: "토큰 이름을 입력해 주세요" }) @MaxLength(50) name!: string;
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(SCOPES, { each: true }) scopes!: Scope[];
  @IsInt() @Min(1) @Max(MAX_EXPIRES_DAYS) expiresInDays!: number;
}

class AuditQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) tokenId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

const userOf = (req: Request) => req.user as { userId: string; role: string };

// MCP 개인 접근 토큰 발급·폐기와 감사 로그(관리자 화면). 데모 관리자도 발급할 수 있지만 read 범위만 갖는다
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/mcp")
@UseGuards(AuthGuard("jwt"), AdminViewGuard)
export class AccessTokensController {
  constructor(private readonly tokens: AccessTokensService) {}

  // 응답의 token(원문)은 이때 한 번만 보인다
  @Post("tokens")
  issue(@Req() req: Request, @Body(PAGE_QUERY) dto: IssueTokenDto) {
    return this.tokens.issue(userOf(req), dto);
  }

  @Get("tokens")
  list(@Req() req: Request) {
    return this.tokens.list(userOf(req).userId);
  }

  @Delete("tokens/:id")
  revoke(@Req() req: Request, @Param("id", ParseIntPipe) id: number) {
    return this.tokens.revoke(userOf(req).userId, id);
  }

  @Get("audit")
  audit(@Req() req: Request, @Query(PAGE_QUERY) query: AuditQueryDto) {
    return this.tokens.auditLog(userOf(req), query);
  }
}
