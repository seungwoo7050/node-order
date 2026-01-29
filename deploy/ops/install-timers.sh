#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/systemd"
install -m 644 ./*.service ./*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now node-order-backup.timer node-order-reset-demo.timer
systemctl list-timers 'node-order-*' --no-pager
