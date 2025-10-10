import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <h1>이 주문은 취소되어 상세 정보가 없습니다.</h1>
      <Link href="/orders">목록으로</Link>
    </main>
  );
}