#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
DC=(docker compose --progress quiet)
env_of() { sed -n "s/^$1=//p" .env; }
say() { printf '%s %s\n' "$(date +%T)" "$*"; }

ACTIVE=$(env_of ACTIVE)
case "$ACTIVE" in blue) BACK=green ;; green) BACK=blue ;; *) echo "되돌릴 벌이 없다(ACTIVE=$ACTIVE)"; exit 1 ;; esac
BACK_TAG=$(env_of "$(echo "$BACK" | tr a-z A-Z)_TAG")
[ -n "$BACK_TAG" ] || { echo "${BACK}에 버전이 없다"; exit 1; }
say "== $ACTIVE → $BACK($BACK_TAG)"
"${DC[@]}" up -d --no-deps --wait --wait-timeout "${WAIT_TIMEOUT:-120}" "api-$BACK" "web-$BACK"
echo "reverse_proxy web-$BACK:3000" > live/web.caddy
echo "reverse_proxy api-$BACK:4000 # WebSocket(Upgrade)도 그대로 넘긴다" > live/api.caddy
"${DC[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | { grep '"level":"error"' || true; }
sed -i.bak "s|^ACTIVE=.*|ACTIVE=$BACK|" .env && rm .env.bak
say "트래픽 → $BACK"
sleep "${DRAIN_SECONDS:-10}"
"${DC[@]}" stop "api-$ACTIVE" "web-$ACTIVE" > /dev/null
say "$ACTIVE 내림"
