// main.ts가 가장 먼저 가져온다(Sentry는 다른 모듈보다 먼저 init해야 한다). DSN이 없으면 아무것도 하지 않는다
import { initSentry } from "./observability/sentry.js";

initSentry();
