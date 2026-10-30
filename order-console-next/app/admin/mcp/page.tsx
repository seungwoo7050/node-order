"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { API_URL, authFetch } from "@/lib/api-client";
import { AdminOnly, useReadOnly } from "../products/admin-only";

type Scope = "read" | "write" | "pii";
type Token = { id: number; name: string; prefix: string; scopes: Scope[]; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; createdAt: string };
type AuditRow = { id: number; tool: string; args: unknown; ok: boolean; error: string | null; createdAt: string; token: { id: number; name: string; prefix: string } };

const SCOPE_LABEL: Record<Scope, string> = {
  read: "read: 주문·재고·대사 읽기",
  write: "write: 송장 입력, 배송 완료, 반품 승인·거절, 재고 조정",
  pii: "pii: 손님 연락처·주소 원문(없으면 가린다)",
};

const READ_ONLY = "데모 관리자가 발급한 토큰은 read 범위만 갖습니다(바꾸는 도구와 연락처 원문은 진짜 관리자만).";
const NOTE = "Claude 같은 MCP 클라이언트가 이 상점의 주문·배송·재고 도구를 쓰게 하는 개인 접근 토큰입니다. 원문은 발급할 때 한 번만 보입니다.";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "-");

function IssueForm({ onIssued }: { onIssued: (t: Token & { token: string }) => void }) {
  const readOnly = useReadOnly();
  const [name, setName] = useState("Claude Code");
  const [scopes, setScopes] = useState<Scope[]>(["read"]);
  const [days, setDays] = useState(30);
  const issue = useMutation({
    mutationFn: () => authFetch<Token & { token: string }>("/admin/mcp/tokens", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), scopes, expiresInDays: days }),
    }),
    onSuccess: onIssued,
  });
  const toggle = (s: Scope) => setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <form className="grid max-w-md gap-4" onSubmit={(e) => { e.preventDefault(); issue.mutate(); }}>
      <label className="grid gap-1">
        <span className="label">토큰 이름</span>
        <input className="border border-line-strong bg-bg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required maxLength={50} />
      </label>
      <fieldset className="grid gap-1">
        <legend className="label mb-1">범위</legend>
        {(["read", "write", "pii"] as const).map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} disabled={readOnly && s !== "read"} />
            {SCOPE_LABEL[s]}
          </label>
        ))}
      </fieldset>
      <label className="grid gap-1">
        <span className="label">만료</span>
        <select className="border border-line-strong bg-bg px-3 py-2" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{d}일 뒤</option>)}
        </select>
      </label>
      {issue.error && <p role="alert" className="alert">{issue.error.message}</p>}
      <p><button type="submit" className="btn btn-primary" disabled={scopes.length === 0} aria-disabled={issue.isPending}>{issue.isPending ? "발급하는 중…" : "토큰 발급"}</button></p>
    </form>
  );
}

function IssuedToken({ token }: { token: Token & { token: string } }) {
  const command = `claude mcp add --transport http node-order ${API_URL}/mcp --header "Authorization: Bearer ${token.token}"`;
  return (
    <section aria-label="발급한 토큰" className="grid gap-2 border border-line-strong p-4" data-testid="issued-token">
      <p className="text-sm">이 원문은 지금 한 번만 보입니다. 안전한 곳에 옮겨 두세요. 범위: {token.scopes.join(", ")}</p>
      <code className="break-all bg-bg px-2 py-1 text-sm" data-testid="token-value">{token.token}</code>
      <p className="label mt-2">Claude Code에 붙이기</p>
      <code className="break-all bg-bg px-2 py-1 text-[0.78rem]">{command}</code>
    </section>
  );
}

function Tokens() {
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<(Token & { token: string }) | null>(null);
  const tokens = useQuery({ queryKey: ["mcp-tokens"], queryFn: () => authFetch<Token[]>("/admin/mcp/tokens") });
  const revoke = useMutation({
    mutationFn: (id: number) => authFetch<Token>(`/admin/mcp/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["mcp-tokens"] }),
  });

  return (
    <div className="grid gap-8">
      <IssueForm onIssued={(t) => { setIssued(t); void queryClient.invalidateQueries({ queryKey: ["mcp-tokens"] }); }} />
      {issued && <IssuedToken token={issued} />}
      <section aria-label="발급한 토큰 목록">
        <h2 className="label mb-2">토큰</h2>
        {tokens.isPending && <p role="status" className="text-sm text-muted">불러오는 중입니다.</p>}
        {tokens.error && <p role="alert" className="alert">토큰을 불러오지 못했습니다. ({tokens.error.message})</p>}
        {tokens.data?.length === 0 && <p className="text-sm text-muted">발급한 토큰이 없습니다.</p>}
        <ul className="grid gap-2 text-sm">
          {tokens.data?.map((t) => {
            const expired = new Date(t.expiresAt) <= new Date();
            const state = t.revokedAt ? "폐기됨" : expired ? "만료됨" : "사용 중";
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2" data-testid={`token-${t.id}`}>
                <span className="font-medium">{t.name}</span>
                <code>{t.prefix}…</code>
                <span>{t.scopes.join(", ")}</span>
                <span className="text-muted">만료 {when(t.expiresAt)} · 마지막 사용 {when(t.lastUsedAt)}</span>
                <span>{state}</span>
                {!t.revokedAt && !expired && (
                  <button type="button" className="btn" onClick={() => revoke.mutate(t.id)} aria-disabled={revoke.isPending}>폐기</button>
                )}
              </li>
            );
          })}
        </ul>
        {revoke.error && <p role="alert" className="alert">{revoke.error.message}</p>}
      </section>
    </div>
  );
}

function Audit() {
  const audit = useQuery({ queryKey: ["mcp-audit"], queryFn: () => authFetch<{ items: AuditRow[] }>("/admin/mcp/audit?limit=50"), refetchInterval: 15_000 });
  return (
    <section aria-label="도구 호출 기록" className="mt-12">
      <h2 className="label mb-2">도구 호출 기록(최근 50건)</h2>
      {audit.isPending && <p role="status" className="text-sm text-muted">불러오는 중입니다.</p>}
      {audit.error && <p role="alert" className="alert">기록을 불러오지 못했습니다. ({audit.error.message})</p>}
      {audit.data?.items.length === 0 && <p className="text-sm text-muted">아직 호출이 없습니다.</p>}
      {audit.data && audit.data.items.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead><tr><th>시각</th><th>토큰</th><th>도구</th><th>인자(연락처는 가림)</th><th>결과</th></tr></thead>
          <tbody>
            {audit.data.items.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="num whitespace-nowrap pr-3">{when(r.createdAt)}</td>
                <td className="pr-3">{r.token.name}</td>
                <td className="pr-3"><code>{r.tool}</code></td>
                <td className="pr-3"><code className="break-all text-[0.78rem]">{JSON.stringify(r.args)}</code></td>
                <td>{r.ok ? "성공" : `실패: ${r.error ?? ""}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function AdminMcpPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <p className="label mb-1"><Link href="/admin">대시보드</Link> / MCP</p>
      <h1 className="title mb-8">AI 도우미 연결(MCP)</h1>
      <AdminOnly readOnlyNote={READ_ONLY} note={NOTE}>
        <Tokens />
        <Audit />
      </AdminOnly>
    </main>
  );
}
