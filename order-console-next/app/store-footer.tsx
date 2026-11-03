import Link from "next/link";
import { connection } from "next/server";
import { getStoreInfo } from "@/lib/store-cache";
import { formatBusinessNumber } from "@/lib/store-info";

export async function StoreFooter() {
  await connection();
  let info;
  try {
    info = await getStoreInfo();
  } catch {
    info = null;
  }
  return (
    <footer
      className="w-full mt-auto border-t border-line py-10 text-[0.75rem] leading-relaxed text-muted"
      data-testid="store-footer"
    >
      <div className="storefront-container flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <nav
            aria-label="약관과 정책"
            className="flex flex-wrap gap-x-5 gap-y-1 text-xs"
          >
            <Link href="/legal/terms" className="text-muted no-underline hover:text-fg">
              이용약관
            </Link>
            <Link
              href="/legal/privacy"
              className="font-medium text-fg no-underline hover:underline"
            >
              개인정보처리방침
            </Link>
            <Link href="/legal/refund" className="text-muted no-underline hover:text-fg">
              청약철회·환불 안내
            </Link>
          </nav>
          {info && (
            <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted">
              <span data-testid="footer-store-name" className="font-medium text-fg">
                {info.storeName}
              </span>
              <span>대표자 {info.representative}</span>
              <span>
                사업자등록번호{" "}
                <span className="num">
                  {formatBusinessNumber(info.businessNumber)}
                </span>
              </span>
              <span>통신판매업 신고번호 {info.mailOrderNumber}</span>
              <span>{info.address}</span>
              <span>
                전화 <span className="num">{info.phone}</span>
              </span>
              <span>{info.email}</span>
              <span>개인정보 보호책임자 {info.privacyOfficer}</span>
            </p>
          )}
        </div>
        <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">
          KOREAN CONTEMPORARY STOREFRONT ARCHIVE
        </div>
      </div>
    </footer>
  );
}
