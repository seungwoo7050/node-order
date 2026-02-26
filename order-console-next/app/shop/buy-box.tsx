"use client";

import { useQuery } from "@tanstack/react-query";
import { useCartStore } from "@/lib/cart-store";
import { useTRPC } from "@/lib/trpc";
import { Stepper } from "./stepper";

export function BuyBox({ id, name, price }: { id: number; name: string; price: number }) {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.products.byId.queryOptions({ id }));
  const quantity = useCartStore((s) => s.items.find((i) => i.productId === id)?.quantity ?? 0);
  const add = useCartStore((s) => s.add);

  if (isPending) return <p role="status" className="text-sm text-muted">재고를 확인하는 중입니다.</p>;
  if (error) return <p role="alert" className="alert">재고를 확인하지 못했습니다. ({error.message})</p>;
  if (data.stock === 0) return <p className="flex items-center gap-3"><span>품절</span><button type="button" className="btn" disabled>품절</button></p>;
  return (
    <p className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted">재고 <span className="num" data-testid={`detail-stock-${id}`}>{data.stock}</span></span>
      {quantity > 0 ? (
        <Stepper productId={id} name={name} quantity={quantity} max={data.stock} />
      ) : (
        <button type="button" className="btn" onClick={() => add({ productId: id, name, price })}>담기</button>
      )}
    </p>
  );
}
