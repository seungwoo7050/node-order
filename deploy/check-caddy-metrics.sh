#!/usr/bin/env bash
# 운영 Caddyfile만으로 /metrics 변형 경로가 막히는지 본다(API 없이). Caddy 컨테이너를 띄우고 API 자리에
# 일부러 지표처럼 보이는 응답("# HELP …")을 두어, Caddy가 넘기면 check-metrics-exposure.sh가 잡게 한다.
#   deploy/check-caddy-metrics.sh [Caddyfile]   (기본 deploy/Caddyfile). monitoring/test.sh(npm run test:rules)가 부른다
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
caddyfile=$(cd "$(dirname "${1:-$here/Caddyfile}")" && pwd)/$(basename "${1:-$here/Caddyfile}")
image=${CADDY_IMAGE:-caddy:2}
port=${CADDY_TEST_PORT:-18081}
tmp=$(mktemp -d)
name=caddy-metrics-test-$$
trap 'docker rm -f "$name" > /dev/null 2>&1; rm -rf "$tmp"' EXIT

printf 'respond "web" 200\n' > "$tmp/web.caddy"
printf 'respond "# HELP leaked_metric 지표가 새었다\\nleaked_metric 1\\n" 200\n' > "$tmp/api.caddy"
docker run -d --name "$name" -p "127.0.0.1:$port:8081" \
  -e PUBLIC_SCHEME=http -e WEB_HOST=localhost:8080 -e API_HOST=localhost:8081 \
  -v "$caddyfile:/etc/caddy/Caddyfile:ro" -v "$tmp:/etc/caddy/live:ro" "$image" > /dev/null
for _ in $(seq 1 50); do curl -s -o /dev/null -H "Host: localhost:8081" "http://127.0.0.1:$port/" && break; sleep 0.2; done

# 대조: 다른 경로는 API 자리(가짜 지표)까지 간다. 이것이 안 보이면 검사 자체가 틀렸다
if ! curl -s -H "Host: localhost:8081" "http://127.0.0.1:$port/health/ready" | grep -q '^# HELP'; then
  echo "FAIL Caddy가 API 자리로 넘기지 않는다(검사 구성이 틀렸다)"; docker logs "$name" | tail -5; exit 1
fi
bash "$here/check-metrics-exposure.sh" "http://127.0.0.1:$port" localhost:8081
