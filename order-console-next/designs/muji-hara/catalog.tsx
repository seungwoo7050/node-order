"use client";

import Link from "next/link";
import { useCartStore } from "@/lib/cart-store";
import { LoadMore } from "@/app/load-more";
import { Stepper } from "@/app/shop/stepper";
import { eulReul, won, type SortOption } from "@/lib/storefront-view-model";
import type { CatalogDesignProps } from "../types";

export function MujiHaraCatalog({
  categories,
  selectedCatId,
  onSelectCategory,
  sort,
  setSort,
  products,
  isPending,
  error,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  fetchNextPage,
  handleAddToCart,
  addedName,
  clearAdded,
}: CatalogDesignProps) {
  const inCart = useCartStore((s) => s.items);

  if (isPending) {
    return (
      <div data-design="muji-hara" className="py-8" aria-busy="true">
        <p className="text-sm text-muted">카탈로그를 정돈하여 불러오는 중입니다.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div data-design="muji-hara" className="py-8">
        <p role="alert" className="alert">
          상품을 불러오지 못했습니다. ({String((error as { message?: string })?.message ?? error)})
        </p>
      </div>
    );
  }

  return (
    <div data-design="muji-hara" className="font-sans antialiased text-[#2c2b29]">
      {/* Category Filter Bar */}
      <div
        data-testid="category-filter-bar"
        className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-[#e8e6df] pb-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`px-3 py-1 text-xs tracking-wider transition-colors cursor-pointer ${
              selectedCatId === null
                ? "border-b border-[#2c2b29] font-medium text-[#2c2b29]"
                : "text-muted hover:text-[#2c2b29]"
            }`}
            onClick={() => onSelectCategory(null, null)}
          >
            전체
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`px-3 py-1 text-xs tracking-wider transition-colors cursor-pointer ${
                selectedCatId === c.id
                  ? "border-b border-[#2c2b29] font-medium text-[#2c2b29]"
                  : "text-muted hover:text-[#2c2b29]"
              }`}
              onClick={() => onSelectCategory(c.id, c.name)}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Sort Select */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted">정렬</span>
          <select
            data-testid="sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="border border-[#e8e6df] bg-[#fbfbfa] px-2 py-1 text-xs text-[#2c2b29]"
          >
            <option value="latest">최신순</option>
            <option value="price_asc">낮은 가격순</option>
            <option value="price_desc">높은 가격순</option>
            <option value="reviews">리뷰 많은순</option>
          </select>
        </div>
      </div>

      {/* Product List */}
      <ul className="grid grid-cols-1 divide-y divide-[#e8e6df] border-t border-[#e8e6df]">
        {products.map((p) => {
          const quantity = inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
          const soldOut = p.stock === 0;

          return (
            <li
              key={p.id}
              className="grid grid-cols-[80px_minmax(0,1fr)_auto] items-center gap-6 py-6 transition-colors hover:bg-[#f7f6f2]/50"
            >
              <div className="relative aspect-square w-20 shrink-0 overflow-hidden bg-[#f4f4f2]">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.imageUrl}
                    alt={p.name}
                    width={80}
                    height={80}
                    className="aspect-square size-20 object-cover"
                    data-testid={`image-${p.id}`}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid size-20 place-items-center font-serif text-2xl text-faint"
                  >
                    {p.name.slice(0, 1)}
                  </span>
                )}
              </div>

              <div className="min-w-0 pr-4">
                <p className="font-serif text-base font-normal tracking-tight text-[#2c2b29]">
                  <Link href={`/shop/${p.id}`} className="no-underline hover:underline">
                    {p.name}
                  </Link>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 text-xs text-muted">
                  <span className="num font-medium text-[#2c2b29]">{won(p.price)}</span>
                  {soldOut ? (
                    <span className="text-danger font-medium">품절</span>
                  ) : (
                    <span>
                      재고 <span className="num" data-testid={`stock-${p.id}`}>{p.stock}</span>
                    </span>
                  )}
                  {(p.reviewCount ?? 0) > 0 && (
                    <span className="text-amber-700">
                      ★ {p.averageRating?.toFixed(1)} ({p.reviewCount})
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {soldOut ? (
                  <button type="button" className="btn" disabled>
                    품절
                  </button>
                ) : quantity > 0 ? (
                  <Stepper productId={p.id} name={p.name} quantity={quantity} max={p.stock ?? 0} />
                ) : (
                  <button
                    type="button"
                    className="btn border border-[#2c2b29] bg-transparent px-4 py-2 text-xs font-normal text-[#2c2b29] hover:bg-[#2c2b29] hover:text-[#fbfbfa]"
                    onClick={() => handleAddToCart(p)}
                  >
                    담기
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-8">
        <LoadMore
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          isFetchNextPageError={isFetchNextPageError}
          fetchNextPage={fetchNextPage}
          loaded={products.length}
          pages={1}
          noun="상품"
        />
      </div>

      {addedName && (
        <p
          role="status"
          className="sticky bottom-4 ml-auto mt-6 w-fit max-w-full border border-[#2c2b29] bg-[#2c2b29] px-4 py-3 text-xs text-[#fbfbfa]"
        >
          {addedName}
          {eulReul(addedName)} 담았습니다.{" "}
          <Link href="/cart" className="ml-3 underline text-[#fbfbfa]">
            장바구니 보기
          </Link>
          <button
            type="button"
            onClick={clearAdded}
            className="ml-3 text-xs opacity-70 hover:opacity-100"
          >
            닫기
          </button>
        </p>
      )}
    </div>
  );
}
