import { cacheLife, cacheTag } from "next/cache";
import type { LegalDocument, LegalKind, StoreInfo } from "./store-info";

// 서버 컴포넌트(바닥글, /legal/*)가 쓰는 태그 캐시. 관리자 화면이 저장하면 server action이 updateTag로 이 태그를 버린다
// → 배포 없이 다음 요청부터 새 값이 보인다. 실패는 캐시하지 않는다(throw)
export const STORE_TAG = "store-settings";
export const LEGAL_TAG = "legal";

const LIFE = { stale: 300, revalidate: 300, expire: 3600 };

export async function getStoreInfo(): Promise<StoreInfo> {
  "use cache";
  cacheTag(STORE_TAG);
  cacheLife(LIFE);
  const res = await fetch(`${process.env.API_URL}/store`, { cache: "no-store" });
  if (!res.ok) throw new Error(`상점 정보를 받지 못했다(${res.status})`);
  return (await res.json()) as StoreInfo;
}

// version이 없으면 지금 시행 중인 판. 없는 판이면 null
export async function getLegalDocument(kind: LegalKind, version?: number): Promise<LegalDocument | null> {
  "use cache";
  cacheTag(LEGAL_TAG);
  cacheLife(LIFE);
  const path = version === undefined ? `/legal/${kind}` : `/legal/${kind}/versions/${version}`;
  const res = await fetch(`${process.env.API_URL}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${kind} 문서를 받지 못했다(${res.status})`);
  return (await res.json()) as LegalDocument;
}
