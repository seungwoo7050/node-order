#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
set +e

step "로그인한 주체"
aws sts get-caller-identity --query Arn --output text | sed -E 's/[0-9]{12}/************/'

step "요금 플랜(FREE면 카드로 청구되지 않고 크레딧에서 빠진다)"
aws freetier get-account-plan-state \
  --query '{plan:accountPlanType,status:accountPlanStatus,credits:accountPlanRemainingCredits.amount,expires:accountPlanExpirationDate}'

step "서비스별 사용 가능 여부"
check() {
  local name=$1; shift
  if out=$("$@" 2>&1); then echo "OK    $name"; else echo "FAIL  $name - $(echo "$out" | grep -oE '\(([A-Za-z]+)\)' | head -1)"; fi
}
check "EC2"        aws ec2 describe-vpcs
check "기본 VPC"   sh -c '[ "$(aws ec2 describe-account-attributes --attribute-names default-vpc --query "AccountAttributes[0].AttributeValues[0].AttributeValue" --output text)" != none ] || { echo "(NoDefaultVpc)"; exit 1; }'
check "RDS"        aws rds describe-db-instances
check "S3"         aws s3api list-buckets
check "IAM 역할"   aws iam list-roles --max-items 1
check "IAM OIDC"   aws iam list-open-id-connect-providers
check "Budgets"    aws budgets describe-budgets --account-id "$(account_id)"
