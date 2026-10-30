import * as Sentry from "@sentry/nestjs";
import { scrubBreadcrumb, scrubEvent } from "./scrub.js";

// 오류 추적(Sentry 호환 SDK). SENTRY_DSN이 있을 때만 켠다(없으면 init을 부르지 않아 SDK가 아무것도 보내지 않는다).
//   - release: 이미지 태그(운영 Compose가 BLUE_TAG·GREEN_TAG를 SENTRY_RELEASE로 넣는다). 어느 배포에서 난 오류인지 남는다
//   - 추적(tracing)은 켜지 않는다: 분산 추적은 OpenTelemetry(instrumentation.ts) 몫이다. enableOpenTelemetrySetup은 기본(false)이라
//     우리 tracer provider와 겹치지 않는다
//   - beforeSend·beforeBreadcrumb에서 연락처·주소·Authorization·Cookie·토큰 모양 값을 지운다(scrub.ts)
// 받는 쪽은 Sentry, 같은 DSN 규약의 자체 호스팅(GlitchTip), 테스트의 가짜 수집 서버(test/fake-sentry.ts) 어느 것이든 된다
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    release: env.SENTRY_RELEASE || undefined,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || "development",
    serverName: "order-api", // 기본값은 호스트 이름(컨테이너 id)이다
    // SDK가 모으는 단계에서 먼저 줄인다(사용자 정보·쿠키·본문·응답 헤더·LLM/MCP 내용은 모으지 않는다). beforeSend가 한 번 더 지운다
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { deny: ["authorization", "cookie", "proxy-authorization", "stripe-signature", "x-api-key"] }, response: false },
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  return true;
}
