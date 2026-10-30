import { expect, test, type Page } from "@playwright/test";

// 관리자 화면에서 MCP 접근 토큰을 발급·폐기하고, 도구 호출 기록(감사 로그)을 본다
const API = "http://localhost:4000";

test.use({ serviceWorkers: "block" });

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

const mcp = (page: Page, token: string, body: unknown) =>
  page.request.post(`${API}/mcp`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    data: body,
  });

test("토큰을 발급하면 원문이 한 번만 보이고, 그 토큰의 도구 호출이 기록에 남으며, 폐기하면 401", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/admin");
  await page.getByRole("link", { name: "AI 도우미 연결(MCP)" }).click();
  await expect(page.getByRole("heading", { name: "AI 도우미 연결(MCP)" })).toBeVisible();

  const name = `e2e-${Date.now()}`;
  await page.getByLabel("토큰 이름").fill(name);
  await page.getByRole("button", { name: "토큰 발급" }).click();
  const issued = page.getByTestId("issued-token");
  await expect(issued).toContainText("한 번만");
  await expect(issued).toContainText("claude mcp add --transport http node-order http://localhost:4000/mcp");
  const token = (await page.getByTestId("token-value").textContent())!.trim();
  expect(token).toMatch(/^nop_/);

  // MCP 클라이언트처럼 도구 하나를 부른다(초기화 없이도 상태 없는 서버는 답한다)
  const res = await mcp(page, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_pending_work", arguments: {} } });
  expect(res.status()).toBe(200);
  expect(JSON.stringify(await res.json())).toContain("lowStock");

  await page.reload();
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toContainText("사용 중");
  await expect(page.getByTestId("issued-token")).toHaveCount(0); // 다시 열면 원문은 없다
  await expect(page.getByRole("row").filter({ hasText: name }).first()).toContainText("list_pending_work");

  await row.getByRole("button", { name: "폐기" }).click();
  await expect(row).toContainText("폐기됨");
  expect((await mcp(page, token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })).status()).toBe(401);
});
