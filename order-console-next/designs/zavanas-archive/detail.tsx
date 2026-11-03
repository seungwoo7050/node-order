"use client";

import Link from "next/link";
import { Stepper } from "@/app/shop/stepper";
import {
  useStorefrontDetailViewModel,
  won,
} from "@/lib/storefront-view-model";
import { StudioProductArtwork } from "../product-artwork";
import type { DetailDesignProps } from "../types";
import styles from "./zavanas-archive.module.css";

export function ZavanasArchiveDetail({
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
      data-design="zavanas-archive"
      data-testid="product-detail"
      className={styles.datasheet}
    >
      <div className={styles.datasheetHeader}>
        <div>
          <span className={styles.orangeDot} />
          <span>TECHNICAL DATASHEET // ARCH-{String(id).padStart(4, "0")}</span>
        </div>
        <div>SECTOR: {product.categoryPath.join(" > ") || "GENERAL"}</div>
      </div>

      <div className={styles.datasheetBody}>
        {/* Left: CAD Viewport */}
        <div className={styles.datasheetLeft}>
          <div className="aspect-square w-full overflow-hidden border border-[#111315] bg-white">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                width={500}
                height={500}
                className="aspect-square size-full object-cover"
              />
            ) : (
              <StudioProductArtwork id={product.id} design="zavanas-archive" />
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 border border-[#111315] bg-white text-[11px]">
            <div className="border-r border-[#111315] p-2.5">
              <span className="block text-[9px] text-[#4b5563]">
                ARCHIVE ID
              </span>
              <strong className="text-[#111315]">
                #ARCH-{String(id).padStart(4, "0")}
              </strong>
            </div>
            <div className="p-2.5">
              <span className="block text-[9px] text-[#4b5563]">
                VERIFICATION
              </span>
              <strong className={styles.orangeText}>PASSED // REV.36</strong>
            </div>
          </div>
        </div>

        {/* Right: Parameter Matrix & Controls */}
        <div className={styles.datasheetRight}>
          <div className="space-y-5">
            <div>
              <span className="text-[10px] uppercase tracking-widest text-[#4b5563]">
                ITEM SPECIFICATION
              </span>
              <h1
                id="product-title"
                className={`${styles.datasheetHeading} mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-[#111315]`}
              >
                {product.name}
              </h1>
            </div>

            <div className="border border-[#111315] bg-white">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-[#cfd6dd]">
                  <tr>
                    <td className="w-1/3 bg-[#f3f5f7] p-3 font-bold text-[#4b5563]">
                      UNIT PRICE
                    </td>
                    <td className="p-3 font-bold text-base text-[#111315]">
                      {won(currentPrice)}
                    </td>
                  </tr>
                  <tr>
                    <td className="bg-[#f3f5f7] p-3 font-bold text-[#4b5563]">
                      INVENTORY STATUS
                    </td>
                    <td className="p-3">
                      {isSoldOut ? (
                        <span className="text-danger font-bold">
                          [OUT OF STOCK]
                        </span>
                      ) : (
                        <span>
                          AVAILABLE{" "}
                          <span
                            className="font-bold text-[#111315]"
                            data-testid={`detail-stock-${id}`}
                          >
                            {currentStock}
                          </span>{" "}
                          UNITS
                        </span>
                      )}
                    </td>
                  </tr>
                  {product.materialInfo && (
                    <tr>
                      <td className="bg-[#f3f5f7] p-3 font-bold text-[#4b5563]">
                        MATERIAL SPEC
                      </td>
                      <td className="p-3 text-[#111315]">
                        {product.materialInfo}
                      </td>
                    </tr>
                  )}
                  {product.sizeGuide && (
                    <tr>
                      <td className="bg-[#f3f5f7] p-3 font-bold text-[#4b5563]">
                        DIMENSION / SIZE
                      </td>
                      <td className="p-3 text-[#111315]">
                        {product.sizeGuide}
                      </td>
                    </tr>
                  )}
                  {product.description && (
                    <tr>
                      <td className="bg-[#f3f5f7] p-3 font-bold text-[#4b5563] align-top">
                        DESCRIPTION
                      </td>
                      <td className="p-3 text-[#111315] whitespace-pre-line leading-relaxed font-sans">
                        {product.description}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 border-t border-[#111315] pt-5 space-y-4">
            {hasVariants && (
              <label className="grid gap-1.5">
                <span className="text-[11px] font-bold text-[#111315]">
                  SELECT VARIANT [SKU]
                </span>
                <select
                  data-testid="variant-select"
                  className="border border-[#111315] bg-[#f3f5f7] p-2.5 text-xs font-mono text-[#111315]"
                  value={selectedVariantId ?? ""}
                  onChange={(e) => setSelectedVariantId(Number(e.target.value))}
                >
                  {allVariants.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.stock === 0}>
                      {v.name} [{v.sku}]{" "}
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
                className="btn w-full font-mono text-xs py-3.5"
                disabled
              >
                ITEM CURRENTLY OUT OF STOCK
              </button>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {inCartQuantity > 0 ? (
                    <div className="flex items-center justify-between border border-[#111315] bg-[#f3f5f7] px-2">
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
                        className="btn border-0 text-xs font-mono hover:underline"
                      >
                        담기
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAddToCart}
                      className="border border-[#111315] bg-white py-3.5 text-xs font-mono font-bold text-[#111315] hover:bg-[#f3f5f7] transition-colors cursor-pointer"
                    >
                      담기
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid="buy-now-btn"
                    onClick={handleBuyNow}
                    className={`${styles.buyNowOrangeBtn} py-3.5 text-xs font-mono font-bold hover:opacity-90 transition-opacity cursor-pointer`}
                  >
                    바로 구매하기
                  </button>
                </div>

                {added && (
                  <p role="status" className="text-xs text-[#4b5563] font-mono">
                    [SYSTEM] 상품을 장바구니에 담았습니다.{" "}
                    <Link
                      href="/cart"
                      className="underline font-bold text-[#111315]"
                    >
                      PROCEED TO CART
                    </Link>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reviews Telemetry Log */}
      <section className="p-6" data-testid="product-reviews">
        <div className="flex items-center justify-between border-b border-[#cfd6dd] pb-3 mb-4">
          <h2 className="text-xs font-bold tracking-wider text-[#111315]">
            [USER VERIFICATION & FIELD LOGS]
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`${styles.orangeText} font-bold`}
              data-testid="product-average-rating"
            >
              ★ {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
            </span>
            <span className="text-[#4b5563]" data-testid="product-review-count">
              ({reviewCount} RECORDED)
            </span>
          </div>
        </div>

        {reviews.length === 0 ? (
          <p className="py-6 text-center text-xs text-[#4b5563]">
            NO RECORDED REVIEWS IN ARCHIVE MATRIX.
          </p>
        ) : (
          <div className="divide-y divide-[#cfd6dd]">
            {reviews.map((r) => (
              <div
                key={r.id}
                data-testid={`product-review-item-${r.id}`}
                className="py-3 text-xs space-y-1"
              >
                <div className="flex items-center justify-between text-[#4b5563]">
                  <div className="flex items-center gap-2">
                    <span className={styles.orangeText}>
                      {"★".repeat(r.rating)}
                    </span>
                    <span className="font-bold text-[#111315]">
                      {r.authorName}
                    </span>
                    {r.variantName && <span>[{r.variantName}]</span>}
                  </div>
                  <span>{new Date(r.createdAt).toISOString().slice(0, 10)}</span>
                </div>
                <p className="text-[#111315] leading-relaxed font-sans text-xs">
                  {r.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}
