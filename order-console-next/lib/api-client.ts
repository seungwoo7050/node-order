import { useAuthStore } from "./auth-store";

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

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
  useAuthStore.getState().clear();
}

export async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
  if (!res.ok) {
    useAuthStore.getState().clear();
    return null;
  }
  const { accessToken } = (await res.json()) as { accessToken: string };
  useAuthStore.getState().setAccessToken(accessToken);
  return accessToken;
}

export async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = (token: string | null) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...init.headers, ...(token && { Authorization: `Bearer ${token}` }) },
    });

  let token = useAuthStore.getState().accessToken ?? (await refreshAccessToken());
  let res = await send(token);
  if (res.status === 401 && token) {
    token = await refreshAccessToken();
    if (token) res = await send(token);
  }
  return parse<T>(res);
}