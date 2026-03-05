#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
BUCKET=$(bucket_name)

step "버킷 $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" 2> /dev/null; then
  echo "이미 있다"
elif [ "$AWS_REGION" = us-east-1 ]; then
  aws s3api create-bucket --bucket "$BUCKET" > /dev/null
else
  aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$AWS_REGION" > /dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging "TagSet=[{$TAGS}]"
echo "$BUCKET"

step "IAM 역할 $NAME-server - EC2만 이 역할을 맡을 수 있다"
if aws iam get-role --role-name "$NAME-server" > /dev/null 2>&1; then
  echo "이미 있다 - 권한 정책만 이 리전의 버킷으로 바꾼다"
else
  aws iam create-role --role-name "$NAME-server" --tags "$TAGS" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]
    }' --query Role.Arn --output text
fi
aws iam put-role-policy --role-name "$NAME-server" --policy-name s3-images --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {\"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\"], \"Resource\": \"arn:aws:s3:::$BUCKET/*\"},
    {\"Effect\": \"Allow\", \"Action\": [\"s3:ListBucket\", \"s3:PutBucketCORS\"], \"Resource\": \"arn:aws:s3:::$BUCKET\"}
  ]
}"
if ! aws iam get-instance-profile --instance-profile-name "$NAME-server" > /dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$NAME-server" --tags "$TAGS" > /dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$NAME-server" --role-name "$NAME-server"
fi
echo "인스턴스 프로필 $NAME-server"
