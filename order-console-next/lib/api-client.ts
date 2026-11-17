import ky from "ky";
import { useAuthStore } from "./auth-store";
import { useCartStore } from "./cart-store";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// global.fetch 모킹 테스트 호환을 위해 (url: string, init: RequestInit) 형태로 정규화하여 fetch 호출
const adaptFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (input instanceof Request) {
    const url = input.url;
    const headers = new Headers(input.headers);
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    }
    const method = init?.method ?? input.method;
    let body: BodyInit | null | undefined = init?.body;
    if (body === undefined && method !== "GET" && method !== "HEAD") {
      try {
        body = await input.clone().text();
      } catch {
        body = input.body;
      }
    }
    const requestInit: RequestInit = {
      ...init,
      method,
      headers,
      body: body ?? undefined,
      credentials: init?.credentials ?? input.credentials,
      signal: init?.signal ?? input.signal,
    };
    return fetch(url, requestInit);
  }
  return fetch(input, init);
};

export const baseKy = ky.create({
  fetch: adaptFetch,
  throwHttpErrors: false,
});

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? res.statusText));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function publicFetch<T>(path: string): Promise<T> {
  return parse<T>(await baseKy.get(`${API_URL}${path}`));
}

export async function login(id: string, password: string): Promise<void> {
  const res = await baseKy.post(`${API_URL}/auth/login`, {
    json: { id, password },
    credentials: "include",
  });
  const { accessToken } = await parse<{ accessToken: string }>(res);
  useAuthStore.getState().setAccessToken(accessToken);
}

export async function demoLogin(as: "user" | "admin"): Promise<void> {
  const res = await baseKy.post(`${API_URL}/auth/demo`, {
    json: { as },
    credentials: "include",
  });
  const { accessToken } = await parse<{ accessToken: string }>(res);
  useAuthStore.getState().setAccessToken(accessToken);
}

export async function demoEnabled(): Promise<boolean> {
  const res = await baseKy.get(`${API_URL}/auth/demo`);
  return (await parse<{ enabled: boolean }>(res)).enabled;
}

export async function exchangeCode(code: string): Promise<void> {
  const res = await baseKy.post(`${API_URL}/auth/exchange`, {
    json: { code },
    credentials: "include",
  });
  const { accessToken } = await parse<{ accessToken: string }>(res);
  useAuthStore.getState().setAccessToken(accessToken);
}

export async function logout(): Promise<void> {
  // 배송지 원문은 서버 응답과 상관없이 먼저 지운다(같은 브라우저를 다음 사람이 쓴다)
  useCartStore.getState().clearShipping();
  try {
    await baseKy.post(`${API_URL}/auth/logout`, { credentials: "include" });
  } finally {
    useAuthStore.getState().clear();
  }
}

let refreshing: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  return (refreshing ??= (async () => {
    try {
      const res = await baseKy.post(`${API_URL}/auth/refresh`, { credentials: "include" });
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
  })());
}

export const authKy = baseKy.extend({
  hooks: {
    beforeRequest: [
      async ({ request }) => {
        let token = useAuthStore.getState().accessToken;
        if (!token) token = await refreshAccessToken();
        if (token) request.headers.set("Authorization", `Bearer ${token}`);
      },
    ],
    afterResponse: [
      async ({ request, response, retryCount }) => {
        if (response.status === 401 && retryCount === 0) {
          const token = await refreshAccessToken();
          if (token) {
            const headers = new Headers(request.headers);
            headers.set("Authorization", `Bearer ${token}`);
            return ky.retry({ request: new Request(request, { headers }) });
          }
        }
      },
    ],
  },
});

export async function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return authKy(url, { ...init, headers });
}

export async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return parse<T>(await fetchWithAuth(`${API_URL}${path}`, init));
}
