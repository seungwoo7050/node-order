"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, authFetch, publicFetch } from "@/lib/api-client";
import { useCartStore } from "@/lib/cart-store";

type Product = { id: number; name: string; price: number; stock: number };
type CheckoutResult = { id: number; price: number };

function ProductList() {
  const { data, isPending, error } = useQuery({
    queryKey: ["products"],
    queryFn: () => publicFetch<Product[]>("/products"),
  });
  const add = useCartStore((s) => s.add);

  if (isPending) return <p>상품을 불러오는 중…</p>;
  if (error) return <p role="alert">상품을 불러오지 못했습니다: {error.message}</p>;
  return (
    <ul>
      {data.map((p) => (
        <li key={p.id}>
          {p.name} — {p.price.toLocaleString()}원 (재고 <span data-testid={`stock-${p.id}`}>{p.stock}</span>)
          <button disabled={p.stock === 0} onClick={() => add({ productId: p.id, name: p.name, price: p.price })}>
            담기
          </button>
        </li>
      ))}
    </ul>
  );
}

function CartPanel() {
  const items = useCartStore((s) => s.items);
  const remove = useCartStore((s) => s.remove);
  const queryClient = useQueryClient();

  const checkout = useMutation({
    mutationFn: () => {
      const key = useCartStore.getState().beginCheckout();
      return authFetch<CheckoutResult>("/orders/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })) }),
      });
    },
    onSuccess: () => {
      useCartStore.getState().finishCheckout();
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["my-orders"] });
    },
  });

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return (
    <section>
      <h2>장바구니</h2>
      {items.length === 0 && <p>비어 있습니다</p>}
      <ul>
        {items.map((i) => (
          <li key={i.productId}>
            {i.name} × {i.quantity} <button onClick={() => remove(i.productId)}>빼기</button>
          </li>
        ))}
      </ul>
      <p>합계 {total.toLocaleString()}원</p>
      <button disabled={items.length === 0 || checkout.isPending} onClick={() => checkout.mutate()}>
        {checkout.isPending ? "결제 중…" : "결제"}
      </button>
      {checkout.isSuccess && <p role="status">결제 완료: 주문 #{checkout.data.id}</p>}
      {checkout.error && (
        <p role="alert">
          결제 실패: {checkout.error.message}
          {checkout.error instanceof ApiError && checkout.error.status === 401 && <> — <Link href="/login">로그인</Link></>}
        </p>
      )}
    </section>
  );
}

export default function ShopPage() {
  return (
    <main>
      <h1>상품</h1>
      <ProductList />
      <CartPanel />
    </main>
  );
}