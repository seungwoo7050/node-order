import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:4000";

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

test.beforeAll(async ({ request }) => {
  const { accessToken } = await (await request.post(`${API}/auth/login`, { data: { id: "kim", password: "1234" } })).json();
  const headers = { Authorization: `Bearer ${accessToken}` };
  const { items } = await (await request.get(`${API}/me/orders?limit=45`, { headers })).json();
  for (let i = items.length; i < 45; i++) await request.post(`${API}/orders`, { headers, data: { user: "kim", price: 1000, paid: true } });
});

const rows = (page: Page) => page.getByTestId("my-orders").getByRole("listitem");

test("목록 끝에 닿으면 다음 20건이 붙고, 같은 주문이 두 번 나오지 않는다", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/me/orders");
  await expect(rows(page)).toHaveCount(20);
  await expect(page.getByRole("status").filter({ hasText: "주문 20건을 불러왔습니다" })).toBeVisible();

  await rows(page).last().scrollIntoViewIfNeeded();
  await expect(rows(page)).toHaveCount(40);

  const hrefs = await rows(page).getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(new Set(hrefs).size).toBe(40);
});

test("스크롤하지 않아도 키보드로 '더 보기'를 눌러 넘기고, 포커스는 버튼에 남는다", async ({ page }) => {
  await page.addInitScript(() => {
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } } as unknown as typeof IntersectionObserver;
  });
  await loginAsKim(page);
  await page.goto("/me/orders");
  await expect(rows(page)).toHaveCount(20);

  const more = page.getByRole("button", { name: "더 보기" });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(rows(page)).toHaveCount(40);
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rows(page)).not.toHaveCount(40);
});

test("결제가 확인되면 아래 목록의 그 주문도 '결제 완료'로 바뀐다 - 목록을 다시 받지 않는다", async ({ page }) => {
  test.skip(!process.env.STRIPE_SIM, "STRIPE_SIM=1 일 때만 Stripe 시뮬레이터로 결제한다");
  await loginAsKim(page);
  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  await Promise.all([page.waitForURL(/localhost:4100\/c\/pay\/cs_/), page.getByRole("button", { name: "결제" }).click()]);

  const listRequests: string[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (path.startsWith("/trpc/") && path.includes("me.orders")) listRequests.push(path);
  });
  await page.getByRole("button", { name: "결제 완료" }).click();
  await page.waitForURL(/\/me\/orders\/\d+\?checkout=success$/);
  const id = new URL(page.url()).pathname.split("/").pop();

  const row = rows(page).filter({ has: page.locator(`a[href="/me/orders/${id}"]`) });
  await expect(row).toContainText("결제 대기");
  await expect(page.getByTestId("order-status")).toHaveText("결제 완료");
  await expect(row).toContainText("결제 완료");
  expect(listRequests).toEqual(["/trpc/me.order,me.orders"]);
});
