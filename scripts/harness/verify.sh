#!/usr/bin/env bash
# 검사 진입점. 로컬 훅, 에이전트, CI가 같은 npm 스크립트를 부른다.
#   verify.sh fast  → lint, typecheck, test:unit, test:harness (Stop 훅이 강제하는 범위)
#   verify.sh full  → fast + test:e2e:api, test:e2e:web, test:rules
# 단계마다 로그를 .harness/logs/<단계>.log에 남기고, 끝에 한 줄 요약을 찍는다.
# fast 단계는 하나가 실패해도 모두 돌려 실패를 한 번에 보인다. full은 fast가 실패하면 e2e를 건너뛴다.
set -uo pipefail
mode=${1:-full}
root=$(cd "$(dirname "$0")/../.." && pwd)
logs="$root/.harness/logs"
mkdir -p "$logs"
cd "$root" || exit 1

summary=()
failed=()

# 로그에서 테스트 수를 뽑는다(vitest "Tests  3 passed (3)", playwright "30 passed", 하네스 "ok   ...")
count() {
  local log=$1 step=$2 pass total skip
  case $step in
    test:harness)
      pass=$(grep -c '^ok ' "$log"); total=$((pass + $(grep -c '^FAIL ' "$log")))
      echo " $pass/$total" ;;
    test:unit | test:e2e:api)
      pass=$(sed -nE 's/^ *Tests +([0-9]+) passed.*/\1/p; s/^ *Tests +[0-9]+ failed \| ([0-9]+) passed.*/\1/p' "$log" | awk '{s+=$1} END {print s+0}')
      total=$(sed -nE 's/^ *Tests +.*\(([0-9]+)\).*/\1/p' "$log" | awk '{s+=$1} END {print s+0}')
      echo " $pass/$total" ;;
    test:e2e:web)
      pass=$(sed -nE 's/^ *([0-9]+) passed.*/\1/p' "$log" | tail -1)
      skip=$(sed -nE 's/^ *([0-9]+) skipped.*/\1/p' "$log" | tail -1)
      echo " ${pass:-0} passed${skip:+ + $skip skipped}" ;;
  esac
}

run() { # run <단계> <명령...>
  local step=$1 log="$logs/${1//:/-}.log"
  shift
  printf '▶ %s\n' "$step"
  local start=$SECONDS
  "$@" >"$log" 2>&1
  local status=$?
  local took=$((SECONDS - start))
  if ((status == 0)); then
    summary+=("$step ✓$(count "$log" "$step")")
    printf '  ✓ %s (%ss)\n' "$step" "$took"
  else
    summary+=("$step ✗$(count "$log" "$step")")
    failed+=("$step")
    printf '  ✗ %s (%ss) - 로그: %s\n' "$step" "$took" "${log#"$root"/}"
    tail -n 25 "$log" | sed 's/^/    /'
  fi
  return $status
}

prepare_test_db() {
  local url
  url=$(sed -nE 's/^TEST_ADMIN_DATABASE_URL=//p' order-api-nest/.env 2>/dev/null)
  [[ -n $url ]] || { echo "order-api-nest/.env에 TEST_ADMIN_DATABASE_URL이 없다"; return 1; }
  (cd order-api-nest && ADMIN_DATABASE_URL=$url npx prisma migrate deploy)
}

# prisma client는 gitignore되어 있어 lint·typecheck 전에 만든다(DB 연결 없이 된다)
run prisma:generate npm exec -w order-api-nest -- prisma generate
run lint npm run lint
run typecheck npm run typecheck
run test:unit npm run test:unit
run test:harness npm run test:harness

if [[ $mode == full ]]; then
  if ((${#failed[@]})); then
    echo "빠른 검사가 실패해 e2e를 건너뛴다"
  else
    run test-db:migrate prepare_test_db &&
      run test:e2e:api npm run test:e2e:api
    run test:e2e:web npm run test:e2e:web
    run test:rules npm run test:rules
  fi
fi

echo
echo "verify($mode): ${summary[*]}" | sed 's/ prisma:generate ✓//'
if ((${#failed[@]})); then
  echo "실패: ${failed[*]}"
  exit 1
fi
