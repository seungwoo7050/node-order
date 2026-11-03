"use client";

import Link from "next/link";
import { Stepper } from "@/app/shop/stepper";
import {
  useStorefrontDetailViewModel,
  won,
} from "@/lib/storefront-view-model";
import { StudioProductArtwork } from "../product-artwork";
import type { DetailDesignProps } from "../types";
import styles from "./editorial-atelier.module.css";

export function EditorialAtelierDetail({
  id,
  initialProduct,
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
    reviewsData,
  } = useStorefrontDetailViewModel(id, initialProduct);

  if (!product) return null;

  const reviewCount = reviewsData?.reviewCount ?? product.reviewCount ?? 0;
  const averageRating =
    reviewsData?.averageRating ?? product.averageRating ?? 0;
  const reviews = reviewsData?.reviews ?? [];

  return (
    <article
      data-design="editorial-atelier"
      data-testid="product-detail"
      className={styles.detailRoot}
    >
      <div className={styles.detailGrid}>
        {/* Left Column: 3:4 Portrait Lookbook Plate + Editorial Story & Reviews */}
        <div className="space-y-12">
          <div className={styles.detailVisualFrame}>
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                width={720}
                height={960}
                className="aspect-[3/4] size-full object-cover"
              />
            ) : (
              <StudioProductArtwork
                id={product.id}
                design="editorial-atelier"
              />
            )}
          </div>

          {product.description && (
            <div className="space-y-3 border-t border-[#141413]/20 pt-8">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#68635a]">
                01 // EDITORIAL NOTE & SILHOUETTE
              </h3>
              <p className="whitespace-pre-line text-sm font-light leading-relaxed text-[#2a2926]">
                {product.description}
              </p>
            </div>
          )}

          {(product.materialInfo || product.sizeGuide) && (
            <div className="space-y-4 border-t border-[#141413]/20 pt-8">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#68635a]">
                02 // FABRICATION & MEASUREMENTS
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 text-xs">
                {product.materialInfo && (
                  <div className="border border-[#141413]/15 bg-[#fbfaf7] p-4 space-y-1">
                    <span className="block font-mono text-[10px] uppercase tracking-widest text-[#68635a]">
                      소재 및 혼용률
                    </span>
                    <span className="block text-[#141413] leading-relaxed">
                      {product.materialInfo}
                    </span>
                  </div>
                )}
                {product.sizeGuide && (
                  <div className="border border-[#141413]/15 bg-[#fbfaf7] p-4 space-y-1">
                    <span className="block font-mono text-[10px] uppercase tracking-widest text-[#68635a]">
                      사이즈 및 핏 가이드
                    </span>
                    <span className="block text-[#141413] leading-relaxed">
                      {product.sizeGuide}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Editorial Reviews Section */}
          <section
            className="border-t border-[#141413]/20 pt-8"
            data-testid="product-reviews"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#68635a]">
                03 // CLIENT IMPRESSIONS
              </h3>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="font-semibold text-[#141413]"
                  data-testid="product-average-rating"
                >
                  ★ {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
                </span>
                <span
                  className="text-[#68635a]"
                  data-testid="product-review-count"
                >
                  ({reviewCount}개의 후기)
                </span>
              </div>
            </div>

            {reviews.length === 0 ? (
              <p className="border border-dashed border-[#141413]/20 py-8 text-center text-xs text-[#68635a]">
                등록된 고객 리뷰가 없습니다.
              </p>
            ) : (
              <div className="divide-y divide-[#141413]/12 border-t border-[#141413]/12">
                {reviews.map((r) => (
                  <div
                    key={r.id}
                    data-testid={`product-review-item-${r.id}`}
                    className="py-4 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[#68635a]">
                      <div className="flex items-center gap-2">
                        <span className="text-[#141413]">
                          {"★".repeat(r.rating)}
                        </span>
                        <span className="font-mono text-[#141413] font-medium">
                          {r.authorName}
                        </span>
                        {r.variantName && <span>· {r.variantName}</span>}
                      </div>
                      <span className="font-mono">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-[#2a2926] leading-relaxed">
                      {r.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Sticky Architectural Buy Box */}
        <div className={styles.detailBuyBox}>
          <div className="space-y-4">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[#68635a]">
              <span>{product.categoryPath.join(" / ") || "ARCHIVE"}</span>
              <span>LOOK #{String(id).padStart(3, "0")}</span>
            </div>

            <h1
              id="product-title"
              className={`${styles.detailHeading} text-3xl sm:text-4xl font-normal tracking-tight text-[#141413]`}
            >
              {product.name}
            </h1>

            <div className="flex items-baseline justify-between border-y border-[#141413]/15 py-4">
              <span className="num text-2xl font-normal text-[#141413]">
                {won(currentPrice)}
              </span>
              <span className="font-mono text-xs text-[#68635a]">
                {isSoldOut ? (
                  <span className="text-danger font-medium">품절</span>
                ) : (
                  <span>
                    재고{" "}
                    <span
                      className="num font-medium text-[#141413]"
                      data-testid={`detail-stock-${id}`}
                    >
                      {currentStock}
                    </span>
                  </span>
                )}
              </span>
            </div>
          </div>

          <div className="mt-6 space-y-6">
            {hasVariants && (
              <label className="grid gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#68635a]">
                  SELECT SIZE / COLOR OPTION
                </span>
                <select
                  data-testid="variant-select"
                  className="border border-[#141413] bg-white p-3 text-xs text-[#141413] font-medium"
                  value={selectedVariantId ?? ""}
                  onChange={(e) => setSelectedVariantId(Number(e.target.value))}
                >
                  {allVariants.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.stock === 0}>
                      {v.name}{" "}
                      {v.priceDelta !== 0
                        ? `(${v.priceDelta > 0 ? "+" : ""}${won(v.priceDelta)})`
                        : ""}{" "}
                      {v.stock === 0 ? "[품절]" : `(재고 ${v.stock}개)`}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {isSoldOut ? (
              <button
                type="button"
                className="btn w-full py-4 uppercase text-xs tracking-wider"
                disabled
              >
                SOLD OUT
              </button>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {inCartQuantity > 0 ? (
                    <div className="flex items-center justify-between border border-[#141413] bg-white px-2">
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
                      <button
                        type="button"
                        onClick={handleAddToCart}
                        className="btn border-0 text-xs hover:underline"
                      >
                        담기
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAddToCart}
                      className="border border-[#141413] bg-white py-4 text-xs font-medium tracking-[0.14em] uppercase text-[#141413] hover:bg-[#ece8e0] transition-colors cursor-pointer"
                    >
                      담기
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid="buy-now-btn"
                    onClick={handleBuyNow}
                    className="border border-[#141413] bg-[#141413] py-4 text-xs font-medium tracking-[0.14em] uppercase text-[#f6f4f0] hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    바로 구매하기
                  </button>
                </div>

                {added && (
                  <p role="status" className="text-xs text-[#68635a] pt-1">
                    선택한 상품을 장바구니에 담았습니다.{" "}
                    <Link
                      href="/cart"
                      className="underline font-semibold text-[#141413]"
                    >
                      장바구니 보기
                    </Link>
                  </p>
                )}
              </div>
            )}

            <div className="border-t border-[#141413]/15 pt-4 space-y-1.5 text-[11px] text-[#68635a]">
              <p>· 전 상품 아틀리에 전용 패키징으로 출고됩니다.</p>
              <p>· 오후 2시 이전 결제 완료 시 당일 출고됩니다.</p>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
