"use client";

import Link from "next/link";
import { useState } from "react";
import { API_URL, authFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { dateTime, won, ORDER_STATUS_LABEL, type OrderStatusCode, type RETURN_KIND_LABEL, type RETURN_REASON_LABEL, type RETURN_STATUS_LABEL, type REFUND_STATUS_LABEL } from "@/lib/orders";
import { ConfirmButton, OrderReviewSection, ReturnForm, Returns, Shipments, Timeline } from "@/app/me/orders/[id]/fulfillment";

type HistoryItem = { toStatus: OrderStatusCode; createdAt: string };
type ShipmentItem = { id: number; returnId: number | null; carrierName: string; trackingNumber: string; trackingUrl: string | null; shippedAt: string };
type ReturnItem = {
  id: number;
  kind: keyof typeof RETURN_KIND_LABEL;
  status: keyof typeof RETURN_STATUS_LABEL;
  reason: keyof typeof RETURN_REASON_LABEL;
  refundAmount: number | null;
  rejectReason: string | null;
  requestedAt: string;
  items: { productId: number; quantity: number; product: { name: string } }[];
  refund: { amount: number; status: keyof typeof REFUND_STATUS_LABEL } | null;
};

interface CustomerOrder {
  id: number;
  userId: string;
  price: number;
  subtotal: number;
  shippingFee: number;
  paid: boolean;
  status: string;
  createdAt: string;
  canceledAt: string | null;
  returnShippingFee?: number;
  shipping: {
    recipientName: string;
    recipientPhone: string;
    postalCode: string;
    address1: string;
    address2?: string | null;
    deliveryMemo?: string | null;
  } | null;
  items: {
    product: { id: number; name: string };
    quantity: number;
    unitPrice: number;
  }[];
  history: HistoryItem[];
  shipments: ShipmentItem[];
  returns: ReturnItem[];
  returnDeadline: string | null;
  returnable: { productId: number; name: string; quantity: number }[];
  canReturn: boolean;
  canConfirm: boolean;
}

export default function GuestOrdersPage() {
  const [orderId, setOrderId] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const idNum = Number(orderId.trim());
    if (!idNum || isNaN(idNum)) {
      setError("올바른 주문번호를 입력해 주세요");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/guest/orders/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: idNum,
          password,
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setError("비회원 주문 비밀번호가 일치하지 않습니다");
        } else if (res.status === 404) {
          setError(`비회원 주문 #${idNum}을 찾을 수 없습니다`);
        } else {
          setError("주문 조회에 실패했습니다");
        }
        setOrder(null);
        setIsLoading(false);
        return;
      }

      const data = (await res.json()) as { order: CustomerOrder; guestAccessToken: string };
      useAuthStore.getState().setAccessToken(data.guestAccessToken);
      setOrder(data.order);
    } catch {
      setError("네트워크 오류가 발생했습니다");
      setOrder(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!order) return;
    if (!confirm("정말 주문을 취소하시겠습니까?")) return;
    setCancelLoading(true);
    try {
      const updated = await authFetch<CustomerOrder>(`/me/orders/${order.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "고객 직접 취소" }),
      });
      setOrder(updated);
    } catch (err) {
      alert((err as Error).message || "주문 취소에 실패했습니다");
    } finally {
      setCancelLoading(false);
    }
  };

  return (
    <main className="page flex-1 pb-12 pt-8">
      <div className="mx-auto max-w-xl">
        <div className="mx-auto max-w-sm">
          <h1 className="title mb-6">비회원 주문 조회</h1>

          <form onSubmit={handleLookup} className="grid gap-4 text-sm mb-8 border-b border-line pb-8" data-testid="guest-lookup-form">
            <label className="grid gap-1">
              <span className="text-muted">주문번호</span>
              <input
                type="number"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                required
                placeholder="숫자만 입력 (예: 12)"
                className="border border-line px-3 py-1.5 num"
                data-testid="guest-order-id"
              />
            </label>

            <label className="grid gap-1">
              <span className="text-muted">비회원 주문 비밀번호</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="주문 시 설정한 비밀번호"
                className="border border-line px-3 py-1.5"
                data-testid="guest-lookup-password"
              />
            </label>

            {error && (
              <p role="alert" className="alert" data-testid="guest-lookup-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn"
              disabled={isLoading}
              data-testid="guest-lookup-submit"
            >
              {isLoading ? "조회 중…" : "주문 조회"}
            </button>
          </form>
        </div>

      {order && (
        <section data-testid="guest-order-detail" className="grid gap-6 border-t border-line pt-6">
          <div className="flex items-center justify-between">
            <h2 className="subtitle">주문 #{order.id}</h2>
            <span className="text-sm font-medium px-2 py-0.5 bg-neutral-100 rounded" data-testid="order-status">
              {ORDER_STATUS_LABEL[order.status as keyof typeof ORDER_STATUS_LABEL] ?? order.status}
            </span>
          </div>

          <dl className="grid grid-cols-[100px_1fr] gap-y-2 text-sm border-y border-line py-4">
            <dt className="text-muted">주문일시</dt>
            <dd className="num">{dateTime(order.createdAt)}</dd>

            <dt className="text-muted">결제금액</dt>
            <dd className="num font-medium" data-testid="order-amount">
              {won(order.price)}
              {order.shippingFee > 0 && (
                <span className="ml-2 text-xs text-muted font-normal">
                  (배송비 {won(order.shippingFee)})
                </span>
              )}
            </dd>

            {order.shipping && (
              <>
                <dt className="text-muted">배송지</dt>
                <dd data-testid="order-shipping">
                  {order.shipping.recipientName} ({order.shipping.recipientPhone})<br />
                  ({order.shipping.postalCode}) {order.shipping.address1} {order.shipping.address2}
                  {order.shipping.deliveryMemo && <><br /><span className="text-muted text-xs">메모: {order.shipping.deliveryMemo}</span></>}
                </dd>
              </>
            )}

            <dt className="text-muted">상품내역</dt>
            <dd>
              <ul className="grid gap-1">
                {order.items.map((it) => (
                  <li key={it.product.id} className="flex justify-between">
                    <span>{it.product.name}</span>
                    <span className="num text-muted">{won(it.unitPrice)} × {it.quantity}</span>
                  </li>
                ))}
              </ul>
            </dd>

            {order.history && order.history.length > 0 && (
              <>
                <dt className="text-muted">진행 이력</dt>
                <dd><Timeline createdAt={order.createdAt} history={order.history} /></dd>
              </>
            )}

            {order.shipments && order.shipments.length > 0 && (
              <>
                <dt className="text-muted">배송 정보</dt>
                <dd><Shipments shipments={order.shipments} /></dd>
              </>
            )}

            {order.returns && order.returns.length > 0 && (
              <>
                <dt className="text-muted">반품/교환</dt>
                <dd><Returns returns={order.returns} /></dd>
              </>
            )}
          </dl>

          {/* 미결제 또는 결제완료 상태에서 취소 버튼 */}
          {(order.status === "pending_payment" || order.status === "paid") && !order.canceledAt && (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn text-danger border-danger hover:bg-danger/10"
                onClick={handleCancel}
                disabled={cancelLoading}
                data-testid="cancel-order-button"
              >
                {cancelLoading ? "취소 중…" : "주문 취소"}
              </button>
            </div>
          )}

          {/* 구매확정 버튼 */}
          {order.canConfirm && (
            <div className="mt-4">
              <ConfirmButton orderId={order.id} />
            </div>
          )}

          {/* 반품/교환 신청 */}
          {order.canReturn && order.returnDeadline && (
            <section className="mt-6 border-t border-line pt-4">
              <h3 className="subtitle mb-3">반품 · 교환 신청</h3>
              <ReturnForm
                orderId={order.id}
                returnable={order.returnable}
                deadline={order.returnDeadline}
                returnShippingFee={order.returnShippingFee}
              />
            </section>
          )}

          {/* 구매 후기 작성 */}
          {order.status === "confirmed" && (
            <OrderReviewSection
              orderId={order.id}
              items={order.items}
              reviews={(order as { reviews?: { id: number; productId: number; rating: number; content: string; createdAt: string }[] }).reviews}
            />
          )}

          <div className="mt-4">
            <Link href={`/me/orders/${order.id}`} className="text-xs text-muted underline">
              주문 상세 전체 화면으로 보기 →
            </Link>
          </div>
        </section>
      )}
      </div>
    </main>
  );
}
