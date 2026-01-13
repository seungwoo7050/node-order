import { expect, test } from "@playwright/test";

test.skip(!process.env.STRIPE_E2E, "STRIPE_E2E=1 일 때만 실제 Stripe로 결제한다");
test.use({ locale: "ko-KR" });

test("테스트 카드로 결제하면 웹훅이 주문을 결제 완료로 바꾼다", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);

  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await Promise.all([page.waitForURL(/^https:\/\/checkout\.stripe\.com\//), page.getByRole("button", { name: "결제" }).click()]);

  await page.locator("#email").fill("test@example.com");
  await page.locator("#payment-method-accordion-item-title-card").click({ force: true });
  await page.locator("#cardNumber").fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("Test User");
  await page.getByRole("button", { name: "결제", exact: true }).click();

  await page.waitForURL(/\/me\/orders\/\d+\?checkout=success$/, { timeout: 60_000 });
  await expect(page.getByTestId("order-status")).toHaveText("결제 완료", { timeout: 30_000 });
});