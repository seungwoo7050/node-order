import { useCartStore } from "@/lib/cart-store";

export function Stepper({ productId, name, quantity, max }: { productId: number; name: string; quantity: number; max: number }) {
  const setQuantity = useCartStore((s) => s.setQuantity);
  return (
    <span className="inline-flex items-center border border-line-strong">
      <button type="button" className="size-[30px] cursor-pointer" aria-label={`${name} 수량 줄이기`} onClick={() => setQuantity(productId, quantity - 1)}>-</button>
      <span className="num min-w-8 text-center text-sm">{quantity}</span>
      <button type="button" className="size-[30px] cursor-pointer disabled:cursor-not-allowed disabled:text-faint" aria-label={`${name} 수량 늘리기`}
        disabled={quantity >= max} onClick={() => setQuantity(productId, quantity + 1)}>+</button>
    </span>
  );
}