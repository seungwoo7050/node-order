"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

// 토스 실패 리다이렉트(?code&message&orderId). 주문은 결제 대기로 남는다
function Failure() {
  const params = useSearchParams();
  const code = params.get("code");
  const message = params.get("message");
  // orderId는 "order-<주문 id>-<임의 값>" 모양(API가 만든다)
  const order = params.get("orderId")?.match(/^order-(\d+)-/)?.[1];
  return (
    <>
      <p role="alert" className="alert mb-4">
        결제가 끝나지 않았습니다{message ? `: ${message}` : ""}{code ? ` (${code})` : ""}
      </p>
      <p className="text-sm text-muted">
        {order ? <>주문 <Link href={`/checkout/toss/${order}`}>#{order}</Link>은 결제 대기로 남아 있습니다. 다시 결제하거나 </> : null}
        <Link href="/me/orders">내 주문</Link>에서 확인해 주세요.
      </p>
    </>
  );
}

export default function TossFailPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">결제 실패</h1>
      <Suspense fallback={null}>
        <Failure />
      </Suspense>
    </main>
  );
}
