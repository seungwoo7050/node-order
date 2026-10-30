# 런북

경보(`monitoring/alert-rules.yml`)마다 한 절이다. 경보의 `runbook` annotation이 이 문서의 절을 가리키고, 알림 메시지에 링크로 붙는다. 절의 순서: 무엇을 보나 → 어떤 명령을 치나 → 언제 사람이 PG 관리자 화면을 봐야 하나.

명령은 운영 서버의 `/opt/node-order`에서 친다(`ssh ubuntu@<서버>` 뒤 `cd /opt/node-order`). 활성 환경은 `.env`의 `ACTIVE`(blue/green)다.

## 공통

- 지금 울리는 경보: `docker compose exec alertmanager amtool alert query --alertmanager.url=http://localhost:9093`
- 지표를 그래프로 보기: 개발 PC에서 `ssh -N -L 19090:127.0.0.1:9090 ubuntu@<서버>`로 터널을 열고, 개발 Grafana(`docker compose --profile monitoring up -d grafana`, http://localhost:3001)에서 데이터 원본 "Prometheus (운영, SSH 터널)"을 고른다. 운영에는 Grafana를 두지 않는다
- API 로그: `docker compose logs --since 30m api-$(sed -n 's/^ACTIVE=//p' .env) | tail -200`
- DB: `bash ops/psql.sh -c "<SQL>"`
- 오류 추적(Sentry 호환): 같은 시각의 이벤트를 release(이미지 태그)로 거른다. 새 태그에서만 나면 `bash rollback.sh`를 먼저 생각한다
- 잠시 끄기(작업 중 같은 경보가 반복될 때): `docker compose exec alertmanager amtool silence add alertname=<이름> --duration=2h --comment="<이유>" --alertmanager.url=http://localhost:9093`

## ApiDown

- **무엇을 보나**: Prometheus가 활성 API의 `/metrics`를 30초 넘게 가져오지 못했다. 컨테이너가 죽었거나, 준비 검사(`/health/ready`)에 막혔거나, 배포 중 대상 파일(`live/targets.json`)이 바뀌지 않았다
- **명령**
  - `docker compose ps` → `api-<ACTIVE>`가 `healthy`인지
  - `docker compose logs --tail 100 api-<ACTIVE>`에서 기동 실패(DB 연결, 마이그레이션 누락)를 찾는다
  - `cat live/targets.json`이 활성 쪽을 가리키는지. 틀리면 `bash release.sh switch`가 끝까지 돌았는지 본다
  - 새 배포 직후라면 `bash rollback.sh`
- **PG 화면**: 보지 않는다. 다만 API가 오래 죽어 있었다면 그동안 온 결제 웹훅은 PG가 다시 보낸다(토스·Stripe 모두 재시도). 복구 뒤 [ReconciliationMismatch](#reconciliationmismatch)가 울리는지 지켜본다

## HighErrorRate

- **무엇을 보나**: 최근 30초 응답 중 5xx가 5%를 넘는 상태가 1분 이어졌다
- **명령**
  - 오류 추적에서 같은 시각의 이벤트를 release별로 묶어 본다(어느 라우트, 어느 태그)
  - 지표: `sum by (route) (rate(http_request_duration_seconds_count{status_code=~"5.."}[5m]))`로 라우트를 좁힌다
  - DB가 원인인지: `bash ops/psql.sh -c "select state, count(*) from pg_stat_activity group by 1"`
  - 새 배포 직후라면 `bash rollback.sh`
- **PG 화면**: `/payments/*` 라우트가 5xx라면 PG 장애 공지(토스 개발자센터 상태 페이지, Stripe status)를 본다

## OutboxBacklog

- **무엇을 보나**: 발행되지 않은 outbox 이벤트가 20건 넘게 1분 이어졌다. 알림 릴레이가 멈췄거나 Redis가 안 된다
- **명령**
  - `docker compose logs --since 10m api-<ACTIVE> | grep -i outbox`
  - `docker compose exec redis redis-cli ping`
  - 가장 오래된 미발행 이벤트의 나이는 지표 `outbox_oldest_unpublished_seconds`
- **PG 화면**: 보지 않는다

## ReconciliationMismatch

- **무엇을 보나**: 해결하지 않은 PG 대사 불일치가 있다(금액·상태가 다름, 한쪽에만 있음, 환불 불일치)
- **명령**
  - 관리자 화면 `/admin/reconciliation`에서 종류별 목록을 본다(또는 MCP 도구 `list_reconciliation_issues`)
  - `bash ops/psql.sh -c "select provider, kind, payment_key, order_id, first_seen_at from reconciliation_issues where resolved_at is null order by first_seen_at"`
  - 저절로 풀린 불일치는 다음 대사가 자동 해결로 표시한다. 다시 돌리기: `bash ops/payments.sh reconcile --date=YYYY-MM-DD`
- **PG 화면**: `missing_in_db`(PG에만 결제가 있다)와 `amount_mismatch`는 반드시 PG 관리자 화면에서 그 결제 키를 찾아 실제 승인 금액과 상태를 확인한다. 돈이 나갔는데 주문이 취소됐다면 PG 화면에서 환불하고, 화면 `/admin/reconciliation`에 메모와 함께 해결 표시한다

## RefundOutcomeUnknown

- **무엇을 보나**: 결과를 모르는(requested) 환불이 1시간 넘게 남아 있다. PG 호출이 시간 초과됐고, 재조회도 아직 확정하지 못했다
- **명령**
  - `bash ops/payments.sh resolve-refunds` (5분보다 오래된 requested 환불을 PG에 다시 묻는다. 여러 번 돌려도 같다)
  - 남은 것: `bash ops/psql.sh -c "select r.id, p.provider, p.provider_payment_key, r.amount, r.created_at from refunds r join payments p on p.id = r.payment_id where r.status = 'requested' order by r.created_at"`
- **PG 화면**: `resolve-refunds` 뒤에도 남으면 PG 관리자 화면에서 그 결제 키의 취소 내역을 본다. PG에 취소가 있으면 다음 재조회가 succeeded로 바꾸고, 없으면 손님에게 알리고 다시 환불한다

## PaymentConfirmFailureRate

- **무엇을 보나**: 15분 동안 결제 승인 시도가 5번 이상이고 그중 20% 넘게 실패하는 상태가 5분 이어졌다. 이유는 지표 라벨 `reason`(rejected=PG 거절, unknown_outcome=결과 모름, amount_mismatch=금액 위조 의심, pg_mismatch=PG 응답이 주문과 다름)
- **명령**
  - `sum by (provider, reason) (increase(payments_confirm_failed_total[15m]))`로 provider와 이유를 본다
  - `docker compose logs --since 30m api-<ACTIVE> | grep -E "토스|Stripe" | tail -50`
  - `.env`의 PG 키가 바뀌거나 만료되지 않았는지(`rejected`가 한꺼번에 늘 때)
- **PG 화면**: `rejected`·`unknown_outcome`이 몰리면 PG 상태 페이지와 관리자 화면의 승인 실패 내역을 본다. `amount_mismatch`가 몰리면 위조 시도일 수 있다(PG 화면은 볼 필요 없다. 요청 IP를 로그에서 보고 `RATE_LIMIT_*`를 조인다)

## ReconciliationRetryExhausted

- **무엇을 보나**: 정기 대사가 한 provider에서 재시도 상한(`RECONCILE_MAX_ATTEMPTS`, 기본 5)까지 실패해 그날은 더 돌지 않는다. 라벨 `provider`
- **명령**
  - `docker compose logs --since 24h api-<ACTIVE> | grep "정기 대사"`에서 실패 이유를 본다(키, PG 조회 429·5xx, 시간 초과)
  - 원인을 고친 뒤 `bash ops/payments.sh reconcile --date=YYYY-MM-DD` (upsert라 같은 날을 여러 번 돌려도 된다)
  - 성공하면 `reconciliation_consecutive_failures{provider}`가 0이 되고 경보가 풀린다
- **PG 화면**: PG 조회 API가 계속 실패하면 PG 관리자 화면에서 그날의 거래 내역을 내려받아 손으로 맞춰 본다(대사가 하는 일을 사람이 한다)

## LlmDailyTokenBudgetExceeded

- **무엇을 보나**: 최근 24시간 LLM 입력+출력 토큰이 하루 상한(`LLM_DAILY_TOKEN_BUDGET`, 기본 20만)을 넘었다. 비용이 예상보다 크다
- **명령**
  - `sum by (direction, model) (increase(llm_tokens_total[1d]))`, 요청 수는 `sum by (result) (increase(llm_requests_total[1d]))`
  - 누가 많이 부르는지: `docker compose logs --since 24h api-<ACTIVE> | grep description-draft | tail -50`
  - 당장 멈추기: `.env`에서 `LLM_API_KEY`를 비우고 `bash release.sh <지금 태그>`로 다시 띄운다(기능이 꺼지고 화면에서 버튼이 사라진다). 관리자당 분당 호출 수는 `LLM_RATE_LIMIT_PER_MINUTE`
- **PG 화면**: 보지 않는다. LLM 공급자 콘솔의 사용량 화면과 맞춰 본다

## SearchIndexLag

- **무엇을 보나**: 검색 색인을 기다리는 상품(`search_dirty`)이 10분 넘게 남아 있다. 리더의 색인 작업이 멈췄거나 매번 실패한다(상품을 고쳐도 검색에 안 나온다)
- **명령**
  - `docker compose logs --since 30m api-<ACTIVE> | grep "검색 색인"`
  - `bash ops/psql.sh -c "select count(*), min(marked_at), count(claimed_at) from search_dirty"`
  - 권한·스키마 문제라면 마이그레이션 상태를 본다. 전체 재색인: `RELEASE_TAG=<활성 태그> docker compose run --rm -T migrate npm run search:reindex`
- **PG 화면**: 보지 않는다

## MailJobsFailing

- **무엇을 보나**: 주문 메일 job이 재시도(4번)를 다 쓰고 실패로 끝났다
- **명령**
  - `docker compose logs --since 1h api-<ACTIVE> | grep "메일 job"`
  - `docker compose exec redis redis-cli zcard bull:mail:failed`
  - 메일 발송자 설정(키, 발신 한도)을 확인한다. 손님이 메일을 못 받은 주문은 로그의 job id(`order-email-<이벤트>`)로 찾는다
- **PG 화면**: 보지 않는다

## FulfillmentOverdue

- **무엇을 보나**: 결제 완료(paid) 뒤 `FULFILLMENT_OVERDUE_DAYS`(기본 3일) 넘게 배송 준비를 시작하지 않은 주문이 30분 넘게 있다. 손님 문의가 오기 전에 처리한다
- **명령**
  - 관리자 화면 `/admin/orders?status=paid`(또는 MCP 도구 `search_orders` status=paid)
  - `bash ops/psql.sh -c "select id, status_changed_at from orders where status = 'paid' and status_changed_at < now() - interval '3 days' order by status_changed_at"`
  - 재고가 없어 보낼 수 없다면 손님에게 알리고 취소·환불한다
- **PG 화면**: 취소·환불한 주문은 PG 관리자 화면에서 환불이 반영됐는지 본다

## Watchdog

- **무엇을 보나**: 항상 울리는 경보다. Alertmanager가 이것을 외부 dead man's switch(`DEADMAN_URL`, healthchecks 호환 핑)로 1분마다 보낸다. 핑이 끊기면(서버, Prometheus, Alertmanager 중 하나가 죽으면) 외부 서비스가 알린다. 이 경보 자체는 웹훅으로 보내지 않는다
- **명령**: 외부 서비스가 "핑이 끊겼다"고 알리면
  - 서버에 접속되는지: `ssh ubuntu@<서버>`. 안 되면 클라우드 콘솔에서 인스턴스 상태를 본다
  - `docker compose ps prometheus alertmanager`, `docker compose logs --tail 50 alertmanager`
  - `DEADMAN_URL`이 바뀌지 않았는지 `.env`를 본다
- **PG 화면**: 서버가 오래 죽어 있었다면 복구 뒤 [ReconciliationMismatch](#reconciliationmismatch)를 본다
