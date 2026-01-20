import { expect, test } from "@playwright/test";

test("데모 관리자로 들어가면 관리 메뉴가, 데모 사용자로 들어가면 없다", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "관리자로" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByRole("link", { name: "관리" })).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.getByRole("button", { name: "일반 사용자로" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByRole("link", { name: "내 주문" })).toBeVisible();
  await expect(page.getByRole("link", { name: "관리" })).toHaveCount(0);
});
