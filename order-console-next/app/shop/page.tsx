"use client";

import { useQuery } from "@tanstack/react-query";
import { publicFetch } from "@/lib/api-client";
import { useCartStore } from "@/lib/cart-store";

type Product = { id: number; name: string; price: number; stock: number };

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

export default function ShopPage() {
  return (
    <main>
      <h1>상품</h1>
      <ProductList />
    </main>
  );
}