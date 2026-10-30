import { expect, test } from "@playwright/test";

test("담기 → 그 자리에서 수량 조절 → 0이 되면 다시 담기", async ({ page }) => {
  await page.goto("/shop");
  const mouse = page.getByRole("listitem").filter({ hasText: "마우스" });
  await mouse.getByRole("button", { name: "담기" }).click();
  await expect(page.getByRole("status").filter({ hasText: "마우스를 담았습니다" })).toBeVisible();

  await mouse.getByRole("button", { name: "마우스 수량 늘리기" }).click();
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 2");

  await mouse.getByRole("button", { name: "마우스 수량 줄이기" }).click();
  await mouse.getByRole("button", { name: "마우스 수량 줄이기" }).click();
  await expect(page.getByTestId("cart-count")).toHaveText("장바구니 0");
  await expect(mouse.getByRole("button", { name: "담기" })).toBeVisible();
});

test("장바구니 페이지에서 수량을 바꾸면 금액이 따라오고, 빼면 비어 있다고 알린다", async ({ page }) => {
  await page.goto("/shop");
  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  await expect(page).toHaveURL(/\/cart$/);

  await page.getByRole("button", { name: "마우스 수량 늘리기" }).click();
  await expect(page.getByRole("complementary", { name: "결제" })).toContainText("60,000원");
  await page.getByRole("button", { name: "빼기" }).click();
  await expect(page.getByText("비어 있습니다")).toBeVisible();
});

test("재고보다 많이 담을 수 없다", async ({ page }) => {
  await page.goto("/shop");
  const keyboard = page.getByRole("listitem").filter({ hasText: "한정판 키보드" });
  const stock = Number(await keyboard.getByTestId("stock-5").textContent());
  await keyboard.getByRole("button", { name: "담기" }).click();
  const plus = keyboard.getByRole("button", { name: "한정판 키보드 수량 늘리기" });
  for (let i = 1; i < stock; i++) await plus.click();
  await expect(page.getByTestId("cart-count")).toHaveText(`장바구니 ${stock}`);
  await expect(plus).toBeDisabled();
});

test("로그인한 손님이 장바구니를 새로고침해도 자기 배송지가 그대로 보이고, 고치면 이어 쓴다", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  const form = page.getByTestId("shipping-form");
  await form.getByLabel("받는 분", { exact: true }).fill("김구매");
  await form.getByLabel("주소", { exact: true }).fill("서울특별시 강남구 테헤란로 123");

  await page.reload(); // 접근 토큰은 메모리에만 있어 사라지고, 화면이 갱신으로 다시 받는다
  await expect(form.getByLabel("받는 분", { exact: true })).toHaveValue("김구매");
  await form.getByLabel("받는 분", { exact: true }).fill("김구매자");
  await expect(form.getByLabel("주소", { exact: true })).toHaveValue("서울특별시 강남구 테헤란로 123");
});

test("결제를 취소하고 돌아오면 남은 주문이 어떻게 되는지 알려 준다", async ({ page }) => {
  await page.goto("/shop?checkout=canceled&order=8");
  await expect(page.getByRole("status").filter({ hasText: "결제를 취소했습니다" })).toContainText("주문 #8은 결제 대기로 남아");
});
