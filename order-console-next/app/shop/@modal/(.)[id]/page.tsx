import { Suspense } from "react";
import { Modal } from "../../modal";
import { ProductDetail } from "../../product-detail";

export default function ProductModal({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Modal>
      <Suspense fallback={<p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>}>
        <ProductDetail params={params} />
      </Suspense>
    </Modal>
  );
}
