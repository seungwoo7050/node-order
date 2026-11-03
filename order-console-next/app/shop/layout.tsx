import { Suspense } from "react";
import { SearchBox, SearchBoxFallback } from "./search-box";
import styles from "./shop-layout.module.css";

export default function ShopLayout({ children, modal }: LayoutProps<"/shop">) {
  return (
    <>
      <div className={styles.searchRow}>
        <div className={`storefront-container ${styles.searchInner}`}>
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
