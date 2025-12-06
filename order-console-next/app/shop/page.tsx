"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, authFetch } from "@/lib/api-client";
import { useCartStore } from "@/lib/cart-store";
import { useAuthStore } from "@/lib/auth-store";
import { useOnline } from "../online-banner";
import { useTRPC } from "@/lib/trpc";
import { ProductImageUploader } from "./product-image-uploader";

type CheckoutResult = { id: number; price: number; checkoutUrl: string };

function ProductList() {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.products.list.queryOptions());
  const add = useCartStore((s) => s.add);
  const loggedIn = useAuthStore((s) => s.accessToken !== null);

  if (isPending) return <p>상품을 불러오는 중...</p>;
  if (error) return <p role="alert">상품을 불러오지 못했습니다: {error.message}</p>;
  return (
    <ul>
      {data.map((p) => (
        <li key={p.id}>
          {p.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt={p.name} width={48} height={48} data-testid={`image-${p.id}`} />
          )}
          {p.name} - {p.price.toLocaleString()}원 (재고 <span data-testid={`stock-${p.id}`}>{p.stock}</span>)
          <button disabled={p.stock === 0} onClick={() => add({ productId: p.id, name: p.name, price: p.price })}>
            담기
          </button>
          {loggedIn && <ProductImageUploader productId={p.id} />}
        </li>
      ))}
    </ul>
  );
}

function CartPanel() {
  const trpc = useTRPC();
  const items = useCartStore((s) => s.items);
  const remove = useCartStore((s) => s.remove);
  const online = useOnline();
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
    onSuccess: (data) => {
      useCartStore.getState().finishCheckout();
      void queryClient.invalidateQueries({ queryKey: trpc.products.list.queryKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.queryKey() });
      window.location.assign(data.checkoutUrl);
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
      <button disabled={items.length === 0 || checkout.isPending || !online} onClick={() => checkout.mutate()}>
        {checkout.isPending ? "결제 중..." : "결제"}
      </button>
      {checkout.isSuccess && <p role="status">주문 #{checkout.data.id} - 결제 화면으로 이동하는 중...</p>}
      {checkout.error && (
        <p role="alert">
          결제 실패: {checkout.error.message}
          {checkout.error instanceof ApiError && checkout.error.status === 401 && <> - <Link href="/login">로그인</Link></>}
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