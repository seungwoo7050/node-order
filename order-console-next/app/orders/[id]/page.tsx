import { notFound } from "next/navigation";
import { getOrder } from "@/lib/api";
import { ReviewButton } from "./review-button";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(Number(id));

  if (!order) notFound();

  return (
    <main>
      <h2>#{order.id} {order.user}</h2>
      <p>{order.price.toLocaleString()}원 · {order.paid ? "결제완료" : "미결제"}</p>
      <ReviewButton orderId={order.id} />
    </main>
  );
}
