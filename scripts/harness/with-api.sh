#!/usr/bin/env bash
# 웹 e2e 앞에서 API(4000)를 준비하고 인자로 받은 명령을 돌린다.
#   - 4000에서 /health/ready가 이미 응답하면(개발 서버나 CI가 띄운 API) 그대로 쓴다.
#   - 아니면 CI test-web 잡과 같은 순서로 준비한다: migrate deploy → seed → build → 실행 → 준비 대기.
#     Stripe 키가 없으면 order-api-nest/scripts/stripe-sim.mjs(4100)를, 토스 키가 없으면
#     order-api-nest/scripts/toss-sim.mjs(4200)를 테스트 대역으로 함께 띄운다.
#     직접 띄운 프로세스는 명령이 끝나면 내린다. 로그는 .harness/logs/.
# 전제: compose의 db·redis·storage가 떠 있고 order-api-nest/.env, order-console-next/.env.local이 있다.
set -uo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
api_url=${API_READY_URL:-http://localhost:4000/health/ready}
logs="$root/.harness/logs"
mkdir -p "$logs"

need() { [[ -f "$root/$1" ]] || { echo "with-api: $1 이 없다. $2" >&2; exit 1; }; }
need order-api-nest/.env "order-api-nest/.env.example을 복사해 값을 채워라."
need order-console-next/.env.local "order-console-next/.env.example을 복사해 AUTH_SECRET 등을 채워라."

ready() { curl -sf "$api_url" >/dev/null 2>&1; }

# Playwright는 3000에 떠 있는 서버를 다시 쓰고(reuseExistingServer), 아래는 4000의 API를 다시 쓴다.
# 포트를 쥔 프로세스의 cwd가 이 저장소 밖이면 멈춘다(port-owner.sh, 테스트는 port-owner.test.sh).
# shellcheck source=port-owner.sh
source "$root/scripts/harness/port-owner.sh"
check_owner 3000 "$root" || exit 1
check_owner 4000 "$root" || exit 1

pid=
if ready; then
  echo "with-api: 이미 떠 있는 API를 쓴다 ($api_url)"
else
  echo "with-api: API를 준비한다 (migrate deploy → seed → build → 실행)"
  (
    cd "$root/order-api-nest" &&
      npx prisma migrate deploy &&
      npx prisma db seed &&
      npm run build
  ) >"$logs/api-prepare.log" 2>&1 || {
    echo "with-api: API 준비가 실패했다. 마지막 로그:" >&2
    tail -n 30 "$logs/api-prepare.log" >&2
    exit 1
  }
  # Stripe 키가 없으면 결제 세션을 Stripe 시뮬레이터(테스트 대역, 4100)로 만든다
  sim_pid=
  if [[ -z ${STRIPE_SECRET_KEY:-} ]] && ! grep -qE '^STRIPE_SECRET_KEY=.+' "$root/order-api-nest/.env"; then
    export STRIPE_SIMULATOR_URL=${STRIPE_SIMULATOR_URL:-http://localhost:4100}
    sim_port=${STRIPE_SIMULATOR_URL##*:}
    echo "with-api: STRIPE_SECRET_KEY가 없어 Stripe 시뮬레이터($STRIPE_SIMULATOR_URL)를 쓴다"
    (cd "$root/order-api-nest" && SIM_PORT=$sim_port exec node scripts/stripe-sim.mjs) >"$logs/stripe-sim.log" 2>&1 &
    sim_pid=$!
  fi
  # 토스 키가 없으면 승인·조회·취소와 위젯 SDK를 토스 시뮬레이터(테스트 대역, 4200)로 돌린다
  toss_pid=
  if [[ -z ${TOSS_SECRET_KEY:-} ]] && ! grep -qE '^TOSS_SECRET_KEY=.+' "$root/order-api-nest/.env"; then
    export TOSS_SIMULATOR_URL=${TOSS_SIMULATOR_URL:-http://localhost:4200}
    toss_port=${TOSS_SIMULATOR_URL##*:}
    echo "with-api: TOSS_SECRET_KEY가 없어 토스 시뮬레이터($TOSS_SIMULATOR_URL)를 쓴다"
    (cd "$root/order-api-nest" && SIM_PORT=$toss_port exec node scripts/toss-sim.mjs) >"$logs/toss-sim.log" 2>&1 &
    toss_pid=$!
  fi
  # TRUST_PROXY=loopback: 웹 e2e가 X-Forwarded-For로 서로 다른 IP를 흉내 낸다(인기 검색어는 IP 3곳 이상만 공개)
  (cd "$root/order-api-nest" && TRUST_PROXY=${TRUST_PROXY:-loopback} exec node --env-file=.env dist/main.js) >"$logs/api.log" 2>&1 &
  pid=$!
  trap 'kill $pid $sim_pid $toss_pid 2>/dev/null; wait $pid $sim_pid $toss_pid 2>/dev/null' EXIT
  for _ in $(seq 1 60); do
    ready && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if ! ready; then
    echo "with-api: API가 60초 안에 준비되지 않았다. 마지막 로그:" >&2
    tail -n 30 "$logs/api.log" >&2
    exit 1
  fi
fi

"$@"
