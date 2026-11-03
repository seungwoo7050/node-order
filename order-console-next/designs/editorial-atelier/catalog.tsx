"use client";

import Link from "next/link";
import { LoadMore } from "@/app/load-more";
import { Stepper } from "@/app/shop/stepper";
import { useCartStore } from "@/lib/cart-store";
import { eulReul, won, type SortOption } from "@/lib/storefront-view-model";
import { StudioProductArtwork } from "../product-artwork";
import type { CatalogDesignProps } from "../types";
import styles from "./editorial-atelier.module.css";

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

  const heroTitle =
    storeInfo?.heroTitle || "CONTEMPORARY ARCHIVE COLLECTION";
  const heroSubtitle =
    storeInfo?.heroSubtitle ||
    "소재의 물성과 구조적인 실루엣의 균형을 탐구하는 서울 컨템포러리 아틀리에 컬렉션. 불필요한 장식을 덜어내고 일상의 밀도를 높이는 에센셜 아카이브를 제안합니다.";

  if (isPending) {
    return (
      <div
        data-design="editorial-atelier"
        className={styles.root}
        aria-busy="true"
      >
        <div className={`${styles.shell} ${styles.statusPad}`}>
          <p className="text-sm text-muted">컬렉션을 준비 중입니다.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-design="editorial-atelier" className={styles.root}>
        <div className={`${styles.shell} ${styles.statusPad}`}>
          <p role="alert" className="alert">
            컬렉션을 불러오지 못했습니다. (
            {String((error as { message?: string })?.message ?? error)})
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-design="editorial-atelier" className={styles.root}>
      {/* Asymmetric Full-Bleed Campaign Hero Spread */}
      <section data-testid="hero-banner" className={styles.heroSpread}>
        <div className={styles.heroCopy}>
          <div>
            <div className={styles.heroEyebrow}>
              <span className={styles.heroRule} />
              <span>EDITION 01 // 26 AW EDITORIAL CAMPAIGN</span>
            </div>
            <h2 className={styles.heroHeadline}>{heroTitle}</h2>
            <p className={styles.heroSubtitle}>{heroSubtitle}</p>
          </div>

          <div className={styles.heroMetaGrid}>
            <div className={styles.heroMetaCell}>
              <span className={styles.heroMetaLabel}>SILHOUETTE</span>
              <span className={styles.heroMetaValue}>
                Relaxed Tailoring & Proportion
              </span>
            </div>
            <div className={styles.heroMetaCell}>
              <span className={styles.heroMetaLabel}>FABRICATION</span>
              <span className={styles.heroMetaValue}>
                Natural Wool · Crisp Poplin
              </span>
            </div>
            <div className={styles.heroMetaCell}>
              <span className={styles.heroMetaLabel}>ARCHIVE VOL.</span>
              <span className={styles.heroMetaValue}>
                {products.length} Curated Pieces
              </span>
            </div>
          </div>
        </div>

        <div className={styles.heroVisual} aria-hidden="true">
          <div className={styles.heroVisualFrame}>
            <StudioProductArtwork id={101} design="editorial-atelier" />
            <div className={styles.heroSecondPlate}>
              <StudioProductArtwork id={102} design="editorial-atelier" />
            </div>
          </div>
          <div className={styles.heroVisualCaption}>
            <span>SEOUL ATELIER LOOKBOOK PLATES I–II</span>
            <span>PHOTOGRAPHY & GARMENT STUDY</span>
          </div>
        </div>
      </section>

      <div className={styles.shell}>
        {/* Category Navigation & Sort Bar */}
        <div data-testid="category-filter-bar" className={styles.filterBar}>
          <div className={styles.categoryTabs}>
            <button
              type="button"
              className={`${styles.catTab} ${
                selectedCatId === null ? styles.catTabActive : ""
              }`}
              onClick={() => onSelectCategory(null, null)}
            >
              <span className={styles.catIndex}>00</span>
              전체
            </button>
            {categories.map((c, idx) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.catTab} ${
                  selectedCatId === c.id ? styles.catTabActive : ""
                }`}
                onClick={() => onSelectCategory(c.id, c.name)}
              >
                <span className={styles.catIndex}>
                  {String(idx + 1).padStart(2, "0")}
                </span>
                {c.name}
              </button>
            ))}
          </div>

          <div className={styles.sortWrap}>
            <span className={styles.sortLabel}>SORT BY</span>
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

        {/* 4-Column 3:4 Portrait Lookbook Grid */}
        <ul className={styles.lookbookGrid}>
          {products.map((p, idx) => {
            const quantity =
              inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
            const soldOut = p.stock === 0;

            return (
              <li key={p.id} className={styles.card}>
                <div>
                  <Link
                    href={`/shop/${p.id}`}
                    tabIndex={-1}
                    aria-hidden="true"
                    className={styles.mediaLink}
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        width={420}
                        height={560}
                        className={styles.mediaImg}
                        data-testid={`image-${p.id}`}
                      />
                    ) : (
                      <StudioProductArtwork
                        id={p.id}
                        design="editorial-atelier"
                      />
                    )}
                    {soldOut && (
                      <span className={styles.soldOutTag}>SOLD OUT</span>
                    )}
                  </Link>

                  <div className={styles.cardBody}>
                    <div className={styles.cardEyebrow}>
                      <span>
                        LOOK {String(idx + 1).padStart(2, "0")} · ARCHIVE
                      </span>
                      {(p.reviewCount ?? 0) > 0 && (
                        <span>
                          ★ {p.averageRating?.toFixed(1)} ({p.reviewCount})
                        </span>
                      )}
                    </div>

                    <h3 className={styles.cardTitle}>
                      <Link
                        href={`/shop/${p.id}`}
                        className={styles.cardTitleLink}
                      >
                        {p.name}
                      </Link>
                    </h3>

                    {p.materialInfo && (
                      <p className="text-[11px] text-[#7a746b] line-clamp-1">
                        {p.materialInfo}
                      </p>
                    )}

                    <div className={styles.cardPriceRow}>
                      <span className={styles.cardPrice}>{won(p.price)}</span>
                      <span className={styles.cardStock}>
                        {soldOut ? (
                          <span className="text-danger">품절</span>
                        ) : (
                          <span>
                            재고{" "}
                            <span
                              className="num"
                              data-testid={`stock-${p.id}`}
                            >
                              {p.stock}
                            </span>
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <div className={styles.cardAction}>
                  {soldOut ? (
                    <button type="button" className={styles.addBtn} disabled>
                      품절
                    </button>
                  ) : quantity > 0 ? (
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                        IN BAG
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
                      className={styles.addBtn}
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

        <div className="mt-14">
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
            className="fixed bottom-6 right-6 z-40 border border-[#141413] bg-[#141413] px-5 py-3.5 text-xs tracking-wide text-[#f6f4f0]"
          >
            {addedName}
            {eulReul(addedName)} 담았습니다.{" "}
            <Link
              href="/cart"
              className="ml-3 underline text-[#f6f4f0] font-medium"
            >
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
