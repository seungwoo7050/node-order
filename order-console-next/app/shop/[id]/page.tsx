import Link from "next/link";
import { Suspense } from "react";
import { LoadError } from "../../load-error";
import { ProductDetail } from "../product-detail";

export default function ProductPage({ params }: PageProps<"/shop/[id]">) {
  return (
    <main className="w-full flex-1 pb-16 pt-6">
      <div className="storefront-container">
        <p className="label mb-6 tracking-[0.14em] uppercase">
          <Link href="/shop" className="no-underline hover:underline">
            ARCHIVE CATALOG
          </Link>{" "}
          <span className="mx-1.5 opacity-50">/</span>
          <span>상품 상세</span>
        </p>
        <LoadError what="상품">
          <Suspense
            fallback={
              <p role="status" className="text-sm text-muted">
                상품을 불러오는 중입니다.
              </p>
            }
          >
            <ProductDetail params={params} />
          </Suspense>
        </LoadError>
      </div>
    </main>
  );
}
