import type { Page } from "@playwright/test";

// 장바구니의 배송지 칸 채우기(결제 시작 전에 API가 필수 검증을 한다)
export async function fillShipping(page: Page, overrides: Partial<Record<"받는 분" | "연락처" | "우편번호" | "주소", string>> = {}) {
  const values = { "받는 분": "김구매", 연락처: "010-2345-6789", 우편번호: "06236", 주소: "서울특별시 강남구 테헤란로 123", ...overrides };
  const form = page.getByTestId("shipping-form");
  for (const [label, value] of Object.entries(values)) await form.getByLabel(label, { exact: true }).fill(value);
}
