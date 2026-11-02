"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authFetch } from "@/lib/api-client";
import { AdminOnly, useReadOnly } from "../products/admin-only";

type SecretItem = {
  key: string;
  label: string;
  category: string;
  configured: boolean;
  source: "db" | "env" | "none";
  maskedPreview?: string;
  updatedAt?: string | null;
};

type SystemOverview = {
  secrets: SecretItem[];
  controls: {
    pausePaidApis: boolean;
    maintenanceMode: boolean;
    updatedAt: string;
  };
  dbCounts: Record<string, number>;
  infrastructure: {
    id: string;
    name: string;
    status: string;
    billingType: string;
    description: string;
  }[];
  runbook: {
    commands: { command: string; title: string; description: string }[];
    strategy: string;
  };
};

export default function AdminSystemPage() {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();

  const [secretKey, setSecretKey] = useState("TOSS_SECRET_KEY");
  const [secretValue, setSecretValue] = useState("");
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data, isPending } = useQuery<SystemOverview>({
    queryKey: ["admin-system-overview"],
    queryFn: () => authFetch<SystemOverview>("/admin/system"),
  });

  const toggleControlMutation = useMutation({
    mutationFn: async (patch: { pausePaidApis?: boolean; maintenanceMode?: boolean }) => {
      setError(null);
      await authFetch("/admin/system/controls", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-system-overview"] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "시스템 제어 변경 실패"),
  });

  const saveSecretMutation = useMutation({
    mutationFn: async () => {
      if (!secretKey || !secretValue.trim()) return;
      setError(null);
      await authFetch("/admin/integrations/secrets", {
        method: "PUT",
        body: JSON.stringify({
          key: secretKey,
          value: secretValue.trim(),
        }),
      });
      setSecretValue("");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-system-overview"] });
      alert("비밀값이 안전하게 암호화되어 금고에 저장되었습니다.");
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "비밀값 저장 실패"),
  });

  const deleteSecretMutation = useMutation({
    mutationFn: async (key: string) => {
      if (!confirm(`'${key}' 비밀값을 삭제하시겠습니까?`)) return;
      setError(null);
      await authFetch(`/admin/integrations/secrets/${key}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-system-overview"] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : "비밀값 삭제 실패"),
  });

  const testSecret = async (key: string) => {
    try {
      const res = await authFetch<{ ok: boolean; message: string }>(`/admin/integrations/secrets/${key}/test`, {
        method: "POST",
      });
      setTestResult((prev) => ({ ...prev, [key]: res.message }));
    } catch (err: unknown) {
      setTestResult((prev) => ({ ...prev, [key]: `오류: ${err instanceof Error ? err.message : String(err)}` }));
    }
  };

  if (isPending || !data) {
    return (
      <main className="page flex-1 pb-12 pt-2">
        <h1 className="title mb-6">시스템·API 금고</h1>
        <p className="text-sm text-muted">시스템 상태를 불러오는 중입니다…</p>
      </main>
    );
  }

  const { secrets, controls, dbCounts, infrastructure, runbook } = data;

  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-6">시스템·API 금고 및 런타임 제어</h1>

      <AdminOnly>
        {error && <p role="alert" className="alert mb-6">{error}</p>}

        <div className="space-y-10">
          {/* 1. 긴급 운영 통제 스위치 */}
          <section className="rounded border border-line bg-surface p-5 space-y-4">
            <h2 className="label text-sm">런타임 긴급 운영 제어</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start justify-between rounded bg-bg p-4 border border-line">
                <div>
                  <strong className="block text-sm font-semibold">유료 API 일괄 차단</strong>
                  <span className="text-xs text-muted block mt-1">
                    LLM, 외부 주소검색 등 종량제 외부 API 호출을 즉시 정지하여 과금을 방지합니다.
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="control-pause-paid-apis"
                  disabled={readOnly || toggleControlMutation.isPending}
                  onClick={() => toggleControlMutation.mutate({ pausePaidApis: !controls.pausePaidApis })}
                  className={`shrink-0 ml-4 rounded px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                    controls.pausePaidApis
                      ? "bg-red-600 text-white"
                      : "bg-neutral-200 text-neutral-800"
                  }`}
                >
                  {controls.pausePaidApis ? "차단 중 (켜짐)" : "정상 허용 (꺼짐)"}
                </button>
              </div>

              <div className="flex items-start justify-between rounded bg-bg p-4 border border-line">
                <div>
                  <strong className="block text-sm font-semibold">상점 점검(휴면) 모드</strong>
                  <span className="text-xs text-muted block mt-1">
                    신규 주문 결제를 503 점검 중으로 즉시 차단합니다.
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="control-maintenance-mode"
                  disabled={readOnly || toggleControlMutation.isPending}
                  onClick={() => toggleControlMutation.mutate({ maintenanceMode: !controls.maintenanceMode })}
                  className={`shrink-0 ml-4 rounded px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                    controls.maintenanceMode
                      ? "bg-amber-600 text-white"
                      : "bg-neutral-200 text-neutral-800"
                  }`}
                >
                  {controls.maintenanceMode ? "점검 중 (503 차단)" : "정상 운영 (꺼짐)"}
                </button>
              </div>
            </div>
          </section>

          {/* 2. 연동 API 키 금고 (Vault) */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="title text-base">외부 연동 API 키 금고 (AES-256-GCM)</h2>
                <p className="text-xs text-muted mt-0.5">
                  비밀값은 데이터베이스에 안전하게 암호화되어 보관되며 마스킹 처리되어 원문이 노출되지 않습니다.
                </p>
              </div>
            </div>

            {/* 신규 키 등록 양식 */}
            {!readOnly && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveSecretMutation.mutate();
                }}
                className="grid sm:grid-cols-[180px_minmax(0,1fr)_auto] gap-2 rounded border border-line bg-neutral-50 p-3 text-xs"
              >
                <select
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  className="border border-line bg-bg px-2.5 py-1.5 rounded"
                >
                  {secrets.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label} ({s.key})
                    </option>
                  ))}
                </select>
                <input
                  type="password"
                  placeholder="비밀값 원문 입력 (저장 시 AES-256-GCM 암호화)"
                  value={secretValue}
                  onChange={(e) => setSecretValue(e.target.value)}
                  required
                  className="border border-line bg-bg px-2.5 py-1.5 rounded"
                />
                <button
                  type="submit"
                  disabled={saveSecretMutation.isPending || !secretValue.trim()}
                  className="btn btn-sm btn-primary whitespace-nowrap"
                >
                  금고에 저장
                </button>
              </form>
            )}

            {/* 비밀값 목록 테이블 */}
            <div className="overflow-x-auto border border-line rounded">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-surface text-muted">
                    <th className="py-2.5 px-3 font-medium">항목</th>
                    <th className="py-2.5 px-3 font-medium">환경변수 키</th>
                    <th className="py-2.5 px-3 font-medium">상태 / 출처</th>
                    <th className="py-2.5 px-3 font-medium">마스킹 미리보기</th>
                    <th className="py-2.5 px-3 font-medium text-right">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {secrets.map((s) => (
                    <tr key={s.key} className="border-b border-line last:border-b-0 hover:bg-neutral-50/50">
                      <td className="py-2.5 px-3 font-medium text-fg">{s.label}</td>
                      <td className="py-2.5 px-3 num text-muted">{s.key}</td>
                      <td className="py-2.5 px-3">
                        {s.configured ? (
                          <span className="rounded bg-green-50 text-green-700 px-1.5 py-0.5 border border-green-200">
                            설정됨 ({s.source === "db" ? "DB 금고" : ".env"})
                          </span>
                        ) : (
                          <span className="rounded bg-neutral-100 text-muted px-1.5 py-0.5">
                            미설정
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-neutral-600">
                        {s.maskedPreview ?? "-"}
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-2">
                        <button
                          type="button"
                          data-testid={`test-secret-${s.key}`}
                          onClick={() => testSecret(s.key)}
                          className="link-quiet cursor-pointer"
                        >
                          연결 확인
                        </button>
                        {!readOnly && s.source === "db" && (
                          <button
                            type="button"
                            onClick={() => deleteSecretMutation.mutate(s.key)}
                            className="text-red-500 hover:underline cursor-pointer"
                          >
                            삭제
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 연결 확인 피드백 */}
            {Object.keys(testResult).length > 0 && (
              <div className="space-y-1 rounded bg-neutral-100 p-3 text-xs">
                {Object.entries(testResult).map(([k, msg]) => (
                  <p key={k}>
                    <strong className="text-fg">{k}:</strong> {msg}
                  </p>
                ))}
              </div>
            )}
          </section>

          {/* 3. 데이터베이스 정본 행 수 현황 */}
          <section className="space-y-3">
            <h2 className="label">데이터베이스 엔티티 현황 (정본 Row Counts)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
              {Object.entries(dbCounts).map(([entity, count]) => (
                <div key={entity} className="rounded border border-line bg-surface p-3">
                  <span className="text-muted block mb-1">{entity}</span>
                  <span className="num font-semibold text-lg">{count}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 4. 인프라 서비스 현황 */}
          <section className="space-y-3">
            <h2 className="label">인프라 및 연결 서비스</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {infrastructure.map((inf) => (
                <div key={inf.id} className="rounded border border-line p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-fg">{inf.name}</span>
                    <span className="rounded bg-neutral-100 text-neutral-700 px-1.5 py-0.5 text-[10px]">
                      {inf.billingType}
                    </span>
                  </div>
                  <p className="text-muted">{inf.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 5. 런북 및 비상 명령어 */}
          <section className="space-y-3 rounded border border-line p-4 bg-neutral-50 text-xs">
            <h2 className="label">운영 런북 (비상 절차 및 방침)</h2>
            <p className="text-muted leading-relaxed">{runbook.strategy}</p>
            <div className="space-y-2 mt-3">
              {(runbook?.commands ?? []).map((cmd) => (
                <div key={cmd.command} className="rounded bg-bg p-2.5 border border-line">
                  <p className="font-semibold text-fg mb-1">{cmd.title}</p>
                  <code className="font-mono bg-neutral-100 px-2 py-0.5 rounded text-[11px] block w-fit mb-1">
                    {cmd.command}
                  </code>
                  <p className="text-muted">{cmd.description}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </AdminOnly>
    </main>
  );
}
