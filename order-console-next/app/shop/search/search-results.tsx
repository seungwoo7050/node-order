"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { popularQueries, searchHref, searchProducts } from "@/lib/search";
import { LoadMore } from "../../load-more";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function PopularChips() {
  const { data } = useQuery({ queryKey: ["search-popular"], queryFn: popularQueries, staleTime: 60_000 });
  if (!data || data.length === 0) return null;
  return (
    <nav aria-label="인기 검색어" className="mt-6">
      <p className="label mb-2">인기 검색어</p>
      <ul className="flex flex-wrap gap-2">
        {data.map((p) => (
          <li key={p.query}><Link href={searchHref(p.query)} prefetch={false} className="btn inline-block no-underline">{p.query}</Link></li>
        ))}
      </ul>
    </nav>
  );
}

function Results({ q }: { q: string }) {
  const { data, isPending, error, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useInfiniteQuery({
    queryKey: ["search", q],
    queryFn: ({ pageParam }) => searchProducts(q, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage,
  });

  if (isPending) return <p role="status" className="text-sm text-muted">검색하는 중입니다.</p>;
  if (error && !data)
    return (
      <p role="alert" className="alert">
        검색하지 못했습니다.
        <span className="block text-sm text-muted">잠시 뒤 다시 시도해 주세요. ({error.message})</span>
      </p>
    );
  const items = data.pages.flatMap((p) => p.items);
  if (items.length === 0)
    return (
      <>
        <p role="status" className="note">‘{q}’에 맞는 상품이 없습니다. 철자를 확인하거나 더 짧은 검색어로 찾아 보세요.</p>
        <PopularChips />
      </>
    );
  return (
    <>
      <ul className="border-t border-line" aria-label="검색 결과">
        {items.map((p) => (
          <li key={p.id} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4 border-b border-line py-4">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt={p.name} width={64} height={64} className="size-16 object-cover" />
            ) : (
              <span aria-hidden="true" className="grid size-16 place-items-center bg-surface font-serif text-xl text-faint">{p.name.slice(0, 1)}</span>
            )}
            <div className="min-w-0">
              <p><Link href={`/shop/${p.id}`} className="no-underline">{p.name}</Link></p>
              <p className="flex flex-wrap gap-x-3 text-[0.8rem] text-muted">
                <span className="num">{won(p.price)}</span>
                {p.stock === 0 ? <span className="text-fg">품절</span> : <span>재고 <span className="num">{p.stock}</span></span>}
                {p.categoryPath.length > 0 && <span>{p.categoryPath.join(" / ")}</span>}
                {p.match === "similar" && <span>비슷한 이름</span>}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <LoadMore hasNextPage={hasNextPage} isFetchingNextPage={isFetchingNextPage} isFetchNextPageError={isFetchNextPageError}
        fetchNextPage={fetchNextPage} loaded={items.length} pages={data.pages.length} noun="검색 결과" />
    </>
  );
}

// 주소의 q가 원본이다(새로 고침, 공유, 뒤로 가기가 같은 결과를 낸다)
export function SearchResults() {
  const q = (useSearchParams().get("q") ?? "").trim();
  return (
    <>
      <h1 className="title mb-8">{q ? <>‘{q}’ 검색 결과</> : "상품 검색"}</h1>
      {q ? <Results key={q} q={q} /> : (
        <>
          <p className="text-sm text-muted">찾을 상품 이름을 입력해 주세요.</p>
          <PopularChips />
        </>
      )}
    </>
  );
}
