#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
BUCKET=$(bucket_name)

step "수명 주기 규칙: backups/ 7일, backups-partial/ 1일 뒤 삭제"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [
    {
      "ID": "expire-db-backups",
      "Status": "Enabled",
      "Filter": {"Prefix": "backups/"},
      "Expiration": {"Days": 7}
    },
    {
      "ID": "expire-partial-dumps",
      "Status": "Enabled",
      "Filter": {"Prefix": "backups-partial/"},
      "Expiration": {"Days": 1}
    }
  ]
}' > /dev/null
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --query 'Rules[].{id:ID,prefix:Filter.Prefix,days:Expiration.Days,status:Status}'
