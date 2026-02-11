import { expect, test, type APIRequestContext } from "@playwright/test";

const API = "http://localhost:4000";

async function newestKimOrderId(request: APIRequestContext): Promise<number> {
  const { accessToken } = await (await request.post(`${API}/auth/login`, { data: { id: "kim", password: "1234" } })).json();
  const { items } = await (await request.get(`${API}/me/orders?limit=1`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
  return items[0].id;
}

test("주문 상세 화면의 tRPC 요청 두 개(me.order, me.orders)가 HTTP 요청 하나로 묶인다", async ({ page, request }) => {
  const id = await newestKimOrderId(request);
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);

  const calls: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/trpc/me.order")) calls.push(url.pathname);
  });

  await page.goto(`/me/orders/${id}`);
  await expect(page.getByTestId("order-detail")).toContainText(`주문 #${id}`);
  await expect(page.getByTestId("my-orders")).toBeVisible();
  expect(calls).toEqual(["/trpc/me.order,me.orders"]);
});
