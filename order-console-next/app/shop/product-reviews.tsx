"use client";

import { useQuery } from "@tanstack/react-query";
import { API_URL } from "@/lib/api-client";

type Review = {
  id: number;
  rating: number;
  content: string;
  authorName: string;
  variantName: string | null;
  createdAt: string;
};

type ProductReviewsData = {
  averageRating: number;
  reviewCount: number;
  reviews: Review[];
};

export function ProductReviews({ productId }: { productId: number }) {
  const { data, isPending } = useQuery<ProductReviewsData>({
    queryKey: ["product-reviews", productId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/products/${productId}/reviews`);
      if (!res.ok) throw new Error("리뷰를 불러오지 못했습니다.");
      return res.json();
    },
  });

  if (isPending) {
    return (
      <div className="mt-12 border-t border-line pt-8 text-xs text-muted">
        리뷰를 불러오는 중...
      </div>
    );
  }

  const reviewCount = data?.reviewCount ?? 0;
  const averageRating = data?.averageRating ?? 0;
  const reviews = data?.reviews ?? [];

  return (
    <section className="mt-12 border-t border-line pt-8" data-testid="product-reviews">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold">구매 후기</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-amber-500 font-bold" data-testid="product-average-rating">
              ★ {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
            </span>
            <span className="text-xs text-muted" data-testid="product-review-count">
              ({reviewCount}개의 후기)
            </span>
          </div>
        </div>
      </div>

      {reviews.length === 0 ? (
        <p className="text-sm text-muted py-6 border border-dashed border-line rounded text-center">
          아직 작성된 리뷰가 없습니다. 상품 구매 후 소중한 첫 후기를 남겨보세요!
        </p>
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <div
              key={r.id}
              data-testid={`product-review-item-${r.id}`}
              className="border border-line rounded-lg p-4 text-sm space-y-2 bg-neutral-50/30"
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-amber-500 font-medium">{"★".repeat(r.rating)}</span>
                  <span className="font-mono text-muted">{r.authorName}</span>
                </div>
                <span className="text-muted">{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>

              {r.variantName && (
                <div className="text-xs text-muted font-normal">
                  <span className="bg-neutral-200/60 px-1.5 py-0.5 rounded text-[0.7rem] mr-1.5">선택 옵션</span>
                  {r.variantName}
                </div>
              )}

              <p className="text-fg whitespace-pre-line leading-relaxed">{r.content}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
