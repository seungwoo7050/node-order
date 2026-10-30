"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useTransition } from "react";
import { refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import type { CatalogProduct } from "@/lib/catalog";
import { streamDescriptionDraft } from "@/lib/description-draft";
import { featuresOptions } from "@/lib/features";
import { useTRPC } from "@/lib/trpc";
import { saveProduct } from "../actions";
import { useReadOnly } from "../admin-only";

const DESCRIPTION_MAX = 2000;

// 설명 초안: API가 SSE로 보내는 글을 설명 칸에 차례로 흘려 넣는다. 저장은 판매자가 "저장"을 누를 때만 한다.
// 중간에 오류가 나면 받은 글은 그대로 두고 오류를 보인다. 멈추기를 누르거나 화면을 떠나면 연결을 끊는다(API가 생성도 끊는다)
function useDescriptionDraft(productId: number, setDescription: (update: (prev: string) => string) => void) {
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function start(keywords: string) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setDraftError(null);
    setDrafting(true);
    setDescription(() => "");
    try {
      const result = await streamDescriptionDraft(productId, keywords.trim(), {
        signal: controller.signal,
        onText: (text) => setDescription((prev) => (prev + text).slice(0, DESCRIPTION_MAX)),
      });
      if (!result.ok) setDraftError(result.message);
    } catch (err) {
      if (!controller.signal.aborted) setDraftError(`초안을 받지 못했습니다. (${(err as Error).message})`);
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setDrafting(false);
      }
    }
  }

  function stop() {
    abort.current?.abort();
    abort.current = null;
    setDrafting(false);
  }

  return { drafting, draftError, start, stop };
}

export function EditProductForm({ product }: { product: CatalogProduct }) {
  const readOnly = useReadOnly();
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [description, setDescription] = useState(product.description);
  const [keywords, setKeywords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  // LLM 키가 없으면(features.llm false) 초안 버튼을 숨긴다. 데모 관리자도 숨긴다(API가 403)
  const { data: features } = useQuery(featuresOptions);
  const canDraft = features?.integrations?.llm === true && !readOnly;
  const draft = useDescriptionDraft(product.id, setDescription);
  // 손으로 고친 설명이 저장되지 않은 채 있으면 초안으로 덮어쓰기 전에 묻는다(초안은 칸을 비우고 다시 채운다)
  const [handEdited, setHandEdited] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  function startDraft(force = false) {
    if (!force && handEdited && description.trim() !== product.description.trim()) return setConfirmOverwrite(true);
    setConfirmOverwrite(false);
    setHandEdited(false);
    void draft.start(keywords);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || readOnly || draft.drafting) return;
    setError(null);
    startTransition(async () => {
      let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
      if (!token) return setError("로그인이 필요합니다.");
      const input = { name: name.trim(), price: Number(price), description: description.trim() };
      void queryClient.invalidateQueries({ queryKey: trpc.products.pathKey() });
      let result = await saveProduct(token, product.id, input);
      if (result.status === 401 && (token = await refreshAccessToken())) result = await saveProduct(token, product.id, input);
      setError(result.message); // 저장되면 목록으로 넘어간다(redirect)
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
        <textarea className="min-h-32 border border-line-strong bg-bg px-3 py-2" value={description} onChange={(e) => { setDescription(e.target.value); setHandEdited(true); }}
          maxLength={DESCRIPTION_MAX} disabled={readOnly} readOnly={draft.drafting} aria-busy={draft.drafting}
          aria-describedby={readOnly ? "read-only-note" : canDraft ? "draft-note" : undefined} />
      </label>
      {canDraft && (
        <section aria-label="AI 초안" className="grid gap-2 border-t border-line pt-4">
          <label className="grid gap-1">
            <span className="label">초안 키워드(선택)</span>
            <input className="border border-line-strong bg-bg px-3 py-2" value={keywords} onChange={(e) => setKeywords(e.target.value)}
              maxLength={200} placeholder="예: 조용한 클릭, 무선, 사무실" disabled={draft.drafting} />
          </label>
          <p id="draft-note" className="text-[0.78rem] text-muted">
            상품 이름·카테고리·가격·지금 설명과 키워드로 초안을 만들어 설명 칸에 채웁니다. 저장을 누르기 전에는 상품에 반영되지 않습니다.
          </p>
          <p className="flex gap-2">
            {draft.drafting ? (
              <>
                <span role="status" className="text-sm text-muted">초안을 받는 중입니다…</span>
                <button type="button" className="btn" onClick={draft.stop}>멈추기</button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => startDraft()}>설명 초안 만들기</button>
            )}
          </p>
          {confirmOverwrite && (
            <div role="alertdialog" aria-labelledby="overwrite-title" aria-describedby="overwrite-desc" className="grid gap-2 border border-line-strong p-3">
              <p id="overwrite-title" className="label">저장하지 않은 설명</p>
              <p id="overwrite-desc" className="text-sm">손으로 고친 설명이 아직 저장되지 않았습니다. 초안을 만들면 설명 칸을 덮어씁니다.</p>
              <p className="flex gap-2">
                <button type="button" className="btn" onClick={() => startDraft(true)}>덮어쓰기</button>
                <button type="button" className="btn" onClick={() => setConfirmOverwrite(false)}>취소</button>
              </p>
            </div>
          )}
          {draft.draftError && <p role="alert" className="alert" data-testid="draft-error">{draft.draftError}</p>}
        </section>
      )}
      {error && <p role="alert" className="alert">{error}</p>}
      <p>
        <button type="submit" className="btn btn-primary" disabled={readOnly || draft.drafting} aria-disabled={pending}>
          {pending ? "저장하는 중…" : "저장"}
        </button>
      </p>
    </form>
  );
}
