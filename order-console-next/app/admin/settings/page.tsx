"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { authFetch, refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { featuresOptions } from "@/lib/features";
import { storeInfoOptions, type StoreSettings } from "@/lib/store-info";
import { AdminOnly, useReadOnly } from "../products/admin-only";
import { saveStoreSettings, type SaveResult } from "./actions";

type Input = Omit<StoreSettings, "version" | "updatedAt">;
type Field = { name: keyof Input; label: string; type?: "number" | "email" | "tel"; hint?: string };

const GROUPS: { legend: string; fields: Field[] }[] = [
  {
    legend: "사업자 정보(상점 바닥글에 보입니다)",
    fields: [
      { name: "storeName", label: "상호" },
      { name: "representative", label: "대표자" },
      { name: "businessNumber", label: "사업자등록번호", hint: "10자리. 하이픈은 있어도 됩니다" },
      { name: "mailOrderNumber", label: "통신판매업 신고번호" },
      { name: "address", label: "사업장 주소" },
      { name: "phone", label: "연락처", type: "tel" },
      { name: "email", label: "이메일", type: "email" },
      { name: "privacyOfficer", label: "개인정보 보호책임자" },
    ],
  },
  {
    legend: "브랜딩·디자인(스토어프론트에 바로 반영됩니다)",
    fields: [
      { name: "storeDesign", label: "기본 스토어 디자인", hint: "muji-hara | editorial-atelier | zavanas-archive" },
      { name: "heroTitle", label: "히어로 타이틀", hint: "에디토리얼 상단 대형 문구" },
      { name: "heroSubtitle", label: "히어로 서브타이틀", hint: "에디토리얼 상단 보조 문구" },
      { name: "announcementText", label: "상단 공지 문구", hint: "최상단 공지 바 문구" },
    ],
  },
  {
    legend: "배송·재고(새 주문부터 적용, 지난 주문은 그대로)",
    fields: [
      { name: "shippingFee", label: "배송비(원)", type: "number" },
      { name: "freeShippingThreshold", label: "무료 배송 기준(원)", type: "number", hint: "상품 합계가 이 금액 이상이면 배송비 0원" },
      { name: "returnShippingFee", label: "단순변심 반품 왕복 배송비(원)", type: "number" },
      { name: "lowStockThreshold", label: "재고 부족 기준(개)", type: "number", hint: "대시보드에 이 수 이하인 상품이 보입니다" },
    ],
  },
];
const NUMBER_FIELDS = new Set(GROUPS.flatMap((g) => g.fields).filter((f) => f.type === "number").map((f) => f.name));

const READ_ONLY = "데모 관리자는 볼 수만 있습니다. 상점 설정 저장은 진짜 관리자만 할 수 있어 입력을 꺼 두었습니다.";

const toForm = (s: Partial<StoreSettings>) =>
  Object.fromEntries(
    GROUPS.flatMap((g) => g.fields).map((f) => {
      let val = s[f.name];
      if (f.name === "storeDesign" && !val) val = "editorial-atelier";
      return [f.name, String(val ?? "")];
    })
  ) as Record<keyof Input, string>;

