#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
BUCKET=$(bucket_name)

step "버킷 $BUCKET"
if [ "$AWS_REGION" = us-east-1 ]; then
  aws s3api create-bucket --bucket "$BUCKET" > /dev/null
else
  aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$AWS_REGION" > /dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging "TagSet=[{$TAGS}]"
echo "$BUCKET"

step "IAM 역할 $NAME-server - EC2만 이 역할을 맡을 수 있다"
aws iam create-role --role-name "$NAME-server" --tags "$TAGS" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]
  }' --query Role.Arn --output text
aws iam put-role-policy --role-name "$NAME-server" --policy-name s3-images --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {\"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\"], \"Resource\": \"arn:aws:s3:::$BUCKET/*\"},
    {\"Effect\": \"Allow\", \"Action\": [\"s3:ListBucket\", \"s3:PutBucketCORS\"], \"Resource\": \"arn:aws:s3:::$BUCKET\"}
  ]
}"
aws iam create-instance-profile --instance-profile-name "$NAME-server" --tags "$TAGS" > /dev/null
aws iam add-role-to-instance-profile --instance-profile-name "$NAME-server" --role-name "$NAME-server"
echo "인스턴스 프로필 $NAME-server"
