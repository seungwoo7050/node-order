#!/usr/bin/env bash
# 리허설 끝에서 끝까지 경보 확인(31). 이 PC의 리허설 구성(compose.rehearsal.yaml)에 운영과 같은 Prometheus·Alertmanager를
# 띄우고 장애를 넣어, 경보가 가짜 웹훅 수신기(scripts/alert-receiver.mjs, 5001)에 도착하는지 본다.
#   deploy/rehearsal-alerts.sh [태그]   (기본 obs1) 이미지가 없으면 만들고(rehearsal-build.sh), 그 태그가 활성이 아니면 배포한 뒤
#                                       1. 색인 작업 멈춤: 앱 역할의 search_dirty UPDATE 권한을 거둬 색인이 매번 실패하게 하고,
#                                          11분 전에 표시된 행을 심는다 → SearchIndexLag
#                                       2. 대사 불일치 심기: 미해결 reconciliation_issues 한 행 → ReconciliationMismatch
#                                       3. Watchdog이 dead man's switch 자리(/ping)로 가는지
#                                       끝나면(성공·실패 모두) 권한과 심은 행을 되돌리고 수신기를 내린다. 리허설 구성은 남긴다
#   deploy/rehearsal-alerts.sh down     리허설 컨테이너·볼륨을 내리고 .env와 live/를 지운다
# 실제 웹훅·dead man's switch에는 보내지 않는다(rehearsal.env의 주소가 host.docker.internal:5001이다)
set -euo pipefail
cd "$(dirname "$0")"
DC=(docker compose --progress quiet)
TAG=${1:-obs1}
RECEIVER_PORT=5001
TIMEOUT=${ALERT_TIMEOUT_SECONDS:-420}
say() { printf '%s %s\n' "$(date +%T)" "$*"; }

if [ "$TAG" = down ]; then
  [ -f .env ] && grep -qx 'IMAGE_PREFIX=rehearsal' .env || { echo ".env가 리허설 구성이 아니다 - 내리지 않는다"; exit 1; }
  "${DC[@]}" --profile blue --profile green --profile tools down -v --remove-orphans
  rm -f .env
  rm -rf ./live
  say "리허설 구성을 내렸다(볼륨 포함)"
  exit 0
fi

[ -f .env ] || cp rehearsal.env .env
grep -qx 'IMAGE_PREFIX=rehearsal' .env || { echo ".env가 리허설 구성이 아니다(IMAGE_PREFIX=rehearsal). 운영 서버에서 돌리지 않는다"; exit 1; }
for k in ALERT_WEBHOOK_URL DEADMAN_URL BUSINESS_METRICS_INTERVAL_MS; do
  grep -q "^$k=" .env || grep "^$k=" rehearsal.env >> .env # 31 전에 복사한 .env에 경보 주소를 더한다
done
mkdir -p live

# 가짜 수신기
if lsof -iTCP:$RECEIVER_PORT -sTCP:LISTEN -n -P > /dev/null 2>&1; then echo "$RECEIVER_PORT 포트를 다른 프로세스가 쓰고 있다"; exit 1; fi
LOG=live/alert-receiver.log
PORT=$RECEIVER_PORT node ../scripts/alert-receiver.mjs > "$LOG" 2>&1 &
RECEIVER_PID=$!

sql() { "${DC[@]}" exec -T db psql -U order_owner -d order_api -v ON_ERROR_STOP=1 -qAt -c "$1"; }
restore() {
  set +e
  if "${DC[@]}" ps --status running --services 2>/dev/null | grep -qx db; then
    sql "GRANT UPDATE ON search_dirty TO order_app" > /dev/null
    sql "DELETE FROM search_dirty WHERE product_id = 999001" > /dev/null
    sql "DELETE FROM reconciliation_issues WHERE payment_key = 'rehearsal-alert-check'" > /dev/null
    say "되돌림: search_dirty UPDATE 권한, 심은 행 삭제"
  fi
  kill "$RECEIVER_PID" 2> /dev/null
  wait "$RECEIVER_PID" 2> /dev/null
}
trap restore EXIT

# 리허설 배포(그 태그가 이미 활성이면 건너뛴다)
active=$(sed -n 's/^ACTIVE=//p' .env)
active_tag=$([ -n "$active" ] && sed -n "s/^$(echo "$active" | tr a-z A-Z)_TAG=//p" .env || true)
if [ "$active_tag" != "$TAG" ]; then
  docker image inspect "rehearsal/order-api:$TAG" > /dev/null 2>&1 || { say "이미지 빌드: $TAG"; ./rehearsal-build.sh "$TAG" ..; }
  ./release.sh "$TAG"
else
  "${DC[@]}" up -d --wait --no-recreate
fi
"${DC[@]}" up -d --no-deps --wait alertmanager prometheus

say "Prometheus가 활성 API를 긁을 때까지"
api_up() { local r; r=$(curl -sf 'http://127.0.0.1:9190/api/v1/query?query=up%7Bjob%3D%22order-api%22%7D' || true); [[ $r =~ \"value\":\[[^]]*,\"1\"\] ]]; }
for _ in $(seq 1 60); do api_up && break; sleep 2; done
api_up || { echo "Prometheus가 order-api를 긁지 못한다(live/targets.json 확인)"; exit 1; }

say "장애 1: 색인 작업 멈춤(search_dirty UPDATE 권한 회수, 11분 전 행)"
sql "REVOKE UPDATE ON search_dirty FROM order_app"
sql "INSERT INTO search_dirty (product_id, marked_at) VALUES (999001, (now() AT TIME ZONE 'UTC') - interval '11 minutes')
     ON CONFLICT (product_id) DO UPDATE SET marked_at = EXCLUDED.marked_at, claimed_at = NULL"
say "장애 2: 대사 불일치 심기"
sql "INSERT INTO reconciliation_issues (provider, business_date, kind, payment_key, our_value, pg_value)
     VALUES ('toss', current_date, 'amount_mismatch', 'rehearsal-alert-check', '{\"amount\":10000}', '{\"amount\":1000}')
     ON CONFLICT (provider, kind, payment_key) DO UPDATE SET resolved_at = NULL, last_seen_at = now()"

say "가짜 수신기에서 경보를 기다린다(최대 ${TIMEOUT}초)"
want=("SLACK .*FIRING SearchIndexLag" "SLACK .*FIRING ReconciliationMismatch" "PING Watchdog")
deadline=$((SECONDS + TIMEOUT))
while :; do
  missing=()
  for w in "${want[@]}"; do grep -qE "$w" "$LOG" || missing+=("$w"); done
  [ ${#missing[@]} -eq 0 ] && break
  if [ $SECONDS -ge $deadline ]; then
    echo "시간 안에 오지 않았다: ${missing[*]}"
    echo "--- 수신기 로그"; cat "$LOG"
    echo "--- Prometheus 경보"; curl -s http://127.0.0.1:9190/api/v1/alerts; echo
    exit 1
  fi
  sleep 5
done

echo "--- 수신기가 받은 것"
grep -E "SLACK|PING" "$LOG" | sort -u -k2 | head -20
say "통과: 경보 2건이 웹훅에, Watchdog이 dead man's switch에 도착했다"
echo "리허설 구성은 떠 있다(웹 :8080, API :8081, Prometheus 127.0.0.1:9190, Alertmanager 127.0.0.1:9193). 내리기: deploy/rehearsal-alerts.sh down"
