#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
set +e

step "태그($TAG_KEY=$TAG_VALUE)가 붙은 리소스 - 지운 직후에는 몇 분 동안 보일 수 있다"
aws resourcegroupstaggingapi get-resources --tag-filters "Key=$TAG_KEY,Values=$TAG_VALUE" \
  --query 'ResourceTagMappingList[].ResourceARN' --output text | tr '\t' '\n' | sed -E 's/[0-9]{12}/************/'

step "요금이 나가는 것들을 종류별로 직접 센다(태그를 빠뜨렸어도 잡히게)"
count() { printf '%3s  %s\n' "$2" "$1"; }
count "실행·정지 중인 인스턴스"   "$(aws ec2 describe-instances --filters Name=instance-state-name,Values=pending,running,stopping,stopped --query 'length(Reservations[].Instances[])')"
count "EBS 볼륨"                  "$(aws ec2 describe-volumes --query 'length(Volumes)')"
count "내 EBS 스냅숏"             "$(aws ec2 describe-snapshots --owner-ids self --query 'length(Snapshots)')"
count "탄력적 IP"                 "$(aws ec2 describe-addresses --query 'length(Addresses)')"
count "RDS 인스턴스"              "$(aws rds describe-db-instances --query 'length(DBInstances)')"
count "RDS 수동 스냅숏"           "$(aws rds describe-db-snapshots --snapshot-type manual --query 'length(DBSnapshots)')"
count "S3 버킷(전체 리전)"        "$(aws s3api list-buckets --query 'length(Buckets)')"
count "IAM 역할 $NAME-server"     "$(aws iam get-role --role-name "$NAME-server" > /dev/null 2>&1 && echo 1 || echo 0)"
count "보안 그룹 $NAME-*"         "$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$NAME-*" --query 'length(SecurityGroups)')"
