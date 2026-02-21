"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import type { CatalogProduct } from "@/lib/catalog";
import { useTRPC } from "@/lib/trpc";
import { saveProduct } from "../actions";
import { useReadOnly } from "../admin-only";

export function EditProductForm({ product }: { product: CatalogProduct }) {
  const readOnly = useReadOnly();
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [description, setDescription] = useState(product.description);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || readOnly) return;
    setError(null);
    startTransition(async () => {
      let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
      if (!token) return setError("로그인이 필요합니다.");
      const input = { name: name.trim(), price: Number(price), description: description.trim() };
      void queryClient.invalidateQueries({ queryKey: trpc.products.pathKey() });
      let result = await saveProduct(token, product.id, input);
      if (result.status === 401 && (token = await refreshAccessToken())) result = await saveProduct(token, product.id, input);
      setError(result.message);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-md gap-6">
      <label className="grid gap-1">
        <span className="label">이름</span>
        <input className="border border-line-strong bg-bg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)}
          required maxLength={100} disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
      </label>
      <label className="grid gap-1">
        <span className="label">가격(원)</span>
        <input className="num border border-line-strong bg-bg px-3 py-2" inputMode="numeric" pattern="[0-9]+" value={price} onChange={(e) => setPrice(e.target.value)}
          required disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
      </label>
      <label className="grid gap-1">
        <span className="label">설명</span>
        <textarea className="min-h-32 border border-line-strong bg-bg px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)}
          maxLength={2000} disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
      </label>
      {error && <p role="alert" className="alert">{error}</p>}
      <p>
        <button type="submit" className="btn btn-primary" disabled={readOnly} aria-disabled={pending}>
          {pending ? "저장하는 중…" : "저장"}
        </button>
      </p>
    </form>
  );
}
