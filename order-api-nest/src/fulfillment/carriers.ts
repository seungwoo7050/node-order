// 택배사 고정 목록과 조회 링크 템플릿. 배송 추적 API는 쓰지 않는다(송장 상태는 관리자가 손으로 바꾼다)
// {n}에 송장번호가 들어간다

export const CARRIERS = {
  cj: { name: "CJ대한통운", url: "https://trace.cjlogistics.com/next/tracking.html?wblNo={n}" },
  epost: { name: "우체국택배", url: "https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1={n}" },
  hanjin: { name: "한진택배", url: "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnum={n}" },
  lotte: { name: "롯데택배", url: "https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo={n}" },
  logen: { name: "로젠택배", url: "https://www.ilogen.com/web/personal/trace/{n}" },
} as const;

export type CarrierCode = keyof typeof CARRIERS;
export const CARRIER_CODES = Object.keys(CARRIERS) as CarrierCode[];

export const isCarrierCode = (code: string): code is CarrierCode => Object.hasOwn(CARRIERS, code);

export function trackingUrl(carrier: string, trackingNumber: string): string | null {
  if (!isCarrierCode(carrier)) return null;
  return CARRIERS[carrier].url.replace("{n}", encodeURIComponent(trackingNumber));
}

// 송장번호: 숫자만 8~20자리(사람이 넣은 하이픈·공백은 뺀다)
export const normalizeTrackingNumber = (raw: string) => raw.replace(/[\s-]/g, "");
export const TRACKING_NUMBER = /^[0-9]{8,20}$/;
