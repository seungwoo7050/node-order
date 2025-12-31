#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
LOCAL="$(dirname "$0")/.local"; mkdir -p "$LOCAL"; chmod 700 "$LOCAL"
[ -f "$LOCAL/db-admin-password" ] || (umask 077; openssl rand -hex 24 > "$LOCAL/db-admin-password")

step "RDS $NAME-db (몇 분 걸린다)"
aws rds create-db-instance \
  --db-instance-identifier "$NAME-db" \
  --engine postgres --engine-version 17 \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 --storage-type gp3 \
  --master-username order_owner \
  --master-user-password "$(cat "$LOCAL/db-admin-password")" \
  --db-name order_api \
  --vpc-security-group-ids "$(sg_id "$NAME-db")" \
  --no-publicly-accessible --no-multi-az \
  --backup-retention-period 0 \
  --tags "$TAGS" \
  --query 'DBInstance.DBInstanceStatus' --output text
aws rds wait db-instance-available --db-instance-identifier "$NAME-db"
aws rds describe-db-instances --db-instance-identifier "$NAME-db" \
  --query 'DBInstances[0].{status:DBInstanceStatus,endpoint:Endpoint.Address,version:EngineVersion,public:PubliclyAccessible}'
