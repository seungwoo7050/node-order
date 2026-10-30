"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { authFetch } from "@/lib/api-client";
import { dateTime } from "@/lib/orders";
import { AdminOnly, useReadOnly } from "../products/admin-only";

type Kind = "amount_mismatch" | "status_mismatch" | "missing_in_db" | "missing_in_pg" | "refund_mismatch";
type Issue = {
  id: number; provider: "toss" | "stripe" | "manual"; businessDate: string; kind: Kind; paymentKey: string; orderId: number | null;
  ourValue: Record<string, unknown> | null; pgValue: Record<string, unknown> | null;
  firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null; resolutionNote: string | null;
};
type IssuesPage = { items: Issue[]; counts: Record<Kind | "open", number> };
type Run = { id: number; provider: string; periodStart: string; startedAt: string; finishedAt: string | null; pgCount: number; dbCount: number; issueCount: number; error: string | null };

const KIND_LABEL: Record<Kind, string> = {
  amount_mismatch: "금액 다름",
  status_mismatch: "상태 다름",
  missing_in_db: "PG에만 있음",
  missing_in_pg: "우리에만 있음",
  refund_mismatch: "환불액 다름",
};
const KINDS = Object.keys(KIND_LABEL) as Kind[];
const PROVIDER_LABEL: Record<string, string> = { toss: "토스페이먼츠", stripe: "Stripe", manual: "수동" };

const READ_ONLY = "데모 관리자는 볼 수만 있습니다. 해결 표시와 메모는 진짜 관리자만 할 수 있어 입력을 꺼 두었습니다.";
const NOTE = "매일 04:00(한국 시각)에 전날 결제·환불을 PG 거래 목록과 맞춰 봅니다. 해결 표시한 건은 값이 그대로면 다음 대사에서도 해결 상태로 남고, 값이 바뀌면 다시 열립니다.";

const show = (v: Record<string, unknown> | null) => (v ? Object.entries(v).map(([k, x]) => `${k}=${x ?? "-"}`).join(", ") : "없음");

function IssueRow({ issue }: { issue: Issue }) {
  const readOnly = useReadOnly();
  const queryClient = useQueryClient();
  const [note, setNote] = useState(issue.resolutionNote ?? "");
  const mutation = useMutation({
    mutationFn: (resolved: boolean) =>
      authFetch<Issue>(`/admin/reconciliation/issues/${issue.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolved, note: note.trim() || undefined }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reconciliation-issues"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
  });
  return (
    <li className="grid gap-2 border-b border-line py-4 text-sm" data-testid={`issue-${issue.id}`}>
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium" data-testid="issue-kind">{KIND_LABEL[issue.kind]}</span>
        <span className="text-muted">{PROVIDER_LABEL[issue.provider] ?? issue.provider}</span>
        <span className="num break-all text-muted">{issue.paymentKey}</span>
        {issue.orderId && <Link href={`/admin/orders/${issue.orderId}`}>주문 #{issue.orderId}</Link>}
        {issue.resolvedAt && <span className="text-ok">해결됨 {dateTime(issue.resolvedAt)}</span>}
      </p>
      <p className="num text-[0.82rem]">우리: {show(issue.ourValue)} · PG: {show(issue.pgValue)}</p>
      <p className="text-[0.75rem] text-muted">처음 발견 {dateTime(issue.firstSeenAt)} · 마지막 발견 {dateTime(issue.lastSeenAt)}</p>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); mutation.mutate(!issue.resolvedAt); }}>
        <label className="sr-only" htmlFor={`note-${issue.id}`}>메모</label>
        <input id={`note-${issue.id}`} className="min-w-0 flex-1 border border-line px-2 py-1" placeholder="확인한 내용(해결 표시에 필요)" value={note}
          onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={readOnly} aria-describedby={readOnly ? "read-only-note" : undefined} />
        <button type="submit" className="btn" disabled={readOnly || (!issue.resolvedAt && !note.trim())} aria-disabled={mutation.isPending}>
          {issue.resolvedAt ? "다시 열기" : "해결 표시"}
        </button>
      </form>
      {mutation.error && <p role="alert" className="alert">{mutation.error.message}</p>}
    </li>
  );
}

function Issues() {
  const [kind, setKind] = useState<Kind | "">("");
  const [state, setState] = useState<"open" | "resolved" | "all">("open");
  const query = useQuery({
    queryKey: ["reconciliation-issues", kind, state],
    queryFn: () => authFetch<IssuesPage>(`/admin/reconciliation/issues?${new URLSearchParams({ state, ...(kind ? { kind } : {}) })}`),
  });
  return (
    <section aria-labelledby="issues">
      <h2 id="issues" className="sr-only">불일치 목록</h2>
      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="label">종류</span>
          <select className="border border-line px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value as Kind | "")} data-testid="kind-filter">
            <option value="">전체</option>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}{query.data ? ` (${query.data.counts[k]})` : ""}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="label">상태</span>
          <select className="border border-line px-2 py-1" value={state} onChange={(e) => setState(e.target.value as typeof state)} data-testid="state-filter">
            <option value="open">미해결</option>
            <option value="resolved">해결됨</option>
            <option value="all">전체</option>
          </select>
        </label>
      </div>
      {query.isPending ? (
        <p role="status" className="text-sm text-muted">불일치를 불러오는 중입니다.</p>
      ) : query.error ? (
        <p role="alert" className="alert">불일치를 불러오지 못했습니다. ({query.error.message})</p>
      ) : query.data.items.length === 0 ? (
        <p className="border-y border-line py-8 text-sm text-muted">{state === "open" ? "미해결 불일치가 없습니다." : "해당하는 불일치가 없습니다."}</p>
      ) : (
        <ul className="border-t border-line" data-testid="issues">
          {query.data.items.map((i) => <IssueRow key={`${i.id}-${i.resolvedAt}`} issue={i} />)}
        </ul>
      )}
    </section>
  );
}

function Runs() {
  const { data } = useQuery({ queryKey: ["reconciliation-runs"], queryFn: () => authFetch<Run[]>("/admin/reconciliation/runs") });
  if (!data || data.length === 0) return null;
  return (
    <section aria-labelledby="runs" className="mt-12">
      <h2 id="runs" className="label mb-2">최근 대사 실행</h2>
      <table className="w-full border-collapse text-left text-[0.82rem]" data-testid="runs">
        <thead>
          <tr className="border-b border-line-strong">
            <th scope="col" className="py-2 font-normal text-muted">기준일</th>
            <th scope="col" className="py-2 font-normal text-muted">PG</th>
            <th scope="col" className="py-2 text-right font-normal text-muted">PG·우리·불일치</th>
            <th scope="col" className="py-2 pl-4 font-normal text-muted">결과</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id} className="border-b border-line">
              <td className="num py-2">{new Date(r.periodStart).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</td>
              <td className="py-2">{PROVIDER_LABEL[r.provider] ?? r.provider}</td>
              <td className="num py-2 text-right">{r.pgCount} · {r.dbCount} · {r.issueCount}</td>
              <td className={`py-2 pl-4 ${r.error ? "text-danger" : ""}`}>{r.error ? `실패: ${r.error}` : r.finishedAt ? "완료" : "진행 중"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function ReconciliationPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">PG 대사</h1>
      <AdminOnly readOnlyNote={READ_ONLY} note={NOTE}>
        <Issues />
        <Runs />
      </AdminOnly>
    </main>
  );
}
