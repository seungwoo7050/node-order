"use client";

import Link from "next/link";
import { LoadMore } from "@/app/load-more";
import { Stepper } from "@/app/shop/stepper";
import { useCartStore } from "@/lib/cart-store";
import { eulReul, won, type SortOption } from "@/lib/storefront-view-model";
import { StudioProductArtwork } from "../product-artwork";
import type { CatalogDesignProps } from "../types";
import styles from "./zavanas-archive.module.css";

export function ZavanasArchiveCatalog({
  categories,
  selectedCatId,
  selectedCatName,
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
      <div
        data-design="zavanas-archive"
        className={styles.root}
        aria-busy="true"
      >
        <div className={styles.shell}>
          <p className="font-mono text-xs text-slate-600">
            LOADING ARCHIVE SPEC MATRIX...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-design="zavanas-archive" className={styles.root}>
        <div className={styles.shell}>
          <p role="alert" className="alert font-mono">
            ARCHIVE LOAD ERROR:{" "}
            {String((error as { message?: string })?.message ?? error)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-design="zavanas-archive" className={styles.root}>
      <div className={styles.shell}>
        {/* Industrial Telemetry Header */}
        <section
          className={styles.telemetryBanner}
          aria-label="아카이브 스펙 매트릭스"
        >
          <div className={styles.telemetryTopBar}>
            <div>
              <span className={styles.orangeDot} />
              <span>SYSTEM: ONLINE // SPEC MATRIX EDITION 03</span>
            </div>
            <div>REF: ZAVANAS · DIETER RAMS INDUSTRIAL GRID</div>
          </div>

          <div className={styles.telemetryMain}>
            <div className={styles.telemetryHeadingBox}>
              <h2 className={styles.telemetryTitle}>
                ZAVANAS ARCHIVE SPEC MATRIX
              </h2>
              <p className={styles.telemetrySub}>
                고밀도 스펙 그리드 · 실시간 재고 및 옵션 SKU 매트릭스 ·
                하드웨어와 워크웨어의 기술적 파라미터를 정밀하게 대조합니다.
              </p>
            </div>

            <div className={styles.telemetryStats} aria-hidden="true">
              <div className={styles.statCell}>
                <span className={styles.statLabel}>INDEXED ITEMS</span>
                <span className={styles.statValue}>
                  {String(products.length).padStart(2, "0")} UNITS
                </span>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statLabel}>ACTIVE FILTER</span>
                <span className={styles.statValue}>
                  {selectedCatName || "ALL_SECTORS"}
                </span>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statLabel}>SORT PROTOCOL</span>
                <span className={styles.statValue}>{sort.toUpperCase()}</span>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statLabel}>LOCK ENGINE</span>
                <span className={styles.statValueOrange}>
                  SELECT FOR UPDATE
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Matrix Folder-Tab Navigation Bar */}
        <div
          data-testid="category-filter-bar"
          className={styles.matrixControlBar}
        >
          <div className={styles.folderTabs}>
            <button
              type="button"
              className={`${styles.folderTab} ${
                selectedCatId === null ? styles.folderTabActive : ""
              }`}
              onClick={() => onSelectCategory(null, null)}
            >
              [00] 전체
            </button>
            {categories.map((c, idx) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.folderTab} ${
                  selectedCatId === c.id ? styles.folderTabActive : ""
                }`}
                onClick={() => onSelectCategory(c.id, c.name)}
              >
                [{String(idx + 1).padStart(2, "0")}] {c.name}
              </button>
            ))}
          </div>

          <div className={styles.sortBox}>
            <span className="text-[#4b5563]">ORDER:</span>
            <select
              data-testid="sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className={styles.sortSelect}
            >
              <option value="latest">최신순 (LATEST)</option>
              <option value="price_asc">낮은 가격순 (PRICE ASC)</option>
              <option value="price_desc">높은 가격순 (PRICE DESC)</option>
              <option value="reviews">리뷰 많은순 (REVIEWS)</option>
            </select>
          </div>
        </div>

        {/* 4-Column Collapsed-Border Technical Spec Grid */}
        <ul className={styles.matrixGrid}>
          {products.map((p) => {
            const quantity =
              inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
            const soldOut = p.stock === 0;

            return (
              <li key={p.id} className={styles.matrixCell}>
                <div>
                  <div className={styles.cellHeader}>
                    <span className={styles.specId}>
                      SPEC #ARCH-{String(p.id).padStart(4, "0")}
                    </span>
                    <span
                      className={`${styles.statusBadge} ${
                        soldOut ? styles.statusOut : styles.statusOk
                      }`}
                    >
                      ● {soldOut ? "DEPLETED" : "ACTIVE"}
                    </span>
                  </div>

                  <Link
                    href={`/shop/${p.id}`}
                    tabIndex={-1}
                    aria-hidden="true"
                    className={styles.cadViewport}
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        width={320}
                        height={320}
                        className={styles.cadImg}
                        data-testid={`image-${p.id}`}
                      />
                    ) : (
                      <StudioProductArtwork
                        id={p.id}
                        design="zavanas-archive"
                      />
                    )}
                  </Link>

                  <div className={styles.specTable}>
                    <h3 className={styles.specTitle}>
                      <Link
                        href={`/shop/${p.id}`}
                        className={styles.specTitleLink}
                      >
                        {p.name}
                      </Link>
                    </h3>

                    <div className={styles.paramRow}>
                      <span className={styles.paramKey}>EDITION</span>
                      <span className={styles.paramVal}>REV.36 // MATRIX</span>
                    </div>

                    <div className={styles.paramRow}>
                      <span className={styles.paramKey}>UNIT PRICE</span>
                      <span className={styles.paramVal}>{won(p.price)}</span>
                    </div>

                    <div className={styles.paramRow}>
                      <span className={styles.paramKey}>INVENTORY</span>
                      <span className={styles.paramVal}>
                        {soldOut ? (
                          <span className="text-danger">[OUT OF STOCK]</span>
                        ) : (
                          <span>
                            QTY:{" "}
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

                    {(p.reviewCount ?? 0) > 0 && (
                      <div className={styles.paramRow}>
                        <span className={styles.paramKey}>RATING INDEX</span>
                        <span className={styles.paramValOrange}>
                          ★ {p.averageRating?.toFixed(1)} ({p.reviewCount})
                        </span>
                      </div>
                    )}

                    {p.variants && p.variants.length > 0 && (
                      <div className={styles.skuChipWrap}>
                        {p.variants.slice(0, 4).map((v) => (
                          <span key={v.id} className={styles.skuChip}>
                            {v.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.cellFooter}>
                  {soldOut ? (
                    <button
                      type="button"
                      className={styles.triggerBtn}
                      disabled
                    >
                      품절 (UNAVAILABLE)
                    </button>
                  ) : quantity > 0 ? (
                    <div className="flex items-center justify-between border border-[#111315] bg-[#f3f5f7] px-2.5 py-1">
                      <span className="text-[10px] font-bold">ALLOCATED</span>
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
                      className={styles.triggerBtn}
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

        <div className="mt-8 font-mono">
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
            className="fixed bottom-6 right-6 z-40 border-2 border-[#111315] bg-[#111315] px-5 py-3.5 text-xs font-mono text-white"
          >
            <span className={styles.orangeText}>[BAG_UPDATED]</span> {addedName}
            {eulReul(addedName)} 담았습니다.{" "}
            <Link
              href="/cart"
              className="ml-3 underline text-white font-bold"
            >
              장바구니 보기
            </Link>
            <button
              type="button"
              onClick={clearAdded}
              className="ml-3 text-xs opacity-70 hover:opacity-100 cursor-pointer"
            >
              [X]
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
