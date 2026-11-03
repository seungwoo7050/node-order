"use client";

import Link from "next/link";
import { useCartStore } from "@/lib/cart-store";
import { LoadMore } from "@/app/load-more";
import { Stepper } from "@/app/shop/stepper";
import { eulReul, won, type SortOption } from "@/lib/storefront-view-model";
import type { CatalogDesignProps } from "../types";

export function ZavanasArchiveCatalog({
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
      <div data-design="zavanas-archive" className="py-8 font-mono text-xs text-slate-500" aria-busy="true">
        LOADING ARCHIVE SPEC MATRIX...
      </div>
    );
  }

  if (error) {
    return (
      <div data-design="zavanas-archive" className="py-8 font-mono">
        <p role="alert" className="alert">
          ARCHIVE LOAD ERROR: {String((error as { message?: string })?.message ?? error)}
        </p>
      </div>
    );
  }

  return (
    <div data-design="zavanas-archive" className="font-sans antialiased text-[#0f172a]">
      {/* Matrix Navigation Bar */}
      <div
        data-testid="category-filter-bar"
        className="mb-8 border border-slate-300 bg-white p-3 font-mono text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className={`px-3 py-1 font-mono transition-colors cursor-pointer ${
                selectedCatId === null
                  ? "bg-[#0f172a] text-white font-semibold"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              }`}
              onClick={() => onSelectCategory(null, null)}
            >
              [00] 전체
            </button>
            {categories.map((c, idx) => (
              <button
                key={c.id}
                type="button"
                className={`px-3 py-1 font-mono transition-colors cursor-pointer ${
                  selectedCatId === c.id
                    ? "bg-[#0f172a] text-white font-semibold"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                }`}
                onClick={() => onSelectCategory(c.id, c.name)}
              >
                [{String(idx + 1).padStart(2, "0")}] {c.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-mono text-[11px]">ORDER:</span>
            <select
              data-testid="sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className="border border-slate-300 bg-white px-2 py-1 text-xs font-mono text-slate-800"
            >
              <option value="latest">최신순 (LATEST)</option>
              <option value="price_asc">낮은 가격순 (PRICE ASC)</option>
              <option value="price_desc">높은 가격순 (PRICE DESC)</option>
              <option value="reviews">리뷰 많은순 (REVIEWS)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Technical Spec Matrix Grid */}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => {
          const quantity = inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
          const soldOut = p.stock === 0;

          return (
            <li
              key={p.id}
              className="flex flex-col justify-between border border-slate-300 bg-white p-4 font-mono transition-shadow hover:border-slate-400"
            >
              <div>
                <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-[10px] text-slate-400 font-mono">
                  <span>SPEC #ARCH-{String(p.id).padStart(4, "0")}</span>
                  <span>ACTIVE</span>
                </div>

                <Link
                  href={`/shop/${p.id}`}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="mt-3 block aspect-square w-full overflow-hidden bg-slate-50 relative border border-slate-200"
                >
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      width={250}
                      height={250}
                      className="aspect-square size-full object-cover"
                      data-testid={`image-${p.id}`}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="grid aspect-square size-full place-items-center font-mono text-4xl text-slate-300"
                    >
                      {p.name.slice(0, 1)}
                    </span>
                  )}
                </Link>

                <div className="mt-3 space-y-1.5">
                  <h3 className="font-sans text-sm font-semibold text-slate-900 tracking-tight">
                    <Link href={`/shop/${p.id}`} className="no-underline hover:text-slate-600">
                      {p.name}
                    </Link>
                  </h3>

                  <div className="flex items-baseline justify-between pt-1">
                    <span className="num font-mono text-sm font-bold text-slate-900">
                      {won(p.price)}
                    </span>
                    <span className="text-[11px] font-mono">
                      {soldOut ? (
                        <span className="text-danger font-bold">[OUT OF STOCK]</span>
                      ) : (
                        <span className="text-slate-600">
                          QTY: <span className="num font-bold text-slate-900" data-testid={`stock-${p.id}`}>{p.stock}</span>
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Spec Option Chips */}
                  {p.variants && p.variants.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {p.variants.map((v) => (
                        <span
                          key={v.id}
                          className="border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] text-slate-600 font-mono"
                        >
                          {v.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {(p.reviewCount ?? 0) > 0 && (
                    <div className="text-[11px] text-amber-700 font-mono">
                      INDEX ★{p.averageRating?.toFixed(1)} / {p.reviewCount} REVIEWS
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200">
                {soldOut ? (
                  <button type="button" className="btn w-full font-mono text-xs" disabled>
                    품절 (UNAVAILABLE)
                  </button>
                ) : quantity > 0 ? (
                  <Stepper productId={p.id} name={p.name} quantity={quantity} max={p.stock ?? 0} />
                ) : (
                  <button
                    type="button"
                    className="btn w-full border border-slate-900 bg-slate-900 py-2 text-xs font-mono font-medium text-white hover:bg-slate-800"
                    onClick={() => handleAddToCart(p)}
                  >
                    담기 (ADD TO CART)
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
          noun="아카이브 항목"
        />
      </div>

      {addedName && (
        <p
          role="status"
          className="sticky bottom-4 ml-auto mt-6 w-fit max-w-full border border-slate-900 bg-slate-900 px-4 py-3 text-xs font-mono text-white"
        >
          [CART] {addedName}
          {eulReul(addedName)} 추가했습니다.{" "}
          <Link href="/cart" className="ml-3 underline text-white font-bold">
            CHECKOUT
          </Link>
          <button
            type="button"
            onClick={clearAdded}
            className="ml-3 text-xs opacity-70 hover:opacity-100"
          >
            DISMISS
          </button>
        </p>
      )}
    </div>
  );
}
