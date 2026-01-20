#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
set +e
exists() { [ -n "$1" ] && [ "$1" != "None" ]; }

step "탄력적 IP - 서버와 떼고 반납한다(붙어 있지 않은 IP도 시간당 요금이 나간다)"
ALLOC=$(eip_alloc)
if exists "$ALLOC"; then
  ASSOC=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].AssociationId' --output text)
  exists "$ASSOC" && aws ec2 disassociate-address --association-id "$ASSOC"
  aws ec2 release-address --allocation-id "$ALLOC" && echo "반납 $ALLOC"
fi

step "인스턴스 - 종료(terminate)하면 디스크(DeleteOnTermination=true)도 함께 지워진다"
INSTANCE=$(instance_id)
if exists "$INSTANCE"; then
  aws ec2 terminate-instances --instance-ids "$INSTANCE" > /dev/null && echo "종료 중 $INSTANCE"
fi

step "RDS - 마지막 스냅숏을 남기지 않는다(스냅숏도 저장 요금이 나간다)"
if aws rds describe-db-instances --db-instance-identifier "$NAME-db" > /dev/null 2>&1; then
  aws rds delete-db-instance --db-instance-identifier "$NAME-db" --skip-final-snapshot --delete-automated-backups \
    --query 'DBInstance.DBInstanceStatus' --output text
fi

step "키 페어(AWS 쪽 공개 키)"
aws ec2 delete-key-pair --key-name "$NAME-admin" > /dev/null 2>&1 && echo "삭제 $NAME-admin"

step "S3 버킷 - 안의 파일부터 비워야 지워진다"
BUCKET=$(bucket_name)
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3 rm "s3://$BUCKET" --recursive --quiet
  aws s3api delete-bucket --bucket "$BUCKET" && echo "삭제 $BUCKET"
fi

step "IAM 역할 - 인스턴스 프로필에서 빼고, 인라인 정책을 지운 뒤 지운다"
if aws iam get-role --role-name "$NAME-server" > /dev/null 2>&1; then
  aws iam remove-role-from-instance-profile --instance-profile-name "$NAME-server" --role-name "$NAME-server"
  aws iam delete-instance-profile --instance-profile-name "$NAME-server"
  aws iam delete-role-policy --role-name "$NAME-server" --policy-name s3-images
  aws iam delete-role --role-name "$NAME-server" && echo "삭제 역할·인스턴스 프로필 $NAME-server"
fi

step "인스턴스 종료와 RDS 삭제를 기다린다(보안 그룹은 쓰는 곳이 없어야 지워진다)"
exists "$INSTANCE" && aws ec2 wait instance-terminated --instance-ids "$INSTANCE" && echo "인스턴스 종료됨"
aws rds wait db-instance-deleted --db-instance-identifier "$NAME-db" 2>/dev/null && echo "RDS 삭제됨"

step "보안 그룹 - DB 쪽이 서버 쪽을 가리키므로 DB 쪽부터"
for g in "$NAME-db" "$NAME-web"; do
  ID=$(sg_id "$g"); exists "$ID" && aws ec2 delete-security-group --group-id "$ID" && echo "삭제 $g"
done

step "Stripe 웹훅 엔드포인트(61-stripe-webhook.sh로 만든 것) - AWS 밖이라 키가 있어야 지운다"
WH="$(dirname "$0")/.local/stripe-webhook-id"
if [ -f "$WH" ] && [ -n "${STRIPE_SECRET_KEY:-}" ]; then
  printf 'user = "%s:"\n' "$STRIPE_SECRET_KEY" | curl -sS -K - -X DELETE "https://api.stripe.com/v1/webhook_endpoints/$(cat "$WH")" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("삭제", d.get("id"), d.get("deleted"))' && rm "$WH"
elif [ -f "$WH" ]; then
  echo "남아 있음: $(cat "$WH") - STRIPE_SECRET_KEY=... ./90-destroy.sh 로 다시 실행하거나 Stripe 대시보드(테스트 모드 → Webhooks)에서 지운다"
fi

step "예산 알림은 남겨 둔다(돈이 들지 않는다). 지우려면:"
echo "  aws budgets delete-budget --account-id <계정 번호> --budget-name $NAME-monthly"
