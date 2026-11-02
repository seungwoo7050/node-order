"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useCartStore } from "@/lib/cart-store";
import { useTRPC } from "@/lib/trpc";
import { Stepper } from "./stepper";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

type Variant = {
  id: number;
  name: string;
  sku: string;
  priceDelta: number;
  stock: number;
  sortOrder: number;
};

export function BuyBox({
  id,
  name,
  price,
  variants,
}: {
  id: number;
  name: string;
  price: number;
  variants?: Variant[];
}) {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.products.byId.queryOptions({ id }));

  const productData = data as ({ variants?: Variant[]; stock?: number } | undefined);
  const allVariants: Variant[] = productData?.variants ?? variants ?? [];
  const hasVariants = allVariants.length > 0;

  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(() =>
    allVariants.length > 0 ? allVariants[0].id : null,
  );

  const selectedVariant = allVariants.find((v) => v.id === selectedVariantId) ?? allVariants[0] ?? null;

  const currentPrice = price + (selectedVariant?.priceDelta ?? 0);
  const currentStock = selectedVariant ? selectedVariant.stock : (data?.stock ?? 0);

  const quantity = useCartStore((s) =>
    s.items.find(
      (i) => i.productId === id && (i.variantId ?? 0) === (selectedVariant?.id ?? 0),
    )?.quantity ?? 0,
  );
  const add = useCartStore((s) => s.add);

  if (isPending) return <p role="status" className="text-sm text-muted">재고를 확인하는 중입니다.</p>;
  if (error) return <p role="alert" className="alert">재고를 확인하지 못했습니다. ({error.message})</p>;

  return (
    <div className="grid gap-3">
      {hasVariants && (
        <label className="grid gap-1">
          <span className="text-xs text-muted font-medium">옵션 선택</span>
          <select
            data-testid="variant-select"
            className="border border-line bg-bg px-2.5 py-1.5 text-sm rounded"
            value={selectedVariant?.id ?? ""}
            onChange={(e) => setSelectedVariantId(Number(e.target.value))}
          >
            {allVariants.map((v) => (
              <option key={v.id} value={v.id} disabled={v.stock === 0}>
                {v.name} {v.priceDelta !== 0 ? `(${v.priceDelta > 0 ? "+" : ""}${won(v.priceDelta)})` : ""} {v.stock === 0 ? "[품절]" : `(재고 ${v.stock}개)`}
              </option>
            ))}
          </select>
        </label>
      )}

      {selectedVariant && selectedVariant.priceDelta !== 0 && (
        <p className="text-sm font-medium text-fg">
          옵션 적용가: <span className="num font-semibold">{won(currentPrice)}</span>
        </p>
      )}

      {currentStock === 0 ? (
        <p className="flex items-center gap-3">
          <span className="text-sm text-muted">품절</span>
          <button type="button" className="btn" disabled>
            품절
          </button>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">
            재고 <span className="num" data-testid={`detail-stock-${id}`}>{currentStock}</span>
          </span>
          {quantity > 0 ? (
            <Stepper
              productId={id}
              name={selectedVariant ? `${name} (${selectedVariant.name})` : name}
              quantity={quantity}
              max={currentStock}
            />
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                add({
                  productId: id,
                  name,
                  price: currentPrice,
                  variantId: selectedVariant?.id,
                  variantLabel: selectedVariant?.name,
                })
              }
            >
              담기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
