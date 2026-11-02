import { useAuthStore } from "./auth-store";
import { useCartStore } from "./cart-store";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? res.statusText));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function publicFetch<T>(path: string): Promise<T> {
  return parse<T>(await fetch(`${API_URL}${path}`));
}

export async function login(id: string, password: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password }),
    credentials: "include",
  });
  const { accessToken } = await parse<{ accessToken: string }>(res);
  useAuthStore.getState().setAccessToken(accessToken);
}

export async function demoLogin(as: "user" | "admin"): Promise<void> {
  const res = await fetch(`${API_URL}/auth/demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ as }),
    credentials: "include",
  });
  const { accessToken } = await parse<{ accessToken: string }>(res);
  useAuthStore.getState().setAccessToken(accessToken);
}

export async function demoEnabled(): Promise<boolean> {
  const res = await fetch(`${API_URL}/auth/demo`);
  return (await parse<{ enabled: boolean }>(res)).enabled;
}

export async function exchangeCode(code: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    credentials: "include",
  });
  const { accessToken } = await parse<{ accessToken: string }>(res);
  useAuthStore.getState().setAccessToken(accessToken);
}

export async function logout(): Promise<void> {
  // 배송지 원문은 서버 응답과 상관없이 먼저 지운다(같은 브라우저를 다음 사람이 쓴다)
  useCartStore.getState().clearShipping();
  try {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
  } finally {
    useAuthStore.getState().clear();
  }
}

let refreshing: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        useAuthStore.getState().setAccessToken(null);
        return null;
      }
      const { accessToken } = (await res.json()) as { accessToken: string };
      useAuthStore.getState().setAccessToken(accessToken);
      return accessToken;
    } catch {
      useAuthStore.getState().setAccessToken(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
  let res = await send(token);
  if (res.status === 401 && token) {
    token = await refreshAccessToken();
    if (token) res = await send(token);
  }
  return res;
}

export async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return parse<T>(await fetchWithAuth(`${API_URL}${path}`, init));
}