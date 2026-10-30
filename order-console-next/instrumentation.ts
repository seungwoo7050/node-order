import type { Instrumentation } from "next";

// 오류 추적(31). SENTRY_DSN이 없으면 SDK를 가져오지도 않는다
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const { initSentry } = await import("./lib/sentry-server");
  initSentry();
}

// 서버 컴포넌트·라우트 핸들러·서버 액션·proxy에서 난 오류를 Next.js가 넘겨준다
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(error, request, context);
};
