#!/bin/sh
# alertmanager 이미지 안에서 돈다(monitoring/test.sh가 부른다). render.sh가 만든 설정을 경우마다 amtool check-config로 보고,
# 주소가 없으면 null 수신자로 가는지, 있으면 그 수신자로 가는지 amtool config routes test로 본다
set -eu
here=$(dirname "$0")
fail=0

# check <설명> <기대 경보 수신자> <기대 Watchdog 수신자> [환경변수=값...]
check() {
  desc=$1 want_main=$2 want_watchdog=$3
  shift 3
  if ! env -u ALERT_WEBHOOK_URL -u DEADMAN_URL "$@" sh "$here/render.sh" > /tmp/am.yml; then
    echo "FAIL $desc: render.sh 실패"; fail=1; return
  fi
  if ! amtool check-config /tmp/am.yml > /tmp/check.log 2>&1; then
    echo "FAIL $desc: amtool check-config"; cat /tmp/check.log; fail=1; return
  fi
  main=$(amtool config routes test --config.file=/tmp/am.yml alertname=ApiDown severity=critical)
  watchdog=$(amtool config routes test --config.file=/tmp/am.yml alertname=Watchdog severity=none)
  if [ "$main" = "$want_main" ] && [ "$watchdog" = "$want_watchdog" ]; then
    echo "ok   $desc (경보 → $main, Watchdog → $watchdog)"
  else
    echo "FAIL $desc: 경보 → $main(기대 $want_main), Watchdog → $watchdog(기대 $want_watchdog)"; fail=1
  fi
}

check "주소가 없으면 기동되고 null로 간다" null null
check "웹훅만 있으면 경보는 웹훅, Watchdog은 null" webhook null ALERT_WEBHOOK_URL=https://hooks.example.com/services/T/B/x
check "둘 다 있으면 경보는 웹훅, Watchdog은 dead man's switch" webhook deadman ALERT_WEBHOOK_URL=https://discord.example.com/api/webhooks/1/x/slack DEADMAN_URL=https://hc-ping.example.com/uuid
check "dead man's switch만 있어도 기동된다" null deadman DEADMAN_URL=https://hc-ping.example.com/uuid

if ALERT_WEBHOOK_URL="https://x.example.com/it's" sh "$here/render.sh" > /dev/null 2>&1; then
  echo "FAIL 작은따옴표가 든 주소를 거절하지 않았다"; fail=1
else
  echo "ok   작은따옴표가 든 주소는 거절한다"
fi
exit $fail
