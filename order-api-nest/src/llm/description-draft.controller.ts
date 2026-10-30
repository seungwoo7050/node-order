import {
  Body, CanActivate, Controller, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, Optional, Param, ParseIntPipe, Post, Req, Res, UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";
import type { Request, Response } from "express";
import { AdminGuard } from "../auth/admin.guard.js";
import { CategoriesService } from "../categories/categories.service.js";
import { llmRequests, llmTokens } from "../metrics/metrics.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RateLimitStore } from "../rate-limit/rate-limit.middleware.js";
import { draftPrompt } from "./description-draft.js";
import { LLM_PROVIDER, type LlmProvider } from "./llm-provider.js";

class DescriptionDraftDto {
  @IsOptional() @IsString() @MaxLength(200) keywords?: string;
}

const LIMIT_PER_MINUTE = () => Number(process.env.LLM_RATE_LIMIT_PER_MINUTE ?? 5) || 5;

// LLM 키가 없으면(공급자가 꺼져 있으면) 인증보다 먼저 404: 기능 자체가 없는 것처럼 보인다
@Injectable()
class LlmEnabledGuard implements CanActivate {
  constructor(@Optional() @Inject(LLM_PROVIDER) private readonly provider: LlmProvider | null) {}
  canActivate(): boolean {
    if (!this.provider?.enabled) throw new NotFoundException("Cannot POST description-draft");
    return true;
  }
}

const sse = (res: Response, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

// 상품 설명 초안(SSE). 저장하지 않는다: 화면이 받은 글을 편집 칸에 흘려 넣고, 판매자가 직접 저장을 누를 때만 저장된다.
//   event: delta  {text}       글 조각(차례로)
//   event: done   {usage}      끝(입력·출력 토큰 수)
//   event: error  {message}    중간 오류. 그때까지 보낸 글은 화면에 남는다
// 손님이 연결을 끊으면 AbortSignal로 공급자 호출을 끊는다. 관리자당 분당 호출 수를 제한한다(LLM_RATE_LIMIT_PER_MINUTE, 기본 5)
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/products/:id/description-draft")
@UseGuards(LlmEnabledGuard, AuthGuard("jwt"), AdminGuard)
export class DescriptionDraftController {
  private readonly logger = new Logger(DescriptionDraftController.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly rate: RateLimitStore,
  ) {}

  @Post()
  async draft(@Param("id", ParseIntPipe) id: number, @Body() dto: DescriptionDraftDto, @Req() req: Request, @Res() res: Response): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { name: true, price: true, description: true, categoryId: true } });
    if (!product) throw new NotFoundException(`product ${id} not found`);
    await this.checkRate((req.user as { userId: string }).userId);
    const categoryPath = product.categoryId ? (await this.categories.path(product.categoryId)).map((c) => c.name) : [];
    const input = draftPrompt({ name: product.name, categoryPath, price: product.price, description: product.description, keywords: dto.keywords ?? "" });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx가 모았다가 한 번에 보내지 않게
    res.flushHeaders();

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    const labels = { provider: this.provider.name, model: this.provider.model };
    try {
      for await (const chunk of this.provider.streamText(input, abort.signal)) {
        if (abort.signal.aborted) break;
        if (chunk.type === "text") {
          sse(res, "delta", { text: chunk.text });
        } else {
          llmTokens.inc({ ...labels, direction: "input" }, chunk.inputTokens);
          llmTokens.inc({ ...labels, direction: "output" }, chunk.outputTokens);
          sse(res, "done", { usage: { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens } });
        }
      }
      llmRequests.inc({ feature: "description_draft", result: abort.signal.aborted ? "aborted" : "ok" });
    } catch (err) {
      if (abort.signal.aborted) {
        llmRequests.inc({ feature: "description_draft", result: "aborted" });
      } else {
        llmRequests.inc({ feature: "description_draft", result: "error" });
        this.logger.warn(`설명 초안 생성 실패(상품 #${id}): ${(err as Error).message}`);
        sse(res, "error", { message: "초안을 만드는 중에 멈췄습니다. 받은 글은 남겨 두었습니다. 잠시 뒤에 다시 시도해 주세요." });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  private async checkRate(userId: string): Promise<void> {
    const limit = LIMIT_PER_MINUTE();
    const window = Math.floor(Date.now() / 60_000);
    let count: number;
    try {
      count = await this.rate.hit(`rate:llm:${userId}:${window}`, 60);
    } catch (err) {
      this.logger.warn(`LLM 호출 수를 세지 못해 통과시킨다: ${(err as Error).message}`);
      return;
    }
    if (count > limit) {
      llmRequests.inc({ feature: "description_draft", result: "rate_limited" });
      throw new HttpException({ statusCode: 429, message: `설명 초안은 1분에 ${limit}번까지 만들 수 있습니다. 잠시 뒤에 다시 시도해 주세요` }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
