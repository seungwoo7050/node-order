import { expect, test, type Browser, type Page } from "@playwright/test";
import { fillShipping } from "./shipping";

// 주문 이행 처음부터 끝까지: 손님(lee)이 배송지를 넣고 토스(시뮬레이터)로 결제 → 관리자(kim)가 배송 준비·송장·배송 완료
// → 손님이 송장 링크를 보고 반품 신청 → 관리자 승인 → 손님 화면에 환불 금액과 상태
const API = "http://localhost:4000";

test.use({ serviceWorkers: "block" });

async function login(page: Page, id: string) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill(id);
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

async function adminPage(browser: Browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await login(page, "kim");
  return page;
}

test.beforeEach(async ({ request }) => {
  const features = await (await request.get(`${API}/features`)).json();
  test.skip(features.toss?.clientKey !== "test_ck_simulator", "토스 시뮬레이터로 띄운 API에서만 돈다");
});

test("배송지 결제 → 배송 준비·송장·배송 완료 → 송장 링크 → 반품 신청 → 승인 → 환불 금액", async ({ page, browser }) => {
  test.setTimeout(90_000);
  // 손님: 배송지를 넣고 결제
  await login(page, "lee");
  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  await expect(page.getByTestId("shipping-fee")).toHaveText("3,000원");
  await expect(page.getByTestId("cart-total")).toHaveText("33,000원");
  await fillShipping(page, { "받는 분": "이수령" });
  await page.getByRole("radio", { name: "토스페이먼츠" }).check();
  await Promise.all([page.waitForURL(/\/checkout\/toss\/\d+$/), page.getByRole("button", { name: "결제하기" }).click()]);
  const orderId = page.url().match(/\/checkout\/toss\/(\d+)$/)![1];
  await Promise.all([page.waitForURL(/\/widget\/pay\?/), page.getByRole("button", { name: "33,000원 결제하기" }).click()]);
  await Promise.all([
    page.waitForURL(new RegExp(`/me/orders/${orderId}\\?checkout=success$`)),
    page.getByRole("button", { name: "결제 승인" }).click(),
  ]);
  await expect(page.getByTestId("order-status")).toHaveText("결제 완료");
  await expect(page.getByTestId("order-shipping")).toContainText("이수령");

  // 관리자: 목록(결제 완료 필터)에서 찾아 배송 준비 → 송장 입력 → 배송 완료. 지금 상태에서 허용된 버튼만 보인다
  const admin = await adminPage(browser);
  await admin.goto("/admin/orders");
  await expect(admin.getByTestId("admin-orders")).toBeVisible();
  await admin.getByRole("link", { name: `#${orderId}`, exact: true }).click();
  const actions = admin.getByTestId("admin-actions");
  await expect(actions.getByRole("button")).toHaveText(["배송 준비", "주문 취소(전액 환불)"]);
  await actions.getByRole("button", { name: "배송 준비" }).click();
  await expect(admin.getByTestId("admin-order-status")).toHaveText("배송 준비 중");
  await actions.getByLabel("택배사").selectOption("cj");
  await actions.getByLabel("송장번호").fill("6012-3456-7890");
  await actions.getByRole("button", { name: "송장 입력" }).click();
  await expect(admin.getByTestId("admin-order-status")).toHaveText("배송 중");
  await expect(actions.getByRole("button")).toHaveText(["배송 완료"]);
  await actions.getByRole("button", { name: "배송 완료" }).click();
  await expect(admin.getByTestId("admin-order-status")).toHaveText("배송 완료");

  // 손님: 송장 조회 링크와 타임라인을 보고 반품 신청(단순변심 1개)
  await page.goto(`/me/orders/${orderId}`);
  await expect(page.getByTestId("order-status")).toHaveText("배송 완료");
  await expect(page.getByTestId("shipments").getByRole("link", { name: "배송 조회" }))
    .toHaveAttribute("href", "https://trace.cjlogistics.com/next/tracking.html?wblNo=601234567890");
  await expect(page.getByTestId("order-timeline")).toContainText("배송 준비 중");
  const form = page.getByTestId("return-form");
  await form.getByLabel("마우스 반품 수량").fill("1");
  await form.getByRole("button", { name: "반품·교환 신청" }).click();
  await expect(page.getByTestId("returns").getByTestId("return-status")).toHaveText("요청됨");
  await expect(page.getByTestId("return-form")).toHaveCount(0); // 1개를 모두 신청해 남은 수량이 없다
  await expect(page.getByRole("button", { name: "구매확정" })).toHaveCount(0); // 처리 중인 요청이 있으면 미룬다

  // 관리자: 반품 승인(환불)
  await admin.reload();
  await admin.getByTestId("admin-returns").getByRole("button", { name: "반품 승인(환불)" }).click();
  await expect(admin.getByTestId("admin-return-status")).toHaveText("완료");
  await admin.context().close();

  // 손님: 환불 금액(30,000원 - 왕복 배송비 6,000원)과 상태
  await page.reload();
  await expect(page.getByTestId("return-status")).toHaveText("완료");
  await expect(page.getByTestId("return-refund")).toHaveText("환불 금액 24,000원 · 환불 완료");
});
