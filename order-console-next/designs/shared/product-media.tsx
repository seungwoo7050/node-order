import type { StorefrontProduct } from "@/lib/storefront-view-model";

/** 사진이 없으면 빈 플레이트(장식 SVG 금지). image-{id}는 카탈로그 <img>에만 */
export function ProductMedia({
  product,
  imgClassName,
  fallbackClassName,
  withTestId = false,
  eager = false,
}: {
  product: Pick<StorefrontProduct, "id" | "name" | "imageUrl">;
  imgClassName?: string;
  fallbackClassName?: string;
  withTestId?: boolean;
  eager?: boolean;
}) {
  if (product.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={product.imageUrl}
        alt={product.name}
        width={1200}
        height={1500}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={imgClassName}
        data-testid={withTestId ? `image-${product.id}` : undefined}
      />
    );
  }
  return <span aria-hidden="true" className={fallbackClassName} />;
}
