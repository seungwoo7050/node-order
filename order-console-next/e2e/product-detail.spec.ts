import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("목록에서 누르면 팝업으로 열리고, Esc와 뒤로 가기로 닫히며, 포커스가 링크로 돌아온다", async ({ page }) => {
  await page.goto("/shop");
  const link = page.getByRole("link", { name: "마우스", exact: true });
  await link.click();
  const dialog = page.getByRole("dialog", { name: "마우스" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/shop\/6$/);
  await expect(dialog.getByTestId("detail-stock-6")).not.toHaveText("");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/shop$/);
  await expect(link).toBeFocused();

  await link.click();
  await expect(page.getByRole("dialog", { name: "마우스" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/shop$/);
});

test("팝업이 열린 채 Tab을 눌러도 포커스가 팝업 밖으로 나가지 않는다", async ({ page }) => {
  await page.goto("/shop");
  await page.getByRole("link", { name: "마우스", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "마우스" });
  await expect(dialog.getByRole("button", { name: "담기" })).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
});

test("주소를 직접 열거나 새로고침하면 팝업이 아니라 전체 페이지다. 설명이 보인다", async ({ page }) => {
  await page.goto("/shop/6");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("product-detail")).toContainText("유선 마우스");
  await expect(page.getByRole("heading", { name: "마우스", exact: true })).toBeVisible();

  await page.goto("/shop");
  await page.getByRole("link", { name: "마우스", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "마우스" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/shop\/6$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("product-detail")).toContainText("유선 마우스");
});

test("없는 상품은 찾을 수 없다는 화면이다", async ({ page }) => {
  await page.goto("/shop/999999");
  await expect(page.getByRole("heading", { name: "상품을 찾을 수 없습니다" })).toBeVisible();
});
