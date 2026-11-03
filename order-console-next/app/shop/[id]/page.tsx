import { Suspense } from "react";
import { LoadError } from "../../load-error";
import { ProductDetail } from "../product-detail";
import styles from "./page.module.css";

export default function ProductPage({ params }: PageProps<"/shop/[id]">) {
  return (
    <main className={styles.main}>
      <LoadError what="상품">
        <Suspense fallback={null}>
          <ProductDetail params={params} />
        </Suspense>
      </LoadError>
    </main>
  );
}
