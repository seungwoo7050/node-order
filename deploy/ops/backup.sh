#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

KEY="backups/order_api-$(date -u +%Y%m%dT%H%M%SZ).dump"
TMP="backups-partial/${KEY#backups/}"
trap 'aws_ s3 rm "s3://$BUCKET/$TMP" --only-show-errors || true' ERR
log "백업 시작 → s3://$BUCKET/$KEY"
pg sh -c 'pg_dump "$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem" --format=custom --no-owner' \
  | aws_ s3 cp - "s3://$BUCKET/$TMP" --only-show-errors
aws_ s3 mv "s3://$BUCKET/$TMP" "s3://$BUCKET/$KEY" --only-show-errors
trap - ERR
SIZE=$(aws_ s3api head-object --bucket "$BUCKET" --key "$KEY" --query ContentLength --output text)
log "백업 끝: $KEY ($SIZE 바이트)"
TZ=Asia/Seoul date +%F > .last-backup-ok
