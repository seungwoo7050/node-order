import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("password").fill("1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

test("이미지를 고르면 저장소에 직접 올라가고, 목록에 보인다", async ({ page }) => {
  await loginAsKim(page);
  const storagePut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().startsWith("http://localhost:9000/"));
  const confirm = page.waitForResponse((r) => r.url().endsWith("/products/2/image/confirm"));
  await page.getByTestId("image-input-2").setInputFiles(path.join(__dirname, "fixtures/pixel.png"));

  expect((await storagePut).status()).toBe(200);
  const { key } = (await (await confirm).json()) as { key: string };
  const img = page.getByTestId("image-2");
  await expect(img).toHaveAttribute("src", new RegExp(`^http://localhost:9000/product-images/${key}\\?`));
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test("이미지가 아닌 파일은 확장자가 .png여도 거절된다", async ({ page }) => {
  await loginAsKim(page);
  await page.getByTestId("image-input-2").setInputFiles({
    name: "not-an-image.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script></html>"),
  });
  await expect(page.getByTestId("image-error-2")).toContainText("이미지 파일이 아니다");
});
