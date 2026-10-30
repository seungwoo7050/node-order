import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "./auth-store";
import { EMPTY_SHIPPING, shippingFor, useCartStore } from "./cart-store";

// 장바구니 저장소의 배송지는 그것을 쓴 사용자의 것이다. 로그아웃을 거치지 않고 사용자가 바뀌어도
// (다른 계정 로그인, GitHub 로그인, 세션 만료 뒤 다른 사람이 로그인) 앞 사람의 배송지를 다음 사람의 결제에 쓰지 않는다
const SHIPPING = { recipientName: "김구매", recipientPhone: "010-2345-6789", postalCode: "06236", address1: "서울특별시 강남구 테헤란로 123", address2: "4층", deliveryMemo: "문 앞" };

// 서명은 보지 않는다(콘솔은 sub만 읽는다)
const jwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub, role: "user" })).toString("base64url")}.s`;
const cart = () => useCartStore.getState();
const login = (sub: string) => useAuthStore.getState().setAccessToken(jwt(sub));

describe("배송지 소유자", () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useCartStore.setState({ items: [], checkoutKey: null, shipping: EMPTY_SHIPPING, shippingOwner: undefined });
  });

  it("다른 계정이 로그아웃 없이 로그인하면 앞 사람의 배송지를 버린다(담은 상품은 남긴다)", () => {
    login("kim");
    cart().add({ productId: 2, name: "마우스", price: 30000 });
    cart().setShipping(SHIPPING);
    expect(cart().shippingOwner).toBe("kim");

    login("lee"); // 다른 계정 로그인·GitHub 로그인
    expect(cart().shipping).toEqual(EMPTY_SHIPPING);
    expect(cart().items).toHaveLength(1);
  });

  it("세션이 만료된 뒤 다른 사람이 로그인해도 버리고, 같은 사람이 다시 로그인하면 그대로 둔다", () => {
    login("kim");
    cart().setShipping(SHIPPING);
    useAuthStore.getState().clear(); // 갱신 실패(세션 만료)
    login("kim");
    expect(cart().shipping).toEqual(SHIPPING);

    useAuthStore.getState().clear();
    login("park");
    expect(cart().shipping).toEqual(EMPTY_SHIPPING);
  });

  it("소유자 기록이 없는 옛 배송지는 로그인하면 버린다", () => {
    useCartStore.setState({ shipping: SHIPPING, shippingOwner: undefined });
    login("kim");
    expect(cart().shipping).toEqual(EMPTY_SHIPPING);
  });

  it("세션이 만료되면(인증 없음) 앞 사람의 배송지를 보여 주지 않는다", () => {
    login("kim");
    cart().setShipping(SHIPPING);
    useAuthStore.getState().clear(); // 갱신 실패(세션 만료). 로그아웃을 거치지 않았다
    expect(shippingFor(cart(), null)).toEqual(EMPTY_SHIPPING);
    expect(shippingFor(cart(), jwt("lee"))).toEqual(EMPTY_SHIPPING);
    expect(shippingFor(cart(), jwt("kim"))).toEqual(SHIPPING);
  });

  it("세션 만료 뒤 칸 하나를 고쳐도 앞 사람의 배송지를 다음 사용자에게 물려주지 않는다", () => {
    login("kim");
    cart().setShipping(SHIPPING);
    useAuthStore.getState().clear();
    cart().setShipping({ deliveryMemo: "경비실" }); // 인증 없이 한 칸만 고친다
    expect(cart().shipping).toEqual({ ...EMPTY_SHIPPING, deliveryMemo: "경비실" });
    login("park");
    expect(cart().shipping).toEqual({ ...EMPTY_SHIPPING, deliveryMemo: "경비실" });
    expect(JSON.stringify(cart())).not.toContain(SHIPPING.recipientPhone);
  });

  it("새로고침 직후 인증을 확인하는 동안에는 배송지를 지우지도 덮어쓰지도 않고, 같은 사람으로 확인되면 보인다", () => {
    login("kim");
    cart().setShipping(SHIPPING);
    useAuthStore.setState(useAuthStore.getInitialState()); // 새로고침: 토큰은 메모리에만 있어 사라졌고, 아직 갱신 전
    cart().setShipping({ deliveryMemo: "경비실" }); // 확인 중에 한 칸을 고친다
    expect(cart().shipping).toEqual(SHIPPING);
    expect(cart().shippingOwner).toBe("kim");
    login("kim"); // 갱신이 끝났다(같은 사람)
    expect(shippingFor(cart(), useAuthStore.getState().accessToken)).toEqual(SHIPPING);
  });

  it("로그인 전에 쓴 배송지는 로그인한 사람의 것이 된다", () => {
    cart().setShipping(SHIPPING);
    expect(cart().shippingOwner).toBeNull();
    login("kim");
    expect(cart().shipping).toEqual(SHIPPING);
    expect(cart().shippingOwner).toBe("kim");
  });
});
