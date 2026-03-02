import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("데모 사용자로 들어가 목록을 보고, 상세를 연다", async ({ page }) => {
  const res = await page.goto("/login");
  if (process.env.DEPLOY_SLOT_TOKEN) expect(res?.headers()["x-deploy-slot"]).toBe("preview");

  await page.getByRole("button", { name: "일반 사용자로" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  const first = page.getByRole("region", { name: "상품 목록" }).getByRole("link").first();
  await expect(first).toBeVisible();
  const name = (await first.textContent())!;

  await page.goto((await first.getAttribute("href"))!);
  await expect(page.getByTestId("product-detail")).toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});
