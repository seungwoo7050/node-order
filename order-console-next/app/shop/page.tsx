"use client";

import { useQuery } from "@tanstack/react-query";
import { publicFetch } from "@/lib/api-client";

type Product = { id: number; name: string; price: number; stock: number };

function ProductList() {
  const { data, isPending, error } = useQuery({
    queryKey: ["products"],
    queryFn: () => publicFetch<Product[]>("/products"),
  });

  if (isPending) return <p>상품을 불러오는 중…</p>;
  if (error) return <p role="alert">상품을 불러오지 못했습니다: {error.message}</p>;
  return (
    <ul>
      {data.map((p) => (
        <li key={p.id}>
          {p.name} — {p.price.toLocaleString()}원 (재고 <span data-testid={`stock-${p.id}`}>{p.stock}</span>)
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