"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, useTransition } from "react";
import { authFetch, refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { LEGAL_KINDS, LEGAL_LABEL, dateOnly, privacyOptions, type LegalDocument, type LegalKind } from "@/lib/store-info";
import { AdminOnly, useReadOnly } from "../products/admin-only";
import { publishLegalDocument } from "../settings/actions";

const READ_ONLY = "데모 관리자는 볼 수만 있습니다. 문서 저장은 진짜 관리자만 할 수 있어 입력을 꺼 두었습니다.";
const NOTE = "저장하면 새 판이 생기고 지난 판은 그대로 남아 공개 페이지의 변경 이력에서 열람할 수 있습니다. 개인정보처리방침을 고치면 손님은 결제할 때 새 판에 다시 동의합니다.";

type Message = { ok: boolean; text: string } | null;

// 저장하면 판이 바뀌어 편집기를 새로 그린다(key). 결과 문구는 바깥(LegalEditor)이 쥔다
function Editor({ doc, message, setMessage }: { doc: LegalDocument; message: Message; setMessage: (m: Message) => void }) {
  const readOnly = useReadOnly();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const [effectiveAt, setEffectiveAt] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || readOnly) return;
    startTransition(async () => {
      let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
      if (!token) return setMessage({ ok: false, text: "로그인이 필요합니다." });
      // datetime-local은 시간대가 없다: 브라우저 시각으로 읽어 ISO로 보낸다
      const input = { title, body, ...(effectiveAt ? { effectiveAt: new Date(effectiveAt).toISOString() } : {}) };
      let saved = await publishLegalDocument(token, doc.kind, input);
      if (!saved.ok && saved.status === 401 && (token = await refreshAccessToken())) saved = await publishLegalDocument(token, doc.kind, input);
      if (!saved.ok) return setMessage({ ok: false, text: `저장하지 못했습니다: ${saved.message}` });
      setMessage({ ok: true, text: `${saved.value.version}판으로 저장했습니다.` });
      setEffectiveAt("");
      queryClient.setQueryData(["admin-legal", doc.kind], saved.value);
      if (doc.kind === "privacy") void queryClient.invalidateQueries({ queryKey: privacyOptions.queryKey });
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" data-testid="legal-form">
      <label className="grid gap-1">
        <span className="text-sm">제목</span>
        <input className="border border-line-strong bg-bg px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={100}
          disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
      </label>
      <label className="grid gap-1">
        <span className="text-sm">본문</span>
        <textarea className="min-h-64 border border-line-strong bg-bg px-3 py-2 text-sm leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} required
          disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
      </label>
      <label className="grid max-w-xs gap-1">
        <span className="text-sm">시행일(비우면 지금부터)</span>
        <input type="datetime-local" className="border border-line-strong bg-bg px-3 py-2" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} disabled={readOnly} />
      </label>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "note" : "alert"} data-testid="legal-save-message">{message.text}</p>}
      <p><button type="submit" className="btn btn-primary" disabled={readOnly} aria-disabled={pending}>{pending ? "저장하는 중…" : "새 판으로 저장"}</button></p>
    </form>
  );
}

function LegalEditor({ kind }: { kind: LegalKind }) {
  const { data, error, isPending } = useQuery({ queryKey: ["admin-legal", kind], queryFn: () => authFetch<LegalDocument>(`/admin/legal/${kind}`) });
  const [message, setMessage] = useState<Message>(null);
  if (isPending) return <p role="status" className="text-sm text-muted">문서를 불러오는 중입니다.</p>;
  if (error) return <p role="alert" className="alert">문서를 불러오지 못했습니다. ({error.message})</p>;
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_220px]">
      <Editor key={`${kind}-${data.version}`} doc={data} message={message} setMessage={setMessage} />
      <aside aria-label="판 목록">
        <h2 className="label mb-2">판 목록</h2>
        <ol className="border-t border-line text-sm" data-testid="legal-versions">
          {data.versions.map((v) => (
            <li key={v.version} className="flex justify-between gap-3 border-b border-line py-2">
              <Link href={`/legal/${kind}?version=${v.version}`}>{v.version}판</Link>
              <span className="text-muted">{dateOnly(v.effectiveAt)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[0.78rem]"><Link href={`/legal/${kind}`}>공개 페이지 보기</Link></p>
      </aside>
    </div>
  );
}

export default function AdminLegalPage() {
  const [kind, setKind] = useState<LegalKind>("privacy");
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">약관·방침</h1>
      <AdminOnly readOnlyNote={READ_ONLY} note={NOTE}>
        <div role="tablist" aria-label="문서 종류" className="mb-8 flex gap-4 border-b border-line text-sm">
          {LEGAL_KINDS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
              className={`-mb-px cursor-pointer border-b py-2 ${kind === k ? "border-fg text-fg" : "border-transparent text-muted"}`}>
              {LEGAL_LABEL[k]}
            </button>
          ))}
        </div>
        <LegalEditor key={kind} kind={kind} />
      </AdminOnly>
    </main>
  );
}
