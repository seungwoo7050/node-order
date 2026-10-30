import { queryOptions } from "@tanstack/react-query";
import { publicFetch } from "./api-client";

// 상점 정보(API의 GET /store)와 법적 고지(GET /legal/:kind). 브라우저·서버 컴포넌트가 같이 쓰는 타입과 표시 함수

export type StoreInfo = {
  storeName: string;
  representative: string;
  businessNumber: string;
  mailOrderNumber: string;
  address: string;
  phone: string;
  email: string;
  privacyOfficer: string;
  shippingFee: number;
  freeShippingThreshold: number;
  returnShippingFee: number;
};

// 관리자 화면이 읽는 설정(GET /admin/settings): 공개 정보 + 재고 부족 기준 + version
export type StoreSettings = StoreInfo & { lowStockThreshold: number; version: number; updatedAt: string };

export type LegalKind = "terms" | "privacy" | "refund";
export const LEGAL_KINDS: LegalKind[] = ["terms", "privacy", "refund"];
export const LEGAL_LABEL: Record<LegalKind, string> = { terms: "이용약관", privacy: "개인정보처리방침", refund: "청약철회·환불 안내" };
export const isLegalKind = (v: string): v is LegalKind => (LEGAL_KINDS as string[]).includes(v);

export type LegalVersion = { version: number; title: string; effectiveAt: string; createdAt: string };
export type LegalDocument = { kind: LegalKind; version: number; title: string; body: string; effectiveAt: string; createdAt: string; current: boolean; versions: LegalVersion[] };

// 123-45-67891
export const formatBusinessNumber = (digits: string) =>
  /^\d{10}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits;

export const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

// 브라우저(장바구니): 배송비와 결제 동의에 쓸 지금 판. 서버가 다시 계산·검증한다
export const storeInfoOptions = queryOptions({
  queryKey: ["store-info"],
  queryFn: () => publicFetch<StoreInfo>("/store"),
  staleTime: 30_000,
});

export const privacyOptions = queryOptions({
  queryKey: ["legal", "privacy"],
  queryFn: () => publicFetch<LegalDocument>("/legal/privacy"),
  staleTime: 30_000,
});
