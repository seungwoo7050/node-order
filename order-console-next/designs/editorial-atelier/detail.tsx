"use client";

import Link from "next/link";
import { Stepper } from "@/app/shop/stepper";
import { useStorefrontDetailViewModel } from "@/lib/storefront-view-model";
import type { DetailDesignProps } from "../types";
import styles from "./editorial-atelier.module.css";

function krw(n: number): string {
  return "KRW " + n.toLocaleString("en-US");
}

export function EditorialAtelierDetail({
  id,
  initialProduct,
  linkFor,
}: DetailDesignProps) {
  const {
    product,
    allVariants,
    hasVariants,
    selectedVariantId,
    setSelectedVariantId,
    currentPrice,
    currentStock,
    isSoldOut,
    inCartQuantity,
    handleAddToCart,
    handleBuyNow,
    added,
    reviewsData,
  } = useStorefrontDetailViewModel(id, initialProduct);

  const getHref = linkFor ?? ((h: string) => h);

  if (!product) return null;

  const reviewCount = reviewsData?.reviewCount ?? product.reviewCount ?? 0;
  const averageRating =
    reviewsData?.averageRating ?? product.averageRating ?? 0;
  const reviews = reviewsData?.reviews ?? [];

  const allImages =
    product.images && product.images.length > 0
      ? product.images
      : product.imageUrl
        ? [{ id: 0, imageUrl: product.imageUrl, sortOrder: 0 }]
        : [];

  return (
    <article
      data-design="editorial-atelier"
      data-testid="product-detail"
      className={styles.detail}
    >
      <div className={styles.media}>
        {allImages.length > 0 ? (
          allImages.map((img, idx) => (
            <figure key={img.id ?? idx} className={styles.mediaPlate}>
              {img.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img.imageUrl}
                  alt=""
                  width={1200}
                  height={1500}
                  loading={idx === 0 ? "eager" : "lazy"}
                  decoding="async"
                  className={styles.mediaPlateImg}
                />
              ) : (
                <span aria-hidden="true" className={styles.fallbackMedia} />
              )}
            </figure>
          ))
        ) : (
          <figure className={styles.mediaPlate}>
            <span aria-hidden="true" className={styles.fallbackMedia} />
          </figure>
        )}
      </div>

      <div className={styles.info}>
        <h1 id="product-title" className={styles.title}>
          {product.name}
        </h1>
        <p className={styles.priceLine}>{krw(currentPrice)}</p>
        <p className={styles.stockLine}>
          재고{" "}
          <span data-testid={`detail-stock-${product.id}`}>
            {isSoldOut ? 0 : currentStock}
          </span>
        </p>

        {hasVariants && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>OPTION</span>
            <select
              data-testid="variant-select"
              value={selectedVariantId ?? ""}
              onChange={(e) => setSelectedVariantId(Number(e.target.value))}
              className={styles.select}
            >
              {allVariants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.priceDelta !== 0
                    ? ` (${v.priceDelta > 0 ? "+" : ""}${v.priceDelta.toLocaleString("ko-KR")}원)`
                    : ""}
                  {v.stock <= 0 ? " [품절]" : ` (재고: ${v.stock})`}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className={styles.actions}>
          {isSoldOut ? (
            <button type="button" disabled className={styles.btnDisabled}>
              품절
            </button>
          ) : (
            <>
              {inCartQuantity > 0 ? (
                <div className={styles.pdpStepperWrap}>
                  <Stepper
                    productId={product.id}
                    name={product.name}
                    quantity={inCartQuantity}
                    max={currentStock}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAddToCart}
                  className={styles.btn}
                >
                  장바구니 담기
                </button>
              )}
              <button
                type="button"
                data-testid="buy-now-btn"
                onClick={handleBuyNow}
                className={styles.btn}
              >
                바로 구매하기
              </button>
            </>
          )}
        </div>

        {added && (
          <p role="status" className={styles.notice}>
            <span>장바구니에 담았습니다.</span>
            <Link href={getHref("/cart")} className={styles.noticeLink}>
              장바구니 보기
            </Link>
          </p>
        )}

        {product.description && (
          <details open className={styles.acc}>
            <summary className={styles.summary}>
              <span>DETAIL</span>
              <span className={styles.accToggle} aria-hidden="true" />
            </summary>
            <div className={styles.accBody}>{product.description}</div>
          </details>
        )}

        {product.materialInfo && (
          <details className={styles.acc}>
            <summary className={styles.summary}>
              <span>MATERIAL</span>
              <span className={styles.accToggle} aria-hidden="true" />
            </summary>
            <div className={styles.accBody}>{product.materialInfo}</div>
          </details>
        )}

        {product.sizeGuide && (
          <details className={styles.acc}>
            <summary className={styles.summary}>
              <span>SIZE</span>
              <span className={styles.accToggle} aria-hidden="true" />
            </summary>
            <div className={styles.accBody}>{product.sizeGuide}</div>
          </details>
        )}

        <section data-testid="product-reviews" className={styles.reviews}>
          <div className={styles.revHead}>
            <h2 className={styles.revTitle}>REVIEW</h2>
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
              ({reviewCount})
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
                  className={styles.rev}
                >
                  <div className={styles.revMeta}>
                    <span className={styles.revAuthor}>{r.authorName}</span>
                    <span className={styles.revDate}>
                      {new Date(r.createdAt).toLocaleDateString("ko-KR")}
                    </span>
                    {r.variantName && (
                      <span className={styles.revVariant}>{r.variantName}</span>
                    )}
                    <span className={styles.revScore}>★ {r.rating}</span>
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

export default EditorialAtelierDetail;
