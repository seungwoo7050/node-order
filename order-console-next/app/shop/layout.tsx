import { Suspense } from "react";
import { SearchBox, SearchBoxFallback } from "./search-box";

export default function ShopLayout({ children, modal }: LayoutProps<"/shop">) {
  return (
    <>
      <div className="page pt-2">
        {/* SearchBox는 주소의 q를 읽으므로(useSearchParams) Suspense 안에 둔다 */}
        <Suspense fallback={<SearchBoxFallback />}>
          <SearchBox />
        </Suspense>
      </div>
      {children}
      {modal}
    </>
  );
}
