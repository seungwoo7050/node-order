"use client";

import { useEffect, useRef } from "react";

type Props = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => unknown;
  loaded: number;
  pages: number;
  noun: string;
};

export function LoadMore({ hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, loaded, pages, noun }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) fetchNextPage();
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (!hasNextPage && pages <= 1) return null;
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
      {hasNextPage && (
        <button ref={ref} type="button" className="btn" aria-disabled={isFetchingNextPage}
          onClick={() => { if (!isFetchingNextPage) fetchNextPage(); }}>
          {isFetchingNextPage ? "불러오는 중…" : isFetchNextPageError ? "다시 시도" : "더 보기"}
        </button>
      )}
      <p role="status" className="num text-sm text-muted">
        {isFetchNextPageError ? "다음 페이지를 불러오지 못했습니다. " : ""}
        {noun} {loaded.toLocaleString("ko-KR")}건{hasNextPage ? "을 불러왔습니다" : " - 끝까지 불러왔습니다"}
      </p>
    </div>
  );
}
