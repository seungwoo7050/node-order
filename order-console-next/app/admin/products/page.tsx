"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { productListOptions } from "@/lib/lists";
import { useTRPC } from "@/lib/trpc";
import { LoadMore } from "../../load-more";
import { ProductImageUploader } from "./product-image-uploader";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function ProductTable({ readOnly }: { readOnly: boolean }) {
  const trpc = useTRPC();
  const { data, isPending, error, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useInfiniteQuery(productListOptions(trpc));
  if (isPending) return <p role="status" className="text-sm text-muted">상품을 불러오는 중입니다.</p>;
  if (error && !data) return <p role="alert" className="alert">상품을 불러오지 못했습니다. ({error.message})</p>;
  const products = data.pages.flatMap((page) => page.items);
  return (
    <>
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-line-strong">
          <th scope="col" className="label py-3 font-normal">상품</th>
          <th scope="col" className="label hidden py-3 font-normal sm:table-cell">가격</th>
          <th scope="col" className="label hidden py-3 font-normal sm:table-cell">재고</th>
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
            <td className="num hidden py-3 sm:table-cell">{won(p.price)}</td>
            <td className="num hidden py-3 sm:table-cell">{p.stock}</td>
            <td className="py-3"><ProductImageUploader productId={p.id} hasImage={p.imageUrl !== null} readOnly={readOnly} /></td>
          </tr>
        ))}
      </tbody>
    </table>
    <LoadMore hasNextPage={hasNextPage} isFetchingNextPage={isFetchingNextPage} isFetchNextPageError={isFetchNextPageError}
      fetchNextPage={fetchNextPage} loaded={products.length} pages={data.pages.length} noun="상품" />
    </>
  );
}

export default function AdminProductsPage() {
  const trpc = useTRPC();
  const { data: profile, isPending, error } = useQuery({ ...trpc.me.profile.queryOptions(), retry: false });
  let body;
  if (isPending) body = <p role="status" className="text-sm text-muted">확인하는 중입니다.</p>;
  else if (error?.data?.code === "UNAUTHORIZED") body = <p className="note">관리자 계정으로 <Link href="/login">로그인</Link>해 주세요.</p>;
  else if (error) body = <p role="alert" className="alert">확인하지 못했습니다. ({error.message})</p>;
  else if (profile.role !== "admin" && profile.role !== "demo_admin") body = <p className="note">관리자만 볼 수 있는 화면입니다.</p>;
  else
    body = (
      <>
        {profile.role === "demo_admin" ? (
          <p id="read-only-note" className="note mb-8" data-testid="read-only-note">
            데모 관리자는 볼 수만 있습니다. 사진 올리기·바꾸기는 진짜 관리자만 할 수 있어 버튼을 꺼 두었습니다.
          </p>
        ) : (
          <p className="note mb-8">이미지는 PNG·JPEG·WebP, 2MB까지 올릴 수 있습니다. 올린 이미지는 상품 화면에 바로 보입니다.</p>
        )}
        <ProductTable readOnly={profile.role === "demo_admin"} />
      </>
    );
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">상품 관리</h1>
      {body}
    </main>
  );
}
