#!/usr/bin/env bash
# npm run test:rules. 도커로 Prometheus·Alertmanager 도구를 받아 검사한다(CI의 alert-rules 잡도 이것을 부른다).
#   1. promtool test rules: 경보 규칙마다 울림·안 울림(alert-rules.test.yml)
#   2. promtool check config: 개발·운영 Prometheus 설정(규칙 파일까지)
#   3. Alertmanager: render.sh가 환경변수로 만든 설정을 경우마다 amtool check-config, 수신자 경로(alertmanager/check.sh)
# 이미지 태그는 운영 Compose와 같다(PROM_IMAGE, ALERTMANAGER_IMAGE로 바꿀 수 있다)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
prom=${PROM_IMAGE:-prom/prometheus:v3.15.1}
am=${ALERTMANAGER_IMAGE:-prom/alertmanager:v0.34.2}

echo "## promtool test rules"
docker run --rm -v "$here:/m:ro" --entrypoint promtool "$prom" test rules /m/alert-rules.test.yml

echo "## promtool check config"
for f in prometheus.yml prometheus.prod.yml; do
  docker run --rm -v "$here:/m:ro" -v "$here/alert-rules.yml:/etc/prometheus/alert-rules.yml:ro" \
    --entrypoint promtool "$prom" check config "/m/$f"
done

echo "## alertmanager"
docker run --rm -v "$here:/m:ro" --entrypoint sh "$am" /m/alertmanager/check.sh
