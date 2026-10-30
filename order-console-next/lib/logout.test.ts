import { afterEach, describe, expect, it, vi } from "vitest";
import { logout } from "./api-client";
import { useAuthStore } from "./auth-store";
import { EMPTY_SHIPPING, useCartStore } from "./cart-store";

const SHIPPING = { recipientName: "김구매", recipientPhone: "010-2345-6789", postalCode: "06236", address1: "서울특별시 강남구 테헤란로 123", address2: "4층", deliveryMemo: "문 앞" };

// 장바구니 저장소(localStorage "cart")에는 다음 주문에 다시 쓰도록 배송지를 남긴다. 로그아웃하면 그 원문을 지운다
// (같은 브라우저를 다른 사람이 쓰면 연락처·주소가 보인다). 담은 상품은 개인정보가 아니라 그대로 둔다
describe("로그아웃", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("배송지 원문을 지우고 담은 상품은 남긴다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    useAuthStore.getState().setAccessToken("token");
    useCartStore.setState({ items: [{ productId: 2, name: "마우스", price: 30000, quantity: 1 }], checkoutKey: "k", shipping: SHIPPING });

    await logout();

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useCartStore.getState().shipping).toEqual(EMPTY_SHIPPING);
    expect(useCartStore.getState().checkoutKey).toBeNull();
    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it("API 호출이 실패해도 배송지는 지운다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    useCartStore.setState({ shipping: SHIPPING });
    await logout().catch(() => {});
    expect(useCartStore.getState().shipping).toEqual(EMPTY_SHIPPING);
  });
});
