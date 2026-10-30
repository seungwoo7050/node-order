import { All, Controller, Logger, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { DashboardService } from "../admin/dashboard.service.js";
import { mcpAuditFailures, mcpToolCalls } from "../metrics/metrics.js";
import { StoreSettingsService } from "../admin/store-settings.service.js";
import { FulfillmentService } from "../fulfillment/fulfillment.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RateLimitStore } from "../rate-limit/rate-limit.middleware.js";
import { ReconciliationService } from "../reconciliation/reconciliation.service.js";
import { SearchStats } from "../search/search-stats.js";
import { AccessTokensService, type McpPrincipal } from "./access-tokens.js";
import { maskArgs, maskText } from "./mask-args.js";
import { McpRateLimiter } from "./mcp-rate-limit.js";
import { registerSellerTools, SELLER_TOOL_NAMES, WRITE_TOOL_NAMES, type McpDeps } from "./mcp-tools.js";

const TOOL_NAMES = new Set<string>(SELLER_TOOL_NAMES);

type ToolCall = { tool: string; args: unknown; auditId?: number };
const WRITE_TOOLS = new Set<string>(WRITE_TOOL_NAMES);
const toolLabel = (tool: string) => (TOOL_NAMES.has(tool) ? tool : "unknown");

// tools/call 요청을 id로 모은다(감사 로그를 응답을 보낼 때 쓴다)
function toolCalls(body: unknown): Map<string | number, ToolCall> {
  const calls = new Map<string | number, ToolCall>();
  for (const msg of [body]) {
    const m = msg as { id?: string | number; method?: string; params?: { name?: unknown; arguments?: unknown } } | null;
    if (m?.method === "tools/call" && m.id !== undefined) calls.set(m.id, { tool: String(m.params?.name ?? ""), args: m.params?.arguments ?? {} });
  }
  return calls;
}

// 응답에서 성공·실패와 오류 문구를 읽는다(isError 결과의 첫 글, 또는 JSON-RPC 오류)
function outcome(msg: JSONRPCMessage): { ok: boolean; error: string | null } {
  if ("error" in msg && msg.error) return { ok: false, error: maskText(msg.error.message) };
  const result = ("result" in msg ? msg.result : undefined) as { isError?: boolean; content?: { type: string; text?: string }[] } | undefined;
  if (!result?.isError) return { ok: true, error: null };
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  let error = text;
  try {
    error = (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    // 글 그대로 남긴다
  }
  return { ok: false, error: maskText(error) };
}

// 판매자용 MCP 서버(Streamable HTTP, POST /mcp). 상태 없는(stateless) 모드: 요청마다 서버와 전송을 새로 만들어
// 토큰의 범위를 그 요청의 도구에 묶는다(세션을 기억하지 않으니 API를 여러 대로 늘려도 그대로 된다).
// 인증은 관리자 화면에서 발급한 개인 접근 토큰(Bearer). 없거나 폐기·만료된 토큰은 401.
// JSON-RPC 배열(batch)은 받지 않는다(400): 2025-06-18 사양에서 빠졌고, 한 요청에 도구 호출을 수십 개 실어 호출 제한을 비켜 갈 수 있다.
// 도구 호출(tools/call)은 토큰마다 분당 MCP_RATE_LIMIT_PER_MINUTE(기본 60)번까지, 넘으면 429(mcp-rate-limit.ts)
@ApiExcludeController()
@Controller("mcp")
export class McpController {
  private readonly logger = new Logger(McpController.name);
  private readonly deps: McpDeps;
  private readonly limiter: McpRateLimiter;

  constructor(
    private readonly tokens: AccessTokensService,
    fulfillment: FulfillmentService,
    dashboard: DashboardService,
    reconciliation: ReconciliationService,
    searchStats: SearchStats,
    settings: StoreSettingsService,
    prisma: PrismaService,
    rateStore: RateLimitStore,
  ) {
    this.deps = { fulfillment, dashboard, reconciliation, searchStats, settings, prisma };
    this.limiter = new McpRateLimiter(rateStore);
  }

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const principal = await this.tokens.authenticate(req.headers.authorization?.replace(/^Bearer\s+/i, ""));
    if (!principal) {
      res.status(401).setHeader("WWW-Authenticate", 'Bearer realm="node-order-mcp"');
      res.json({ jsonrpc: "2.0", error: { code: -32001, message: "유효한 MCP 접근 토큰이 필요합니다(없거나, 폐기됐거나, 만료됐다)" }, id: null });
      return;
    }

    if (Array.isArray(req.body)) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "JSON-RPC 배열(batch) 요청은 받지 않습니다. 메시지를 하나씩 보내 주세요" }, id: null });
      return;
    }
    const calls = toolCalls(req.body);
    const id = (req.body as { id?: string | number } | null)?.id ?? null;
    if (calls.size > 0) {
      const rate = await this.limiter.allow(principal.tokenId);
      if (!rate.ok) {
        // 거절한 호출도 감사 1행(rate_limited)과 호출 지표에 남긴다(누가 한도를 두드리는지 보이게)
        for (const call of calls.values()) {
          mcpToolCalls.inc({ tool: toolLabel(call.tool), result: "rate_limited" });
          await this.tokens.audit({ tokenId: principal.tokenId, tool: call.tool, args: maskArgs(call.args), result: "rate_limited", error: `분당 ${rate.limit}번 초과` })
            .catch((err: Error) => this.auditFailed(call.tool, err));
        }
        res.status(429).setHeader("Retry-After", String(rate.retryAfter));
        res.json({ jsonrpc: "2.0", error: { code: -32029, message: `도구 호출은 토큰마다 1분에 ${rate.limit}번까지입니다. ${rate.retryAfter}초 뒤에 다시 시도하세요` }, id });
        return;
      }
      // 쓰기 도구는 감사 기록(pending)을 먼저 남긴다. 남길 수 없으면 실행하지 않는다(기록 없이 상태·재고·돈이 바뀌지 않게).
      // 실행 뒤 결과로 고친다. 실행 도중 죽으면 pending이 남아 무엇을 하다 멈췄는지 보인다
      for (const call of calls.values()) {
        if (!WRITE_TOOLS.has(call.tool)) continue;
        try {
          call.auditId = await this.tokens.audit({ tokenId: principal.tokenId, tool: call.tool, args: maskArgs(call.args), result: "pending" });
        } catch (err) {
          this.auditFailed(call.tool, err as Error);
          mcpToolCalls.inc({ tool: toolLabel(call.tool), result: "error" });
          res.status(503).json({ jsonrpc: "2.0", error: { code: -32603, message: "감사 기록을 남길 수 없어 도구를 실행하지 않았습니다. 잠시 뒤 다시 시도하세요" }, id });
          return;
        }
      }
    }

    const server = new McpServer({ name: "node-order-seller", version: "1.0.0" }, {
      instructions: "1인 상점 판매자의 주문·배송·반품·재고 도구. 바꾸는 도구(write)는 사람이 확인한 뒤 부른다.",
    });
    registerSellerTools(server, principal, this.deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    this.auditResponses(transport, principal, calls);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error(`MCP 요청 처리 실패: ${(err as Error).message}`);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }

  // 상태 없는 모드라 GET(서버 알림 스트림)·DELETE(세션 종료)는 없다
  @All()
  notAllowed(@Res() res: Response): void {
    res.status(405).setHeader("Allow", "POST");
    res.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  }

  // 모든 도구 호출을 응답을 보내기 직전에 감사 로그에 한 행씩 남긴다. 도구 안이 아니라 여기서 남기는 이유:
  // 인자 검증 실패나 없는 도구 이름처럼 도구 함수까지 오지 않는 호출도 빠뜨리지 않는다
  private auditResponses(transport: StreamableHTTPServerTransport, principal: McpPrincipal, calls: Map<string | number, ToolCall>) {
    if (calls.size === 0) return;
    const send = transport.send.bind(transport);
    transport.send = async (msg, options) => {
      const id = "id" in msg ? msg.id : undefined;
      const call = id !== undefined && id !== null ? calls.get(id) : undefined;
      if (call && ("result" in msg || "error" in msg)) {
        calls.delete(id!);
        const { ok, error } = outcome(msg);
        const result = ok ? "ok" : "error";
        mcpToolCalls.inc({ tool: toolLabel(call.tool), result });
        // 쓰기 도구는 실행 전에 남긴 행을 고치고, 읽기 도구는 지금 남긴다. 읽기 도구의 감사 실패는 결과를 막지 않고 지표·로그로 드러낸다
        const write = call.auditId !== undefined
          ? this.tokens.finishAudit(call.auditId, { result, error })
          : this.tokens.audit({ tokenId: principal.tokenId, tool: call.tool, args: maskArgs(call.args), result, error });
        await write.catch((err: Error) => this.auditFailed(call.tool, err));
      }
      return send(msg, options);
    };
  }

  private auditFailed(tool: string, err: Error) {
    mcpAuditFailures.inc({ tool: toolLabel(tool) });
    this.logger.error(`MCP 감사 로그를 남기지 못했다(${tool}): ${err.message}`);
  }
}
