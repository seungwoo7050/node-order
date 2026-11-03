"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authFetch } from "@/lib/api-client";
import { AdminOnly, useReadOnly } from "../products/admin-only";

type AdminReview = {
  id: number;
  orderId: number;
  productId: number;
  userId: string;
  authorName: string;
  rating: number;
  content: string;
  variantName: string | null;
  createdAt: string;
  product: { id: number; name: string };
  order: { id: number; createdAt: string; status: string };
};

export default function AdminReviewsPage() {
  return (
    <main className="page flex-1 pb-12 pt-2 space-y-6">
      <AdminOnly note={null}>
        <ReviewsContent />
      </AdminOnly>
    </main>
  );
}

function ReviewsContent() {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();

  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: reviews = [], isPending } = useQuery<AdminReview[]>({
    queryKey: ["admin-reviews", search],
    queryFn: () => {
      const q = search.trim();
      const path = q ? `/admin/reviews?q=${encodeURIComponent(q)}` : "/admin/reviews";
      return authFetch<AdminReview[]>(path);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => authFetch(`/admin/reviews/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-reviews"] }),
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="title">리뷰 관리</h1>
          <p className="text-xs text-muted mt-1">고객 리뷰 목록을 조회하고 부적절한 구매 후기를 관리합니다.</p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명, 작성자, 내용 검색"
            data-testid="review-search-input"
            className="px-3 py-1.5 border border-line bg-bg rounded text-xs w-64"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-line overflow-hidden" data-testid="admin-reviews-table">
        <div className="p-4 border-b border-line font-semibold text-sm">
          전체 리뷰 ({reviews.length}개)
        </div>
        {isPending ? (
          <div className="p-8 text-center text-sm text-muted">리뷰를 불러오는 중...</div>
        ) : reviews.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">작성된 리뷰가 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 border-b border-line text-xs font-medium text-muted">
                <tr>
                  <th className="px-4 py-3">번호</th>
                  <th className="px-4 py-3">상품명</th>
                  <th className="px-4 py-3">별점</th>
                  <th className="px-4 py-3">리뷰 내용</th>
                  <th className="px-4 py-3">구매 옵션</th>
                  <th className="px-4 py-3">작성자</th>
                  <th className="px-4 py-3">주문번호</th>
                  <th className="px-4 py-3">작성일</th>
                  <th className="px-4 py-3 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {reviews.map((review) => (
                  <tr key={review.id} data-testid={`review-row-${review.id}`} className="hover:bg-neutral-50/50">
                    <td className="px-4 py-3 num text-muted">#{review.id}</td>
                    <td className="px-4 py-3 font-medium text-neutral-900">{review.product?.name ?? `상품 #${review.productId}`}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center text-amber-500">
                        {"★".repeat(review.rating)}
                        <span className="text-neutral-300">{"★".repeat(5 - review.rating)}</span>
                        <span className="ml-1 num text-xs text-muted">({review.rating})</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate text-neutral-800" title={review.content}>
                      {review.content}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {review.variantName ? review.variantName : "-"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 font-mono text-xs">{review.authorName}</td>
                    <td className="px-4 py-3 num text-neutral-600 text-xs">#{review.orderId}</td>
                    <td className="px-4 py-3 num text-xs text-muted">
                      {new Date(review.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          if (confirm(`리뷰 #${review.id}을(를) 삭제하시겠습니까?`)) {
                            deleteMutation.mutate(review.id);
                          }
                        }}
                        disabled={readOnly || deleteMutation.isPending}
                        data-testid={`delete-review-${review.id}`}
                        className="px-2.5 py-1 text-xs border border-red-200 text-red-700 bg-red-50 rounded hover:bg-red-100 disabled:opacity-50 cursor-pointer"
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
