#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
NEW=${1:?이미지 태그}
PREV=$(sed -n 's/^IMAGE_TAG=//p' .env)

docker login ghcr.io -u github-actions --password-stdin
trap 'docker logout ghcr.io > /dev/null' EXIT

set_tag() { sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env; }
rollback() {
  echo "== 배포 실패 → ${PREV:-(이전 버전 없음)} 로 되돌린다"
  docker compose logs --tail 30 api web || true
  set_tag "$PREV"
  if [ -n "$PREV" ]; then docker compose up -d --remove-orphans --wait --wait-timeout 120 || true; fi
  docker images --format '{{.Repository}}:{{.Tag}}' | grep '^ghcr.io/seungwoo7050/node-order/' | grep ":$NEW\$" | xargs -r docker rmi > /dev/null || true
  exit 1
}

set_tag "$NEW"
echo "== ${PREV:-(처음)} → $NEW"
docker compose pull --quiet || rollback
docker compose pull --quiet migrate || rollback
docker compose run --rm migrate || rollback
APP_PW=$(sed -n 's|^DATABASE_URL=postgresql://order_app:\([^@]*\)@.*|\1|p' .env)
printf "ALTER ROLE order_app PASSWORD '%s';\n" "$APP_PW" | docker compose run --rm -T migrate npx prisma db execute --stdin > /dev/null || rollback
docker compose up -d --remove-orphans --wait --wait-timeout 120 || rollback
docker images --format '{{.Repository}}:{{.Tag}}' | grep '^ghcr.io/seungwoo7050/node-order/' | grep -v ":$NEW\$" | xargs -r docker rmi > /dev/null || true
docker image prune -f > /dev/null
docker compose ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
