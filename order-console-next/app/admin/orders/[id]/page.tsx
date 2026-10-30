"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { authFetch } from "@/lib/api-client";
import {
  CARRIER_OPTIONS, ORDER_STATUS_LABEL, REFUND_STATUS_LABEL, RETURN_KIND_LABEL, RETURN_REASON_LABEL, RETURN_STATUS_LABEL, won, type OrderStatusCode,
} from "@/lib/orders";
import { Shipments, Timeline } from "../../../me/orders/[id]/fulfillment";
import { AdminOnly, useReadOnly } from "../../products/admin-only";

type AdminReturn = {
  id: number; kind: keyof typeof RETURN_KIND_LABEL; status: keyof typeof RETURN_STATUS_LABEL; reason: keyof typeof RETURN_REASON_LABEL;
  detail: string | null; refundAmount: number | null; rejectReason: string | null;
  items: { productId: number; quantity: number; product: { name: string } }[];
  refund: { amount: number; status: keyof typeof REFUND_STATUS_LABEL } | null;
  actions: ("approve" | "reject" | "ship")[];
};
type AdminOrder = {
  id: number; userId: string; status: OrderStatusCode; price: number; subtotal: number; shippingFee: number; createdAt: string;
  shipping: { recipientName: string; recipientPhone: string; postalCode: string; address1: string; address2: string | null; deliveryMemo: string | null } | null;
  items: { quantity: number; unitPrice: number; product: { id: number; name: string } }[];
  history: { toStatus: OrderStatusCode; createdAt: string }[];
  shipments: { id: number; returnId: number | null; carrierName: string; trackingNumber: string; trackingUrl: string | null; shippedAt: string }[];
  payment: { provider: string; status: string; amount: number } | null;
  returns: AdminReturn[];
  actions: ("prepare" | "ship" | "deliver" | "cancel")[];
};

const READ_ONLY = "데모 관리자는 볼 수만 있습니다. 배송 준비·송장 입력·취소·반품 처리는 진짜 관리자만 할 수 있어 버튼을 꺼 두었습니다.";
const orderKey = (id: number) => ["admin-order", id] as const;

// 동작 하나(POST). 응답의 주문(또는 { order })으로 화면을 바꾼다
function useAction(orderId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      authFetch<AdminOrder | { order: AdminOrder }>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(orderKey(orderId), "order" in res ? res.order : res);
      void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    },
  });
}

function ShipmentForm({ label, onSubmit, pending }: { label: string; onSubmit: (v: { carrier: string; trackingNumber: string }) => void; pending: boolean }) {
  const readOnly = useReadOnly();
  const [carrier, setCarrier] = useState<string>(CARRIER_OPTIONS[0].code);
  const [trackingNumber, setTrackingNumber] = useState("");
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); onSubmit({ carrier, trackingNumber }); }}>
      <label className="sr-only" htmlFor={`${label}-carrier`}>택배사</label>
      <select id={`${label}-carrier`} className="border border-line px-2 py-1 text-sm" value={carrier} onChange={(e) => setCarrier(e.target.value)} disabled={readOnly}>
        {CARRIER_OPTIONS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
      <input aria-label="송장번호" className="num w-44 border border-line px-2 py-1 text-sm" inputMode="numeric" placeholder="송장번호"
        value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} required disabled={readOnly} />
      <button type="submit" className="btn" disabled={readOnly || pending}>{label}</button>
    </form>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mb-3 sm:mb-0">{children}</dd>
    </>
  );
}

