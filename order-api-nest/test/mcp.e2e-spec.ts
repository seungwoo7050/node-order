import type { INestApplication } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SELLER_TOOL_NAMES } from "../src/mcp/mcp-tools.js";
import { adminDb } from "./admin-db.js";
import { SHIPPING, client, demoAdminToken, seedPaymentData, startPaymentApp } from "./payment-app.js";

// 판매자용 MCP 서버(/mcp): SDK의 Client + Streamable HTTP 전송으로 붙는다(Claude Code 같은 MCP 클라이언트와 같은 경로)
describe("MCP /mcp", () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokens: { user: string; admin: string };
  const open: Client[] = [];

  beforeAll(async () => {
    ({ app, baseUrl } = await startPaymentApp());
  });

  beforeEach(async () => {
    tokens = await seedPaymentData(baseUrl);
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close()));
  });

  afterAll(async () => {
    await app.close();
  });

  const admin = () => client(baseUrl, tokens.admin);
  const issue = async (scopes: string[], jwt = tokens.admin) => {
    const res = await client(baseUrl, jwt).post("/admin/mcp/tokens", { name: `t-${scopes.join("-")}`, scopes, expiresInDays: 30 });
    expect(res.status).toBe(201);
    return res.body as { id: number; token: string; scopes: string[]; prefix: string };
  };
  const connect = async (token: string) => {
    const c = new Client({ name: "e2e", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    open.push(c);
    return c;
  };
  const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
    const result = (await c.callTool({ name, arguments: args })) as CallToolResult;
    const text = result.content.find((b) => b.type === "text")?.text ?? "";
    return { isError: result.isError === true, text, body: JSON.parse(text) as Record<string, any> };
  };
  const rawPost = (token?: string) => fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

  // 배송지가 있는 주문(결제는 붙이지 않는다: 송장·배송 완료·반품 거절은 PG를 부르지 않는다)
  const order = async (status: "paid" | "preparing" | "shipped" | "delivered") => {
    const o = await adminDb.order.create({
      data: { userId: "kim", totalAmount: 10_000, shippingFee: 3_000, paid: true, status, ...SHIPPING, items: { create: [{ productId: 1, quantity: 1, unitPrice: 7_000 }] } },
    });
    return o.id;
  };
  const historyCount = (orderId: number) => adminDb.orderStatusHistory.count({ where: { orderId } });

  it("도구 목록과 annotations: 읽기 도구는 readOnlyHint, 돈·재고를 움직이는 도구는 destructiveHint", async () => {
    const c = await connect((await issue(["read"])).token);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...SELLER_TOOL_NAMES].sort());
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const name of ["list_pending_work", "search_orders", "get_order", "list_low_stock", "list_zero_result_searches", "list_reconciliation_issues"]) {
      expect(byName[name]!.annotations?.readOnlyHint, name).toBe(true);
    }
    for (const name of ["approve_return", "adjust_stock"]) {
      expect(byName[name]!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
    for (const name of ["register_shipment", "mark_delivered", "reject_return"]) {
      expect(byName[name]!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    }
    // 입력 스키마는 zod에서 나온 JSON Schema
    expect(byName.register_shipment!.inputSchema).toMatchObject({ type: "object", required: expect.arrayContaining(["orderId", "carrier", "trackingNumber"]) });
  });

  it("read 토큰으로 write 도구를 부르면 거부되고 아무것도 바뀌지 않는다", async () => {
    const id = await order("preparing");
    const c = await connect((await issue(["read"])).token);
    const r = await call(c, "register_shipment", { orderId: id, carrier: "cj", trackingNumber: "123456789012" });
    expect(r.isError).toBe(true);
    expect(r.body).toMatchObject({ requiredScope: "write" });
    expect((await adminDb.order.findUniqueOrThrow({ where: { id } })).status).toBe("preparing");
    expect(await adminDb.shipment.count()).toBe(0);
    const adjust = await call(c, "adjust_stock", { productId: 1, delta: 5 });
    expect(adjust.isError).toBe(true);
    expect((await adminDb.product.findUniqueOrThrow({ where: { id: 1 } })).stock).toBe(10);
  });

  it("토큰이 없거나, 폐기됐거나, 만료됐으면 401", async () => {
    expect((await rawPost()).status).toBe(401);
    expect((await rawPost("nop_not-a-real-token")).status).toBe(401);

    const revoked = await issue(["read"]);
    expect((await rawPost(revoked.token)).status).toBe(200);
    expect((await admin().delete(`/admin/mcp/tokens/${revoked.id}`)).status).toBe(200);
    const res = await rawPost(revoked.token);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
    await expect(connect(revoked.token)).rejects.toThrow();

    const expired = await issue(["read"]);
    await adminDb.accessToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await rawPost(expired.token)).status).toBe(401);

    // 일반 손님은 토큰을 발급할 수 없다
    expect((await client(baseUrl, tokens.user).post("/admin/mcp/tokens", { name: "x", scopes: ["read"], expiresInDays: 1 })).status).toBe(403);
  });

  it("원문은 발급할 때만 보이고 DB에는 해시만 있다. 데모 관리자가 발급한 토큰은 read 범위만 갖는다", async () => {
    const issued = await issue(["read", "write", "pii"]);
    expect(issued.token).toMatch(/^nop_/);
    const row = await adminDb.accessToken.findUniqueOrThrow({ where: { id: issued.id } });
    expect(row.tokenHash).not.toContain(issued.token);
    expect(JSON.stringify(row)).not.toContain(issued.token);
    const list = await admin().get("/admin/mcp/tokens");
    expect(JSON.stringify(list.body)).not.toContain(issued.token);

    const demo = await issue(["read", "write", "pii"], await demoAdminToken(baseUrl));
    expect(demo.scopes).toEqual(["read"]);
    const c = await connect(demo.token);
    const id = await order("preparing");
    expect((await call(c, "register_shipment", { orderId: id, carrier: "cj", trackingNumber: "123456789012" })).isError).toBe(true);
    expect((await call(c, "get_order", { orderId: id })).text).not.toContain(SHIPPING.recipientPhone);
  });

  it("register_shipment는 28의 상태 기계를 그대로 탄다: 허용된 상태에서만 송장이 붙고, 아니면 isError와 지금 상태(history는 그대로)", async () => {
    const c = await connect((await issue(["read", "write"])).token);

    const preparing = await order("preparing");
    const ok = await call(c, "register_shipment", { orderId: preparing, carrier: "cj", trackingNumber: "1234-5678-9012" });
    expect(ok.isError).toBe(false);
    expect(ok.body.status).toBe("shipped");
    expect(ok.body.shipments).toMatchObject([{ carrier: "cj", carrierName: "CJ대한통운", trackingNumber: "123456789012" }]);
    expect(await historyCount(preparing)).toBe(1);
    expect(await adminDb.outboxEvent.count({ where: { type: "order.shipped" } })).toBe(1);

    // 같은 주문에 다시: 이미 배송 중
    const again = await call(c, "register_shipment", { orderId: preparing, carrier: "cj", trackingNumber: "999999999999" });
    expect(again.isError).toBe(true);
    expect(again.body).toMatchObject({ currentStatus: "shipped" });
    expect(await historyCount(preparing)).toBe(1);
    expect(await adminDb.shipment.count({ where: { orderId: preparing } })).toBe(1);

    // 배송 준비 전(결제 완료)
    const paid = await order("paid");
    const early = await call(c, "register_shipment", { orderId: paid, carrier: "cj", trackingNumber: "123456789012" });
    expect(early).toMatchObject({ isError: true, body: { currentStatus: "paid" } });
    expect(await historyCount(paid)).toBe(0);

    // 송장번호 형식 오류는 400을 isError로
    const bad = await call(c, "register_shipment", { orderId: await order("preparing"), carrier: "cj", trackingNumber: "12" });
    expect(bad).toMatchObject({ isError: true, body: { status: 400 } });

    // 배송 완료도 같은 전이 표: shipped → delivered, 다시 부르면 isError
    expect((await call(c, "mark_delivered", { orderId: preparing })).body.status).toBe("delivered");
    expect(await call(c, "mark_delivered", { orderId: preparing })).toMatchObject({ isError: true, body: { currentStatus: "delivered" } });
  });

  it("같은 주문을 REST로 본 결과와 MCP(get_order, pii 범위)로 본 결과가 같다", async () => {
    const id = await order("preparing");
    const c = await connect((await issue(["read", "write", "pii"])).token);
    await call(c, "register_shipment", { orderId: id, carrier: "hanjin", trackingNumber: "123456789012" });
    const rest = await admin().get(`/admin/orders/${id}`);
    expect(rest.status).toBe(200);
    const mcp = await call(c, "get_order", { orderId: id });
    expect(mcp.body).toEqual(rest.body);
    expect(mcp.body.shipping.recipientPhone).toBe(SHIPPING.recipientPhone);
  });

  it("pii 범위가 없으면 get_order·search_orders 결과에 연락처·주소 원문이 없다", async () => {
    const id = await order("paid");
    const c = await connect((await issue(["read", "write"])).token);
    const detail = await call(c, "get_order", { orderId: id });
    for (const raw of [SHIPPING.recipientPhone, SHIPPING.address1, SHIPPING.address2, SHIPPING.recipientName, SHIPPING.deliveryMemo]) {
      expect(detail.text).not.toContain(raw);
    }
    expect(detail.body.shipping).toMatchObject({ recipientName: "김*매", recipientPhone: "010-****-6789", address1: "서울특별시 강남구 ***" });
    const list = await call(c, "search_orders", { status: "paid" });
    expect(list.body.items).toHaveLength(1);
    expect(list.text).not.toContain(SHIPPING.recipientName);
  });

  it("모든 도구 호출이 감사 로그에 1행씩 남고, 인자 안의 연락처는 마스킹돼 있다", async () => {
    const delivered = await order("delivered");
    const ret = await adminDb.return.create({ data: { orderId: delivered, kind: "refund", reason: "defective", status: "requested", detail: "연락 010-2345-6789" } });
    const readToken = await issue(["read"]);
    const writeToken = await issue(["read", "write"]);
    const r = await connect(readToken.token);
    const w = await connect(writeToken.token);

    await call(r, "list_pending_work");
    await call(r, "get_order", { orderId: delivered });
    await call(r, "adjust_stock", { productId: 1, delta: 3 }); // 범위 없음(실패)
    const rejected = await call(w, "reject_return", { returnId: ret.id, reason: "손님(010-9876-5432, kim@example.com)과 통화 후 거절" });
    expect(rejected.isError).toBe(false);
    await call(w, "reject_return", { returnId: ret.id, reason: "다시" }); // 이미 거절됨(실패)
    // 인자 검증에 실패한 호출도 남는다
    const invalid = (await w.callTool({ name: "get_order", arguments: { orderId: "abc" } })) as CallToolResult;
    expect(invalid.isError).toBe(true);
    await call(w, "list_low_stock", { threshold: 100 });

    const rows = await adminDb.mcpAuditEntry.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((x) => [x.tokenId, x.tool, x.ok])).toEqual([
      [readToken.id, "list_pending_work", true],
      [readToken.id, "get_order", true],
      [readToken.id, "adjust_stock", false],
      [writeToken.id, "reject_return", true],
      [writeToken.id, "reject_return", false],
      [writeToken.id, "get_order", false],
      [writeToken.id, "list_low_stock", true],
    ]);
    expect(rows[3]!.args).toEqual({ returnId: ret.id, reason: "손님(010-****-5432, k***@example.com)과 통화 후 거절" });
    expect(rows[2]!.error).toMatch(/write 범위/);
    const all = JSON.stringify(rows);
    expect(all).not.toContain("010-9876-5432");
    expect(all).not.toContain("kim@example.com");

    // 관리자 화면: 감사 로그 API
    const audit = await admin().get("/admin/mcp/audit?limit=3");
    expect(audit.status).toBe(200);
    expect(audit.body.items.map((x: { tool: string }) => x.tool)).toEqual(["list_low_stock", "get_order", "reject_return"]);
    expect(audit.body.items[2].token).toMatchObject({ id: writeToken.id, prefix: writeToken.prefix });
  });

  it("읽기 도구는 26 검색 통계·29 대사·재고 기준을 그대로 읽고, adjust_stock은 REST와 같은 규칙", async () => {
    const c = await connect((await issue(["read", "write"])).token);
    const pending = await call(c, "list_pending_work");
    expect(pending.body).toMatchObject({ pending: { paid: { count: 0 } }, lowStock: { threshold: expect.any(Number) } });
    expect((await call(c, "list_zero_result_searches")).body).toEqual({ items: expect.any(Array) });
    await adminDb.$executeRaw`TRUNCATE reconciliation_issues, reconciliation_runs RESTART IDENTITY`;
    await adminDb.reconciliationIssue.create({ data: { provider: "toss", businessDate: new Date("2026-01-02"), kind: "amount_mismatch", paymentKey: "pk-x", ourValue: { amount: 1 }, pgValue: { amount: 2 } } });
    const issues = await call(c, "list_reconciliation_issues");
    expect(issues.body).toMatchObject({ items: [{ paymentKey: "pk-x", kind: "amount_mismatch" }], counts: { open: 1 } });
    expect(issues.body).toEqual((await admin().get("/admin/reconciliation/issues")).body);

    expect((await call(c, "adjust_stock", { productId: 1, delta: -4 })).body).toEqual({ id: 1, stock: 6 });
    expect(await call(c, "adjust_stock", { productId: 1, delta: -7 })).toMatchObject({ isError: true, body: { status: 409 } });
    const low = await call(c, "list_low_stock", { threshold: 6 });
    expect(low.body).toMatchObject({ threshold: 6, items: [{ id: 1, stock: 6 }] });
  });

  it("GET·DELETE /mcp는 405(상태 없는 서버)", async () => {
    const t = await issue(["read"]);
    expect((await fetch(`${baseUrl}/mcp`, { headers: { Authorization: `Bearer ${t.token}` } })).status).toBe(405);
    expect((await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: { Authorization: `Bearer ${t.token}` } })).status).toBe(405);
  });
});
