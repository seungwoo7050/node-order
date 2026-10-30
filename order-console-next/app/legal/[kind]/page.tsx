import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { won } from "@/lib/orders";
import { getLegalDocument, getStoreInfo } from "@/lib/store-cache";
import { dateOnly, formatBusinessNumber, isLegalKind, type LegalDocument, type StoreInfo } from "@/lib/store-info";
import { LoadError } from "../../load-error";

// 상점이 정하는 값(사업자 정보, 반품 배송비, 개인정보 보호책임자)은 본문에 적지 않고 설정에서 읽어 붙인다:
// 설정을 저장하면 이 페이지도 배포 없이 새 값을 보인다
function StoreFacts({ kind, info }: { kind: LegalDocument["kind"]; info: StoreInfo }) {
  const rows: [string, string][] =
    kind === "privacy"
      ? [["개인정보 보호책임자", info.privacyOfficer], ["연락처", `${info.phone} · ${info.email}`], ["사업자", info.storeName]]
      : kind === "refund"
        ? [
            ["단순변심 반품 왕복 배송비", won(info.returnShippingFee)],
            ["배송비", `${won(info.shippingFee)} (상품 합계 ${won(info.freeShippingThreshold)} 이상 무료)`],
            ["반품 문의", `${info.phone} · ${info.email}`],
          ]
        : [["상호", info.storeName], ["대표자", info.representative], ["사업자등록번호", formatBusinessNumber(info.businessNumber)], ["통신판매업 신고번호", info.mailOrderNumber], ["주소", info.address]];
  return (
    <dl className="mb-8 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 border-y border-line py-4 text-sm" data-testid="legal-store-facts">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

async function LegalBody({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ version?: string }> }) {
  const { kind } = await params;
  if (!isLegalKind(kind)) notFound();
  const { version: v } = await searchParams;
  const version = v && /^\d+$/.test(v) ? Number(v) : undefined;
  const [doc, info] = await Promise.all([getLegalDocument(kind, version), getStoreInfo()]);
  if (!doc) notFound();
  return (
    <>
      <h1 className="title mb-2">{doc.title}</h1>
      <p className="mb-6 text-sm text-muted" data-testid="legal-version">
        {doc.version}판 · {dateOnly(doc.effectiveAt)} 시행{doc.current ? " (지금 판)" : ""}
      </p>
      {!doc.current && (
        <p className="note mb-6">지난 판입니다. <Link href={`/legal/${kind}`}>지금 시행 중인 판 보기</Link></p>
      )}
      <StoreFacts kind={kind} info={info} />
      <div className="mb-10 whitespace-pre-line text-[0.95rem] leading-relaxed" data-testid="legal-body">{doc.body}</div>
      <section aria-labelledby="history">
        <h2 id="history" className="label mb-2">변경 이력</h2>
        <ol className="border-t border-line text-sm" data-testid="legal-history">
          {doc.versions.map((h) => (
            <li key={h.version} className="flex gap-4 border-b border-line py-2">
              {h.version === doc.version ? (
                <span aria-current="page">{h.version}판</span>
              ) : (
                <Link href={`/legal/${kind}?version=${h.version}`}>{h.version}판</Link>
              )}
              <span className="text-muted">{dateOnly(h.effectiveAt)} 시행</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

export default function LegalPage(props: PageProps<"/legal/[kind]">) {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <LoadError what="문서">
        <Suspense fallback={<p role="status" className="text-sm text-muted">문서를 불러오는 중입니다.</p>}>
          <LegalBody params={props.params} searchParams={props.searchParams as Promise<{ version?: string }>} />
        </Suspense>
      </LoadError>
    </main>
  );
}
