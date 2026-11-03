import { useCartStore } from "@/lib/cart-store";

export function Stepper({
  productId,
  name,
  quantity,
  max,
  classNames,
}: {
  productId: number;
  name: string;
  quantity: number;
  max: number;
  classNames?: {
    root?: string;
    button?: string;
    value?: string;
  };
}) {
  const setQuantity = useCartStore((s) => s.setQuantity);
  const rootClass =
    classNames?.root ?? "inline-flex items-center border border-line-strong";
  const buttonClass = classNames?.button ?? "size-[30px] cursor-pointer";
  const valueClass = classNames?.value ?? "num min-w-8 text-center text-sm";

  return (
    <span className={rootClass}>
      <button
        type="button"
        className={buttonClass}
        aria-label={`${name} 수량 줄이기`}
        onClick={() => setQuantity(productId, quantity - 1)}
      >
        -
      </button>
      <span className={valueClass}>{quantity}</span>
      <button
        type="button"
        className={`${buttonClass}${
          !classNames?.button
            ? " disabled:cursor-not-allowed disabled:text-faint"
            : ""
        }`}
        aria-label={`${name} 수량 늘리기`}
        disabled={quantity >= max}
        onClick={() => setQuantity(productId, quantity + 1)}
      >
        +
      </button>
    </span>
  );
}
