#!/usr/bin/env bash
# 웹 e2e 앞에서 API(4000)를 준비하고 인자로 받은 명령을 돌린다.
#   - 4000에서 /health/ready가 이미 응답하면(개발 서버나 CI가 띄운 API) 그대로 쓴다.
#   - 아니면 CI test-web 잡과 같은 순서로 준비한다: migrate deploy → seed → build → 실행 → 준비 대기.
#     직접 띄운 API는 명령이 끝나면 내린다. 로그는 .harness/logs/api.log.
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
  (cd "$root/order-api-nest" && exec node --env-file=.env dist/main.js) >"$logs/api.log" 2>&1 &
  pid=$!
  trap 'kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null' EXIT
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
