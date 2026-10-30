#!/usr/bin/env bash
# 공개 주소로 업무 지표(/metrics)가 보이지 않는지 본다. 경로 변형(끝 슬래시, 쿼리, 대소문자, 퍼센트 인코딩, 점·이중 슬래시)마다
# 응답에 Prometheus 본문("# HELP")이 없어야 한다. 하나라도 보이면 exit 1
#   deploy/check-metrics-exposure.sh http://localhost:8081            리허설 API 주소
#   deploy/check-metrics-exposure.sh http://127.0.0.1:18081 localhost:8081   Host 헤더를 따로 줄 때(monitoring/test.sh)
set -uo pipefail
base=${1:?공개 API 주소}
host=${2:-}
paths=(
  /metrics /metrics/ "/metrics?x=1" "/metrics/?format=text" /METRICS /Metrics/ /mEtRiCs
  /%6Detrics /%6d%65%74%72%69%63%73 /metrics%2F /metrics%2f /metrics/. /./metrics //metrics /foo/../metrics "/metrics;x" /metrics.
)
fail=0
for p in "${paths[@]}"; do
  args=(-s --path-as-is -o /tmp/metrics-exposure.$$ -w '%{http_code}' --max-time 5)
  [ -n "$host" ] && args+=(-H "Host: $host")
  code=$(curl "${args[@]}" "$base$p" || echo 000)
  if grep -q '^# HELP' /tmp/metrics-exposure.$$ 2>/dev/null; then
    echo "FAIL $p → $code (지표 본문이 보인다)"; fail=1
  else
    echo "ok   $p → $code"
  fi
done
rm -f /tmp/metrics-exposure.$$
exit $fail
