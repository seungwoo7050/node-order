#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
LOCAL="$(dirname "$0")/.local"
: "${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY(테스트 키)를 환경 변수로 준다}"
STRIPE_SECRET_KEY=$(unquote "$STRIPE_SECRET_KEY"); export STRIPE_SECRET_KEY
case "$STRIPE_SECRET_KEY" in sk_test_*) ;; *) echo "테스트 키(sk_test_)만 쓴다"; exit 1 ;; esac
umask 077

IP=$(aws ec2 describe-addresses --allocation-ids "$(eip_alloc)" --query 'Addresses[0].PublicIp' --output text)
URL="https://api.${IP//./-}.sslip.io/payments/webhook"

if [ -f "$LOCAL/stripe-webhook-id" ]; then
  OLD=$(cat "$LOCAL/stripe-webhook-id")
  step "전에 만든 웹훅 엔드포인트 $OLD 를 지운다"
  printf 'user = "%s:"\n' "$STRIPE_SECRET_KEY" | curl -sS -K - -X DELETE "https://api.stripe.com/v1/webhook_endpoints/$OLD" > /dev/null
  rm "$LOCAL/stripe-webhook-id"
fi

step "웹훅 엔드포인트 $URL"
RES=$(printf 'user = "%s:"\n' "$STRIPE_SECRET_KEY" | curl -sS -K - https://api.stripe.com/v1/webhook_endpoints \
  -d "url=$URL" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=checkout.session.expired" \
  -d "description=node-order 18 deploy")
ID=$(echo "$RES" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id") or d["error"]["message"])')
case "$ID" in we_*) echo "$ID" > "$LOCAL/stripe-webhook-id"; echo "만듦 $ID" ;; *) echo "실패: $ID"; exit 1 ;; esac
SECRET=$(echo "$RES" | python3 -c 'import json,sys; print(json.load(sys.stdin)["secret"])')

step "서버 .env에 STRIPE_SECRET_KEY와 STRIPE_WEBHOOK_SECRET를 넣는다"
STRIPE_WEBHOOK_SECRET="$SECRET" "$(dirname "$0")/60-server-env.sh"
