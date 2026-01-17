#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
CHECK_DB=order_api_restore_check

KEY=$(aws_ s3api list-objects-v2 --bucket "$BUCKET" --prefix backups/ --query 'sort_by(Contents || `[]`, &LastModified)[-1].Key' --output text)
if [ "$KEY" = None ] || [ -z "$KEY" ]; then log "backups/에 백업이 없다"; exit 1; fi
log "복원 대상: $KEY"
drop_check_db() { pg sh -c 'psql "$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem" -qc "DROP DATABASE IF EXISTS '$CHECK_DB'"'; log "임시 DB를 지웠다"; }
trap drop_check_db EXIT

pg sh -c 'psql "$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem" -qc "DROP DATABASE IF EXISTS '$CHECK_DB'" -c "CREATE DATABASE '$CHECK_DB'"'
aws_ s3 cp "s3://$BUCKET/$KEY" - --only-show-errors \
  | pg sh -c 'pg_restore --no-owner -d "$(echo "$ADMIN_DATABASE_URL" | sed "s|/order_api?|/'$CHECK_DB'?|")&sslrootcert=/rds-ca.pem"'

COUNTS="select 'users', count(*) from users union all select 'products', count(*) from products union all select 'orders', count(*) from orders union all select 'order_items', count(*) from order_items order by 1"
live=$(pg sh -c "psql \"\$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem\" -At -F ' ' -c \"$COUNTS\"")
restored=$(pg sh -c "psql \"\$(echo \"\$ADMIN_DATABASE_URL\" | sed 's|/order_api?|/$CHECK_DB?|')&sslrootcert=/rds-ca.pem\" -At -F ' ' -c \"$COUNTS\"")
paste <(echo "$live") <(echo "$restored") | awk 'BEGIN { print "테이블        운영  복원" } { printf "%-12s %5s %5s%s\n", $1, $2, $4, ($2 == $4 ? "" : "  ← 다르다(백업 뒤에 바뀌었을 수 있다)") }'

if [ "$(echo "$restored" | grep -c .)" -ne 4 ] || echo "$restored" | grep -Eq '^(users|products) 0$'; then
  log "복원 확인 실패: 표가 빠졌거나 비어 있다"; exit 1
fi
