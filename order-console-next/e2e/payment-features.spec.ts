import { expect, test, type Page } from "@playwright/test";

// 결제 화면은 API의 GET /features가 켠 결제 수단만 보인다. 키 조합마다 API를 다시 띄우지 않고 응답을 바꿔 끼운다
// (키 → features 응답은 API e2e의 features.e2e-spec.ts가 검사한다)
const API = "http://localhost:4000";

test.use({ serviceWorkers: "block" });

async function cartWith(page: Page, features: unknown) {
  await page.route(`${API}/features`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(features) }));
  await page.goto("/shop");
  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  await expect(page.getByRole("heading", { name: "장바구니" })).toBeVisible();
}

const methods = (page: Page) => page.getByRole("group", { name: "결제 수단" }).getByRole("radio");

test("토스 키만 있으면 토스만 보인다", async ({ page }) => {
  await cartWith(page, { payments: ["toss"], toss: { clientKey: "ck", sdkUrl: "http://localhost:1/none.js" } });
  await expect(methods(page)).toHaveCount(1);
  await expect(page.getByRole("radio", { name: "토스페이먼츠" })).toBeChecked();
  await expect(page.getByRole("button", { name: "결제하기" })).toBeEnabled();
  await expect(page.getByTestId("checkout-note")).toContainText("토스페이먼츠 결제창");
});

test("Stripe 키만 있으면 Stripe만 보인다", async ({ page }) => {
  await cartWith(page, { payments: ["stripe"] });
  await expect(methods(page)).toHaveCount(1);
  await expect(page.getByRole("radio", { name: /Stripe/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "결제하기" })).toBeEnabled();
  await expect(page.getByTestId("checkout-note")).toContainText("Stripe 화면");
});

test("둘 다 있으면 둘 다 보이고 고를 수 있다(기본은 Stripe)", async ({ page }) => {
  await cartWith(page, { payments: ["toss", "stripe"], toss: { clientKey: "ck", sdkUrl: "http://localhost:1/none.js" } });
  await expect(methods(page)).toHaveCount(2);
  await expect(page.getByRole("radio", { name: /Stripe/ })).toBeChecked();
  await page.getByRole("radio", { name: "토스페이먼츠" }).check();
  await expect(page.getByTestId("checkout-note")).toContainText("토스페이먼츠 결제창");
});

test("둘 다 없으면 결제 버튼이 꺼지고 이유가 보인다", async ({ page }) => {
  await cartWith(page, { payments: [] });
  await expect(methods(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "결제하기" })).toBeDisabled();
  await expect(page.getByTestId("checkout-note")).toHaveText(/켜진 결제 수단이 없어 결제할 수 없습니다/);
});
