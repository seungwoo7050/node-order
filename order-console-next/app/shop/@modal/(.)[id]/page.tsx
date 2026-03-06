import { Suspense } from "react";
import { LoadError } from "../../../load-error";
import { Modal } from "../../modal";
import { ProductDetail } from "../../product-detail";

export default function ProductModal({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Modal>
      <LoadError what="상품">
        <Suspense fallback={<p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>}>
          <ProductDetail params={params} />
        </Suspense>
      </LoadError>
    </Modal>
  );
}
