"use client";

import Link from "next/link";
import { Stepper } from "@/app/shop/stepper";
import {
  useStorefrontDetailViewModel,
  won,
} from "@/lib/storefront-view-model";
import type { DetailDesignProps } from "../types";

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
  const averageRating = reviewsData?.averageRating ?? product.averageRating ?? 0;
  const reviews = reviewsData?.reviews ?? [];

  return (
    <article
      data-design="muji-hara"
      data-testid="product-detail"
      className="font-sans antialiased text-[#2c2b29] py-4"
    >
      <div className="grid gap-12 md:grid-cols-[380px_minmax(0,1fr)]">
        {/* Visual Box (1:1 Square) */}
        <div className="aspect-square w-full overflow-hidden bg-[#f4f4f2] border border-[#e8e6df]">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.name}
              width={380}
              height={380}
              className="aspect-square size-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid aspect-square size-full place-items-center font-serif text-5xl text-faint"
            >
              {product.name.slice(0, 1)}
            </span>
          )}
        </div>

        {/* Content Box */}
        <div className="flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            {product.categoryPath.length > 0 && (
              <p className="text-xs tracking-wider text-muted uppercase">
                {product.categoryPath.join(" / ")}
              </p>
            )}

            <h1 id="product-title" className="font-serif text-2xl font-normal tracking-tight text-[#2c2b29]">
              {product.name}
            </h1>

            <div className="flex items-center gap-4 text-sm">
              <span className="num text-xl font-medium text-[#2c2b29]">{won(currentPrice)}</span>
              <span className="text-xs text-muted">
                {isSoldOut ? (
                  <span className="text-danger font-medium">품절</span>
                ) : (
                  <span>
                    재고 <span className="num font-semibold" data-testid={`detail-stock-${id}`}>{currentStock}</span>개
                  </span>
                )}
              </span>
            </div>

            {product.description && (
              <p className="whitespace-pre-line text-xs leading-relaxed text-[#55534e]">
                {product.description}
              </p>
            )}

            {product.materialInfo && (
              <div className="border-t border-[#e8e6df] pt-3 text-xs text-[#55534e]">
                <span className="font-medium text-[#2c2b29]">소재 사양: </span>
                {product.materialInfo}
              </div>
            )}

            {product.sizeGuide && (
              <div className="border-t border-[#e8e6df] pt-3 text-xs text-[#55534e]">
                <span className="font-medium text-[#2c2b29]">치수 안내: </span>
                {product.sizeGuide}
              </div>
            )}
          </div>

          {/* Action / Buy Box */}
          <div className="border-t border-[#e8e6df] pt-6 space-y-4">
            {hasVariants && (
              <label className="grid gap-1">
                <span className="text-xs text-muted">옵션 선택</span>
                <select
                  data-testid="variant-select"
                  className="border border-[#e8e6df] bg-[#fbfbfa] px-3 py-2 text-xs text-[#2c2b29]"
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
              <button type="button" className="btn w-full py-3" disabled>
                품절된 상품입니다
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  {inCartQuantity > 0 ? (
                    <div className="flex items-center gap-3">
                      <Stepper
                        productId={id}
                        name={selectedVariant ? `${product.name} (${selectedVariant.name})` : product.name}
                        quantity={inCartQuantity}
                        max={currentStock}
                      />
                      <button
                        type="button"
                        onClick={handleAddToCart}
                        className="btn border border-[#2c2b29] bg-transparent px-4 py-2 text-xs text-[#2c2b29] hover:bg-[#2c2b29] hover:text-[#fbfbfa]"
                      >
                        담기
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAddToCart}
                      className="btn border border-[#2c2b29] bg-transparent px-6 py-3 text-xs font-medium text-[#2c2b29] hover:bg-[#2c2b29] hover:text-[#fbfbfa]"
                    >
                      담기
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid="buy-now-btn"
                    onClick={handleBuyNow}
                    className="btn border border-[#2c2b29] bg-[#2c2b29] px-6 py-3 text-xs font-medium text-[#fbfbfa] hover:opacity-90"
                  >
                    바로 구매하기
                  </button>
                </div>

                {added && (
                  <p role="status" className="text-xs text-muted">
                    장바구니에 담았습니다.{" "}
                    <Link href="/cart" className="underline font-medium text-[#2c2b29]">
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
      <section className="mt-16 border-t border-[#e8e6df] pt-10" data-testid="product-reviews">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="font-serif text-lg font-normal text-[#2c2b29]">사용자 후기</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-amber-700" data-testid="product-average-rating">
              ★ {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
            </span>
            <span className="text-muted" data-testid="product-review-count">
              ({reviewCount}개의 후기)
            </span>
          </div>
        </div>

        {reviews.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted border border-dashed border-[#e8e6df]">
            등록된 후기가 없습니다.
          </p>
        ) : (
          <div className="divide-y divide-[#e8e6df]">
            {reviews.map((r) => (
              <div key={r.id} data-testid={`product-review-item-${r.id}`} className="py-4 text-xs space-y-1">
                <div className="flex items-center justify-between text-muted">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-700">{"★".repeat(r.rating)}</span>
                    <span className="font-mono text-[#2c2b29]">{r.authorName}</span>
                    {r.variantName && <span>[{r.variantName}]</span>}
                  </div>
                  <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-[#2c2b29] leading-relaxed pt-1">{r.content}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}
