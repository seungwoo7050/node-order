"use client";

import { useSearchParams } from "next/navigation";

// Auth.js는 GitHub 로그인이 실패하면(API 거절, 사용자 취소) pages.error인 /login?error=<코드>로 보낸다(auth.ts).
// 코드 값은 Auth.js 버전마다 달라 나누지 않고 한 문구로 알린다.
export function OAuthError() {
  const code = useSearchParams().get("error");
  if (!code) return null;
  return <p role="alert" className="alert" data-testid="oauth-error">GitHub 로그인을 마치지 못했습니다. 다시 시도해 주세요.</p>;
}
