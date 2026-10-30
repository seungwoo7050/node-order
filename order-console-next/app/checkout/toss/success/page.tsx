"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/api-client";
import { useTRPC } from "@/lib/trpc";

// 토스 성공 리다이렉트(?paymentKey&orderId&amount). 여기서는 결제 완료로 보이지 않는다:
// 서버가 금액을 DB와 비교하고 토스 승인 API를 부른 뒤에야 결제 완료다
function ConfirmPayment() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const paymentKey = params.get("paymentKey");
  const orderId = params.get("orderId");
  const amount = Number(params.get("amount"));

  useEffect(() => {
    if (started.current || !paymentKey || !orderId) return;
    started.current = true;
    (async () => {
      try {
        const res = await authFetch<{ orderId: number; status: string }>("/payments/toss/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentKey, orderId, amount }),
        });
        void queryClient.invalidateQueries({ queryKey: trpc.me.orders.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.me.order.pathKey() });
        router.replace(`/me/orders/${res.orderId}?checkout=success`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "알 수 없는 오류");
      }
    })();
  }, [paymentKey, orderId, amount, router, queryClient, trpc]);

  if (!paymentKey || !orderId) return <p role="alert" className="alert">결제 결과가 비어 있습니다. <Link href="/me/orders">내 주문</Link>에서 상태를 확인해 주세요.</p>;
  if (error) return <p role="alert" className="alert">결제를 확인하지 못했습니다: {error} - <Link href="/me/orders">내 주문</Link>에서 상태를 확인해 주세요.</p>;
  return <p role="status" className="text-sm text-muted">결제를 승인하는 중입니다. 창을 닫지 마세요.</p>;
}

export default function TossSuccessPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">결제 확인</h1>
      <Suspense fallback={<p role="status" className="text-sm text-muted">결제를 확인하는 중입니다.</p>}>
        <ConfirmPayment />
      </Suspense>
    </main>
  );
}
