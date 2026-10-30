// 떠 있는 API의 /mcp에 MCP SDK 클라이언트(Streamable HTTP)로 붙어 도구 목록을 받고 읽기 도구 하나를 부른다.
// Claude Code를 붙이기 전에 토큰과 주소가 맞는지 보는 용도:
//   MCP_TOKEN=nop_... npm run mcp:check [-- --url=http://localhost:4000/mcp] [-- --tool=list_pending_work]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const url = new URL(arg("url") ?? process.env.MCP_URL ?? "http://localhost:4000/mcp");
const tool = arg("tool") ?? "list_pending_work";
const token = process.env.MCP_TOKEN;
if (!token) throw new Error("MCP_TOKEN=<npm run mcp:token으로 받은 원문>이 필요합니다");

const client = new Client({ name: "node-order-mcp-check", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
try {
  const { tools } = await client.listTools();
  console.log(`도구 ${tools.length}개: ${tools.map((t) => `${t.name}${t.annotations?.readOnlyHint ? "(읽기)" : t.annotations?.destructiveHint ? "(돈·재고)" : ""}`).join(", ")}`);
  const result = await client.callTool({ name: tool, arguments: {} });
  const text = (result.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
  console.log(`${tool} → ${result.isError ? "isError" : "ok"}`);
  console.log(text.length > 1500 ? `${text.slice(0, 1500)}…` : text);
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
