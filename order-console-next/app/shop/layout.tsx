import { Suspense } from "react";
import { SearchBox, SearchBoxFallback } from "./search-box";

export default function ShopLayout({ children, modal }: LayoutProps<"/shop">) {
  return (
    <>
      <div className="w-full border-b border-line bg-bg/60">
        <div className="storefront-container flex items-center justify-end py-2.5">
          {/* SearchBox는 주소의 q를 읽으므로(useSearchParams) Suspense 안에 둔다 */}
          <Suspense fallback={<SearchBoxFallback />}>
            <SearchBox />
          </Suspense>
        </div>
      </div>
      {children}
      {modal}
    </>
  );
}
