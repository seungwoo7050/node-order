#!/bin/sh
# Alertmanager 설정을 환경변수로 만든다(Alertmanager는 설정 파일 안의 환경변수를 펼치지 않는다).
#   ALERT_WEBHOOK_URL  경보를 보낼 Slack·Discord 호환 웹훅(Discord는 주소 끝에 /slack). 없으면 null 수신자(기동은 된다)
#   DEADMAN_URL        Watchdog을 1분마다 보낼 dead man's switch(healthchecks 호환 핑 주소). 없으면 null 수신자
#   RUNBOOK_BASE_URL   경보의 runbook annotation(docs/runbook.md#…) 앞에 붙일 주소
#   ALERT_ENV          메시지 제목에 붙일 환경 이름(기본 production)
# 쓰는 법:
#   sh render.sh                       설정을 표준 출력으로(검사: amtool check-config)
#   sh render.sh --run [인자...]        /tmp/alertmanager.yml로 쓰고 alertmanager를 띄운다(Compose의 entrypoint)
# alertmanager 이미지의 busybox sh에서 돈다(bash 문법을 쓰지 않는다)
set -eu

WEBHOOK=${ALERT_WEBHOOK_URL:-}
DEADMAN=${DEADMAN_URL:-}
RUNBOOK_BASE=${RUNBOOK_BASE_URL:-https://github.com/seungwoo7050/node-order/blob/main/}
ENV_NAME=${ALERT_ENV:-production}

# 작은따옴표 YAML 문자열에 넣으므로 작은따옴표·줄바꿈이 든 값은 받지 않는다
for v in "$WEBHOOK" "$DEADMAN" "$RUNBOOK_BASE" "$ENV_NAME"; do
  case "$v" in *"'"* | *"
"*) echo "render.sh: 값에 작은따옴표나 줄바꿈이 있다" >&2; exit 1 ;; esac
done

if [ -n "$WEBHOOK" ]; then main=webhook; else main=null; fi
if [ -n "$DEADMAN" ]; then watchdog=deadman; else watchdog=null; fi

render() {
  cat <<EOF
# render.sh가 만든 설정(손으로 고치지 않는다). 경보 → ${main}, Watchdog → ${watchdog}
route:
  receiver: '${main}'
  group_by: ["alertname", "provider"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    # 항상 울리는 Watchdog은 웹훅으로 보내지 않고 dead man's switch로 1분마다 보낸다
    - matchers: ['alertname="Watchdog"']
      receiver: '${watchdog}'
      group_wait: 0s
      group_interval: 1m
      repeat_interval: 1m

receivers:
  - name: 'null'
EOF
  if [ -n "$WEBHOOK" ]; then
    cat <<EOF
  - name: webhook
    slack_configs:
      - api_url: '${WEBHOOK}'
        send_resolved: true
        title: '[${ENV_NAME}] {{ .Status | toUpper }} {{ .CommonLabels.alertname }}{{ if .CommonLabels.provider }} ({{ .CommonLabels.provider }}){{ end }}'
        text: >-
          {{ range .Alerts }}• [{{ .Labels.severity }}] {{ .Annotations.summary }} - {{ .Annotations.description }}
          런북: ${RUNBOOK_BASE}{{ .Annotations.runbook }}
          {{ end }}
EOF
  fi
  if [ -n "$DEADMAN" ]; then
    cat <<EOF
  - name: deadman
    webhook_configs:
      - url: '${DEADMAN}'
        send_resolved: false
EOF
  fi
}

if [ "${1:-}" = "--run" ]; then
  shift
  render > /tmp/alertmanager.yml
  echo "render.sh: 경보 → ${main}, Watchdog → ${watchdog}" >&2
  exec /bin/alertmanager --config.file=/tmp/alertmanager.yml "$@"
fi
render
