#!/usr/bin/env bash
# 서버에서 결제 손 작업을 돌린다(런북 RefundOutcomeUnknown, ReconciliationRetryExhausted).
#   bash ops/payments.sh resolve-refunds [--older-than=<초>]   결과 미상 환불을 PG 재조회로 확정
#   bash ops/payments.sh reconcile [--date=YYYY-MM-DD]         PG 대사(날짜를 빼면 어제, Asia/Seoul)
# ACTIVE 쪽 태그의 migrate 이미지(소스와 tsx가 있다)로 돌리고, PG 키는 서버 .env에서 넘긴다
source "$(dirname "$0")/lib.sh"
case "${1:-}" in
  resolve-refunds | reconcile) task=$1; shift ;;
  *) echo "쓰는 법: bash ops/payments.sh resolve-refunds|reconcile [인자]"; exit 1 ;;
esac
[ -n "$ACTIVE_TAG" ] || { log "트래픽을 받는 활성 환경(ACTIVE)이 없다"; exit 1; }
keys=()
for k in STRIPE_SECRET_KEY TOSS_SECRET_KEY TOSS_CLIENT_KEY; do keys+=(-e "$k=$(env_of "$k")"); done
log "payments:$task $* (태그 $ACTIVE_TAG)"
RELEASE_TAG=$ACTIVE_TAG docker compose run --rm -T "${keys[@]}" migrate npm run "payments:$task" -- "$@"
