import { expect, test, type Page } from "@playwright/test";

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

test("관리자는 입고 수량을 더하고 빼며, 재고보다 많이 빼면 이유가 보인다", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/admin/products");
  const stock = page.getByTestId("admin-stock-6");
  await expect(stock).not.toHaveText("");
  const before = Number(await stock.textContent());
  const input = page.getByTestId("stock-delta-6");

  await input.fill("5");
  await input.press("Enter");
  await expect(stock).toHaveText(String(before + 5));

  await input.fill(String(-(before + 6)));
  await input.press("Enter");
  await expect(page.getByTestId("stock-error-6")).toContainText("뺄 수 없습니다");
  await expect(stock).toHaveText(String(before + 5));

  await input.fill("-5");
  await input.press("Enter");
  await expect(stock).toHaveText(String(before));
});
