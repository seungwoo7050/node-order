import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = { productId: number; name: string; price: number; quantity: number };
// 배송지. 다음 주문에 다시 쓰도록 이 브라우저에 남긴다(주문에는 사본이 붙는다). 로그아웃하면 지운다(clearShipping)
export type ShippingInput = { recipientName: string; recipientPhone: string; postalCode: string; address1: string; address2: string; deliveryMemo: string };
export const EMPTY_SHIPPING: ShippingInput = { recipientName: "", recipientPhone: "", postalCode: "", address1: "", address2: "", deliveryMemo: "" };

type CartState = {
  items: CartItem[];
  checkoutKey: string | null;
  shipping: ShippingInput;
  setShipping: (patch: Partial<ShippingInput>) => void;
  clearShipping: () => void;
  add: (item: Omit<CartItem, "quantity">) => void;
  remove: (productId: number) => void;
  setQuantity: (productId: number, quantity: number) => void;
  beginCheckout: () => string;
  finishCheckout: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      checkoutKey: null,
      shipping: EMPTY_SHIPPING,
      // 배송지가 바뀌면 다른 요청이므로 멱등 키를 새로 만든다(같은 키로 다른 내용을 보내면 422)
      setShipping: (patch) => set((state) => ({ checkoutKey: null, shipping: { ...state.shipping, ...patch } })),
      // 로그아웃할 때 배송지 원문(연락처·주소)을 이 브라우저에서 지운다. 담은 상품은 남긴다
      clearShipping: () => set({ checkoutKey: null, shipping: EMPTY_SHIPPING }),
      add: (item) =>
        set((state) => {
          const found = state.items.find((i) => i.productId === item.productId);
          if (found) {
            return {
              checkoutKey: null,
              items: state.items.map((i) => (i.productId === item.productId ? { ...i, quantity: i.quantity + 1 } : i)),
            };
          }
          return { checkoutKey: null, items: [...state.items, { ...item, quantity: 1 }] };
        }),
      remove: (productId) =>
        set((state) => ({ checkoutKey: null, items: state.items.filter((i) => i.productId !== productId) })),
      setQuantity: (productId, quantity) =>
        set((state) => {
          const q = Math.floor(quantity);
          if (q <= 0) return { checkoutKey: null, items: state.items.filter((i) => i.productId !== productId) };
          return { checkoutKey: null, items: state.items.map((i) => (i.productId === productId ? { ...i, quantity: q } : i)) };
        }),
      beginCheckout: () => {
        const existing = get().checkoutKey;
        if (existing) return existing;
        const key = crypto.randomUUID();
        set({ checkoutKey: key });
        return key;
      },
      finishCheckout: () => set({ items: [], checkoutKey: null }),
    }),
    { name: "cart" },
  ),
);