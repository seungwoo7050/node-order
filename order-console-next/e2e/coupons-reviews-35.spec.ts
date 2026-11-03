import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

test.describe("35-coupons-reviews e2e", () => {
  test("1. 관리자 쿠폰 CRUD 및 활성화 토글", async ({ page }) => {
    await loginAsKim(page);

    // 사이드바에서 쿠폰 관리 메뉴 확인 및 이동
    await page.goto("/admin/coupons");
    await expect(page.getByRole("heading", { name: "쿠폰 관리" })).toBeVisible();

    const couponCode = `TEST${Date.now().toString().slice(-4)}`;

    // 새 쿠폰 발행
    await page.getByTestId("coupon-code-input").fill(couponCode);
    await page.getByTestId("coupon-name-input").fill("테스트 할인 쿠폰");
    await page.getByTestId("coupon-discount-type").selectOption("fixed");
    await page.getByTestId("coupon-discount-value").fill("3000");
    await page.getByTestId("coupon-min-order-amount").fill("10000");
    await page.getByTestId("coupon-create-submit").click();

    // 목록에 등록 확인
    const couponList = page.getByTestId("coupon-list");
    await expect(couponList).toContainText(couponCode);
    await expect(couponList).toContainText("3,000원 할인");

    // 활성화/비활성화 토글
    const toggleBtn = couponList.getByRole("button", { name: "비활성화" }).first();
    await toggleBtn.click();
    await expect(couponList.getByRole("button", { name: "활성화" }).first()).toBeVisible();
  });

  test("2. 장바구니 쿠폰 적용, 오류 처리 및 할인 미리보기", async ({ page }) => {
    // 1. 유효한 쿠폰 하나를 사전에 API로 생성
    const couponCode = `CART${Date.now().toString().slice(-4)}`;
    await loginAsKim(page);
    await page.goto("/admin/coupons");
    await page.getByTestId("coupon-code-input").fill(couponCode);
    await page.getByTestId("coupon-name-input").fill("장바구니 2000원 할인");
    await page.getByTestId("coupon-discount-type").selectOption("fixed");
    await page.getByTestId("coupon-discount-value").fill("2000");
    await page.getByTestId("coupon-min-order-amount").fill("0");
    await page.getByTestId("coupon-create-submit").click();
    await expect(page.getByTestId("coupon-list")).toContainText(couponCode);

    // 2. 상품 상세 페이지에서 장바구니에 담기
    await page.goto("/shop/6");
    await page.getByRole("button", { name: "담기" }).click();

    // 3. 장바구니로 이동
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "장바구니" })).toBeVisible();

    // 4. 잘못된 쿠폰 입력 시 에러 표시 확인
    await page.getByTestId("coupon-code-input").fill("INVALID_CODE");
    await page.getByTestId("apply-coupon-btn").click();
    await expect(page.getByTestId("coupon-error")).toBeVisible();

    // 5. 유효한 쿠폰 적용 시 할인액 반영 확인
    await page.getByTestId("coupon-code-input").fill(couponCode);
    await page.getByTestId("apply-coupon-btn").click();

    await expect(page.getByTestId("applied-coupon-info")).toBeVisible();
    await expect(page.getByTestId("coupon-discount-amount")).toContainText("-2,000원");

    // 6. 쿠폰 적용 취소
    await page.getByTestId("remove-coupon-btn").click();
    await expect(page.getByTestId("coupon-discount-amount")).toHaveCount(0);
  });

  test("3. 상품 상세 후기(Review) 영역 및 관리자 리뷰 관리", async ({ page }) => {
    // 상품 상세에 후기 영역 존재 확인
    await page.goto("/shop/1");
    const reviewsSection = page.getByTestId("product-reviews");
    await expect(reviewsSection).toBeVisible();
    await expect(reviewsSection.getByTestId("product-average-rating")).toBeVisible();
    await expect(reviewsSection.getByTestId("product-review-count")).toBeVisible();

    // 관리자 리뷰 관리 화면 접근
    await loginAsKim(page);
    await page.goto("/admin/reviews");
    await expect(page.getByRole("heading", { name: "리뷰 관리" })).toBeVisible();
    await expect(page.getByTestId("admin-reviews-table")).toBeVisible();
    await expect(page.getByTestId("review-search-input")).toBeVisible();
  });
});
