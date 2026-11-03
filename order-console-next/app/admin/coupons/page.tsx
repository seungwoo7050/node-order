"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authFetch } from "@/lib/api-client";
import { AdminOnly, useReadOnly } from "../products/admin-only";

type Coupon = {
  id: number;
  code: string;
  name: string;
  discountType: "fixed" | "percent";
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export default function AdminCouponsPage() {
  return (
    <AdminOnly note="프로모션 할인 쿠폰 코드를 발행하고 관리합니다.">
      <CouponsContent />
    </AdminOnly>
  );
}

function CouponsContent() {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [discountValue, setDiscountValue] = useState<number>(1000);
  const [minOrderAmount, setMinOrderAmount] = useState<number>(0);
  const [maxDiscountAmount, setMaxDiscountAmount] = useState<string>("");
  const [maxUses, setMaxUses] = useState<string>("");
  const [startsAt, setStartsAt] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { data: coupons = [], isPending } = useQuery<Coupon[]>({
    queryKey: ["admin-coupons"],
    queryFn: () => authFetch<Coupon[]>("/admin/coupons"),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      authFetch("/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      setCode("");
      setName("");
      setDiscountValue(1000);
      setMinOrderAmount(0);
      setMaxDiscountAmount("");
      setMaxUses("");
      setStartsAt("");
      setExpiresAt("");
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      authFetch(`/admin/coupons/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-coupons"] }),
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      authFetch(`/admin/coupons/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-coupons"] }),
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim() || !name.trim()) {
      setError("쿠폰 코드와 쿠폰명을 입력해 주세요.");
      return;
    }

    createMutation.mutate({
      code: code.trim(),
      name: name.trim(),
      discountType,
      discountValue: Number(discountValue),
      minOrderAmount: Number(minOrderAmount) || 0,
      maxDiscountAmount: maxDiscountAmount ? Number(maxDiscountAmount) : null,
      maxUses: maxUses ? Number(maxUses) : null,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">쿠폰 관리</h1>
        <p className="text-sm text-neutral-500 mt-1">할인 쿠폰을 생성하고 수정·삭제할 수 있습니다.</p>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">
          {error}
        </div>
      )}

      {/* 쿠폰 생성 폼 */}
      <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">새 쿠폰 발행</h2>
        <form onSubmit={handleSubmit} data-testid="coupon-create-form" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">쿠폰 코드 (대문자)</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="예: SUMMER2026"
                disabled={readOnly}
                data-testid="coupon-code-input"
                className="w-full px-3 py-2 border rounded-md text-sm font-mono uppercase focus:ring-1 focus:ring-black"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">쿠폰명</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 여름 맞이 10% 특별 할인"
                disabled={readOnly}
                data-testid="coupon-name-input"
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-black"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">할인 종류</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as "fixed" | "percent")}
                disabled={readOnly}
                data-testid="coupon-discount-type"
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-black"
              >
                <option value="fixed">정액 할인 (원)</option>
                <option value="percent">정률 할인 (%)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                {discountType === "fixed" ? "할인 금액 (원)" : "할인율 (%)"}
              </label>
              <input
                type="number"
                min={1}
                max={discountType === "percent" ? 100 : undefined}
                value={discountValue}
                onChange={(e) => setDiscountValue(Number(e.target.value))}
                disabled={readOnly}
                data-testid="coupon-discount-value"
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-black"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">최소 주문 금액 (원)</label>
              <input
                type="number"
                min={0}
                value={minOrderAmount}
                onChange={(e) => setMinOrderAmount(Number(e.target.value))}
                disabled={readOnly}
                data-testid="coupon-min-order-amount"
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-black"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">최대 할인 한도 (정률 시, 원)</label>
              <input
                type="number"
                min={1}
                value={maxDiscountAmount}
                onChange={(e) => setMaxDiscountAmount(e.target.value)}
                placeholder="비워두면 무제한"
                disabled={readOnly || discountType === "fixed"}
                data-testid="coupon-max-discount-amount"
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-black disabled:bg-neutral-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">총 사용 가능 횟수</label>
              <input
                type="number"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="비워두면 무제한"
                disabled={readOnly}
                data-testid="coupon-max-uses"
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-black"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">만료 일시 (선택)</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={readOnly}
                data-testid="coupon-expires-at"
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-black"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={readOnly || createMutation.isPending}
              data-testid="coupon-create-submit"
              className="px-5 py-2.5 bg-black text-white text-sm font-medium rounded-lg hover:bg-neutral-800 disabled:opacity-50"
            >
              {createMutation.isPending ? "발행 중..." : "쿠폰 발행"}
            </button>
          </div>
        </form>
      </div>

      {/* 쿠폰 목록 테이블 */}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden shadow-sm" data-testid="coupon-list">
        <div className="p-4 border-b border-neutral-200 font-semibold text-sm">
          쿠폰 목록 ({coupons.length}개)
        </div>
        {isPending ? (
          <div className="p-8 text-center text-sm text-neutral-500">쿠폰 목록을 불러오는 중...</div>
        ) : coupons.length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">등록된 쿠폰이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-medium text-neutral-500 uppercase">
                <tr>
                  <th className="px-4 py-3">코드</th>
                  <th className="px-4 py-3">쿠폰명</th>
                  <th className="px-4 py-3">할인 혜택</th>
                  <th className="px-4 py-3">최소 주문액</th>
                  <th className="px-4 py-3">사용 횟수</th>
                  <th className="px-4 py-3">유효기간</th>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {coupons.map((coupon) => (
                  <tr key={coupon.id} data-testid={`coupon-row-${coupon.id}`} className="hover:bg-neutral-50/50">
                    <td className="px-4 py-3 font-mono font-semibold text-neutral-900">{coupon.code}</td>
                    <td className="px-4 py-3 font-medium text-neutral-900">{coupon.name}</td>
                    <td className="px-4 py-3">
                      {coupon.discountType === "fixed" ? (
                        <span className="text-blue-600 font-medium">{coupon.discountValue.toLocaleString()}원 할인</span>
                      ) : (
                        <span className="text-emerald-600 font-medium">
                          {coupon.discountValue}% 할인
                          {coupon.maxDiscountAmount && ` (최대 ${coupon.maxDiscountAmount.toLocaleString()}원)`}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {coupon.minOrderAmount > 0 ? `${coupon.minOrderAmount.toLocaleString()}원` : "제한 없음"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {coupon.usedCount}회 {coupon.maxUses != null ? `/ ${coupon.maxUses}회` : "/ 무제한"}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      {coupon.expiresAt ? `${new Date(coupon.expiresAt).toLocaleDateString()}까지` : "상시"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          coupon.active ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {coupon.active ? "활성" : "비활성"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => toggleMutation.mutate({ id: coupon.id, active: !coupon.active })}
                        disabled={readOnly || toggleMutation.isPending}
                        data-testid={`toggle-coupon-${coupon.id}`}
                        className="px-2.5 py-1 text-xs border rounded hover:bg-neutral-100 disabled:opacity-50"
                      >
                        {coupon.active ? "비활성화" : "활성화"}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`쿠폰 '${coupon.code}'를 삭제하시겠습니까?`)) {
                            deleteMutation.mutate(coupon.id);
                          }
                        }}
                        disabled={readOnly || deleteMutation.isPending}
                        data-testid={`delete-coupon-${coupon.id}`}
                        className="px-2.5 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
