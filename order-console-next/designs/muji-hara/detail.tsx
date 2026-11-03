"use client";

import Link from "next/link";
import { Stepper } from "@/app/shop/stepper";
import {
  useStorefrontDetailViewModel,
  won,
} from "@/lib/storefront-view-model";
import { StudioProductArtwork } from "../product-artwork";
import type { DetailDesignProps } from "../types";
import styles from "./muji-hara.module.css";

export function MujiHaraDetail({ id, initialProduct }: DetailDesignProps) {
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
      data-design="muji-hara"
      data-testid="product-detail"
      className={styles.detailSheet}
    >
      <div className={styles.detailLayout}>
        {/* Left: 1:1 Specimen Frame */}
        <div className="space-y-4">
          <div className="aspect-square w-full overflow-hidden border border-[#cec3ae] bg-[#e8e0d1]">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                width={520}
                height={520}
                className="aspect-square size-full object-cover"
              />
            ) : (
              <StudioProductArtwork id={product.id} design="muji-hara" />
            )}
          </div>
          <div className="flex items-center justify-between border-t border-[#cec3ae] pt-2.5 font-mono text-[11px] text-[#6b6358]">
            <span className="text-[#7f1d1d] font-semibold">
              標本記録票 · SPECIMEN NO.{String(id).padStart(3, "0")}
            </span>
            <span>UNBLEACHED ARCHIVE SHEET</span>
          </div>
        </div>

        {/* Right: Specimen Ledger & Actions */}
        <div className="flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-[#6b6358]">
              <span className="inline-block size-2 bg-[#7f1d1d]" />
              <span>{product.categoryPath.join(" · ") || "생활 아카이브"}</span>
            </div>

            <h1
              id="product-title"
              className={`${styles.detailSerif} text-3xl sm:text-4xl font-normal tracking-tight text-[#26231f]`}
            >
              {product.name}
            </h1>

            <div className="flex items-baseline justify-between border-y border-[#cec3ae] py-3.5">
              <span className="num text-2xl font-semibold text-[#26231f]">
                {won(currentPrice)}
              </span>
              <span className="text-xs text-[#6b6358]">
                {isSoldOut ? (
                  <span className="text-danger font-medium">품절</span>
                ) : (
                  <span>
                    재고{" "}
                    <span
                      className="num font-semibold text-[#26231f]"
                      data-testid={`detail-stock-${id}`}
                    >
                      {currentStock}
                    </span>
                    개
                  </span>
                )}
              </span>
            </div>

            {product.description && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-[#46413a]">
                {product.description}
              </p>
            )}

            {/* Structured Washi Specification Ledger */}
            <dl className="divide-y divide-[#ded4c1] border-y border-[#ded4c1] text-xs">
              {product.materialInfo && (
                <div className="grid grid-cols-[110px_1fr] py-2.5">
                  <dt className="font-medium text-[#6b6358]">소재 사양</dt>
                  <dd className="text-[#26231f]">{product.materialInfo}</dd>
                </div>
              )}
              {product.sizeGuide && (
                <div className="grid grid-cols-[110px_1fr] py-2.5">
                  <dt className="font-medium text-[#6b6358]">치수 안내</dt>
                  <dd className="text-[#26231f]">{product.sizeGuide}</dd>
                </div>
              )}
              <div className="grid grid-cols-[110px_1fr] py-2.5">
                <dt className="font-medium text-[#6b6358]">포장 사양</dt>
                <dd className="text-[#26231f]">
                  무표백 재생지 완충 포장 · 출고 검수 필
                </dd>
              </div>
            </dl>
          </div>

          {/* Action / Buy Box */}
          <div className="space-y-4 pt-2">
            {hasVariants && (
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-[#6b6358]">
                  규격 / 옵션 선택
                </span>
                <select
                  data-testid="variant-select"
                  className="border border-[#26231f] bg-[#fbf9f4] px-3 py-2.5 text-xs text-[#26231f]"
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
              <button type="button" className="btn w-full py-3.5" disabled>
                품절된 상품입니다
              </button>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {inCartQuantity > 0 ? (
                    <div className="flex items-center justify-between border border-[#26231f] bg-[#fbf9f4] px-2">
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
                      className="border border-[#26231f] bg-transparent py-3.5 text-xs font-medium text-[#26231f] hover:bg-[#26231f] hover:text-[#f7f3eb] transition-colors cursor-pointer"
                    >
                      담기
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid="buy-now-btn"
                    onClick={handleBuyNow}
                    className="border border-[#7f1d1d] bg-[#7f1d1d] py-3.5 text-xs font-medium text-[#f7f3eb] hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    바로 구매하기
                  </button>
                </div>

                {added && (
                  <p role="status" className="text-xs text-[#6b6358]">
                    장바구니에 담았습니다.{" "}
                    <Link
                      href="/cart"
                      className="underline font-medium text-[#7f1d1d]"
                    >
                      장바구니로 이동
                    </Link>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reviews Section */}
      <section
        className="mt-14 border-t border-[#cec3ae] pt-8"
        data-testid="product-reviews"
      >
        <div className="flex items-baseline justify-between mb-6">
          <h2 className={`${styles.detailSerif} text-xl font-normal text-[#26231f]`}>
            사용자 기록 및 후기
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <span
              className="font-semibold text-[#7f1d1d]"
              data-testid="product-average-rating"
            >
              ★ {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
            </span>
            <span className="text-[#6b6358]" data-testid="product-review-count">
              ({reviewCount}개의 후기)
            </span>
          </div>
        </div>

        {reviews.length === 0 ? (
          <p className="py-8 text-center text-xs text-[#6b6358] border border-dashed border-[#cec3ae]">
            등록된 후기가 없습니다.
          </p>
        ) : (
          <div className="divide-y divide-[#ded4c1]">
            {reviews.map((r) => (
              <div
                key={r.id}
                data-testid={`product-review-item-${r.id}`}
                className="py-4 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between text-[#6b6358]">
                  <div className="flex items-center gap-2">
                    <span className="text-[#7f1d1d]">
                      {"★".repeat(r.rating)}
                    </span>
                    <span className="font-mono text-[#26231f] font-medium">
                      {r.authorName}
                    </span>
                    {r.variantName && <span>[{r.variantName}]</span>}
                  </div>
                  <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-[#26231f] leading-relaxed">{r.content}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}
