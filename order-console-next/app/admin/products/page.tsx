import { connection } from "next/server";
import { Suspense } from "react";
import { getProducts } from "@/lib/catalog";
import { AdminOnly } from "./admin-only";
import { ProductImageUploader } from "./product-image-uploader";
import { StockCell } from "./stock-cell";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

async function ProductTable() {
  await connection();
  const products = await getProducts();
  return (
    <>
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-line-strong">
          <th scope="col" className="label py-3 font-normal">상품</th>
          <th scope="col" className="label hidden py-3 font-normal sm:table-cell">가격</th>
          <th scope="col" className="label hidden py-3 font-normal sm:table-cell">재고</th>
          <th scope="col" className="label hidden py-3 font-normal sm:table-cell">입고·조정</th>
          <th scope="col" className="label py-3 font-normal">이미지</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr key={p.id} className="border-b border-line">
            <td className="py-3">
              <span className="flex items-center gap-3">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" width={36} height={36} className="size-9 object-cover" data-testid={`image-${p.id}`} />
                ) : (
                  <span aria-hidden="true" className="grid size-9 place-items-center bg-surface font-serif text-sm text-faint">{p.name.slice(0, 1)}</span>
                )}
                {p.name}
              </span>
            </td>
            <td className="num hidden py-3 sm:table-cell" data-testid={`price-${p.id}`}>{won(p.price)}</td>
            <StockCell productId={p.id} name={p.name} />
            <td className="py-3"><ProductImageUploader productId={p.id} hasImage={p.imageUrl !== null} /></td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

export default function AdminProductsPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">상품 관리</h1>
      <AdminOnly>
        <Suspense fallback={<p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>}>
          <ProductTable />
        </Suspense>
      </AdminOnly>
    </main>
  );
}
