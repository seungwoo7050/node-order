"use client";

import Link from "next/link";
import { useState } from "react";
import { Stepper } from "@/app/shop/stepper";
import {
  useStorefrontDetailViewModel,
  won,
} from "@/lib/storefront-view-model";
import type { DetailDesignProps } from "../types";
import styles from "./zavanas-archive.module.css";

export type ZavanasArchiveDetailProps = DetailDesignProps;

export function ZavanasArchiveDetail({
  id,
  initialProduct,
  linkFor = (href: string) => href,
}: ZavanasArchiveDetailProps) {
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
    reviewsData,
  } = useStorefrontDetailViewModel(id, initialProduct);

  const images = [
    product?.imageUrl,
    ...(product?.images?.map((img) => img.imageUrl) ?? []),
  ].filter(Boolean) as string[];

  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  if (!product) return null;

  const activeImage = selectedImage ?? images[0] ?? product.imageUrl ?? null;
  const reviewCount = reviewsData?.reviewCount ?? product.reviewCount ?? 0;
  const averageRating =
    reviewsData?.averageRating ?? product.averageRating ?? 0;
  const reviews = reviewsData?.reviews ?? [];

  return (
    <article
      data-design="zavanas-archive"
      data-testid="product-detail"
      className={styles.detail}
    >
      <div className={styles.wrap}>
        <div className={styles.titleRow}>
          <span className={styles.dash} aria-hidden="true">
            —
          </span>
          <h1 id="product-title" className={styles.title}>
            {product.name}
          </h1>
        </div>

        <div className={styles.pdp}>
          <div className={styles.mediaCol}>
            <figure className={styles.mainPlate}>
              {activeImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activeImage}
                  alt={product.name}
                  width={1200}
                  height={1200}
                  className={styles.mainPlateImg}
                  loading="eager"
                />
              ) : (
                <span aria-hidden="true" className={styles.fallbackPlate} />
              )}
            </figure>

            {images.length > 1 && (
              <div className={styles.thumbs}>
                {images.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`${styles.thumbBtn} ${
                      activeImage === img ? styles.thumbBtnActive : ""
                    }`}
                    onClick={() => setSelectedImage(img)}
                    aria-label={`이미지 ${idx + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img}
                      alt=""
                      width={120}
                      height={120}
                      className={styles.thumbImg}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.info}>
            <table className={styles.table}>
              <tbody>
                <tr>
                  <th scope="row">판매가</th>
                  <td>{won(currentPrice)}</td>
                </tr>
                <tr>
                  <th scope="row">재고</th>
                  <td>
                    {isSoldOut ? (
                      <span className={styles.soldBadge}>SOLD OUT</span>
                    ) : (
                      <span>
                        재고{" "}
                        <span data-testid={`detail-stock-${id}`}>
                          {currentStock}
                        </span>
                        개
                      </span>
                    )}
                  </td>
                </tr>
                {product.materialInfo && (
                  <tr>
                    <th scope="row">소재</th>
                    <td>{product.materialInfo}</td>
                  </tr>
                )}
                {hasVariants && (
                  <tr>
                    <th scope="row">옵션</th>
                    <td>
                      <select
                        data-testid="variant-select"
                        aria-label="옵션 선택"
                        className={styles.select}
                        value={selectedVariantId ?? ""}
                        onChange={(e) =>
                          setSelectedVariantId(Number(e.target.value))
                        }
                      >
                        {allVariants.map((v) => (
                          <option
                            key={v.id}
                            value={v.id}
                            disabled={v.stock === 0}
                          >
                            {v.name}
                            {v.priceDelta !== 0
                              ? ` (${v.priceDelta > 0 ? "+" : ""}${won(v.priceDelta)})`
                              : ""}
                            {v.stock === 0
                              ? " [품절]"
                              : ` (재고 ${v.stock}개)`}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className={styles.totalBox}>
              총 상품 금액 <strong>{won(currentPrice)}</strong>
            </div>

            {isSoldOut ? (
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.btnSolid}
                  disabled
                >
                  품절
                </button>
              </div>
            ) : (
              <div className={styles.actionRow}>
                <button
                  type="button"
                  data-testid="buy-now-btn"
                  onClick={handleBuyNow}
                  className={styles.btnSolid}
                >
                  바로 구매하기
                </button>

                {inCartQuantity > 0 ? (
                  <div className={styles.stepperWrap}>
                    <Stepper
                      productId={id}
                      name={
                        selectedVariant
                          ? `${product.name} (${selectedVariant.name})`
                          : product.name
                      }
                      quantity={inCartQuantity}
                      max={currentStock}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className={styles.btnLine}
                  >
                    장바구니 담기
                  </button>
                )}
              </div>
            )}

            {added && (
              <p role="status" className={styles.notice}>
                <span>상품을 장바구니에 담았습니다.</span>
                <Link
                  href={linkFor("/cart")}
                  className={styles.noticeLink}
                >
                  장바구니 보기
                </Link>
              </p>
            )}
          </div>
        </div>

        <section className={styles.block}>
          <div className={styles.blockHeading}>
            <span className={styles.dash} aria-hidden="true">
              —
            </span>
            <h2 className={styles.blockTitle}>상품 정보</h2>
          </div>
          {product.description && (
            <p className={styles.desc}>{product.description}</p>
          )}
          {product.sizeGuide && (
            <p className={styles.sizeGuide}>{product.sizeGuide}</p>
          )}
        </section>

        <section
          data-testid="product-reviews"
          className={styles.block}
        >
          <div className={styles.blockHeading}>
            <span className={styles.dash} aria-hidden="true">
              —
            </span>
            <h2 className={styles.blockTitle}>구매 후기</h2>
            <div className={styles.revSummary}>
              <span
                data-testid="product-average-rating"
                className={styles.revRating}
              >
                ★ {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
              </span>
              <span
                data-testid="product-review-count"
                className={styles.revCount}
              >
                ({reviewCount})
              </span>
            </div>
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
                    <span className={styles.revItemRating}>
                      {"★".repeat(r.rating)}
                    </span>
                    <span className={styles.revAuthor}>{r.authorName}</span>
                    {r.variantName && (
                      <span className={styles.revVariant}>
                        [{r.variantName}]
                      </span>
                    )}
                    <time className={styles.revDate}>
                      {new Date(r.createdAt).toISOString().slice(0, 10)}
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

export { ZavanasArchiveDetail as Detail };
