"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { API_URL, authFetch, refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AdminOnly, useReadOnly } from "../admin-only";

type VariantItem = {
  name: string;
  sku: string;
  priceDelta: number;
  stock: number;
};

export default function NewProductPage() {
  const router = useRouter();
  const readOnly = useReadOnly();

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [materialInfo, setMaterialInfo] = useState("");
  const [sizeGuide, setSizeGuide] = useState("");
  const [isVisible, setIsVisible] = useState(true);

  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [varName, setVarName] = useState("");
  const [varSku, setVarSku] = useState("");
  const [varDelta, setVarDelta] = useState("0");
  const [varStock, setVarStock] = useState("10");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load categories
  const { data: categories } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["admin-categories-select"],
    queryFn: () => authFetch("/admin/categories"),
  });

  const addVariant = () => {
    if (!varName.trim()) return;
    setVariants([
      ...variants,
      {
        name: varName.trim(),
        sku: varSku.trim(),
        priceDelta: Number(varDelta) || 0,
        stock: Number(varStock) || 0,
      },
    ]);
    setVarName("");
    setVarSku("");
    setVarDelta("0");
    setVarStock("10");
  };

  const removeVariant = (index: number) => {
    setVariants(variants.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || loading) return;
    setError(null);
    setLoading(true);

    try {
      const token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
      if (!token) throw new Error("로그인이 필요합니다.");

      const payload = {
        name: name.trim(),
        price: Number(price),
        stock: variants.length > 0 ? variants.reduce((sum, v) => sum + v.stock, 0) : Number(stock) || 0,
        description: description.trim(),
        categoryId: categoryId || null,
        materialInfo: materialInfo.trim(),
        sizeGuide: sizeGuide.trim(),
        isVisible,
        variants: variants.length > 0 ? variants : undefined,
      };

      const res = await fetch(`${API_URL}/admin/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? "상품 생성 실패"));
      }

      router.push("/admin/products");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "상품 등록 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page flex-1 pb-12 pt-2">
      <p className="label mb-1">
        <Link href="/admin/products">상품 관리</Link> / 새 상품
      </p>
      <h1 className="title mb-8">새 상품 등록</h1>

      <AdminOnly>
        <form onSubmit={handleSubmit} className="grid max-w-xl gap-6">
          <label className="grid gap-1">
            <span className="label">상품명 *</span>
            <input
              className="border border-line-strong bg-bg px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder="예: 오버핏 옥스포드 셔츠"
              disabled={readOnly}
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="grid gap-1">
              <span className="label">기본 가격(원) *</span>
              <input
                type="number"
                min={0}
                className="num border border-line-strong bg-bg px-3 py-2 text-sm"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
                placeholder="예: 39000"
                disabled={readOnly}
              />
            </label>

            <label className="grid gap-1">
              <span className="label">
                {variants.length > 0 ? "합산 재고 (옵션 자동 합산)" : "기본 재고"}
              </span>
              <input
                type="number"
                min={0}
                className="num border border-line-strong bg-bg px-3 py-2 text-sm"
                value={variants.length > 0 ? variants.reduce((s, v) => s + v.stock, 0) : stock}
                onChange={(e) => setStock(e.target.value)}
                disabled={readOnly || variants.length > 0}
              />
            </label>
          </div>

          <label className="grid gap-1">
            <span className="label">카테고리</span>
            <select
              className="border border-line-strong bg-bg px-3 py-2 text-sm"
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
              disabled={readOnly}
            >
              <option value="">카테고리 없음</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="label">설명</span>
            <textarea
              className="min-h-24 border border-line-strong bg-bg px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              placeholder="상품 설명을 입력하세요."
              disabled={readOnly}
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="grid gap-1">
              <span className="label">소재 / 혼용률</span>
              <input
                className="border border-line-strong bg-bg px-3 py-2 text-sm"
                value={materialInfo}
                onChange={(e) => setMaterialInfo(e.target.value)}
                placeholder="예: 면 100%"
                disabled={readOnly}
              />
            </label>

            <label className="grid gap-1">
              <span className="label">사이즈 가이드</span>
              <input
                className="border border-line-strong bg-bg px-3 py-2 text-sm"
                value={sizeGuide}
                onChange={(e) => setSizeGuide(e.target.value)}
                placeholder="예: M(95~100), L(100~105)"
                disabled={readOnly}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isVisible}
              onChange={(e) => setIsVisible(e.target.checked)}
              disabled={readOnly}
            />
            <span>쇼핑몰에 상품 즉시 노출</span>
          </label>

          {/* 옵션(Variants) 등록 섹션 */}
          <section className="border-t border-line pt-4 space-y-3">
            <h2 className="label">옵션(Variant) 설정</h2>
            <p className="text-xs text-muted">
              색상, 사이즈 등 옵션을 추가하면 주문 시 개별 옵션별 재고가 관리됩니다.
            </p>

            {variants.length > 0 && (
              <ul className="space-y-2">
                {variants.map((v, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between rounded bg-neutral-100 p-2 text-xs"
                  >
                    <span>
                      <strong className="font-medium text-fg">{v.name}</strong>{" "}
                      {v.sku && <span className="text-muted">(SKU: {v.sku})</span>}{" "}
                      {v.priceDelta !== 0 && (
                        <span className="text-muted">
                          [{v.priceDelta > 0 ? "+" : ""}
                          {v.priceDelta.toLocaleString()}원]
                        </span>
                      )}{" "}
                      <span className="num font-semibold text-neutral-800">
                        재고: {v.stock}개
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-red-500 hover:underline"
                      onClick={() => removeVariant(idx)}
                      disabled={readOnly}
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!readOnly && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-surface p-3 rounded text-xs border border-line">
                <input
                  placeholder="옵션명 (예: 화이트 / M)"
                  value={varName}
                  onChange={(e) => setVarName(e.target.value)}
                  className="border border-line bg-bg px-2 py-1 col-span-2 sm:col-span-1"
                />
                <input
                  placeholder="SKU (선택)"
                  value={varSku}
                  onChange={(e) => setVarSku(e.target.value)}
                  className="border border-line bg-bg px-2 py-1"
                />
                <input
                  type="number"
                  placeholder="추가금(+/-)"
                  value={varDelta}
                  onChange={(e) => setVarDelta(e.target.value)}
                  className="border border-line bg-bg px-2 py-1"
                />
                <input
                  type="number"
                  min={0}
                  placeholder="재고"
                  value={varStock}
                  onChange={(e) => setVarStock(e.target.value)}
                  className="border border-line bg-bg px-2 py-1"
                />
                <button
                  type="button"
                  onClick={addVariant}
                  className="btn btn-sm col-span-2 sm:col-span-4 mt-1"
                >
                  + 옵션 추가
                </button>
              </div>
            )}
          </section>

          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}

          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={readOnly || loading}
            >
              {loading ? "등록하는 중…" : "상품 등록"}
            </button>
          </div>
        </form>
      </AdminOnly>
    </main>
  );
}
