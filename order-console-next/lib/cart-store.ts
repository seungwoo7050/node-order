import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = { productId: number; name: string; price: number; quantity: number };

type CartState = {
  items: CartItem[];
  checkoutKey: string | null;
  add: (item: Omit<CartItem, "quantity">) => void;
  remove: (productId: number) => void;
  beginCheckout: () => string;
  finishCheckout: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      checkoutKey: null,
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