import { Suspense } from "react";
import { SearchResults } from "./search-results";

export default function SearchPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <Suspense fallback={<p role="status" className="text-sm text-muted">검색하는 중입니다.</p>}>
        <SearchResults />
      </Suspense>
    </main>
  );
}
