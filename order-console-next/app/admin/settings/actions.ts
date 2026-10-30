"use server";

import { updateTag } from "next/cache";
import { LEGAL_TAG, STORE_TAG } from "@/lib/store-cache";
import type { LegalDocument, LegalKind, StoreSettings } from "@/lib/store-info";

// API 응답을 그대로 화면에 돌려준다(칸별 오류 fields, 409의 currentVersion·current)
export type SaveResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string; fields?: Record<string, string>; currentVersion?: number; current?: StoreSettings };

async function call<T>(token: string, method: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<SaveResult<T>> {
  const res = await fetch(`${process.env.API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, value: json as T };
  const message = Array.isArray(json.message) ? json.message.join(", ") : String(json.message ?? res.statusText);
  return { ok: false, status: res.status, message, fields: json.fields as Record<string, string> | undefined, currentVersion: json.currentVersion as number | undefined, current: json.current as StoreSettings | undefined };
}

// 저장에 성공하면 바닥글·/legal/*가 쓰는 태그 캐시를 버린다(배포 없이 다음 요청부터 새 값)
export async function saveStoreSettings(token: string, version: number, input: Omit<StoreSettings, "version" | "updatedAt">): Promise<SaveResult<StoreSettings>> {
  const result = await call<StoreSettings>(token, "PUT", "/admin/settings", input, { "If-Match": `"${version}"` });
  if (result.ok) updateTag(STORE_TAG);
  return result;
}

export async function publishLegalDocument(token: string, kind: LegalKind, input: { title: string; body: string; effectiveAt?: string }): Promise<SaveResult<LegalDocument>> {
  const result = await call<LegalDocument>(token, "POST", `/admin/legal/${kind}`, input);
  if (result.ok) updateTag(LEGAL_TAG);
  return result;
}
