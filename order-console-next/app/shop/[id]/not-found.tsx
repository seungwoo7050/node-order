import Link from "next/link";

export default function ProductNotFound() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-4">상품을 찾을 수 없습니다</h1>
      <p className="note">주소의 상품 번호가 없거나 지워진 상품입니다. <Link href="/shop">상품 목록</Link>에서 다시 골라 주세요.</p>
    </main>
  );
}
