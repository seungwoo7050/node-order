"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authFetch } from "@/lib/api-client";
import {
  ORDER_STATUS_LABEL, REFUND_STATUS_LABEL, RETURN_KIND_LABEL, RETURN_REASON_LABEL, RETURN_STATUS_LABEL, dateTime, won, type OrderStatusCode,
} from "@/lib/orders";
import { useTRPC } from "@/lib/trpc";

type History = { toStatus: OrderStatusCode; createdAt: string };
type Shipment = { id: number; returnId: number | null; carrierName: string; trackingNumber: string; trackingUrl: string | null; shippedAt: string };
type ReturnRow = {
  id: number; kind: keyof typeof RETURN_KIND_LABEL; status: keyof typeof RETURN_STATUS_LABEL; reason: keyof typeof RETURN_REASON_LABEL;
  refundAmount: number | null; rejectReason: string | null; requestedAt: string;
  items: { productId: number; quantity: number; product: { name: string } }[];
  refund: { amount: number; status: keyof typeof REFUND_STATUS_LABEL } | null;
};

// 상태 타임라인: 주문 접수 + 전이 이력
export function Timeline({ createdAt, history }: { createdAt: string; history: History[] }) {
  const steps = [{ label: "주문 접수", at: createdAt }, ...history.map((h) => ({ label: ORDER_STATUS_LABEL[h.toStatus], at: h.createdAt }))];
  return (
    <ol className="grid gap-y-1 text-sm" data-testid="order-timeline">
      {steps.map((s, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6">
          <span>{s.label}</span>
          <span className="num text-muted">{dateTime(s.at)}</span>
        </li>
      ))}
    </ol>
  );
}

export function Shipments({ shipments }: { shipments: Shipment[] }) {
  return (
    <ul className="grid gap-y-1 text-sm" data-testid="shipments">
      {shipments.map((s) => (
        <li key={s.id}>
          {s.returnId ? "교환품 " : ""}{s.carrierName} <span className="num">{s.trackingNumber}</span>
          {s.trackingUrl && <> · <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">배송 조회</a></>}
        </li>
      ))}
    </ul>
  );
}

export function Returns({ returns }: { returns: ReturnRow[] }) {
  return (
    <ul className="grid gap-y-3 text-sm" data-testid="returns">
      {returns.map((r) => (
        <li key={r.id} data-testid={`return-${r.id}`}>
          <p>
            {RETURN_KIND_LABEL[r.kind]} #{r.id} · {RETURN_REASON_LABEL[r.reason]} · <span data-testid="return-status">{RETURN_STATUS_LABEL[r.status]}</span>
          </p>
          <p className="text-muted">{r.items.map((i) => `${i.product.name} × ${i.quantity}`).join(", ")}</p>
          {r.refundAmount !== null && (
            <p data-testid="return-refund">
              환불 금액 <span className="num">{won(r.refundAmount)}</span>
              {r.refund && <> · {REFUND_STATUS_LABEL[r.refund.status]}</>}
            </p>
          )}
          {r.rejectReason && <p className="text-muted">거절 사유: {r.rejectReason}</p>}
        </li>
      ))}
    </ul>
  );
}

function useOrderMutation<T>(orderId: number, fn: (input: T) => Promise<unknown>) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: trpc.me.order.queryKey({ id: orderId }) });
      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.pathKey() });
    },
  });
}

export function ConfirmButton({ orderId }: { orderId: number }) {
  const confirm = useOrderMutation(orderId, () => authFetch(`/me/orders/${orderId}/confirm`, { method: "POST" }));
  return (
    <div>
      <button type="button" className="btn" disabled={confirm.isPending} onClick={() => confirm.mutate(undefined)}>
        {confirm.isPending ? "확정하는 중…" : "구매확정"}
      </button>
      <p className="mt-1 text-[0.78rem] text-muted">구매확정하면 반품·교환을 신청할 수 없습니다.</p>
      {confirm.error && <p role="alert" className="alert mt-2">{confirm.error.message}</p>}
    </div>
  );
}

type Returnable = { productId: number; name: string; quantity: number };

