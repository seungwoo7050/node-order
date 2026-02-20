"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";
import { useReadOnly } from "./admin-only";
import { StockAdjuster } from "./stock-adjuster";

export function StockCell({ productId, name }: { productId: number; name: string }) {
  const trpc = useTRPC();
  const readOnly = useReadOnly();
  const { data } = useQuery(trpc.products.byId.queryOptions({ id: productId }));
  return (
    <>
      <td className="num hidden py-3 sm:table-cell" data-testid={`admin-stock-${productId}`}>{data?.stock ?? ""}</td>
      <td className="hidden py-3 sm:table-cell"><StockAdjuster productId={productId} name={name} readOnly={readOnly} /></td>
    </>
  );
}
