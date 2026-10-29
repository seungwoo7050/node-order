#!/usr/bin/env bash
# 웹 e2e 앞에서 API(4000)를 준비하고 인자로 받은 명령을 돌린다.
#   - 4000에서 /health/ready가 이미 응답하면(개발 서버나 CI가 띄운 API) 그대로 쓴다.
#   - 아니면 CI test-web 잡과 같은 순서로 준비한다: migrate deploy → seed → build → 실행 → 준비 대기.
#     Stripe 키가 없으면 order-api-nest/scripts/stripe-sim.mjs(4100)를 테스트 대역으로 함께 띄운다.
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
# 다른 체크아웃이나 worktree의 서버를 쓰면 이 코드가 아닌 것을 검사하게 되므로,
# 포트를 쥔 프로세스의 cwd가 이 저장소 밖이면 멈춘다(lsof가 없으면 건너뛴다).
check_owner() {
  local port=$1 owner dir
  owner=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1)
  [[ -n $owner ]] || return 0
  dir=$(lsof -a -p "$owner" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  [[ -n $dir ]] || return 0
  # worktree가 원본 체크아웃 아래에 있을 수 있어 경로 접두어가 아니라 git 루트로 비교한다
  if [[ $(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) != "$root" ]]; then
    echo "with-api: $port 포트에 다른 체크아웃의 서버가 있다(pid $owner, $dir). 그 서버를 내리고 다시 돌려라." >&2
    exit 1
  fi
}
check_owner 3000
check_owner 4000

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
  (cd "$root/order-api-nest" && exec node --env-file=.env dist/main.js) >"$logs/api.log" 2>&1 &
  pid=$!
  trap 'kill $pid $sim_pid 2>/dev/null; wait $pid $sim_pid 2>/dev/null' EXIT
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
