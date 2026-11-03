import Link from "next/link";
import { connection } from "next/server";
import { getStoreInfo } from "@/lib/store-cache";
import { formatBusinessNumber } from "@/lib/store-info";
import styles from "./store-footer.module.css";

export async function StoreFooter() {
  await connection();
  let info;
  try {
    info = await getStoreInfo();
  } catch {
    info = null;
  }

  const storeName = info?.storeName ?? "Store";

  return (
    <footer className={styles.footer} data-testid="store-footer">
      <div className={`storefront-container ${styles.inner}`}>
        <p className={styles.brand}>
          <span data-testid="footer-store-name">{storeName}</span>
        </p>

        <nav aria-label="약관과 정책" className={styles.nav}>
          <Link href="/legal/terms">이용약관</Link>
          <Link href="/legal/privacy">개인정보처리방침</Link>
          <Link href="/legal/refund">청약철회·환불 안내</Link>
        </nav>

        {info && (
          <p className={styles.biz}>
            <span>대표자 {info.representative}</span>
            <span>
              사업자등록번호{" "}
              <span className={styles.num}>
                {formatBusinessNumber(info.businessNumber)}
              </span>
            </span>
            <span>통신판매업 신고번호 {info.mailOrderNumber}</span>
            <span>{info.address}</span>
            <span>
              전화 <span className={styles.num}>{info.phone}</span>
            </span>
            <span>{info.email}</span>
            <span>개인정보 보호책임자 {info.privacyOfficer}</span>
          </p>
        )}
      </div>
    </footer>
  );
}
