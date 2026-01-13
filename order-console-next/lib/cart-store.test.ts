import { beforeEach, describe, expect, it } from "vitest";
import { useCartStore } from "./cart-store";

const mouse = { productId: 2, name: "마우스", price: 30000 };
const keyboard = { productId: 1, name: "한정판 키보드", price: 150000 };
const cart = () => useCartStore.getState();

describe("장바구니 수량", () => {
  beforeEach(() => useCartStore.setState({ items: [], checkoutKey: null }));

  it("정한 수량이 그대로 들어간다", () => {
    cart().add(mouse);
    cart().setQuantity(2, 3);
    expect(cart().items).toEqual([{ ...mouse, quantity: 3 }]);
  });

  it("0 이하로 정하면 빠진다 - 다른 상품은 그대로", () => {
    cart().add(mouse);
    cart().add(keyboard);
    cart().setQuantity(2, 0);
    expect(cart().items.map((i) => i.productId)).toEqual([1]);
  });

  it("수량을 바꾸면 결제 멱등 키를 버린다 - 다른 결제이기 때문이다(05의 5단계)", () => {
    cart().add(mouse);
    const key = cart().beginCheckout();
    expect(cart().beginCheckout()).toBe(key);
    cart().setQuantity(2, 2);
    expect(cart().checkoutKey).toBeNull();
    expect(cart().beginCheckout()).not.toBe(key);
  });

  it("소수는 버린다", () => {
    cart().add(mouse);
    cart().setQuantity(2, 2.7);
    expect(cart().items[0].quantity).toBe(2);
  });
});
