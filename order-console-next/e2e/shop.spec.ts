import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = "http://localhost:4000";

test.use({ serviceWorkers: "block" });

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

async function newestKimOrderId(request: APIRequestContext): Promise<number> {
  const { accessToken } = await (await request.post(`${API}/auth/login`, { data: { id: "kim", password: "1234" } })).json();
  const { items } = await (await request.get(`${API}/me/orders?limit=1`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
  return items[0].id;
}

test("장바구니는 새로고침해도 남고, 하이드레이션 에러가 없다", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(err.message));

  await loginAsKim(page);
  const mouse = page.getByRole("listitem").filter({ hasText: "마우스" });
  await mouse.getByRole("button", { name: "담기" }).click();
  await mouse.getByRole("button", { name: "마우스 수량 늘리기" }).click();
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 2");

  await page.reload();
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 2");
  expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
});

test("결제를 누르면 재고를 예약하고 Stripe 결제 화면으로 간다", async ({ page }) => {
  await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "stripe" }));
  await loginAsKim(page);
  const stock = page.getByTestId("stock-6");
  await expect(stock).not.toHaveText("");
  const before = Number(await stock.textContent());

  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  await Promise.all([
    page.waitForURL(/\/c\/pay\/cs_/),
    page.getByRole("button", { name: "결제" }).click(),
  ]);

  await page.goto("/shop");
  await expect(page.getByTestId("stock-6")).toHaveText(String(before - 1));
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 0");
  await page.goto("/me/orders");
  await expect(page.getByTestId("my-orders").getByRole("listitem").first()).toContainText("결제 대기");
  await page.getByTestId("my-orders").getByRole("listitem").first().getByRole("link").click();
  await expect(page.getByTestId("order-detail")).toContainText("마우스");
  await expect(page.getByTestId("order-detail")).toContainText("30,000원 × 1");
});

test("새로고침 뒤 로그인이 필요한 요청 두 개가 동시에 나가도 refresh는 한 번이다", async ({ page, request }) => {
  const id = await newestKimOrderId(request); // 브라우저와 따로 쓰는 요청이라 아래 refresh 수에 섞이지 않는다
  await loginAsKim(page);
  const refreshes: number[] = [];
  page.on("response", (res) => {
    if (res.url().endsWith("/auth/refresh")) refreshes.push(res.status());
  });

  for (let i = 0; i < 2; i++) {
    refreshes.length = 0;
    await page.goto(`/me/orders/${id}`);
    await expect(page.getByTestId("order-detail")).toContainText(`주문 #${id}`);
    await expect(page.getByTestId("my-orders")).toBeVisible();
    expect(refreshes).toEqual([200]);
  }
});

test("결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/me/orders");
  await expect(page.getByTestId("my-orders")).toBeVisible();
  const newestBefore = await page.getByTestId("my-orders").getByRole("listitem").first().getByRole("link").getAttribute("href");
  await page.goto("/shop");
  await page.route("https://checkout.stripe.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "stripe" }));

  let first = true;
  await page.route("**/orders/checkout", async (route) => {
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  await page.getByRole("button", { name: "결제" }).click();
  await expect(page.getByText(/결제를 시작하지 못했습니다/)).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/c\/pay\/cs_/),
    page.getByRole("button", { name: "결제" }).click(),
  ]);

  await page.goto("/me/orders");
  const links = page.getByTestId("my-orders").getByRole("listitem").getByRole("link");
  await expect(links.nth(1)).toHaveAttribute("href", newestBefore!);
  await expect(links.nth(0)).not.toHaveAttribute("href", newestBefore!);
});
