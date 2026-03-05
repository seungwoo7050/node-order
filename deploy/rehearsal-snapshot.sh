#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
DC=(docker compose --progress quiet)
psql_() { "${DC[@]}" exec -T db psql -q -U order_owner -d postgres -c "$1"; }
"${DC[@]}" stop api-blue api-green web-blue web-green > /dev/null 2>&1 || true
SNAP="order_api_${2:-snap}"
case "${1:?save | restore}" in
  save) psql_ "DROP DATABASE IF EXISTS $SNAP" && psql_ "CREATE DATABASE $SNAP TEMPLATE order_api" ;;
  restore) psql_ "DROP DATABASE order_api WITH (FORCE)" && psql_ "CREATE DATABASE order_api TEMPLATE $SNAP" ;;
esac
"${DC[@]}" exec -T redis redis-cli FLUSHALL > /dev/null # 캐시도 그 시점으로(빈 채로)
ACTIVE=$(sed -n 's/^ACTIVE=//p' .env)
[ -n "$ACTIVE" ] && "${DC[@]}" up -d --no-deps --wait "api-$ACTIVE" "web-$ACTIVE"
echo "$1 $SNAP 끝 - ${ACTIVE:-(없음)} 환경을 다시 띄웠다"
