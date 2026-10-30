// outbox 이벤트 종류별 메일 템플릿. 이벤트 하나에 메일 하나다(relay가 jobId로 같은 이벤트를 두 번 넣지 않는다)

type Payload = Record<string, unknown>;

const TEMPLATES: Record<string, (orderId: number, p: Payload) => string> = {
  "order.created": (id) => `주문 #${id} 접수`,
  "order.paid": (id) => `주문 #${id} 결제 완료`,
  "order.preparing": (id) => `주문 #${id} 배송 준비를 시작했습니다`,
  "order.shipped": (id, p) => `주문 #${id} 발송: ${String(p.carrierName ?? p.carrier ?? "")} ${String(p.trackingNumber ?? "")}`.trim(),
  "order.delivered": (id) => `주문 #${id} 배송 완료`,
  "order.canceled": (id) => `주문 #${id} 취소 - 결제 금액은 환불됩니다`,
  "return.approved": (id, p) => (p.kind === "exchange" ? `주문 #${id} 교환 승인` : `주문 #${id} 반품 승인 - ${Number(p.refundAmount ?? 0).toLocaleString("ko-KR")}원 환불`),
  "return.rejected": (id) => `주문 #${id} 반품·교환 요청 거절`,
};

export type MailContent = { template: string; subject: string };

export function mailFor(type: string, orderId: number, payload: Payload = {}): MailContent {
  const render = TEMPLATES[type];
  return render ? { template: type, subject: render(orderId, payload) } : { template: "generic", subject: `주문 #${orderId} 알림` };
}

export const MAIL_TEMPLATE_NAMES = Object.keys(TEMPLATES);
