"use client";

import Link from "next/link";
import { Stepper } from "@/app/shop/stepper";
import {
  useStorefrontDetailViewModel,
  won,
} from "@/lib/storefront-view-model";
import type { DetailDesignProps } from "../types";

export function EditorialAtelierDetail({ id, initialProduct }: DetailDesignProps) {
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
  const averageRating = reviewsData?.averageRating ?? product.averageRating ?? 0;
  const reviews = reviewsData?.reviews ?? [];

  return (
    <article
      data-design="editorial-atelier"
      data-testid="product-detail"
      className="font-sans antialiased text-[#111111] py-6"
    >
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.2fr_1fr]">
        {/* Left Column: Visuals & Spec Story */}
        <div className="space-y-12">
          {/* Main 3:4 Lookbook Image */}
          <div className="aspect-[3/4] w-full overflow-hidden bg-[#f4f4f4]">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                width={600}
                height={800}
                className="aspect-[3/4] size-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="grid aspect-[3/4] size-full place-items-center font-serif text-6xl text-neutral-300"
              >
                {product.name.slice(0, 1)}
              </span>
            )}
          </div>

          {/* Description Story */}
          {product.description && (
            <div className="space-y-3 border-t border-[#e5e5e5] pt-8">
              <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">
                PRODUCT STORY
              </h3>
              <p className="whitespace-pre-line text-xs font-light leading-relaxed text-neutral-700">
                {product.description}
              </p>
            </div>
          )}

          {/* Material & Size Specs */}
          {(product.materialInfo || product.sizeGuide) && (
            <div className="space-y-4 border-t border-[#e5e5e5] pt-8">
              <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">
                SPECIFICATIONS & FIT
              </h3>
              <div className="grid gap-3 text-xs">
                {product.materialInfo && (
                  <div className="border border-[#e5e5e5] p-3">
                    <span className="font-semibold text-[#111111]">소재 / 혼용률: </span>
                    <span className="text-neutral-600">{product.materialInfo}</span>
                  </div>
                )}
                {product.sizeGuide && (
                  <div className="border border-[#e5e5e5] p-3">
                    <span className="font-semibold text-[#111111]">사이즈 가이드: </span>
                    <span className="text-neutral-600">{product.sizeGuide}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reviews Section */}
          <section className="border-t border-[#e5e5e5] pt-8" data-testid="product-reviews">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-neutral-500">
                REVIEWS
              </h3>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-amber-700" data-testid="product-average-rating">
                  ★ {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
                </span>
                <span className="text-neutral-500" data-testid="product-review-count">
                  ({reviewCount}개의 후기)
                </span>
              </div>
            </div>

            {reviews.length === 0 ? (
              <p className="border border-dashed border-[#e5e5e5] py-8 text-center text-xs text-neutral-500">
                등록된 고객 리뷰가 없습니다.
              </p>
            ) : (
              <div className="space-y-4">
                {reviews.map((r) => (
                  <div
                    key={r.id}
                    data-testid={`product-review-item-${r.id}`}
                    className="border-b border-[#f0f0f0] pb-4 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between text-neutral-500">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-700">{"★".repeat(r.rating)}</span>
                        <span className="font-mono text-[#111111]">{r.authorName}</span>
                        {r.variantName && <span>· {r.variantName}</span>}
                      </div>
                      <span className="font-mono">{new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-neutral-700 leading-relaxed pt-1">{r.content}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Sticky Architectural Buy Box */}
        <div className="lg:sticky lg:top-8 self-start space-y-8 bg-white lg:p-6 border-b lg:border lg:border-[#e5e5e5] pb-8">
          <div className="space-y-3">
            {product.categoryPath.length > 0 && (
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500">
                {product.categoryPath.join(" / ")}
              </p>
            )}

            <h1 id="product-title" className="font-serif text-3xl font-normal tracking-tight text-[#111111]">
              {product.name}
            </h1>

            <div className="flex items-baseline justify-between border-b border-[#e5e5e5] pb-4">
              <span className="num text-2xl font-light text-[#111111]">{won(currentPrice)}</span>
              <span className="text-xs text-neutral-500">
                {isSoldOut ? (
                  <span className="text-danger font-medium">품절</span>
                ) : (
                  <span>
                    재고 <span className="num font-medium" data-testid={`detail-stock-${id}`}>{currentStock}</span>
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Options & Action */}
          <div className="space-y-6">
            {hasVariants && (
              <label className="grid gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-500">
                  SELECT OPTION
                </span>
                <select
                  data-testid="variant-select"
                  className="border border-[#111111] bg-white p-3 text-xs text-[#111111] font-medium"
                  value={selectedVariantId ?? ""}
                  onChange={(e) => setSelectedVariantId(Number(e.target.value))}
                >
                  {allVariants.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.stock === 0}>
                      {v.name} {v.priceDelta !== 0 ? `(${v.priceDelta > 0 ? "+" : ""}${won(v.priceDelta)})` : ""} {v.stock === 0 ? "[품절]" : `(재고 ${v.stock}개)`}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {isSoldOut ? (
              <button type="button" className="btn w-full py-4 uppercase text-xs tracking-wider" disabled>
                SOLD OUT
              </button>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {inCartQuantity > 0 ? (
                    <div className="flex items-center justify-between border border-[#111111] px-2">
                      <Stepper
                        productId={id}
                        name={selectedVariant ? `${product.name} (${selectedVariant.name})` : product.name}
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
                      className="btn border border-[#111111] bg-white py-4 text-xs font-medium tracking-wider text-[#111111] hover:bg-neutral-100"
                    >
                      담기
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid="buy-now-btn"
                    onClick={handleBuyNow}
                    className="btn border border-[#111111] bg-[#111111] py-4 text-xs font-medium tracking-wider text-white hover:bg-neutral-800"
                  >
                    바로 구매하기
                  </button>
                </div>

                {added && (
                  <p role="status" className="text-xs text-neutral-600">
                    선택한 상품을 장바구니에 담았습니다.{" "}
                    <Link href="/cart" className="underline font-semibold text-[#111111]">
                      장바구니 보기
                    </Link>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
