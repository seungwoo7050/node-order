"use client";

import Link from "next/link";
import { useCartStore } from "@/lib/cart-store";
import { LoadMore } from "@/app/load-more";
import { Stepper } from "@/app/shop/stepper";
import { eulReul, won, type SortOption } from "@/lib/storefront-view-model";
import type { CatalogDesignProps } from "../types";

export function EditorialAtelierCatalog({
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
  storeInfo,
  handleAddToCart,
  addedName,
  clearAdded,
}: CatalogDesignProps) {
  const inCart = useCartStore((s) => s.items);

  const heroTitle = storeInfo?.heroTitle ?? "CONTEMPORARY ARCHIVE COLLECTION";
  const heroSubtitle =
    storeInfo?.heroSubtitle ?? "소재의 본질과 절제된 실루엣에 집중한 데일리 에센셜 아카이브";

  if (isPending) {
    return (
      <div data-design="editorial-atelier" className="py-12" aria-busy="true">
        <p className="text-sm text-neutral-500 font-light">컬렉션을 준비 중입니다.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div data-design="editorial-atelier" className="py-12">
        <p role="alert" className="alert">
          컬렉션을 불러오지 못했습니다. ({String((error as { message?: string })?.message ?? error)})
        </p>
      </div>
    );
  }

  return (
    <div data-design="editorial-atelier" className="font-sans antialiased text-[#111111]">
      {/* Campaign Hero Banner */}
      <section
        data-testid="hero-banner"
        className="mb-12 border-y border-[#111111] bg-[#f9f9f9] px-6 py-14 text-center sm:px-12 sm:py-20"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-neutral-500">
          EDITORIAL CAMPAIGN
        </span>
        <h2 className="mt-3 font-serif text-3xl font-normal tracking-tight text-[#111111] sm:text-5xl">
          {heroTitle}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-xs font-light tracking-wide text-neutral-600 sm:text-sm">
          {heroSubtitle}
        </p>
      </section>

      {/* Category Navigation Bar & Sort Controls */}
      <div
        data-testid="category-filter-bar"
        className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-[#e5e5e5] pb-4 text-xs"
      >
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className={`tracking-[0.1em] uppercase transition-colors cursor-pointer ${
              selectedCatId === null
                ? "font-semibold text-[#111111] underline underline-offset-4"
                : "text-neutral-500 hover:text-[#111111]"
            }`}
            onClick={() => onSelectCategory(null, null)}
          >
            전체
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`tracking-[0.1em] uppercase transition-colors cursor-pointer ${
                selectedCatId === c.id
                  ? "font-semibold text-[#111111] underline underline-offset-4"
                  : "text-neutral-500 hover:text-[#111111]"
              }`}
              onClick={() => onSelectCategory(c.id, c.name)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-neutral-500 font-mono text-[11px]">SORT BY</span>
          <select
            data-testid="sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="border border-[#111111] bg-white px-2.5 py-1 text-xs text-[#111111]"
          >
            <option value="latest">최신순</option>
            <option value="price_asc">낮은 가격순</option>
            <option value="price_desc">높은 가격순</option>
            <option value="reviews">리뷰 많은순</option>
          </select>
        </div>
      </div>

      {/* Lookbook 3:4 Portrait Grid */}
      <ul className="grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 md:grid-cols-3">
        {products.map((p) => {
          const quantity = inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
          const soldOut = p.stock === 0;

          return (
            <li key={p.id} className="group flex flex-col justify-between">
              <div>
                <Link
                  href={`/shop/${p.id}`}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="block aspect-[3/4] w-full overflow-hidden bg-[#f4f4f4] relative no-underline"
                >
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      width={300}
                      height={400}
                      className="aspect-[3/4] size-full object-cover transition-transform duration-500 group-hover:scale-105"
                      data-testid={`image-${p.id}`}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="grid aspect-[3/4] size-full place-items-center font-serif text-4xl text-neutral-300"
                    >
                      {p.name.slice(0, 1)}
                    </span>
                  )}
                  {soldOut && (
                    <span className="absolute left-3 top-3 bg-[#111111] px-2 py-1 text-[10px] font-medium tracking-wider text-white uppercase">
                      SOLD OUT
                    </span>
                  )}
                </Link>

                <div className="mt-4 space-y-1">
                  <h3 className="font-serif text-base font-normal tracking-tight text-[#111111]">
                    <Link href={`/shop/${p.id}`} className="no-underline hover:opacity-70">
                      {p.name}
                    </Link>
                  </h3>
                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="num font-medium text-[#111111]">{won(p.price)}</span>
                    <span className="text-[11px] text-neutral-500">
                      {soldOut ? (
                        <span className="text-danger">품절</span>
                      ) : (
                        <span>
                          재고 <span className="num" data-testid={`stock-${p.id}`}>{p.stock}</span>
                        </span>
                      )}
                    </span>
                  </div>
                  {(p.reviewCount ?? 0) > 0 && (
                    <p className="text-[11px] text-amber-700">
                      ★ {p.averageRating?.toFixed(1)} ({p.reviewCount})
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-2 border-t border-[#f0f0f0]">
                {soldOut ? (
                  <button type="button" className="btn w-full text-xs" disabled>
                    품절
                  </button>
                ) : quantity > 0 ? (
                  <Stepper productId={p.id} name={p.name} quantity={quantity} max={p.stock ?? 0} />
                ) : (
                  <button
                    type="button"
                    className="btn w-full border border-[#111111] bg-[#111111] py-2 text-xs font-normal tracking-wider text-white hover:bg-neutral-800"
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

      <div className="mt-12">
        <LoadMore
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          isFetchNextPageError={isFetchNextPageError}
          fetchNextPage={fetchNextPage}
          loaded={products.length}
          pages={1}
          noun="컬렉션"
        />
      </div>

      {addedName && (
        <p
          role="status"
          className="sticky bottom-4 ml-auto mt-6 w-fit max-w-full border border-[#111111] bg-[#111111] px-5 py-3 text-xs tracking-wide text-white"
        >
          {addedName}
          {eulReul(addedName)} 담았습니다.{" "}
          <Link href="/cart" className="ml-3 underline text-white font-medium">
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
