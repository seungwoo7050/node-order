import { expect, test } from "@playwright/test";

test("주문 상세 화면의 tRPC 요청 두 개(me.order, me.orders)가 HTTP 요청 하나로 묶인다", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("password").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);

  const calls: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/trpc/me.")) calls.push(url.pathname);
  });

  await page.goto("/me/orders/1");
  await expect(page.getByTestId("order-detail")).toContainText("주문 #1");
  await expect(page.getByTestId("my-orders")).toBeVisible();
  expect(calls).toEqual(["/trpc/me.order,me.orders"]);
});