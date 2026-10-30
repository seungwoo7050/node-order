import { HttpException, Logger } from "@nestjs/common";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DashboardService } from "../admin/dashboard.service.js";
import { StoreSettingsService } from "../admin/store-settings.service.js";
import { maskPersonalData } from "../auth/demo-admin-mask.interceptor.js";
import { CARRIER_CODES, type CarrierCode } from "../fulfillment/carriers.js";
import { FulfillmentService } from "../fulfillment/fulfillment.service.js";
import { ORDER_STATUSES } from "../fulfillment/order-state.js";
import { TransitionConflict } from "../fulfillment/transitions.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { adjustStock } from "../products/stock.js";
import { ISSUE_KINDS, type IssueKind } from "../reconciliation/compare.js";
import { ReconciliationService } from "../reconciliation/reconciliation.service.js";
import { SearchStats } from "../search/search-stats.js";
import type { McpPrincipal, Scope } from "./access-tokens.js";
import { withUntrusted } from "./untrusted.js";

// 판매자용 MCP 도구. 도구는 HTTP로 자기 API를 다시 부르지 않고 REST 컨트롤러가 쓰는 서비스를 그대로 부른다
// (28 상태 기계·27 환불은 FulfillmentService, 29 대시보드·대사, 26 검색 통계).
// 읽기 도구는 readOnlyHint, 돈이나 재고를 움직이는 도구는 destructiveHint. 범위는 도구마다 read 또는 write
export type McpDeps = {
  fulfillment: FulfillmentService;
  dashboard: DashboardService;
  reconciliation: ReconciliationService;
  searchStats: SearchStats;
  settings: StoreSettingsService;
  prisma: PrismaService;
};

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

const logger = new Logger("McpTools");

const json = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

// 서비스가 던진 예외를 도구 결과로 바꾼다. 상태 전이가 거부되면 지금 상태를 같이 싣는다(모델이 다음 행동을 고를 수 있게)
export function toolError(err: unknown): CallToolResult {
  if (err instanceof TransitionConflict) return json({ error: err.message, currentStatus: err.currentStatus }, true);
  if (err instanceof HttpException) {
    const body = err.getResponse() as string | { message?: string | string[] };
    const message = typeof body === "string" ? body : Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? err.message);
    return json({ error: message, status: err.getStatus() }, true);
  }
  logger.error(`도구 실행 실패: ${(err as Error).message}`);
  return json({ error: "서버 내부 오류로 처리하지 못했습니다" }, true);
}

