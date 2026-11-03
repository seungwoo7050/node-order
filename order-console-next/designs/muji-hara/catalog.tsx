"use client";

import Link from "next/link";
import { LoadMore } from "@/app/load-more";
import { Stepper } from "@/app/shop/stepper";
import { useCartStore } from "@/lib/cart-store";
import { eulReul, won, type SortOption } from "@/lib/storefront-view-model";
import { StudioProductArtwork } from "../product-artwork";
import type { CatalogDesignProps } from "../types";
import styles from "./muji-hara.module.css";

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
      <div data-design="muji-hara" className={styles.root} aria-busy="true">
        <div className={`${styles.shell} ${styles.statusPad}`}>
          <p className="text-sm text-muted">
            카탈로그를 정돈하여 불러오는 중입니다.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-design="muji-hara" className={styles.root}>
        <div className={`${styles.shell} ${styles.statusPad}`}>
          <p role="alert" className="alert">
            상품을 불러오지 못했습니다. (
            {String((error as { message?: string })?.message ?? error)})
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-design="muji-hara" className={styles.root}>
      <div className={styles.shell}>
        {/* Tactile Washi Philosophy Banner */}
        <section className={styles.manifestoBar} aria-label="브랜드 철학">
          <div className={styles.crimsonSeal} aria-hidden="true">
            <span>無印</span>
            <span>標本</span>
          </div>
          <div className={styles.manifestoCopy}>
            <span className={styles.manifestoKicker}>
              生活の原型 · TACTILE DAILY OBJECT ARCHIVE
            </span>
            <h2 className={styles.manifestoTitle}>
              소재의 결을 살리고 과잉을 덜어낸 생활 도감
            </h2>
            <p className={styles.manifestoDesc}>
              표백하지 않은 종이의 온기와 절제된 비례. 매일 손이 닿는 사물과 의복의
              원형(Archetype)을 채집하여 소재 사양과 치수를 정직하게 기록합니다.
            </p>
          </div>
          <div className={styles.manifestoStamp} aria-hidden="true">
            <div>EDITION 02 // HARA KENYA</div>
            <div>PAPER: UNBLEACHED WASHI</div>
            <div>RECORDS: {products.length} ITEMS</div>
          </div>
        </section>

        {/* Category Filter & Sort Bar */}
        <div data-testid="category-filter-bar" className={styles.filterBar}>
          <div className={styles.categoryPills}>
            <button
              type="button"
              className={`${styles.catBtn} ${
                selectedCatId === null ? styles.catBtnActive : ""
              }`}
              onClick={() => onSelectCategory(null, null)}
            >
              전체
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.catBtn} ${
                  selectedCatId === c.id ? styles.catBtnActive : ""
                }`}
                onClick={() => onSelectCategory(c.id, c.name)}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5 text-xs">
            <span className="text-[#6b6358] font-mono text-[11px]">
              정렬 기준
            </span>
            <select
              data-testid="sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className={styles.sortSelect}
            >
              <option value="latest">최신순</option>
              <option value="price_asc">낮은 가격순</option>
              <option value="price_desc">높은 가격순</option>
              <option value="reviews">리뷰 많은순</option>
            </select>
          </div>
        </div>

        {/* 3-Column Collapsed-Border Washi Specimen Grid */}
        <ul className={styles.specimenGrid}>
          {products.map((p) => {
            const quantity =
              inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
            const soldOut = p.stock === 0;

            return (
              <li key={p.id} className={styles.specimenCell}>
                <div>
                  <div className={styles.cellHeader}>
                    <span className={styles.specimenCode}>
                      標本 NO.{String(p.id).padStart(3, "0")}
                    </span>
                    <span className={styles.specimenCat}>WASHI ARCHIVE</span>
                  </div>

                  <Link
                    href={`/shop/${p.id}`}
                    tabIndex={-1}
                    aria-hidden="true"
                    className={styles.squareFrame}
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        width={360}
                        height={360}
                        className={styles.squareImg}
                        data-testid={`image-${p.id}`}
                      />
                    ) : (
                      <StudioProductArtwork id={p.id} design="muji-hara" />
                    )}
                  </Link>

                  <div className={styles.cellBody}>
                    <h3 className={styles.itemTitle}>
                      <Link
                        href={`/shop/${p.id}`}
                        className={styles.itemTitleLink}
                      >
                        {p.name}
                      </Link>
                    </h3>

                    {p.materialInfo && (
                      <p className={styles.itemDesc}>{p.materialInfo}</p>
                    )}

                    <div className={styles.ledgerRow}>
                      <span className={styles.itemPrice}>{won(p.price)}</span>
                      <div className={styles.itemMeta}>
                        {(p.reviewCount ?? 0) > 0 && (
                          <span className="text-[#7f1d1d] font-medium">
                            ★ {p.averageRating?.toFixed(1)} ({p.reviewCount})
                          </span>
                        )}
                        {soldOut ? (
                          <span className="text-danger font-medium">품절</span>
                        ) : (
                          <span>
                            재고{" "}
                            <span
                              className="num font-medium text-[#26231f]"
                              data-testid={`stock-${p.id}`}
                            >
                              {p.stock}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.cellAction}>
                  {soldOut ? (
                    <button
                      type="button"
                      className={styles.tactileBtn}
                      disabled
                    >
                      품절
                    </button>
                  ) : quantity > 0 ? (
                    <div className="flex w-full items-center justify-between border border-[#cec3ae] bg-[#f3eee4] px-3 py-1">
                      <span className="text-[11px] text-[#6b6358]">
                        담은 수량
                      </span>
                      <Stepper
                        productId={p.id}
                        name={p.name}
                        quantity={quantity}
                        max={p.stock ?? 0}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.tactileBtn}
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

        <div className="mt-10">
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
            className="fixed bottom-6 right-6 z-40 border border-[#7f1d1d] bg-[#26231f] px-5 py-3.5 text-xs text-[#f7f3eb]"
          >
            {addedName}
            {eulReul(addedName)} 담았습니다.{" "}
            <Link href="/cart" className="ml-3 underline text-[#f7f3eb]">
              장바구니 보기
            </Link>
            <button
              type="button"
              onClick={clearAdded}
              className="ml-3 text-xs opacity-70 hover:opacity-100 cursor-pointer"
            >
              닫기
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
