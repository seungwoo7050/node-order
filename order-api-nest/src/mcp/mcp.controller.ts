import { All, Controller, Logger, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { DashboardService } from "../admin/dashboard.service.js";
import { StoreSettingsService } from "../admin/store-settings.service.js";
import { FulfillmentService } from "../fulfillment/fulfillment.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ReconciliationService } from "../reconciliation/reconciliation.service.js";
import { SearchStats } from "../search/search-stats.js";
import { AccessTokensService, type McpPrincipal } from "./access-tokens.js";
import { maskArgs, maskText } from "./mask-args.js";
import { registerSellerTools, type McpDeps } from "./mcp-tools.js";

type ToolCall = { tool: string; args: unknown };

// tools/call 요청을 id로 모은다(감사 로그를 응답을 보낼 때 쓴다)
function toolCalls(body: unknown): Map<string | number, ToolCall> {
  const calls = new Map<string | number, ToolCall>();
  for (const msg of Array.isArray(body) ? body : [body]) {
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
// 인증은 관리자 화면에서 발급한 개인 접근 토큰(Bearer). 없거나 폐기·만료된 토큰은 401
@ApiExcludeController()
@Controller("mcp")
export class McpController {
  private readonly logger = new Logger(McpController.name);
  private readonly deps: McpDeps;

  constructor(
    private readonly tokens: AccessTokensService,
    fulfillment: FulfillmentService,
    dashboard: DashboardService,
    reconciliation: ReconciliationService,
    searchStats: SearchStats,
    settings: StoreSettingsService,
    prisma: PrismaService,
  ) {
    this.deps = { fulfillment, dashboard, reconciliation, searchStats, settings, prisma };
  }

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const principal = await this.tokens.authenticate(req.headers.authorization?.replace(/^Bearer\s+/i, ""));
    if (!principal) {
      res.status(401).setHeader("WWW-Authenticate", 'Bearer realm="node-order-mcp"');
      res.json({ jsonrpc: "2.0", error: { code: -32001, message: "유효한 MCP 접근 토큰이 필요합니다(없거나, 폐기됐거나, 만료됐다)" }, id: null });
      return;
    }

    const server = new McpServer({ name: "node-order-seller", version: "1.0.0" }, {
      instructions: "1인 상점 판매자의 주문·배송·반품·재고 도구. 바꾸는 도구(write)는 사람이 확인한 뒤 부른다.",
    });
    registerSellerTools(server, principal, this.deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    this.auditResponses(transport, principal, toolCalls(req.body));
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
        await this.tokens.audit({ tokenId: principal.tokenId, tool: call.tool, args: maskArgs(call.args), ok, error })
          .catch((err: Error) => this.logger.error(`MCP 감사 로그를 남기지 못했다: ${err.message}`));
      }
      return send(msg, options);
    };
  }
}
