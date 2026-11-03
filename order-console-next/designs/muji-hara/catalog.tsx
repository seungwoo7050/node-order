"use client";

import Link from "next/link";
import { useMemo } from "react";
import { LoadMore } from "@/app/load-more";
import { Stepper } from "@/app/shop/stepper";
import { useCartStore } from "@/lib/cart-store";
import {
  eulReul,
  won,
  type CategoryItem,
  type SortOption,
} from "@/lib/storefront-view-model";
import { EmptyState, SkeletonGrid } from "../shared/catalog-states";
import { ProductMedia } from "../shared/product-media";
import type { CatalogDesignProps } from "../types";
import styles from "./muji-hara.module.css";

type CatWithParent = CategoryItem & { parentId?: number | null };

export function MujiHaraCatalog({
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
  linkFor,
}: CatalogDesignProps) {
  const inCart = useCartStore((s) => s.items);
  const toHref = linkFor ?? ((h: string) => h);

  const { rootCategories, subCategories, activeRootId } = useMemo(() => {
    const cats = categories as CatWithParent[];
    const hasParentField = cats.some(
      (c) => c.parentId !== undefined && c.parentId !== null,
    );

    if (!hasParentField) {
      return {
        rootCategories: cats,
        subCategories: [] as CatWithParent[],
        activeRootId: null as number | null,
      };
    }

    const roots = cats.filter((c) => !c.parentId);
    let resolvedRootId: number | null = null;

    if (selectedCatId !== null) {
      const isRoot = roots.some((r) => r.id === selectedCatId);
      if (isRoot) {
        resolvedRootId = selectedCatId;
      } else {
        const parent = cats.find((c) => c.id === selectedCatId)?.parentId;
        if (parent) resolvedRootId = parent;
      }
    }

    const subs = resolvedRootId
      ? cats.filter((c) => c.parentId === resolvedRootId)
      : [];

    return {
      rootCategories: roots,
      subCategories: subs,
      activeRootId: resolvedRootId,
    };
  }, [categories, selectedCatId]);

  return (
    <div
      data-design="muji-hara"
      className={styles.root}
      aria-busy={isPending ? "true" : undefined}
    >
      <div className={`${styles.wrap} ${styles.titleRow}`}>
        <h2 className={styles.pageTitle}>{selectedCatName ?? "전체 상품"}</h2>
      </div>

      <div data-testid="category-filter-bar" className={styles.filterBar}>
        <div className={styles.tabRow}>
          <div className={`${styles.wrap} ${styles.tabInner}`}>
            <button
              type="button"
              className={`${styles.tab} ${
                selectedCatId === null ? styles.tabOn : ""
              }`}
              onClick={() => onSelectCategory(null, null)}
            >
              전체
            </button>
            {rootCategories.map((c) => {
              const isSelected =
                selectedCatId === c.id || activeRootId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`${styles.tab} ${
                    isSelected ? styles.tabOn : ""
                  }`}
                  onClick={() => onSelectCategory(c.id, c.name)}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        {subCategories.length > 0 && (
          <div className={styles.wrap}>
            <div className={styles.subRow}>
              {subCategories.map((sub) => {
                const isSelected = selectedCatId === sub.id;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    className={`${styles.sub} ${
                      isSelected ? styles.subOn : ""
                    }`}
                    onClick={() => onSelectCategory(sub.id, sub.name)}
                  >
                    {sub.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className={`${styles.wrap} ${styles.toolbar}`}>
        <span className={styles.total}>{products.length}개 상품</span>
        <label className={styles.sortLabel}>
          <span className={styles.visuallyHidden}>정렬</span>
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
        </label>
      </div>

      <div className={styles.wrap}>
        {isPending ? (
          <SkeletonGrid
            count={8}
            gridClassName={styles.skelGrid}
            cardClassName={styles.skelCard}
            plateClassName={styles.skelPlate}
            lineClassName={styles.skelLine1}
          />
        ) : error ? (
          <p role="alert" className={styles.alert}>
            상품을 불러오지 못했습니다. (
            {String((error as { message?: string })?.message ?? error)})
          </p>
        ) : products.length === 0 ? (
          <EmptyState
            title="선택한 카테고리에 상품이 없습니다."
            actionLabel="전체 보기"
            onReset={() => onSelectCategory(null, null)}
            className={styles.empty}
            titleClassName={styles.emptyTitle}
            actionClassName={styles.emptyAction}
          />
        ) : (
          <ul data-testid="product-list" className={styles.grid}>
            {products.map((p, idx) => {
              const quantity =
                inCart.find((i) => i.productId === p.id)?.quantity ?? 0;
              const soldOut = (p.stock ?? 0) <= 0;

              return (
                <li key={p.id} className={styles.card}>
                  <Link
                    href={toHref(`/shop/${p.id}`)}
                    tabIndex={-1}
                    aria-hidden="true"
                    className={styles.plate}
                  >
                    <ProductMedia
                      product={p}
                      imgClassName={styles.plateImg}
                      fallbackClassName={styles.plateFallback}
                      withTestId={true}
                      eager={idx < 4}
                    />
                    {sort === "reviews" && idx < 10 && (
                      <span className={styles.rank}>{idx + 1}</span>
                    )}
                  </Link>

                  <Link
                    href={toHref(`/shop/${p.id}`)}
                    className={styles.name}
                  >
                    {p.name}
                  </Link>

                  <div className={styles.priceRow}>
                    <span className={styles.price}>{won(p.price)}</span>
                    {(p.reviewCount ?? 0) > 0 && (
                      <span className={styles.rating}>
                        ★ {p.averageRating ? p.averageRating.toFixed(1) : "0.0"}{" "}
                        ({p.reviewCount})
                      </span>
                    )}
                  </div>

                  {soldOut ? (
                    <span className={styles.sold}>품절</span>
                  ) : (
                    <p className={styles.stock}>
                      {"재고 "}
                      <span data-testid={`stock-${p.id}`}>{p.stock}</span>
                      {"개"}
                    </p>
                  )}

                  <div className={styles.action}>
                    {soldOut ? (
                      <button
                        type="button"
                        disabled
                        className={styles.addBtnDisabled}
                      >
                        품절
                      </button>
                    ) : quantity > 0 ? (
                      <div className={styles.stepperWrap}>
                        <Stepper
                          productId={p.id}
                          name={p.name}
                          quantity={quantity}
                          max={p.stock ?? 999}
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
        )}
      </div>

      {hasNextPage && (
        <div className={`${styles.wrap} ${styles.more}`}>
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
      )}

      {addedName && (
        <p role="status" className={styles.toast}>
          <span>
            {addedName}
            {eulReul(addedName)} 담았습니다.
            <Link href={toHref("/cart")} className={styles.toastLink}>
              장바구니 보기
            </Link>
          </span>
          <button
            type="button"
            onClick={clearAdded}
            className={styles.toastClose}
          >
            닫기
          </button>
        </p>
      )}
    </div>
  );
}
