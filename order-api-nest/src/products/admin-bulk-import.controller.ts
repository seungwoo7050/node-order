import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, Min } from "class-validator";
import { AdminGuard } from "../auth/admin.guard.js";
import { AdminViewGuard } from "../auth/admin-view.guard.js";

// services/ingestguard 의 SchemaSpec 규격에 맞춘 상품 카탈로그 대량 적재 표준 스키마
export const PRODUCT_CATALOG_SCHEMA_SPEC = {
  key_field: "sku",
  fields: {
    sku: { type: "str", required: true, min_length: 1, max_length: 64 },
    name: { type: "str", required: true, min_length: 1, max_length: 200 },
    price: { type: "int", required: true, ge: 0 },
    stock: { type: "int", required: false, ge: 0 },
    description: { type: "str", required: false, max_length: 2000 },
  },
} as const;

export class BulkImportCatalogDto {
  @IsIn(["csv", "jsonl"])
  formatType!: "csv" | "jsonl";

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  chunkSize?: number;
}

export class ReplayQuarantineRowDto {
  @IsObject()
  patchedPayload!: Record<string, unknown>;
}

// services/pulsebox 에 스택트레이스 지문(SHA-256 정규화) 수집 이벤트를 전송하는 헬퍼
export async function reportToPulsebox(
  err: Error,
  service = "order-api-nest",
  environment = process.env.NODE_ENV || "production",
): Promise<boolean> {
  const pulseboxUrl = process.env.PULSEBOX_URL;
  if (!pulseboxUrl) return false;
  try {
    const res = await fetch(`${pulseboxUrl}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service,
        environment,
        exception_type: err.name || "Error",
        message: err.message,
        traceback: err.stack || `${err.name}: ${err.message}`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/products/bulk-import")
export class AdminBulkImportController {
  private get baseUrl(): string {
    return process.env.INGESTGUARD_URL || "http://localhost:8001";
  }

  @Post()
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  @HttpCode(201)
  async ingest(@Body() dto: BulkImportCatalogDto): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/jobs/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset: "products",
          format_type: dto.formatType,
          content: dto.content,
          chunk_size: dto.chunkSize ?? 100,
          schema_spec: PRODUCT_CATALOG_SCHEMA_SPEC,
        }),
      });
      if (!res.ok) {
        throw new BadGatewayException(`ingestguard 적재 실패: ${res.status}`);
      }
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      await reportToPulsebox(err as Error);
      throw new BadGatewayException(`ingestguard 연결 실패: ${(err as Error).message}`);
    }
  }

  @Get(":jobId/quarantine")
  @UseGuards(AuthGuard("jwt"), AdminViewGuard)
  async listQuarantine(@Param("jobId") jobId: string): Promise<Record<string, unknown>[]> {
    const res = await fetch(`${this.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/quarantine`);
    if (!res.ok) {
      throw new BadGatewayException(`ingestguard 격리 행 조회 실패: ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>[];
  }

  @Post("quarantine/:quarantineId/replay")
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  @HttpCode(200)
  async replay(
    @Param("quarantineId") quarantineId: string,
    @Body() dto: ReplayQuarantineRowDto,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/v1/quarantine/${encodeURIComponent(quarantineId)}/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patched_payload: dto.patchedPayload,
        schema_spec: PRODUCT_CATALOG_SCHEMA_SPEC,
      }),
    });
    if (!res.ok) {
      throw new BadGatewayException(`ingestguard 격리 행 재반영 실패: ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}
