"use client";

import Link from "next/link";
import { Stepper } from "@/app/shop/stepper";
import {
  useStorefrontDetailViewModel,
  won,
} from "@/lib/storefront-view-model";
import type { DetailDesignProps } from "../types";

export function ZavanasArchiveDetail({ id, initialProduct }: DetailDesignProps) {
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
      data-design="zavanas-archive"
      data-testid="product-detail"
      className="font-mono antialiased text-[#0f172a] py-6"
    >
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_1.1fr]">
        {/* Left Column: Spec Image */}
        <div className="space-y-4">
          <div className="aspect-square w-full overflow-hidden border border-slate-300 bg-white p-2">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                width={450}
                height={450}
                className="aspect-square size-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="grid aspect-square size-full place-items-center font-mono text-5xl text-slate-300"
              >
                {product.name.slice(0, 1)}
              </span>
            )}
          </div>

          <div className="border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 font-mono space-y-1">
            <div className="flex justify-between">
              <span>ARCHIVE ID:</span>
              <span className="font-bold text-slate-800">#ARCH-{String(id).padStart(4, "0")}</span>
            </div>
            <div className="flex justify-between">
              <span>CATEGORY PATH:</span>
              <span className="text-slate-800">{product.categoryPath.join(" > ") || "GENERAL"}</span>
            </div>
          </div>
        </div>

        {/* Right Column: Spec Sheet Matrix Table */}
        <div className="space-y-6">
          <div>
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
              TECHNICAL SPEC SHEET
            </span>
            <h1 id="product-title" className="font-sans text-2xl font-bold tracking-tight text-slate-900 mt-1">
              {product.name}
            </h1>
          </div>

          {/* Matrix Parameters Table */}
          <div className="border border-slate-300 bg-white">
            <table className="w-full text-xs font-mono">
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="w-1/3 bg-slate-50 p-2.5 font-bold text-slate-600">UNIT PRICE</td>
                  <td className="p-2.5 font-bold text-slate-900">{won(currentPrice)}</td>
                </tr>
                <tr>
                  <td className="bg-slate-50 p-2.5 font-bold text-slate-600">INVENTORY STATUS</td>
                  <td className="p-2.5">
                    {isSoldOut ? (
                      <span className="text-danger font-bold">[OUT OF STOCK]</span>
                    ) : (
                      <span>
                        AVAILABLE <span className="font-bold" data-testid={`detail-stock-${id}`}>{currentStock}</span> UNITS
                      </span>
                    )}
                  </td>
                </tr>
                {product.materialInfo && (
                  <tr>
                    <td className="bg-slate-50 p-2.5 font-bold text-slate-600">MATERIAL SPEC</td>
                    <td className="p-2.5 text-slate-700">{product.materialInfo}</td>
                  </tr>
                )}
                {product.sizeGuide && (
                  <tr>
                    <td className="bg-slate-50 p-2.5 font-bold text-slate-600">DIMENSION / SIZE</td>
                    <td className="p-2.5 text-slate-700">{product.sizeGuide}</td>
                  </tr>
                )}
                {product.description && (
                  <tr>
                    <td className="bg-slate-50 p-2.5 font-bold text-slate-600 align-top">DESCRIPTION</td>
                    <td className="p-2.5 text-slate-700 whitespace-pre-line leading-relaxed">
                      {product.description}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Action / Buy Box */}
          <div className="border border-slate-300 bg-white p-4 space-y-4 font-mono">
            {hasVariants && (
              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-slate-600">SELECT VARIANT [SKU]</span>
                <select
                  data-testid="variant-select"
                  className="border border-slate-300 bg-white p-2 text-xs font-mono text-slate-900"
                  value={selectedVariantId ?? ""}
                  onChange={(e) => setSelectedVariantId(Number(e.target.value))}
                >
                  {allVariants.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.stock === 0}>
                      {v.name} [{v.sku}] {v.priceDelta !== 0 ? `(${v.priceDelta > 0 ? "+" : ""}${won(v.priceDelta)})` : ""} {v.stock === 0 ? "[품절]" : `(재고 ${v.stock}개)`}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {isSoldOut ? (
              <button type="button" className="btn w-full font-mono text-xs" disabled>
                ITEM CURRENTLY OUT OF STOCK
              </button>
            ) : (
              <div className="space-y-3">
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
                        className="btn border border-slate-900 px-4 py-2 text-xs font-mono text-slate-900 hover:bg-slate-100"
                      >
                        담기
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAddToCart}
                      className="btn border border-slate-900 bg-white px-5 py-2.5 text-xs font-mono font-bold text-slate-900 hover:bg-slate-100"
                    >
                      담기
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid="buy-now-btn"
                    onClick={handleBuyNow}
                    className="btn border border-slate-900 bg-slate-900 px-6 py-2.5 text-xs font-mono font-bold text-white hover:bg-slate-800"
                  >
                    바로 구매하기
                  </button>
                </div>

                {added && (
                  <p role="status" className="text-xs text-slate-600 font-mono">
                    [SYSTEM] 상품을 장바구니에 담았습니다 (ADDED TO CART).{" "}
                    <Link href="/cart" className="underline font-bold text-slate-900">
                      PROCEED TO CART
                    </Link>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reviews Parameter Section */}
      <section className="mt-12 border border-slate-300 bg-white p-6 font-mono" data-testid="product-reviews">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
          <h2 className="text-sm font-bold text-slate-900">[USER VERIFICATION & REVIEWS]</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-amber-700" data-testid="product-average-rating">
              ★ {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
            </span>
            <span className="text-slate-500" data-testid="product-review-count">
              ({reviewCount} RECORDED)
            </span>
          </div>
        </div>

        {reviews.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            NO RECORDED REVIEWS IN ARCHIVE MATRIX.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {reviews.map((r) => (
              <div key={r.id} data-testid={`product-review-item-${r.id}`} className="py-3 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-500">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-700">{"★".repeat(r.rating)}</span>
                    <span className="font-bold text-slate-800">{r.authorName}</span>
                    {r.variantName && <span>[{r.variantName}]</span>}
                  </div>
                  <span>{new Date(r.createdAt).toISOString().slice(0, 10)}</span>
                </div>
                <p className="text-slate-800 leading-relaxed font-sans text-xs">{r.content}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}
