import { create } from "zustand";
import { persist } from "zustand/middleware";
import { tokenSubject, useAuthStore } from "./auth-store";

export type CartItem = { productId: number; name: string; price: number; quantity: number };
// 배송지. 다음 주문에 다시 쓰도록 이 브라우저에 남긴다(주문에는 사본이 붙는다). 로그아웃하면 지운다(clearShipping).
// 쓴 사람의 id(shippingOwner)를 같이 둔다: 로그아웃을 거치지 않고 사용자가 바뀌면(다른 계정·GitHub 로그인, 세션 만료 뒤 다른 사람)
// 새 접근 토큰의 sub와 비교해 다르면 버린다. null = 로그인 전에 썼다(로그인한 사람의 것이 된다), undefined = 기록 없음(옛 저장소, 버린다)
export type ShippingInput = { recipientName: string; recipientPhone: string; postalCode: string; address1: string; address2: string; deliveryMemo: string };
export const EMPTY_SHIPPING: ShippingInput = { recipientName: "", recipientPhone: "", postalCode: "", address1: "", address2: "", deliveryMemo: "" };

type CartState = {
  items: CartItem[];
  checkoutKey: string | null;
  shipping: ShippingInput;
  shippingOwner?: string | null;
  setShipping: (patch: Partial<ShippingInput>) => void;
  clearShipping: () => void;
  adoptShipping: (userId: string) => void;
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
      setShipping: (patch) =>
        set((state) => ({ checkoutKey: null, shipping: { ...state.shipping, ...patch }, shippingOwner: tokenSubject(useAuthStore.getState().accessToken) })),
      // 로그아웃할 때 배송지 원문(연락처·주소)을 이 브라우저에서 지운다. 담은 상품은 남긴다
      clearShipping: () => set({ checkoutKey: null, shipping: EMPTY_SHIPPING, shippingOwner: undefined }),
      // 로그인한 사용자가 정해질 때마다(접근 토큰이 바뀔 때) 부른다. 남이 쓴(또는 누가 썼는지 모르는) 배송지는 버린다
      adoptShipping: (userId) => {
        const { shipping, shippingOwner } = get();
        if (shippingOwner === userId) return;
        const empty = Object.values(shipping).every((v) => v === "");
        if (shippingOwner === null || empty) return set({ shippingOwner: empty ? undefined : userId });
        set({ checkoutKey: null, shipping: EMPTY_SHIPPING, shippingOwner: undefined });
      },
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

// 접근 토큰이 새로 생길 때(로그인, 갱신) 그 사용자의 것이 아닌 배송지를 버린다
useAuthStore.subscribe((state, prev) => {
  if (!state.accessToken || state.accessToken === prev.accessToken) return;
  const userId = tokenSubject(state.accessToken);
  if (userId) useCartStore.getState().adoptShipping(userId);
});
