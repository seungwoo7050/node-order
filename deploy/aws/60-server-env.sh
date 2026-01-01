#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
LOCAL="$(dirname "$0")/.local"
ENV_FILE="$LOCAL/server.env"
umask 077

set_kv() { K="$1" V="$2" python3 - "$ENV_FILE" <<'EOF'
import os, sys
path, k, v = sys.argv[1], os.environ["K"], os.environ["V"]
lines = open(path).read().splitlines() if os.path.exists(path) else []
lines = [l for l in lines if not l.startswith(k + "=")] + [f"{k}={v}"]
open(path, "w").write("\n".join(lines) + "\n")
EOF
}
has_kv() { grep -q "^$1=." "$ENV_FILE" 2>/dev/null; }
rand() { openssl rand -"$1" "$2"; }

step "공개 값과 주소"
IP=$(aws ec2 describe-addresses --allocation-ids "$(eip_alloc)" --query 'Addresses[0].PublicIp' --output text)
ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier "$NAME-db" --query 'DBInstances[0].Endpoint.Address' --output text)
grep -q '^IMAGE_TAG=' "$ENV_FILE" 2>/dev/null || set_kv IMAGE_TAG ""
set_kv WEB_HOST "shop.${IP//./-}.sslip.io"
set_kv API_HOST "api.${IP//./-}.sslip.io"
set_kv AWS_REGION "$AWS_REGION"
set_kv S3_BUCKET "$(bucket_name)"

step "DB 연결(소유자 비밀번호는 40-database.sh가 만든 것, 앱 비밀번호는 여기서 한 번 만든다)"
[ -f "$LOCAL/db-app-password" ] || rand hex 24 > "$LOCAL/db-app-password"
set_kv ADMIN_DATABASE_URL "postgresql://order_owner:$(cat "$LOCAL/db-admin-password")@$ENDPOINT:5432/order_api?sslmode=verify-full"
set_kv DATABASE_URL "postgresql://order_app:$(cat "$LOCAL/db-app-password")@$ENDPOINT:5432/order_api?sslmode=verify-full"

step "무작위 비밀(없을 때만 만든다)"
has_kv JWT_SECRET    || set_kv JWT_SECRET "$(rand base64 32)"
has_kv AUTH_SECRET   || set_kv AUTH_SECRET "$(rand base64 32)"
has_kv DEMO_PASSWORD || set_kv DEMO_PASSWORD "$(rand hex 8)"

step "외부 서비스 값(환경 변수로 준 것만 바꾼다)"
for k in GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET; do
  if [ -n "${!k:-}" ]; then set_kv "$k" "$(unquote "${!k}")"; echo "바꿈  $k"
  elif ! grep -q "^$k=" "$ENV_FILE"; then set_kv "$k" ""; fi
done

step "확인 - 값은 가리고 채워졌는지만 본다"
awk -F= '{ k = $1; v = substr($0, length(k) + 2)
  if (v == "") print k "=(비어 있음)"
  else if (k ~ /^(WEB_HOST|API_HOST|AWS_REGION|S3_BUCKET|IMAGE_TAG)$/) print k "=" v
  else print k "=(채워짐)" }' "$ENV_FILE" | sed -E 's/[0-9]{12}/************/'

step "서버로 올린다(권한 600 - 서버의 ubuntu 사용자만 읽는다). IMAGE_TAG는 서버의 값을 지킨다"
SSH=(ssh -i "$LOCAL/admin_ed25519" -o UserKnownHostsFile="$LOCAL/known_hosts" -o StrictHostKeyChecking=accept-new "ubuntu@$IP")
SERVER_TAG=$("${SSH[@]}" "sed -n 's/^IMAGE_TAG=//p' /opt/node-order/.env 2>/dev/null" || true)
[ -n "$SERVER_TAG" ] && set_kv IMAGE_TAG "$SERVER_TAG"
"${SSH[@]}" 'umask 077 && cat > /opt/node-order/.env' < "$ENV_FILE"
"${SSH[@]}" 'stat -c "%a %U %n" /opt/node-order/.env'
