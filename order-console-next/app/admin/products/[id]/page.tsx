import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProduct } from "@/lib/catalog";
import { LoadError } from "../../../load-error";
import { AdminOnly } from "../admin-only";
import { EditProductForm } from "./edit-product-form";

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const product = Number.isInteger(id) && id > 0 ? await getProduct(id) : null;
  if (!product) notFound();
  return <EditProductForm product={product} />;
}

export default function EditProductPage({ params }: PageProps<"/admin/products/[id]">) {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <p className="label mb-1"><Link href="/admin/products">상품 관리</Link> / 수정</p>
      <h1 className="title mb-8">상품 수정</h1>
      <AdminOnly>
        <LoadError what="상품">
          <Suspense fallback={<p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>}>
            <Editor params={params} />
          </Suspense>
        </LoadError>
      </AdminOnly>
    </main>
  );
}
