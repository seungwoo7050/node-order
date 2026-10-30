```
상태: 확정(오케스트레이터)
브랜치: 31-observability (앞 브랜치: 30-ai-mcp)
문제: Prometheus, Grafana, Alertmanager는 개발 PC에서만 돈다. 운영 서버에서 API가 500을 내거나 대사 불일치가 쌓여도, 색인이 밀리거나 결과 미상 환불이 남아도 판매자는 손님 문의로 알게 된다. 서버 자체가 죽으면 서버 안의 경보도 같이 죽는다. 오류가 나도 어느 버전(blue/green 태그)에서 났는지 남지 않는다.
결정:
  - 오류 추적은 Sentry 호환 SDK(`@sentry/nestjs`, `@sentry/nextjs`)다. `SENTRY_DSN`이 있을 때만 켜고, release는 이미지 태그(blue/green 태그)로 둔다. `beforeSend`에서 연락처, 주소, Authorization·Cookie 헤더, 토큰 모양 값을 지운다(29의 마스킹 규칙 재사용). 테스트는 가짜 수집 서버(envelope 엔드포인트)로 한다 / 대안: 로그 검색만으로 오류를 찾기. 1인 운영자가 매일 로그를 볼 수 없고, 같은 오류를 묶어 주지 않는다 / 바꿀 신호: 무료 한도를 넘거나 데이터 반출이 문제가 되면 자체 호스팅(GlitchTip)으로 같은 DSN 규약을 유지한 채 옮긴다
  - 운영 Compose에 Prometheus와 Alertmanager를 더한다(보존 7일, 컨테이너 메모리 상한). Grafana는 운영에 두지 않고, 필요할 때 SSH 터널로 개발 PC의 Grafana를 운영 Prometheus에 붙인다 / 대안: 관리형 모니터링(CloudWatch, Grafana Cloud). 비용과 연동 면적이 늘어난다 / 바꿀 신호: 서버가 두 대 이상이 될 때
  - 업무 지표: 리더 작업이 주기적으로 계산하는 게이지와 기존 카운터를 쓴다. `reconciliation_open_issues`, `refunds_unresolved_oldest_seconds`, `payments_confirm_failed_total`, `search_index_lag_seconds`(가장 오래된 dirty 행), `outbox_oldest_unpublished_seconds`, `mail_jobs_failed_total`, `fulfillment_overdue_orders`(paid 뒤 N일 넘게 미착수)다. 라벨에 손님 정보나 주문 id를 넣지 않는다(카디널리티와 개인정보)
  - 경보 규칙: 기존 ApiDown, HighErrorRate, OutboxBacklog에 더해 대사 불일치 발생, 결과 미상 환불 1시간 초과, 결제 승인 실패율, 색인 지연 10분 초과, 메일 실패, 처리 지연 주문, 항상 울리는 Watchdog을 둔다. 규칙마다 promtool 단위 테스트(울림·안 울림)를 둔다
  - 알림 경로: Alertmanager는 `ALERT_WEBHOOK_URL`(Slack·Discord 호환 웹훅) 하나로 보낸다. 설정 파일은 환경변수로 만들고, URL이 없으면 null 수신자로 둔다(기동은 된다). 서버가 통째로 죽는 경우는 Watchdog을 외부 dead man's switch(`DEADMAN_URL`, healthchecks 호환 핑)로 보내서, 핑이 끊기면 외부 서비스가 알리게 한다 / 대안: 메일(SES). 발신 도메인 인증과 비용이 생긴다
  - 경보마다 런북 절(무엇을 보나, 어떤 명령을 치나, 언제 사람이 PG 관리자 화면을 봐야 하나)을 `docs/runbook.md`에 두고, 경보 annotation이 그 절을 가리킨다
  - 운영 배포는 하지 않는다(사람이 정한다). 리허설 구성(`deploy/compose.rehearsal.yaml`)에 같은 Prometheus·Alertmanager를 띄워 끝에서 끝까지 확인한다
완료 기준:
  1. DSN이 없으면 SDK를 초기화하지 않고 기존 테스트가 그대로 통과한다. DSN을 가짜 수집 서버로 두면 API 라우트와 콘솔 서버 컴포넌트에서 던진 오류가 release 태그와 함께 도착한다. 이벤트 본문에 연락처, 주소, Authorization, Cookie 원문이 없다
  2. 업무 지표가 `/metrics`에 나오고, 라벨에 주문 id·이메일·연락처가 없다(테스트로 검사)
  3. 새 경보 규칙마다 promtool 테스트가 울림과 안 울림을 확인한다. Watchdog은 항상 울린다
  4. Alertmanager 설정이 환경변수로 만들어지고 `amtool check-config`를 통과한다. URL이 없을 때도 통과하고 null 수신자로 간다
  5. 리허설 끝에서 끝까지: 리허설 구성을 띄우고 장애를 넣으면(색인 작업 멈춤, 대사 불일치 심기) 경보가 가짜 웹훅 수신기에 도착한다. 이것을 스크립트 하나로 재현한다
  6. 경보마다 런북 절이 있고 annotation 링크가 그 절을 가리킨다(링크 깨짐 검사)
  7. Prometheus 보존 기간 7일과 두 컨테이너의 메모리 상한이 운영 Compose에 있다
  8. `npm run verify` 통과. 테스트 수가 30 끝보다 늘고 줄지 않는다
범위 밖: 로그 수집(Loki), 운영 분산 추적, APM, 당직 호출, 실제 운영 배포와 실제 DSN·웹훅 연결(사람)
외부 의존: 오류 추적 DSN, 알림 웹훅 URL, dead man's switch URL(모두 선택. 실제 연결 확인에만 씀. 없으면 blocked)
```
