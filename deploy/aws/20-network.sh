#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
VPC=$(vpc_id)
if [ "$VPC" = "None" ]; then
  echo "이 리전($AWS_REGION)에 기본 VPC가 없다 → aws ec2 create-default-vpc 로 다시 만든 뒤 실행한다"
  exit 1
fi

step "서버 보안 그룹 $NAME-web"
WEB_SG=$(aws ec2 create-security-group --group-name "$NAME-web" --vpc-id "$VPC" \
  --description "node-order server: http, https, ssh" \
  --tag-specifications "ResourceType=security-group,Tags=[{$TAGS},{Key=Name,Value=$NAME-web}]" --query GroupId --output text)
for port in 80 443 22; do
  aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" --protocol tcp --port "$port" --cidr 0.0.0.0/0 \
    --tag-specifications "ResourceType=security-group-rule,Tags=[{$TAGS}]" > /dev/null
done
echo "$WEB_SG"

step "DB 보안 그룹 $NAME-db - 서버 보안 그룹에서 오는 5432만 받는다"
DB_SG=$(aws ec2 create-security-group --group-name "$NAME-db" --vpc-id "$VPC" \
  --description "node-order database: postgres from server only" \
  --tag-specifications "ResourceType=security-group,Tags=[{$TAGS},{Key=Name,Value=$NAME-db}]" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$DB_SG" --protocol tcp --port 5432 --source-group "$WEB_SG" \
  --tag-specifications "ResourceType=security-group-rule,Tags=[{$TAGS}]" > /dev/null
echo "$DB_SG"
