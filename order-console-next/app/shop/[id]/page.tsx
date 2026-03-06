import Link from "next/link";
import { Suspense } from "react";
import { LoadError } from "../../load-error";
import { ProductDetail } from "../product-detail";

export default function ProductPage({ params }: PageProps<"/shop/[id]">) {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <p className="label mb-6"><Link href="/shop">상품</Link> / 상세</p>
      <LoadError what="상품">
        <Suspense fallback={<p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>}>
          <ProductDetail params={params} />
        </Suspense>
      </LoadError>
    </main>
  );
}
