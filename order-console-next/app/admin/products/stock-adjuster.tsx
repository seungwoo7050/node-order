"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authFetch } from "@/lib/api-client";
import { productListOptions } from "@/lib/lists";
import { useTRPC } from "@/lib/trpc";

type Adjusted = { id: number; stock: number };

export function StockAdjuster({ productId, name, readOnly }: { productId: number; name: string; readOnly: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [delta, setDelta] = useState("");
  const value = Number(delta);
  const valid = delta !== "" && Number.isInteger(value) && value !== 0;

  const adjust = useMutation({
    mutationFn: (d: number) =>
      authFetch<Adjusted>(`/products/${productId}/stock-adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: d }),
      }),
    onSuccess: ({ stock }) => {
      setDelta("");
      queryClient.setQueryData(productListOptions(trpc).queryKey, (old) => old && {
        ...old,
        pages: old.pages.map((page) => ({ ...page, items: page.items.map((p) => (p.id === productId ? { ...p, stock } : p)) })),
      });
    },
  });

  return (
    <form className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); if (valid && !adjust.isPending) adjust.mutate(value); }}>
      <label htmlFor={`stock-delta-${productId}`} className="sr-only">{name} 재고 조정 수량(입고는 +, 빼기는 -)</label>
      <input id={`stock-delta-${productId}`} type="number" step={1} inputMode="numeric" placeholder="+40"
        className="num w-20 border border-line px-2 py-1 text-sm" data-testid={`stock-delta-${productId}`}
        value={delta} onChange={(e) => setDelta(e.target.value)}
        disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
      <button type="submit" className="btn" disabled={readOnly} aria-disabled={adjust.isPending || !valid}>
        {adjust.isPending ? "반영 중…" : "반영"}
      </button>
      {adjust.error && <span role="alert" className="text-[0.82rem] text-danger" data-testid={`stock-error-${productId}`}>{adjust.error.message}</span>}
    </form>
  );
}
