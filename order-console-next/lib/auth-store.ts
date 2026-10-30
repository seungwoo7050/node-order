import { create } from "zustand";

type AuthState = {
  accessToken: string | null;
  setAccessToken: (token: string) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null }),
}));

// 접근 토큰(JWT)의 sub(사용자 id). 서명은 확인하지 않는다(API가 확인한다). 화면이 "지금 누구인가"를 알 때만 쓴다
export function tokenSubject(token: string | null): string | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}
