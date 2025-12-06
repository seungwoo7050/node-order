export function orderStatus(o: { paid: boolean; canceledAt: string | null }) {
  if (o.paid) return "결제 완료";
  if (o.canceledAt) return "취소됨(결제 기한 지남)";
  return "결제 대기";
}