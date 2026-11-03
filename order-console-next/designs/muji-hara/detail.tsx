"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Stepper } from "@/app/shop/stepper";
import {
  eulReul,
  useStorefrontDetailViewModel,
  won,
} from "@/lib/storefront-view-model";
import { ProductMedia } from "../shared/product-media";
import type { DetailDesignProps } from "../types";
import styles from "./muji-hara.module.css";

export function MujiHaraDetail({
  id,
  initialProduct,
  linkFor,
}: DetailDesignProps) {
  const {
    product,
    allVariants,
    hasVariants,
    selectedVariant,
    selectedVariantId,
    setSelectedVariantId,
    currentPrice,
    currentStock,
    isSoldOut,
    inCartQuantity,
    handleAddToCart,
    handleBuyNow,
    added,
    clearAdded,
    reviewsData,
  } = useStorefrontDetailViewModel(id, initialProduct);

  const toHref = linkFor ?? ((h: string) => h);

  const allImages = useMemo(() => {
    if (!product) return [];
    const list: { id: number | string; url: string }[] = [];
    if (product.imageUrl) list.push({ id: "main", url: product.imageUrl });
    if (product.images) {
      for (const img of product.images) {
        if (img.imageUrl && img.imageUrl !== product.imageUrl) {
          list.push({ id: img.id, url: img.imageUrl });
        }
      }
    }
    return list;
  }, [product]);

  const [activeImageIndex, setActiveImageIndex] = useState(0);

  if (!product) return null;

  const activeImageUrl = allImages[activeImageIndex]?.url ?? product.imageUrl;
  const reviewCount = reviewsData?.reviewCount ?? product.reviewCount ?? 0;
  const averageRating =
    reviewsData?.averageRating ?? product.averageRating ?? 0;
  const reviews = reviewsData?.reviews ?? [];

  return (
    <article
      data-design="muji-hara"
      data-testid="product-detail"
      className={styles.detail}
    >
      <div className={`${styles.wrap} ${styles.pdp}`}>
        <div className={styles.gallery}>
          <figure className={styles.mainPlate}>
            <ProductMedia
              product={{
                id: product.id,
                name: product.name,
                imageUrl: activeImageUrl,
              }}
              imgClassName={styles.mainImg}
              fallbackClassName={styles.plateFallback}
              eager={true}
            />
          </figure>
          {allImages.length > 1 && (
            <div className={styles.thumbs}>
              {allImages.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  className={`${styles.thumbBtn} ${
                    i === activeImageIndex ? styles.thumbBtnActive : ""
                  }`}
                  onClick={() => setActiveImageIndex(i)}
                  aria-label={`이미지 ${i + 1} 보기`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt=""
                    width={160}
                    height={160}
                    className={styles.thumbImg}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.info}>
          {product.categoryPath && product.categoryPath.length > 0 && (
            <p className={styles.path}>{product.categoryPath.join(" > ")}</p>
          )}

          <h1 id="product-title" className={styles.title}>
            {product.name}
          </h1>

          <p className={styles.priceLine}>
            <span>{won(currentPrice)}</span>
            {selectedVariant && selectedVariant.priceDelta !== 0 && (
              <span className={styles.delta}>
                ({selectedVariant.priceDelta > 0 ? "+" : ""}
                {won(selectedVariant.priceDelta)})
              </span>
            )}
          </p>

          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt className={styles.rowLabel}>재고</dt>
              <dd className={styles.rowValue}>
                {isSoldOut ? (
                  <span className={styles.sold}>품절</span>
                ) : (
                  <span>
                    <span data-testid={`detail-stock-${id}`}>
                      {currentStock}
                    </span>
                    {"개"}
                  </span>
                )}
              </dd>
            </div>

            {product.materialInfo && (
              <div className={styles.row}>
                <dt className={styles.rowLabel}>소재</dt>
                <dd className={styles.rowValue}>{product.materialInfo}</dd>
              </div>
            )}

            {hasVariants && (
              <div className={styles.row}>
                <dt className={styles.rowLabel}>옵션</dt>
                <dd className={styles.rowValue}>
                  <select
                    data-testid="variant-select"
                    className={styles.select}
                    value={selectedVariantId ?? ""}
                    onChange={(e) =>
                      setSelectedVariantId(Number(e.target.value))
                    }
                  >
                    {allVariants.map((v) => (
                      <option key={v.id} value={v.id} disabled={v.stock <= 0}>
                        {v.name}
                        {v.priceDelta !== 0
                          ? ` (${v.priceDelta > 0 ? "+" : ""}${won(v.priceDelta)})`
                          : ""}{" "}
                        {v.stock <= 0 ? "(품절)" : ""}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
            )}
          </dl>

          <div className={styles.total}>
            <span>총 상품금액</span>
            <strong>
              {won(currentPrice * Math.max(1, inCartQuantity || 1))}
            </strong>
          </div>

          <div className={styles.actions}>
            {isSoldOut ? (
              <button type="button" disabled className={styles.btnDisabled}>
                품절
              </button>
            ) : (
              <>
                {inCartQuantity > 0 ? (
                  <div className={styles.stepperWrap}>
                    <Stepper
                      productId={id}
                      name={product.name}
                      quantity={inCartQuantity}
                      max={currentStock}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.btnLine}
                    onClick={handleAddToCart}
                  >
                    장바구니 담기
                  </button>
                )}
                <button
                  type="button"
                  data-testid="buy-now-btn"
                  className={styles.btnSolid}
                  onClick={handleBuyNow}
                >
                  바로 구매하기
                </button>
              </>
            )}
          </div>

          {added && (
            <p role="status" className={styles.notice}>
              <span>
                {product.name}
                {eulReul(product.name)} 장바구니에 담았습니다.
                <Link href={toHref("/cart")} className={styles.noticeLink}>
                  장바구니 보기
                </Link>
              </span>
              <button
                type="button"
                onClick={clearAdded}
                className={styles.noticeClose}
              >
                닫기
              </button>
            </p>
          )}
        </div>
      </div>

      <div className={`${styles.wrap} ${styles.below}`}>
        <section
          className={styles.section}
          aria-labelledby="product-info-heading"
        >
          <h2 id="product-info-heading" className={styles.sectionTitle}>
            상품 정보
          </h2>
          {product.description && (
            <p className={styles.desc}>{product.description}</p>
          )}
          {(product.sizeGuide || product.materialInfo) && (
            <table className={styles.specTable}>
              <tbody>
                {product.materialInfo && (
                  <tr>
                    <th scope="row">소재</th>
                    <td>{product.materialInfo}</td>
                  </tr>
                )}
                {product.sizeGuide && (
                  <tr>
                    <th scope="row">치수 안내</th>
                    <td>{product.sizeGuide}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </section>

        <section
          data-testid="product-reviews"
          className={styles.section}
          aria-labelledby="product-reviews-heading"
        >
          <h2 id="product-reviews-heading" className={styles.sectionTitle}>
            리뷰
          </h2>
          <div className={styles.revSummary}>
            <span
              data-testid="product-average-rating"
              className={styles.revRating}
            >
              ★ {averageRating.toFixed(1)}
            </span>
            <span
              data-testid="product-review-count"
              className={styles.revCount}
            >
              {reviewCount}개 리뷰
            </span>
          </div>

          {reviews.length === 0 ? (
            <p className={styles.revEmpty}>아직 작성된 후기가 없습니다.</p>
          ) : (
            <div className={styles.revList}>
              {reviews.map((r) => (
                <div
                  key={r.id}
                  data-testid={`product-review-item-${r.id}`}
                  className={styles.revItem}
                >
                  <div className={styles.revMeta}>
                    <span className={styles.revAuthor}>{r.authorName}</span>
                    <span className={styles.revStars}>★ {r.rating}</span>
                    {r.variantName && (
                      <span className={styles.revVariant}>
                        옵션: {r.variantName}
                      </span>
                    )}
                    <time className={styles.revDate}>
                      {new Date(r.createdAt).toLocaleDateString("ko-KR")}
                    </time>
                  </div>
                  <p className={styles.revContent}>{r.content}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </article>
  );
}
