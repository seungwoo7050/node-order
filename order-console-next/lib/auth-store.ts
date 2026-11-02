import { create } from "zustand";

// 인증 상태. 접근 토큰은 메모리에만 있어 새로고침하면 사라지고, 갱신(/auth/refresh)이 끝날 때까지는 누구인지 모른다:
//   checking = 아직 모른다(화면을 막 열었다) / authenticated = 토큰이 있다 / anonymous = 갱신이 실패했거나 로그아웃했다
// 배송지처럼 "누구의 것인가"에 따라 보이는 값은 checking 동안 보이지도, 지우지도, 덮어쓰지도 않는다(cart-store.ts)
export type AuthStatus = "checking" | "authenticated" | "anonymous";

type AuthState = {
  accessToken: string | null;
  status: AuthStatus;
  setAccessToken: (token: string | null) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  status: "checking",
  setAccessToken: (accessToken) => set({ accessToken, status: accessToken ? "authenticated" : "anonymous" }),
  clear: () => set({ accessToken: null, status: "anonymous" }),
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
