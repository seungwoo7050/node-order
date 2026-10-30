"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/api-client";
import { loadTossSdk, type TossWidgets } from "@/lib/toss-sdk";

// API가 정한 결제 정보(GET /payments/toss/checkout/:id). 금액과 주문번호를 브라우저가 정하지 않는다
type TossCheckout = {
  orderId: number;
  providerOrderId: string;
  amount: number;
  orderName: string;
  customerKey: string;
  clientKey: string;
  sdkUrl: string;
};

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function TossWidget({ info }: { info: TossCheckout }) {
  const widgets = useRef<TossWidgets | null>(null);
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 위젯은 한 번만 그린다(개발 모드의 effect 두 번 실행에도)
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const TossPayments = await loadTossSdk(info.sdkUrl);
        const w = TossPayments(info.clientKey).widgets({ customerKey: info.customerKey });
        await w.setAmount({ currency: "KRW", value: info.amount });
        await Promise.all([
          w.renderPaymentMethods({ selector: "#toss-payment-methods", variantKey: "DEFAULT" }),
          w.renderAgreement({ selector: "#toss-agreement", variantKey: "AGREEMENT" }),
        ]);
        widgets.current = w;
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "결제 화면을 띄우지 못했습니다");
      }
    })();
  }, [info]);

  const pay = async () => {
    if (!widgets.current) return;
    setPaying(true);
    try {
      // 성공하면 successUrl?paymentKey&orderId&amount로 돌아온다. 승인은 그 페이지가 서버에 맡긴다
      await widgets.current.requestPayment({
        orderId: info.providerOrderId,
        orderName: info.orderName,
        successUrl: `${window.location.origin}/checkout/toss/success`,
        failUrl: `${window.location.origin}/checkout/toss/fail`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "결제를 요청하지 못했습니다");
      setPaying(false);
    }
  };

  return (
    <section data-testid="toss-checkout">
      <p className="mb-6 flex items-baseline justify-between border-y border-line py-4">
        <span>{info.orderName}</span>
        <span className="num text-xl font-normal">{won(info.amount)}</span>
      </p>
      <div id="toss-payment-methods" className="mb-4 min-h-12" />
      <div id="toss-agreement" className="mb-6" />
      {!ready && !error && <p role="status" className="mb-4 text-sm text-muted">결제 화면을 불러오는 중입니다.</p>}
      {error && <p role="alert" className="alert mb-4">{error}</p>}
      <button type="button" className="btn btn-primary w-full max-w-sm" disabled={!ready || paying} onClick={pay}>
        {paying ? "결제창으로 이동하는 중…" : `${won(info.amount)} 결제하기`}
      </button>
    </section>
  );
}

export default function TossCheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const info = useQuery({
    queryKey: ["toss-checkout", id],
    queryFn: () => authFetch<TossCheckout>(`/payments/toss/checkout/${id}`),
    retry: false,
    staleTime: 0,
  });
  return (
    <main className="page flex-1 pb-12 pt-2">
      <p className="label mb-1"><Link href="/me/orders">내 주문</Link> / #{id}</p>
      <h1 className="title mb-8">토스페이먼츠로 결제</h1>
      {info.isPending && <p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>}
      {info.error && (
        <p role="alert" className="alert">
          결제를 이어 갈 수 없습니다: {info.error.message} - <Link href={`/me/orders/${id}`}>주문 보기</Link>
        </p>
      )}
      {info.data && <TossWidget info={info.data} />}
    </main>
  );
}
