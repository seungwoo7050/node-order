import { expect, test, type Page } from "@playwright/test";

const MOUSE = { name: "마우스", price: 30000, description: "손에 맞는 크기의 유선 마우스입니다. 버튼 두 개와 휠 하나, 군더더기가 없습니다." };

test.use({ serviceWorkers: "block" });

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage({ serviceWorkers: "block" });
  await loginAsKim(page);
  await page.goto("/admin/products/6");
  await page.getByLabel("이름").fill(MOUSE.name);
  await page.getByLabel("가격(원)").fill(String(MOUSE.price));
  await page.getByLabel("설명").fill(MOUSE.description);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page).toHaveURL(/\/admin\/products$/);
  await page.close();
});

test("가격과 설명을 저장하면 목록·상점·상세가 모두 새 값이다", async ({ page }) => {
  await loginAsKim(page);
  const mouse = page.getByRole("listitem").filter({ hasText: "마우스" });
  await expect(mouse).toContainText("30,000원");
  await page.getByRole("link", { name: "마우스", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "마우스" })).toContainText("유선 마우스");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/shop$/);

  await page.goto("/admin/products");
  await expect(page.getByTestId("price-6")).toHaveText("30,000원");
  await page.getByRole("link", { name: "마우스 수정" }).click();
  await page.getByLabel("가격(원)").fill("31500");
  await page.getByLabel("설명").fill("가격을 고친 마우스입니다.");
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page).toHaveURL(/\/admin\/products$/);
  await expect(page.getByTestId("price-6")).toHaveText("31,500원");
  await page.getByRole("link", { name: "상품" }).first().click();
  await expect(page.getByRole("listitem").filter({ hasText: "마우스" })).toContainText("31,500원");
  await page.goto("/shop/6");
  await expect(page.getByTestId("product-detail")).toContainText("가격을 고친 마우스입니다.");
});

test("API가 거절하면 목록으로 가지 않고, 입력값을 둔 채 사유를 알린다", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/admin/products/6");
  await page.getByLabel("이름").fill("   ");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "name" })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/products\/6$/);
  await expect(page.getByLabel("가격(원)")).not.toHaveValue("");
});

test("데모 관리자는 수정 화면을 볼 수 있지만 입력과 저장이 꺼져 있다", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "관리자로" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await page.goto("/admin/products/6");
  await expect(page.getByTestId("read-only-note")).toBeVisible();
  await expect(page.getByLabel("가격(원)")).toBeDisabled();
  await expect(page.getByRole("button", { name: "저장" })).toBeDisabled();
});
