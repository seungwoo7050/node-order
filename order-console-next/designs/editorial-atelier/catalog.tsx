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
import type { CatalogDesignProps } from "../types";
import styles from "./editorial-atelier.module.css";

type CatWithDepth = CategoryItem & { depth: number; parentId?: number | null };

function getCategoryTree(
  cats: (CategoryItem & { parentId?: number | null })[],
): CatWithDepth[] {
  const hasParent = cats.some((c) => c.parentId != null);
  if (!hasParent) {
    return cats.map((c) => ({ ...c, depth: 0 }));
  }
  const rootCats = cats.filter((c) => c.parentId == null);
  const result: CatWithDepth[] = [];
  function addChildren(parentId: number, depth: number) {
    const children = cats.filter((c) => c.parentId === parentId);
    for (const child of children) {
      result.push({ ...child, depth });
      addChildren(child.id, depth + 1);
    }
  }
  for (const root of rootCats) {
    result.push({ ...root, depth: 0 });
    addChildren(root.id, 1);
  }
  for (const c of cats) {
    if (!result.some((r) => r.id === c.id)) {
      result.push({ ...c, depth: 0 });
    }
  }
  return result;
}

export function EditorialAtelierCatalog({
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
  linkFor,
}: CatalogDesignProps) {
  const inCart = useCartStore((s) => s.items);
  const getHref = linkFor ?? ((h: string) => h);

  const heroTitle = storeInfo?.heroTitle || "CONTEMPORARY LOOKBOOK";
  const heroSubtitle =
    storeInfo?.heroSubtitle ||
    "소재의 물성과 구조적인 실루엣의 균형을 탐구하는 에디토리얼 아틀리에 컬렉션입니다.";

  const tree = useMemo(() => getCategoryTree(categories), [categories]);

  return (
    <div
      data-design="editorial-atelier"
      className={styles.root}
      aria-busy={isPending ? "true" : undefined}
    >
      <section data-testid="hero-banner" className={styles.hero}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/storefront/editorial/campaign-01.webp"
          alt=""
          loading="eager"
          decoding="async"
          className={styles.heroImg}
        />
        <div className={styles.heroCopy}>
          <h2 className={styles.heroTitle}>{heroTitle}</h2>
          <p className={styles.heroSub}>{heroSubtitle}</p>
        </div>
      </section>

      <div className={styles.layout}>
        <aside className={styles.side}>
          <nav
            data-testid="category-filter-bar"
            aria-label="카테고리"
            className={styles.cats}
          >
            <button
              type="button"
              onClick={() => onSelectCategory(null, null)}
              className={`${styles.cat} ${selectedCatId === null ? styles.catActive : ""}`}
            >
              전체
            </button>
            {tree.map((cat) => {
              const isSelected = selectedCatId === cat.id;
              const depthClass =
                cat.depth === 1
                  ? styles.depth1
                  : cat.depth >= 2
                    ? styles.depth2
                    : "";
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onSelectCategory(cat.id, cat.name)}
                  className={`${styles.cat} ${depthClass} ${isSelected ? styles.catActive : ""}`}
                >
                  {cat.name}
                </button>
              );
            })}
          </nav>

          <label className={styles.sort}>
            <span className={styles.sortLabel}>SORT</span>
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
        </aside>

        <section className={styles.main}>
          <div className={styles.crumbs}>
            <span>SHOP</span>
            <span>/</span>
            <span>{selectedCatName ?? "ALL"}</span>
            <span className={styles.count}>{products.length} ITEMS</span>
          </div>

          {isPending ? (
            <div className={styles.grid} aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={styles.card}>
                  <span className={styles.skelPlate} />
                  <span className={styles.skelLine} />
                  <span className={styles.skelLine} />
                </div>
              ))}
            </div>
          ) : error ? (
            <p role="alert" className={styles.error}>
              상품 목록을 불러오지 못했습니다. (
              {String((error as { message?: string })?.message ?? error)})
            </p>
          ) : products.length === 0 ? (
            <div className={styles.empty}>
              <p>등록된 상품이 없습니다.</p>
              <button
                type="button"
                onClick={() => onSelectCategory(null, null)}
                className={styles.emptyAction}
              >
                전체 보기
              </button>
            </div>
          ) : (
            <ul data-testid="product-list" className={styles.grid}>
              {products.map((product) => {
                const inCartQty = inCart
                  .filter((i) => i.productId === product.id)
                  .reduce((sum, i) => sum + i.quantity, 0);
                const isSoldOut = (product.stock ?? 0) <= 0;
                const detailHref = getHref(`/shop/${product.id}`);

                return (
                  <li key={product.id} className={styles.card}>
                    <Link
                      href={detailHref}
                      tabIndex={-1}
                      aria-hidden="true"
                      className={styles.plate}
                    >
                      {product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.imageUrl}
                          alt=""
                          width={1200}
                          height={1500}
                          loading="lazy"
                          decoding="async"
                          className={styles.plateImg}
                          data-testid={`image-${product.id}`}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className={styles.fallbackPlate}
                        />
                      )}
                      {isSoldOut && (
                        <span className={styles.soldTag}>SOLD OUT</span>
                      )}
                    </Link>

                    <div className={styles.caption}>
                      <Link href={detailHref} className={styles.name}>
                        {product.name}
                      </Link>
                      <span className={styles.price}>{won(product.price)}</span>
                      <span
                        data-testid={`stock-${product.id}`}
                        className={styles.stock}
                      >
                        {isSoldOut ? "품절" : `재고 ${product.stock ?? 0}`}
                      </span>
                      <div className={styles.action}>
                        {inCartQty > 0 ? (
                          <div className={styles.stepperWrap}>
                            <Stepper
                              productId={product.id}
                              name={product.name}
                              quantity={inCartQty}
                              max={product.stock ?? 999}
                            />
                          </div>
                        ) : isSoldOut ? (
                          <button
                            type="button"
                            disabled
                            className={styles.addDisabled}
                          >
                            품절
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAddToCart(product)}
                            className={styles.add}
                          >
                            담기
                          </button>
                        )}
                      </div>
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
        </section>
      </div>

      {addedName && (
        <p role="status" className={styles.toast}>
          <span>
            {addedName}
            {eulReul(addedName)} 담았습니다.
          </span>
          <Link href={getHref("/cart")} className={styles.toastLink}>
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
  );
}

export default EditorialAtelierCatalog;