export function ReturnForm({ orderId, returnable, deadline, returnShippingFee }: { orderId: number; returnable: Returnable[]; deadline: string; returnShippingFee?: number }) {
  const [kind, setKind] = useState<"refund" | "exchange">("refund");
  const [reason, setReason] = useState<keyof typeof RETURN_REASON_LABEL>("change_of_mind");
  const [detail, setDetail] = useState("");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const items = returnable.filter((r) => (quantities[r.productId] ?? 0) > 0).map((r) => ({ productId: r.productId, quantity: quantities[r.productId]! }));
  const request = useOrderMutation(orderId, () =>
    authFetch(`/me/orders/${orderId}/returns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, reason, detail: detail || undefined, items }),
    }));

  return (
    <form className="grid max-w-md gap-3 text-sm" data-testid="return-form"
      onSubmit={(e) => { e.preventDefault(); if (items.length > 0) request.mutate(undefined, { onSuccess: () => setQuantities({}) }); }}>
      <p className="text-muted">{dateTime(deadline)}까지 신청할 수 있습니다. 단순변심 반품은 왕복 배송비 {won(returnShippingFee ?? 6000)}을 빼고 환불합니다.</p>
      <fieldset className="flex gap-4">
        <legend className="sr-only">종류</legend>
        {(["refund", "exchange"] as const).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <input type="radio" name="return-kind" checked={kind === k} onChange={() => setKind(k)} /> {RETURN_KIND_LABEL[k]}
          </label>
        ))}
      </fieldset>
      <label className="grid gap-1">
        <span className="text-[0.78rem] text-muted">사유</span>
        <select className="border border-line px-2 py-1.5" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
          {Object.entries(RETURN_REASON_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {returnable.filter((r) => r.quantity > 0).map((r) => (
        <label key={r.productId} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3">
          <span>{r.name} <span className="text-muted">(최대 {r.quantity}개)</span></span>
          <input type="number" min={0} max={r.quantity} step={1} className="num border border-line px-2 py-1" aria-label={`${r.name} 반품 수량`}
            value={quantities[r.productId] ?? 0} onChange={(e) => setQuantities({ ...quantities, [r.productId]: Math.min(r.quantity, Math.max(0, Number(e.target.value) || 0)) })} />
        </label>
      ))}
      <label className="grid gap-1">
        <span className="text-[0.78rem] text-muted">자세한 내용 (선택)</span>
        <textarea className="border border-line px-2 py-1.5" rows={2} maxLength={500} value={detail} onChange={(e) => setDetail(e.target.value)} />
      </label>
      <button type="submit" className="btn justify-self-start" disabled={request.isPending} aria-disabled={items.length === 0}>
        {request.isPending ? "신청하는 중…" : "반품·교환 신청"}
      </button>
      {request.error && <p role="alert" className="alert">{request.error.message}</p>}
    </form>
  );
}

type ReviewItem = { id: number; productId: number; rating: number; content: string; createdAt: string };

export function OrderReviewSection({
  orderId,
  items,
  reviews = [],
}: {
  orderId: number;
  items: { product: { id: number; name: string }; variantLabel?: string | null }[];
  reviews?: ReviewItem[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [activeProductId, setActiveProductId] = useState<number | null>(null);
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reviewMutation = useMutation({
    mutationFn: (productId: number) =>
      authFetch(`/me/orders/${orderId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, rating, content }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: trpc.me.order.queryKey({ id: orderId }) });
      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.pathKey() });
      setActiveProductId(null);
      setContent("");
      setRating(5);
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const reviewedProductIds = new Set(reviews.map((r) => r.productId));

  return (
    <section className="mt-8 border-t border-line pt-6" data-testid="order-reviews-section">
      <h2 className="subtitle mb-3">상품 구매 후기</h2>
      <div className="space-y-4">
        {items.map(({ product, variantLabel }) => {
          const isReviewed = reviewedProductIds.has(product.id);
          const existingReview = reviews.find((r) => r.productId === product.id);

          return (
            <div
              key={product.id}
              className="border border-line rounded-lg p-4 bg-neutral-50/50"
              data-testid={`order-item-review-${product.id}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{product.name}</p>
                  {variantLabel && <p className="text-xs text-muted">옵션: {variantLabel}</p>}
                </div>
                {isReviewed ? (
                  <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-medium">
                    작성 완료
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveProductId(activeProductId === product.id ? null : product.id);
                      setError(null);
                    }}
                    data-testid={`open-review-form-${product.id}`}
                    className="btn btn-secondary text-xs px-3 py-1"
                  >
                    {activeProductId === product.id ? "닫기" : "리뷰 작성"}
                  </button>
                )}
              </div>

              {isReviewed && existingReview && (
                <div className="mt-3 text-xs bg-white p-3 rounded border border-line space-y-1">
                  <div className="text-amber-500 font-bold">{"★".repeat(existingReview.rating)} ({existingReview.rating}점)</div>
                  <p className="text-fg">{existingReview.content}</p>
                </div>
              )}

              {activeProductId === product.id && !isReviewed && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!content.trim()) {
                      setError("리뷰 내용을 입력해 주세요.");
                      return;
                    }
                    reviewMutation.mutate(product.id);
                  }}
                  data-testid="review-form"
                  className="mt-4 border-t border-line pt-4 space-y-3"
                >
                  {error && <p role="alert" className="alert text-xs">{error}</p>}
                  <div>
                    <label className="block text-xs text-muted mb-1">별점</label>
                    <select
                      value={rating}
                      onChange={(e) => setRating(Number(e.target.value))}
                      data-testid={`review-rating-${product.id}`}
                      className="border border-line px-2 py-1 text-sm rounded"
                    >
                      <option value={5}>★★★★★ (5점 - 아주 만족해요)</option>
                      <option value={4}>★★★★☆ (4점 - 만족해요)</option>
                      <option value={3}>★★★☆☆ (3점 - 보통이에요)</option>
                      <option value={2}>★★☆☆☆ (2점 - 그냥 그래요)</option>
                      <option value={1}>★☆☆☆☆ (1점 - 실망이에요)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-muted mb-1">후기 내용</label>
                    <textarea
                      rows={3}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="상품의 품질, 착용감, 디자인 등에 대한 솔직한 후기를 남겨주세요."
                      data-testid={`review-content-${product.id}`}
                      className="w-full border border-line p-2 text-sm rounded focus:ring-1 focus:ring-black"
                      required
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveProductId(null)}
                      className="btn btn-secondary text-xs"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      disabled={reviewMutation.isPending}
                      data-testid={`review-submit-${product.id}`}
                      className="btn btn-primary text-xs"
                    >
                      {reviewMutation.isPending ? "등록 중..." : "리뷰 등록"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
