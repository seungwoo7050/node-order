#!/usr/bin/env bash
# check-monitoring.sh 테스트(도커 없이): 저장소의 경보 규칙·런북·운영 Compose가 통과하고(0),
# 깨진 예(런북 절이 없음, annotation 없음, promtool 테스트 없음, 보존 기간·메모리 상한 없음)는 막는지(1) 본다
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
check="$root/scripts/check-monitoring.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0

# expect <기대 exit> <설명> <check-monitoring.sh 인자...>
expect() {
  local want=$1 desc=$2 got out
  shift 2
  out=$(bash "$check" "$@" 2>&1)
  got=$?
  if [[ $got == "$want" ]]; then
    echo "ok   $desc"
  else
    echo "FAIL $desc (기대 $want, 실제 $got) $out"
    fail=1
  fi
}

expect 0 "경보마다 runbook 절이 docs/runbook.md에 있다" runbook "$root/monitoring/alert-rules.yml" "$root"
expect 0 "경보마다 promtool 테스트가 있다" tests "$root/monitoring/alert-rules.yml" "$root/monitoring/alert-rules.test.yml"
expect 0 "운영 Compose에 Prometheus 보존 7일과 두 컨테이너의 메모리 상한이 있다" compose "$root/deploy/compose.yml"

# 깨진 예: 런북에서 절 하나를 지우면 그 경보의 링크가 깨진다
mkdir -p "$tmp/repo/docs"
sed '/^## SearchIndexLag$/d' "$root/docs/runbook.md" > "$tmp/repo/docs/runbook.md"
expect 1 "런북 절이 없으면 막는다(#searchindexlag)" runbook "$root/monitoring/alert-rules.yml" "$tmp/repo"

# 깨진 예: runbook annotation이 빠진 경보
cat > "$tmp/rules.yml" <<'EOF'
groups:
  - name: x
    rules:
      - alert: ApiDown
        expr: up == 0
        annotations:
          summary: "s"
          runbook: docs/runbook.md#apidown
      - alert: NoRunbook
        expr: vector(1)
        annotations:
          summary: "s"
EOF
expect 1 "runbook annotation이 없는 경보를 막는다" runbook "$tmp/rules.yml" "$root"
expect 1 "promtool 테스트가 없는 경보를 막는다" tests "$tmp/rules.yml" "$root/monitoring/alert-rules.test.yml"

# 깨진 예: 런북 안의 링크가 없는 절을 가리킨다
cp "$root/docs/runbook.md" "$tmp/repo/docs/runbook.md"
echo "- [없는 절](#no-such-section)" >> "$tmp/repo/docs/runbook.md"
expect 1 "런북 안 링크가 없는 절을 가리키면 막는다" runbook "$root/monitoring/alert-rules.yml" "$tmp/repo"

# 깨진 예: 보존 기간·메모리 상한이 빠진 Compose
sed '/retention.time=7d/d' "$root/deploy/compose.yml" > "$tmp/no-retention.yml"
expect 1 "Prometheus 보존 기간이 없으면 막는다" compose "$tmp/no-retention.yml"
awk '/^  alertmanager:/ { am = 1 } am && /mem_limit/ { next } { print }' "$root/deploy/compose.yml" > "$tmp/no-mem.yml"
expect 1 "Alertmanager 메모리 상한이 없으면 막는다" compose "$tmp/no-mem.yml"

# 규칙의 창이 운영 스크레이프 간격(15s)의 4배 이상
expect 0 "경보 규칙의 rate·increase 창이 운영 스크레이프 간격의 4배 이상이다" windows "$root/monitoring/alert-rules.yml" "$root/monitoring/prometheus.prod.yml"
sed 's/\[2m\]/[30s]/g' "$root/monitoring/alert-rules.yml" > "$tmp/short-window.yml"
expect 1 "창이 [30s](15s 스크레이프에 표본 2개)면 막는다" windows "$tmp/short-window.yml" "$root/monitoring/prometheus.prod.yml"

exit $fail
