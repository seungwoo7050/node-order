"use client";

import Link from "next/link";
import { LoadMore } from "@/app/load-more";
import { Stepper } from "@/app/shop/stepper";
import { useCartStore } from "@/lib/cart-store";
import { eulReul, won, type SortOption } from "@/lib/storefront-view-model";
import type { CatalogDesignProps } from "../types";
import styles from "./zavanas-archive.module.css";

const SORT_LABEL: Record<SortOption, string> = {
  latest: "신상품",
  price_asc: "낮은 가격순",
  price_desc: "높은 가격순",
  reviews: "리뷰 많은순",
};

export type ZavanasArchiveCatalogProps = CatalogDesignProps;

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
  storeInfo,
  handleAddToCart,
  addedName,
  clearAdded,
  linkFor = (href: string) => href,
}: ZavanasArchiveCatalogProps) {
  const inCart = useCartStore((s) => s.items);

  const storeName = storeInfo?.storeName ?? "ZAVANAS";
  const heroTitle = storeInfo?.heroTitle ?? storeName;
  const bannerSub =
    storeInfo?.heroSubtitle ??
    "자바나스가 제안하는 클래식 미니멀 베이직 라인업입니다. 불필요한 디테일을 절제하고 본질적인 실루엣과 소재의 완성도에 집중합니다.";

  return (
    <div
      data-design="zavanas-archive"
      className={styles.root}
      aria-busy={isPending ? "true" : undefined}
    >
      <div className={styles.wrap}>
        <section className={styles.banner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/storefront/zavanas/banner-01.webp"
            alt=""
            width={2400}
            height={800}
            className={styles.bannerImg}
            loading="eager"
          />
          <div className={styles.bannerCopy}>
            <p className={styles.eyebrow}>MAIN VISUAL</p>
            <span className={styles.rule} aria-hidden="true" />
            <p className={styles.kicker}>{storeName}</p>
            <h2 className={styles.bannerTitle}>{heroTitle}</h2>
            <p className={styles.bannerSub}>{bannerSub}</p>
            <a href="#zv-list" className={styles.btnSolid}>
              컬렉션 보기 →
            </a>
          </div>
        </section>

        <div id="zv-list" className={styles.headRow}>
          <div className={styles.heading}>
            <span className={styles.dash} aria-hidden="true">
              —
            </span>
            <h2 className={styles.headingText}>
              {selectedCatName ?? SORT_LABEL[sort]}
            </h2>
          </div>
        </div>

        <div data-testid="category-filter-bar" className={styles.filters}>
          <button
            type="button"
            className={`${styles.filter} ${
              selectedCatId === null ? styles.filterOn : ""
            }`}
            onClick={() => onSelectCategory(null, null)}
          >
            전체
          </button>
          {categories.map((c) => (
            <span key={c.id} className={styles.filterItem}>
              <span className={styles.sep} aria-hidden="true">
                |
              </span>
              <button
                type="button"
                className={`${styles.filter} ${
                  selectedCatId === c.id ? styles.filterOn : ""
                }`}
                onClick={() => onSelectCategory(c.id, c.name)}
              >
                {c.name}
              </button>
            </span>
          ))}
          <select
            data-testid="sort-select"
            aria-label="정렬"
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

        {isPending ? (
          <div className={styles.skelGrid} aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={styles.skelCard}>
                <span className={styles.skelPlate} />
                <span className={styles.hair} />
                <span className={styles.skelLine} />
                <span
                  className={`${styles.skelLine} ${styles.skelLineShort}`}
                />
              </div>
            ))}
          </div>
        ) : error ? (
          <p role="alert" className={styles.errorAlert}>
            상품을 불러오는 중 오류가 발생했습니다. (
            {String((error as { message?: string })?.message ?? error)})
          </p>
        ) : products.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyText}>
              해당 조건에 일치하는 상품이 없습니다.
            </p>
            <button
              type="button"
              className={styles.emptyAction}
              onClick={() => onSelectCategory(null, null)}
            >
              전체 보기
            </button>
          </div>
        ) : (
          <ul data-testid="product-list" className={styles.grid}>
            {products.map((p) => {
              const quantity =
                inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
              const soldOut = p.stock === 0;

              return (
                <li key={p.id} className={styles.card}>
                  <Link
                    href={linkFor(`/shop/${p.id}`)}
                    tabIndex={-1}
                    aria-hidden="true"
                    className={styles.plate}
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        width={600}
                        height={600}
                        loading="lazy"
                        decoding="async"
                        className={styles.plateImg}
                        data-testid={`image-${p.id}`}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={styles.fallbackPlate}
                      />
                    )}
                  </Link>

                  <Link href={linkFor(`/shop/${p.id}`)} className={styles.name}>
                    {p.name}
                  </Link>

                  <span className={styles.hair} aria-hidden="true" />

                  {p.description && (
                    <p className={styles.desc}>{p.description}</p>
                  )}

                  <p className={styles.price}>{won(p.price)}</p>

                  {soldOut ? (
                    <span className={styles.soldBadge}>SOLD OUT</span>
                  ) : (
                    <p className={styles.stock}>
                      재고{" "}
                      <span data-testid={`stock-${p.id}`}>{p.stock}</span>개
                    </p>
                  )}

                  <div className={styles.action}>
                    {soldOut ? (
                      <button
                        type="button"
                        className={styles.add}
                        disabled
                      >
                        품절
                      </button>
                    ) : quantity > 0 ? (
                      <div className={styles.stepperWrap}>
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
                        className={styles.add}
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
        )}

        <div className={styles.more}>
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
          <p role="status" className={styles.toast}>
            <span>
              {addedName}
              {eulReul(addedName)} 담았습니다.
            </span>
            <Link href={linkFor("/cart")} className={styles.toastLink}>
              장바구니 보기
            </Link>
            <button
              type="button"
              onClick={clearAdded}
              className={styles.toastClose}
              aria-label="닫기"
            >
              닫기
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

export { ZavanasArchiveCatalog as Catalog };
