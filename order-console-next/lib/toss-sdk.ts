// 토스페이먼츠 결제위젯 SDK(v2, https://js.tosspayments.com/v2/standard)의 쓰는 부분만 적은 타입.
// 스크립트 주소는 API의 /features가 준다(e2e에서는 토스 시뮬레이터의 가짜 SDK).
// 스크립트는 코드에서 만들어 붙인다: CSP의 'strict-dynamic' 아래에서 nonce가 있는 스크립트가 만든 스크립트는 허용된다

export type TossWidgets = {
  setAmount(amount: { currency: "KRW"; value: number }): Promise<void>;
  renderPaymentMethods(options: { selector: string; variantKey?: string }): Promise<unknown>;
  renderAgreement(options: { selector: string; variantKey?: string }): Promise<unknown>;
  requestPayment(options: { orderId: string; orderName: string; successUrl: string; failUrl: string; customerEmail?: string; customerName?: string }): Promise<void>;
};

export type TossPaymentsFactory = (clientKey: string) => { widgets(options: { customerKey: string }): TossWidgets };

declare global {
  interface Window {
    TossPayments?: TossPaymentsFactory;
  }
}

const loading = new Map<string, Promise<TossPaymentsFactory>>();

export function loadTossSdk(src: string): Promise<TossPaymentsFactory> {
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  let promise = loading.get(src);
  if (!promise) {
    promise = new Promise<TossPaymentsFactory>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => (window.TossPayments ? resolve(window.TossPayments) : reject(new Error("토스 SDK에 TossPayments가 없습니다")));
      script.onerror = () => {
        loading.delete(src);
        reject(new Error("토스 결제 SDK를 불러오지 못했습니다"));
      };
      document.head.appendChild(script);
    });
    loading.set(src, promise);
  }
  return promise;
}
