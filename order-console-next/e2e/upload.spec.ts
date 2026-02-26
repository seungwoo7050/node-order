import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

test("이미지를 고르면 저장소에 직접 올라가고, 목록에 보인다", async ({ page }) => {
  await loginAsKim(page);
  await page.getByRole("link", { name: "관리" }).click();
  const storagePut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().startsWith("http://localhost:9000/"));
  await page.getByTestId("image-input-6").setInputFiles(path.join(__dirname, "fixtures/pixel.png"));

  const put = await storagePut;
  expect(put.status()).toBe(200);
  const key = new URL(put.url()).pathname.replace(/^\/product-images\//, "");
  const img = page.getByTestId("image-6").filter({ visible: true });
  await expect(img).toHaveAttribute("src", new RegExp(`^http://localhost:9000/product-images/${key}\\?`));
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test("이미지가 아닌 파일은 확장자가 .png여도 거절된다", async ({ page }) => {
  await loginAsKim(page);
  await page.goto("/admin/products");
  await page.getByTestId("image-input-6").setInputFiles({
    name: "not-an-image.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script></html>"),
  });
  await expect(page.getByTestId("image-error-6")).toContainText("이미지 파일이 아니다");
});

test("관리 메뉴와 관리자 페이지는 관리자에게만", async ({ page }) => {
  await loginAsKim(page);
  await expect(page.getByRole("link", { name: "관리" })).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("아이디").fill("lee");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByRole("link", { name: "내 주문" })).toBeVisible();
  await expect(page.getByRole("link", { name: "관리" })).toHaveCount(0);
  await page.goto("/admin/products");
  await expect(page.getByText("관리자만 볼 수 있는 화면입니다")).toBeVisible();
});
