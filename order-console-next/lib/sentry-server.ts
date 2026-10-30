import * as Sentry from "@sentry/nextjs";
// API와 같은 지우기 규칙(29의 칸 규칙 + 토큰 모양 값). 이미지 빌드가 이 두 파일만 가져온다(Dockerfile, Dockerfile.dockerignore)
import { scrubBreadcrumb, scrubEvent } from "../../order-api-nest/src/observability/scrub";

// 콘솔 서버(Node.js 런타임)의 오류 추적. instrumentation.ts의 register가 SENTRY_DSN이 있을 때만 부른다.
// 서버 컴포넌트·라우트 핸들러·서버 액션에서 난 오류는 onRequestError(captureRequestError)로 보낸다.
// 브라우저 쪽 SDK는 켜지 않는다(DSN을 빌드에 넣어야 하고, 이번 범위는 서버 오류다)
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    release: env.SENTRY_RELEASE || undefined,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || "development",
    serverName: "order-web",
    debug: env.SENTRY_DEBUG === "1",
    enableOpenTelemetrySetup: false, // 추적은 쓰지 않는다(오류만)
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { deny: ["authorization", "cookie", "proxy-authorization"] }, response: false },
      httpBodies: [],
    },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  return true;
}
