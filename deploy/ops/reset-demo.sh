#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

if [ "$(env_of DEMO_LOGIN)" != "1" ]; then
  log "DEMO_LOGIN이 1이 아니다 - 데모 서비스가 아니므로 초기화하지 않는다"
  exit 0
fi
if [ "$(cat .last-backup-ok 2>/dev/null)" != "$(TZ=Asia/Seoul date +%F)" ] && [ "${FORCE:-}" != 1 ]; then
  log "오늘 백업이 성공하지 않았다 - 초기화하지 않는다(backup.sh를 확인하고, 강제하려면 FORCE=1)"
  exit 1
fi
log "데모 데이터 초기화 시작"
[ -n "$ACTIVE_TAG" ] || { log "트래픽을 받는 활성 환경(ACTIVE)이 없다 - 블루그린으로 성공한 배포가 아직 없다"; exit 1; }
RELEASE_TAG=$ACTIVE_TAG docker compose run --rm -T migrate npx prisma db seed 2>&1 | tail -1
log "데모 데이터 초기화 끝"
