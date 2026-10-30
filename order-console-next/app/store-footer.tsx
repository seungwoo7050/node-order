import Link from "next/link";
import { connection } from "next/server";
import { getStoreInfo } from "@/lib/store-cache";
import { formatBusinessNumber } from "@/lib/store-info";

// 모든 페이지 바닥글의 사업자 정보(전자상거래법 표시 의무: 상호, 대표자, 주소, 연락처, 사업자등록번호, 통신판매업 신고번호 등).
// 값은 관리자 설정(/admin/settings)에서 오고, 저장하면 태그 캐시를 버려 배포 없이 바뀐다
export async function StoreFooter() {
  await connection();
  let info;
  try {
    info = await getStoreInfo();
  } catch {
    info = null; // API가 잠깐 안 되면 링크만 보인다(실패는 캐시하지 않아 다음 요청에 다시 읽는다)
  }
  return (
    <footer className="page mt-auto border-t border-line py-6 text-[0.75rem] leading-relaxed text-muted" data-testid="store-footer">
      <nav aria-label="약관과 정책" className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/legal/terms" className="text-muted">이용약관</Link>
        <Link href="/legal/privacy" className="font-medium text-fg">개인정보처리방침</Link>
        <Link href="/legal/refund" className="text-muted">청약철회·환불 안내</Link>
      </nav>
      {info && (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span data-testid="footer-store-name">{info.storeName}</span>
          <span>대표자 {info.representative}</span>
          <span>사업자등록번호 <span className="num">{formatBusinessNumber(info.businessNumber)}</span></span>
          <span>통신판매업 신고번호 {info.mailOrderNumber}</span>
          <span>{info.address}</span>
          <span>전화 <span className="num">{info.phone}</span></span>
          <span>{info.email}</span>
          <span>개인정보 보호책임자 {info.privacyOfficer}</span>
        </p>
      )}
    </footer>
  );
}
