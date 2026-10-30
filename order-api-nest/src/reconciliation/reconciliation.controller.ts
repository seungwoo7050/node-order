import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { AdminGuard } from "../auth/admin.guard.js";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { PAGE_QUERY } from "../pagination/page-query.pipe.js";
import { ISSUE_KINDS, type IssueKind } from "./compare.js";
import { ReconciliationService } from "./reconciliation.service.js";

class IssueQueryDto {
  @IsOptional() @IsIn(ISSUE_KINDS) kind?: IssueKind;
  @IsOptional() @IsIn(["open", "resolved", "all"]) state?: "open" | "resolved" | "all";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

// 해결 표시에는 메모가 있어야 한다(무엇을 확인했는지 남긴다). 다시 열 때는 메모가 없어도 된다
class ResolveIssueDto {
  @IsBoolean() resolved!: boolean;
  @IsOptional() @Transform(({ value }) => (typeof value === "string" ? value.trim() : value)) @IsString() @MaxLength(500) note?: string;
}

// 관리자 대사 화면. 읽기는 데모 관리자도 되고, 해결 표시는 진짜 관리자만
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/reconciliation")
@UseGuards(AuthGuard("jwt"))
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get("issues")
  @UseGuards(AdminViewGuard)
  issues(@Query(PAGE_QUERY) query: IssueQueryDto) {
    return this.reconciliation.issues(query);
  }

  @Get("runs")
  @UseGuards(AdminViewGuard)
  runs() {
    return this.reconciliation.runs();
  }

  @Patch("issues/:id")
  @UseGuards(AdminGuard)
  resolve(@Param("id", ParseIntPipe) id: number, @Body(PAGE_QUERY) dto: ResolveIssueDto) {
    if (dto.resolved && !dto.note) throw new BadRequestException("해결 표시에는 메모가 필요합니다(무엇을 확인했는지)");
    return this.reconciliation.resolve(id, dto);
  }
}
