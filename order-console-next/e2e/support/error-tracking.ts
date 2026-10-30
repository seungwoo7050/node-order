// 오류 추적(31): e2e가 띄우는 콘솔 서버는 이 포트의 가짜 수집 서버(e2e/error-tracking.spec.ts가 띄운다)로 보낸다
export const E2E_SENTRY_PORT = 4400;
export const E2E_SENTRY_RELEASE = "e2e-web";