export function registerSellerTools(server: McpServer, principal: McpPrincipal, deps: McpDeps): void {
  const pii = principal.scopes.includes("pii");
  // 손님 연락처·주소: pii 범위가 있을 때만 원문, 없으면 29의 마스킹 규칙(칸 이름으로 가린다)
  const view = (value: unknown) => (pii ? value : maskPersonalData(value));

  function tool<Shape extends z.ZodRawShape>(
    name: string,
    config: { title: string; description: string; inputSchema: Shape; annotations: ToolAnnotations },
    scope: Scope,
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
  ) {
    const handler = async (args: z.infer<z.ZodObject<Shape>>): Promise<CallToolResult> => {
      if (!principal.scopes.includes(scope)) {
        return json({ error: `이 토큰에는 ${scope} 범위가 없어 ${name}을(를) 부를 수 없습니다`, requiredScope: scope }, true);
      }
      try {
        // 성공 결과: { untrustedFields(손님·외부가 쓴 칸의 경로), notice, data }
        return json(withUntrusted(view(await run(args))));
      } catch (err) {
        return toolError(err);
      }
    };
    // registerTool의 콜백 타입이 zod 모양마다 달라 여기서 한 번만 맞춘다
    server.registerTool(name, config, handler as never);
  }

  const orderId = z.number().int().positive().describe("주문 번호");
  const returnId = z.number().int().positive().describe("반품·교환 요청 번호(get_order 결과의 returns[].id)");
  const actor = principal.userId;

  tool("list_pending_work", {
    title: "오늘 처리할 일",
    description: "관리자 대시보드 타일: 오늘 결제·순매출, 처리 대기(결제 완료, 배송 준비 중, 반품 요청) 수, 재고 부족 상품, 0건 검색어, 미해결 PG 대사 건수",
    inputSchema: {},
    annotations: READ,
  }, "read", () => deps.dashboard.get());

  tool("search_orders", {
    title: "주문 찾기",
    description: "주문 목록(최신순). 상태로 거르거나 처리하지 않은 반품 요청이 있는 주문만 볼 수 있다. 다음 쪽은 nextCursor를 cursor로 넘긴다",
    inputSchema: {
      status: z.enum(ORDER_STATUSES).optional().describe("주문 상태(paid=결제 완료, preparing=배송 준비 중, shipped=배송 중 …)"),
      returnsRequested: z.boolean().optional().describe("true면 처리하지 않은 반품·교환 요청이 있는 주문만"),
      limit: z.number().int().min(1).max(50).default(20),
      cursor: z.string().max(200).optional(),
    },
    annotations: READ,
  }, "read", (a) => deps.fulfillment.list({ limit: a.limit, cursor: a.cursor, status: a.status, returns: a.returnsRequested ? "requested" : undefined }));

  tool("get_order", {
    title: "주문 상세",
    description: "주문 하나의 상세: 상태와 이력, 상품, 배송지, 송장, 반품 요청, 지금 할 수 있는 동작(actions). 관리자 주문 상세 화면과 같은 내용",
    inputSchema: { orderId },
    annotations: READ,
  }, "read", (a) => deps.fulfillment.adminDetail(a.orderId));

  tool("register_shipment", {
    title: "송장 입력",
    description: `배송 준비 중(preparing)인 주문에 송장을 붙이고 배송 중(shipped)으로 바꾼다. 다른 상태면 오류와 지금 상태를 돌려준다. 택배사: ${CARRIER_CODES.join(", ")}`,
    inputSchema: {
      orderId,
      carrier: z.enum(CARRIER_CODES as [CarrierCode, ...CarrierCode[]]).describe("택배사 코드"),
      trackingNumber: z.string().min(1).max(30).describe("송장번호(숫자 8~20자리, 하이픈은 빼도 된다)"),
    },
    annotations: WRITE,
  }, "write", (a) => deps.fulfillment.ship(a.orderId, actor, { carrier: a.carrier, trackingNumber: a.trackingNumber }));

  tool("mark_delivered", {
    title: "배송 완료 처리",
    description: "배송 중(shipped)인 주문을 배송 완료로 앞당긴다(손님에게 알림이 간다). 다른 상태면 오류와 지금 상태를 돌려준다",
    inputSchema: { orderId },
    annotations: WRITE,
  }, "write", (a) => deps.fulfillment.deliver(a.orderId, actor));

  tool("approve_return", {
    title: "반품 승인",
    description: "반품·교환 요청을 승인한다. 반품 수량은 재고로 돌아가고, 환불 요청이면 PG로 환불한다(교환이면 교환품 재고를 뺀다)",
    inputSchema: { returnId },
    annotations: DESTRUCTIVE,
  }, "write", (a) => deps.fulfillment.approveReturn(a.returnId, actor));

  tool("reject_return", {
    title: "반품 거절",
    description: "반품·교환 요청을 거절한다. 사유는 손님에게 그대로 보인다",
    inputSchema: { returnId, reason: z.string().trim().min(1).max(200).describe("거절 사유(손님에게 보인다)") },
    annotations: WRITE,
  }, "write", (a) => deps.fulfillment.rejectReturn(a.returnId, actor, a.reason));

  tool("list_low_stock", {
    title: "재고 부족 상품",
    description: "재고가 기준 이하인 상품(적은 순). 기준을 주지 않으면 상점 설정의 재고 부족 기준",
    inputSchema: {
      threshold: z.number().int().min(0).max(100000).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: READ,
  }, "read", async (a) => {
    const threshold = a.threshold ?? (await deps.settings.get()).lowStockThreshold;
    const items = await deps.prisma.product.findMany({
      where: { stock: { lte: threshold } }, select: { id: true, name: true, stock: true, price: true },
      orderBy: [{ stock: "asc" }, { id: "asc" }], take: a.limit,
    });
    return { threshold, items };
  });

  tool("adjust_stock", {
    title: "재고 조정",
    description: "상품 재고를 delta만큼 더하거나 뺀다(입고는 양수, 파손·분실은 음수). 0 아래로는 내려가지 않는다",
    inputSchema: {
      productId: z.number().int().positive(),
      delta: z.number().int().min(-100000).max(100000).refine((d) => d !== 0, "0이 아닌 수"),
    },
    annotations: DESTRUCTIVE,
  }, "write", (a) => adjustStock(deps.prisma, a.productId, a.delta));

  tool("list_zero_result_searches", {
    title: "결과 없는 검색어",
    description: "최근 7일 동안 손님이 찾았는데 결과가 0건이었던 검색어(많은 순). 상품명·설명에 넣을 말을 고를 때 쓴다",
    inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
    annotations: READ,
  }, "read", async (a) => ({ items: await deps.searchStats.zeroResults(a.limit) }));

  tool("list_reconciliation_issues", {
    title: "PG 대사 불일치",
    description: "우리 결제 기록과 PG 기록이 어긋난 건(금액·상태 불일치, 한쪽에만 있음, 환불 불일치). 기본은 해결하지 않은 것만",
    inputSchema: {
      kind: z.enum(ISSUE_KINDS as [IssueKind, ...IssueKind[]]).optional(),
      state: z.enum(["open", "resolved", "all"]).default("open"),
      limit: z.number().int().min(1).max(200).default(50),
    },
    annotations: READ,
  }, "read", (a) => deps.reconciliation.issues(a));
}

export const SELLER_TOOL_NAMES = [
  "list_pending_work", "search_orders", "get_order", "register_shipment", "mark_delivered", "approve_return",
  "reject_return", "list_low_stock", "adjust_stock", "list_zero_result_searches", "list_reconciliation_issues",
] as const;

// 상태·재고·돈을 바꾸는 도구(write 범위). 감사 기록을 실행 전에 남긴다(mcp.controller.ts). e2e가 annotations와 맞는지 본다
export const WRITE_TOOL_NAMES = ["register_shipment", "mark_delivered", "approve_return", "reject_return", "adjust_stock"] as const;
