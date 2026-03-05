#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
DC=(docker compose --progress quiet)
DRAIN_SECONDS=${DRAIN_SECONDS:-10}

env_of() { sed -n "s/^$1=//p" .env; }
set_env() { if grep -q "^$1=" .env; then sed -i.bak "s|^$1=.*|$1=$2|" .env && rm .env.bak; else echo "$1=$2" >> .env; fi; }
say() { printf '%s %s\n' "$(date +%T)" "$*"; }
upper() { echo "$1" | tr a-z A-Z; }

ACTIVE=$(env_of ACTIVE)
case "$ACTIVE" in blue) IDLE=green ;; green) IDLE=blue ;; "") IDLE=blue ;; *) echo "ACTIVE는 blue나 green이다: $ACTIVE"; exit 1 ;; esac
reload_caddy() {
  if "${DC[@]}" exec -T caddy test -f /etc/caddy/live/web.caddy 2> /dev/null; then
    "${DC[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | { grep '"level":"error"' || true; }
  else
    "${DC[@]}" up -d --no-deps --force-recreate --remove-orphans --wait caddy
  fi
}

route() {
  if [ -n "${3:-}" ]; then
    printf '@preview header Cookie *deploy_slot=%s*\nhandle @preview {\n\theader X-Deploy-Slot preview\n\treverse_proxy web-%s:3000\n}\nhandle {\n\treverse_proxy web-%s:3000\n}\n' "$3" "$2" "$1" > live/web.caddy
  else
    echo "reverse_proxy web-$1:3000" > live/web.caddy
  fi
  echo "reverse_proxy api-$1:4000 # WebSocket(Upgrade)도 그대로 넘긴다" > live/api.caddy
  reload_caddy
}

up() {
  local NEW=${1:?이미지 태그} TOKEN=${2:-}
  say "== ${ACTIVE:-(없음)}($([ -n "$ACTIVE" ] && env_of "$(upper "$ACTIVE")_TAG" || echo 없음)) 옆에 $IDLE($NEW)"
  if [ "$(env_of IMAGE_PREFIX)" != rehearsal ]; then
    docker login ghcr.io -u github-actions --password-stdin > /dev/null
    trap 'docker logout ghcr.io > /dev/null' EXIT
    RELEASE_TAG=$NEW "${DC[@]}" pull --quiet migrate
    env "$(upper "$IDLE")_TAG=$NEW" "${DC[@]}" pull --quiet "api-$IDLE" "web-$IDLE"
  else
    for img in order-api order-api-migrate order-web; do
      docker image inspect "rehearsal/$img:$NEW" > /dev/null 2>&1 \
        || { echo "rehearsal/$img:${NEW} 이미지가 없다. 저장소 루트에서 deploy/rehearsal-build.sh ${NEW}부터 친다"; exit 1; }
    done
  fi

  mkdir -p live
  [ -f live/web.caddy ] || { echo "reverse_proxy web-$IDLE:3000" > live/web.caddy; echo "reverse_proxy api-$IDLE:4000" > live/api.caddy; }
  "${DC[@]}" up -d --wait --no-recreate

  say "마이그레이션"
  RELEASE_TAG=$NEW "${DC[@]}" run --rm -T migrate 2>&1 | { grep -E "^Applying|^No pending|rror|P3[0-9]{3}" || true; }
  APP_PW=$(env_of DATABASE_URL | sed -n 's|^postgresql://order_app:\([^@]*\)@.*|\1|p')
  printf "ALTER ROLE order_app PASSWORD '%s';\n" "$APP_PW" | RELEASE_TAG=$NEW "${DC[@]}" run --rm -T migrate npx prisma db execute --stdin 2>&1 | { grep -E "rror|P[0-9]{4}" || true; }

  env_of "$(upper "$IDLE")_TAG" > live/prev-idle-tag # abort가 되돌릴 값
  set_env "$(upper "$IDLE")_TAG" "$NEW"
  say "$IDLE 기동"
  if ! "${DC[@]}" up -d --no-deps --wait --wait-timeout "${WAIT_TIMEOUT:-120}" "api-$IDLE" "web-$IDLE"; then
    say "== ${IDLE}가 준비되지 않았다 → 트래픽은 ${ACTIVE:-(없음)}에 그대로 둔다"
    "${DC[@]}" logs --tail 20 "api-$IDLE" || true
    abort
    exit 1
  fi
  if [ -n "$TOKEN" ]; then
    route "${ACTIVE:-$IDLE}" "$IDLE" "$TOKEN"
    say "미리보기: deploy_slot 쿠키를 든 요청만 $IDLE"
  fi
}

switch() {
  "${DC[@]}" ps --status running --services | grep -qx "api-$IDLE" || { echo "${IDLE}가 떠 있지 않다. up부터 한다"; exit 1; }
  local NEW OLD_TAG
  NEW=$(env_of "$(upper "$IDLE")_TAG")
  OLD_TAG=$([ -n "$ACTIVE" ] && env_of "$(upper "$ACTIVE")_TAG" || true)
  route "$IDLE"
  set_env ACTIVE "$IDLE"
  rm -f live/prev-idle-tag
  say "트래픽 → $IDLE($NEW)"

  if [ -n "$ACTIVE" ]; then
    sleep "$DRAIN_SECONDS"
    "${DC[@]}" stop "api-$ACTIVE" "web-$ACTIVE" > /dev/null
    say "$ACTIVE 내림(이미지 ${OLD_TAG}는 되돌리기용으로 남긴다)"
  fi

  if [ "$(env_of IMAGE_PREFIX)" != rehearsal ]; then
    docker images --format '{{.Repository}}:{{.Tag}}' | grep '^ghcr.io/seungwoo7050/node-order/' \
      | grep -v -e ":$NEW\$" -e ":${OLD_TAG:-none}\$" | xargs -r docker rmi > /dev/null || true
    docker image prune -f > /dev/null
  fi
  "${DC[@]}" ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
}

abort() {
  "${DC[@]}" stop "api-$IDLE" "web-$IDLE" > /dev/null
  [ -f live/prev-idle-tag ] && set_env "$(upper "$IDLE")_TAG" "$(cat live/prev-idle-tag)" && rm live/prev-idle-tag
  [ -n "$ACTIVE" ] && route "$ACTIVE"
  say "$IDLE 내림 - 트래픽은 ${ACTIVE:-(없음)}에 그대로다"
}

case "${1:?<태그> | up <태그> [토큰] | switch | abort}" in
  up) up "${2:-}" "${3:-}" ;;
  switch) switch ;;
  abort) abort ;;
  *) up "$1"; switch ;;
esac
