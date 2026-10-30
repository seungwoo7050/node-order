import { queryOptions } from "@tanstack/react-query";
import { publicFetch } from "./api-client";

export type PaymentProvider = "toss" | "stripe";

// API의 GET /features. 키가 있는 결제 수단만 온다(둘 다 없으면 빈 목록)
export type Features = {
  payments: PaymentProvider[];
  toss?: { clientKey: string; sdkUrl: string };
};

export const featuresOptions = queryOptions({
  queryKey: ["features"],
  queryFn: () => publicFetch<Features>("/features"),
  staleTime: 60_000,
});

export const providerLabel: Record<PaymentProvider, string> = {
  toss: "토스페이먼츠",
  stripe: "Stripe (해외 카드)",
};

export const providerNote: Record<PaymentProvider, string> = {
  toss: "결제는 토스페이먼츠 결제창에서 이어집니다.",
  stripe: "결제는 Stripe 화면에서 이어집니다.",
};

// 고르지 않았을 때의 결제 수단: 기존 흐름(Stripe)이 켜져 있으면 Stripe, 아니면 켜진 첫 수단
export function defaultProvider(payments: PaymentProvider[]): PaymentProvider | null {
  if (payments.includes("stripe")) return "stripe";
  return payments[0] ?? null;
}