function Integrations() {
  const { data } = useQuery(featuresOptions);
  const rows: [string, boolean | undefined][] = [
    ["토스페이먼츠", data?.integrations?.toss],
    ["Stripe", data?.integrations?.stripe],
    ["오류 추적", data?.integrations?.errorTracking],
    ["LLM", data?.integrations?.llm],
  ];
  return (
    <section aria-labelledby="integrations" className="mt-12">
      <h2 id="integrations" className="label mb-2">연결된 기능</h2>
      <p className="mb-3 text-[0.78rem] text-muted">키는 서버 환경변수에만 둡니다. 이 화면에서는 받지도 보이지도 않고, 연결 여부만 봅니다.</p>
      <dl className="grid max-w-xs grid-cols-[1fr_auto] gap-y-1 text-sm" data-testid="integrations">
        {rows.map(([name, on]) => (
          <div key={name} className="contents">
            <dt>{name}</dt>
            <dd className={on ? "" : "text-muted"}>{on === undefined ? "확인 중" : on ? "연결됨" : "없음"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SettingsForm({ initial }: { initial: StoreSettings }) {
  const readOnly = useReadOnly();
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(initial.version);
  const [form, setForm] = useState(() => toForm(initial));
  const [result, setResult] = useState<SaveResult<StoreSettings> | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || readOnly) return;
    startTransition(async () => {
      let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
      if (!token) return setResult({ ok: false, status: 401, message: "로그인이 필요합니다." });
      const input = Object.fromEntries(
        Object.entries(form)
          .filter(([k, v]) => !(k === "storeDesign" && !v))
          .map(([k, v]) => [k, NUMBER_FIELDS.has(k as keyof Input) ? Number(v) : v])
      ) as Input;
      let saved = await saveStoreSettings(token, version, input);
      if (!saved.ok && saved.status === 401 && (token = await refreshAccessToken())) saved = await saveStoreSettings(token, version, input);
      setResult(saved);
      if (saved.ok) {
        setVersion(saved.value.version);
        setForm(toForm(saved.value));
        queryClient.setQueryData(["admin-settings"], saved.value);
        void queryClient.invalidateQueries({ queryKey: ["admin-branding"] });
        void queryClient.invalidateQueries({ queryKey: storeInfoOptions.queryKey });
      }
    });
  }

  // 충돌: 다른 곳에서 먼저 저장했다. 지금 값을 불러와 다시 고친 뒤 저장한다(입력값은 버린다)
  function reloadCurrent(current: StoreSettings) {
    setVersion(current.version);
    setForm((prev) => toForm({ ...prev, ...current }));
    setResult(null);
  }

  const fieldError = (name: keyof Input) => (result && !result.ok ? result.fields?.[name] : undefined);
  return (
    <form onSubmit={submit} className="grid max-w-xl gap-8" noValidate data-testid="settings-form">
      {GROUPS.map((g) => (
        <fieldset key={g.legend} className="grid gap-4">
          <legend className="label mb-3">{g.legend}</legend>
          {g.fields.map((f) => {
            const err = fieldError(f.name);
            const describedBy = [err && `${f.name}-error`, f.hint && `${f.name}-hint`, readOnly && "read-only-note"].filter(Boolean).join(" ") || undefined;
            return (
              <label key={f.name} className="grid gap-1">
                <span className="text-sm">{f.label}</span>
                {f.name === "storeDesign" ? (
                  <select
                    name={f.name}
                    aria-label={f.label}
                    data-testid="store-design-select"
                    className="border bg-bg px-3 py-2 border-line-strong text-sm"
                    value={form[f.name]}
                    onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                    disabled={readOnly}
                    aria-describedby={describedBy}
                  >
                    <option value="editorial-atelier">editorial-atelier (에디토리얼 룩북)</option>
                    <option value="muji-hara">muji-hara (무지·하라 촉각 카탈로그)</option>
                    <option value="zavanas-archive">zavanas-archive (자바나스 스펙 매트릭스)</option>
                  </select>
                ) : (
                  <input
                    name={f.name} aria-label={f.label} className={`border bg-bg px-3 py-2 ${f.type === "number" ? "num" : ""} ${err ? "border-danger" : "border-line-strong"}`}
                    type={f.type === "number" ? "text" : (f.type ?? "text")} inputMode={f.type === "number" ? "numeric" : undefined}
                    value={form[f.name]} onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}
                    disabled={readOnly} aria-invalid={err ? true : undefined} aria-describedby={describedBy}
                  />
                )}
                {f.hint && <span id={`${f.name}-hint`} className="text-[0.75rem] text-muted">{f.hint}</span>}
                {err && <span id={`${f.name}-error`} className="text-[0.8rem] text-danger" data-testid={`error-${f.name}`}>{err}</span>}
              </label>
            );
          })}
        </fieldset>
      ))}
      {result && !result.ok && result.status === 409 && result.current && (
        <div role="alert" className="alert" data-testid="save-conflict">
          다른 곳에서 먼저 설정을 저장했습니다(지금 {result.currentVersion}판). 지금 값을 불러온 뒤 다시 고쳐 저장해 주세요.
          <button type="button" className="btn ml-3" onClick={() => reloadCurrent(result.current!)}>지금 값 불러오기</button>
        </div>
      )}
      {result && !result.ok && result.status !== 409 && <p role="alert" className="alert">저장하지 못했습니다: {result.message}</p>}
      {result?.ok && <p role="status" className="note" data-testid="save-done">저장했습니다({result.value.version}판). 상점 화면에 바로 보입니다.</p>}
      <p className="flex items-center gap-4">
        <button type="submit" className="btn btn-primary" disabled={readOnly} aria-disabled={pending}>{pending ? "저장하는 중…" : "저장"}</button>
        <span className="text-[0.78rem] text-muted num">설정 {version}판을 고치는 중</span>
      </p>
    </form>
  );
}

function Settings() {
  const settingsQuery = useQuery({ queryKey: ["admin-settings"], queryFn: () => authFetch<StoreSettings>("/admin/settings"), staleTime: Infinity });
  const brandingQuery = useQuery({ queryKey: ["admin-branding"], queryFn: () => authFetch<Record<string, string>>("/admin/settings/branding"), staleTime: Infinity });

  if (settingsQuery.isPending || brandingQuery.isPending) return <p role="status" className="text-sm text-muted">설정을 불러오는 중입니다.</p>;
  if (settingsQuery.error)
    return <p role="alert" className="alert">설정을 불러오지 못했습니다. ({settingsQuery.error.message}) <button type="button" className="btn ml-2" onClick={() => void settingsQuery.refetch()}>다시 시도</button></p>;

  const initial = {
    ...settingsQuery.data!,
    storeDesign: brandingQuery.data?.storeDesign ?? "editorial-atelier",
    heroTitle: brandingQuery.data?.heroTitle ?? "CONTEMPORARY ARCHIVE COLLECTION",
    heroSubtitle: brandingQuery.data?.heroSubtitle ?? "소재의 본질과 절제된 실루엣에 집중한 데일리 에센셜 아카이브",
    announcementText: brandingQuery.data?.announcementText ?? "전 상품 50,000원 이상 구매 시 무료배송 · 신규 가입 웰컴 쿠폰 증정",
  };

  return <SettingsForm initial={initial} />;
}

export default function AdminSettingsPage() {
  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">상점 설정</h1>
      <AdminOnly readOnlyNote={READ_ONLY} note={null}>
        <Settings />
        <Integrations />
      </AdminOnly>
    </main>
  );
}