function OrderDetail({ id }: { id: number }) {
  const readOnly = useReadOnly();
  const { data, isPending, error } = useQuery({ queryKey: orderKey(id), queryFn: () => authFetch<AdminOrder>(`/admin/orders/${id}`) });
  const action = useAction(id);
  const [rejectReason, setRejectReason] = useState("");
  if (isPending) return <p role="status" className="text-sm text-muted">주문을 불러오는 중입니다.</p>;
  if (error) return <p role="alert" className="alert">주문을 불러오지 못했습니다. ({error.message})</p>;
  const post = (path: string, body?: unknown) => action.mutate({ path, body });
  const button = (label: string, path: string) => (
    <button type="button" className="btn" disabled={readOnly || action.isPending} onClick={() => post(path)}>{label}</button>
  );

  return (
    <section data-testid="admin-order-detail">
      <p className="label mb-1"><Link href="/admin/orders">주문 관리</Link> / #{data.id}</p>
      <h2 className="title mb-6">주문 #{data.id} <span className="text-base text-muted" data-testid="admin-order-status">{ORDER_STATUS_LABEL[data.status]}</span></h2>

      <div className="mb-8 flex flex-wrap items-center gap-3" data-testid="admin-actions">
        {data.actions.includes("prepare") && button("배송 준비", `/admin/orders/${id}/prepare`)}
        {data.actions.includes("ship") && <ShipmentForm label="송장 입력" pending={action.isPending} onSubmit={(v) => post(`/admin/orders/${id}/shipment`, v)} />}
        {data.actions.includes("deliver") && button("배송 완료", `/admin/orders/${id}/deliver`)}
        {data.actions.includes("cancel") && button("주문 취소(전액 환불)", `/admin/orders/${id}/cancel`)}
        {data.actions.length === 0 && <p className="text-sm text-muted">지금 상태에서 할 수 있는 주문 동작이 없습니다.</p>}
      </div>
      {action.error && <p role="alert" className="alert mb-6">{action.error.message}</p>}

      <dl className="grid items-baseline gap-x-8 gap-y-1 border-y border-line py-6 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-3">
        <Row label="손님">{data.userId}</Row>
        <Row label="금액"><span className="num">{won(data.price)}</span> <span className="text-[0.82rem] text-muted">(상품 {won(data.subtotal)} + 배송비 {won(data.shippingFee)})</span></Row>
        <Row label="결제">{data.payment ? `${data.payment.provider} · ${data.payment.status}` : "-"}</Row>
        <Row label="상품">
          <ul className="grid max-w-md gap-y-1">
            {data.items.map((it) => (
              <li key={it.product.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6">
                <span>{it.product.name}</span><span className="num text-right text-muted">{won(it.unitPrice)} × {it.quantity}</span>
              </li>
            ))}
          </ul>
        </Row>
        <Row label="배송지">
          {data.shipping ? (
            <span className="text-sm">
              {data.shipping.recipientName} · <span className="num">{data.shipping.recipientPhone}</span><br />
              ({data.shipping.postalCode}) {data.shipping.address1} {data.shipping.address2}
              {data.shipping.deliveryMemo && <><br /><span className="text-muted">메모: {data.shipping.deliveryMemo}</span></>}
            </span>
          ) : "-"}
        </Row>
        <Row label="진행"><Timeline createdAt={data.createdAt} history={data.history} /></Row>
        {data.shipments.length > 0 && <Row label="송장"><Shipments shipments={data.shipments} /></Row>}
      </dl>

      {data.returns.length > 0 && (
        <section className="mt-8">
          <h3 className="subtitle mb-4">반품·교환 요청</h3>
          <ul className="grid gap-y-6 text-sm" data-testid="admin-returns">
            {data.returns.map((r) => (
              <li key={r.id} className="border-b border-line pb-4" data-testid={`admin-return-${r.id}`}>
                <p>{RETURN_KIND_LABEL[r.kind]} #{r.id} · {RETURN_REASON_LABEL[r.reason]} · <span data-testid="admin-return-status">{RETURN_STATUS_LABEL[r.status]}</span></p>
                <p className="text-muted">{r.items.map((i) => `${i.product.name} × ${i.quantity}`).join(", ")}{r.detail && ` - ${r.detail}`}</p>
                {r.refundAmount !== null && <p>환불 금액 <span className="num">{won(r.refundAmount)}</span>{r.refund && ` · ${REFUND_STATUS_LABEL[r.refund.status]}`}</p>}
                {r.rejectReason && <p className="text-muted">거절 사유: {r.rejectReason}</p>}
                {r.actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {r.actions.includes("approve") && button(r.kind === "refund" ? "반품 승인(환불)" : "교환 승인", `/admin/returns/${r.id}/approve`)}
                    {r.actions.includes("reject") && (
                      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); post(`/admin/returns/${r.id}/reject`, { reason: rejectReason }); }}>
                        <input aria-label="거절 사유" className="w-44 border border-line px-2 py-1" placeholder="거절 사유" required
                          value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} disabled={readOnly} />
                        <button type="submit" className="btn" disabled={readOnly || action.isPending}>거절</button>
                      </form>
                    )}
                    {r.actions.includes("ship") && <ShipmentForm label="교환품 송장 입력" pending={action.isPending} onSubmit={(v) => post(`/admin/returns/${r.id}/shipment`, v)} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

export default function AdminOrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <main className="page flex-1 pb-12 pt-2">
      <AdminOnly readOnlyNote={READ_ONLY} note={null}>
        <OrderDetail id={Number(id)} />
      </AdminOnly>
    </main>
  );
}
