#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
DIR="$(dirname "$0")"; LOCAL="$DIR/.local"; mkdir -p "$LOCAL"; chmod 700 "$LOCAL"

step "SSH 키(이 PC의 .local/에만 있다)"
[ -f "$LOCAL/admin_ed25519" ] || ssh-keygen -q -t ed25519 -N "" -C "$NAME-admin" -f "$LOCAL/admin_ed25519"
[ -f "$LOCAL/ci_ed25519" ]    || ssh-keygen -q -t ed25519 -N "" -C "$NAME-ci"    -f "$LOCAL/ci_ed25519"
aws ec2 import-key-pair --key-name "$NAME-admin" --public-key-material "fileb://$LOCAL/admin_ed25519.pub" \
  --tag-specifications "ResourceType=key-pair,Tags=[{$TAGS}]" --query KeyName --output text

step "Ubuntu 24.04 이미지(AMI) - AWS가 공개하는 파라미터로 이 리전의 최신 ID를 찾는다"
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --query Parameter.Value --output text)
echo "$AMI"

step "인스턴스 $NAME (t3.small)"
USER_DATA="$LOCAL/user-data.rendered.sh"
{
  head -1 "$DIR/user-data.sh"
  echo "AWS_REGION=$AWS_REGION"
  tail -n +2 "$DIR/user-data.sh"
  echo "echo '$(cat "$LOCAL/ci_ed25519.pub")' >> /home/ubuntu/.ssh/authorized_keys"
} > "$USER_DATA"
INSTANCE=$(aws ec2 run-instances \
  --image-id "$AMI" --instance-type t3.small \
  --key-name "$NAME-admin" \
  --security-group-ids "$(sg_id "$NAME-web")" \
  --iam-instance-profile "Name=$NAME-server" \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=16,VolumeType=gp3,DeleteOnTermination=true}' \
  --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled \
  --user-data "file://$USER_DATA" \
  --tag-specifications "ResourceType=instance,Tags=[{$TAGS},{Key=Name,Value=$NAME}]" \
                       "ResourceType=volume,Tags=[{$TAGS},{Key=Name,Value=$NAME}]" \
  --query 'Instances[0].InstanceId' --output text)
echo "$INSTANCE"
aws ec2 wait instance-running --instance-ids "$INSTANCE"

step "탄력적 IP - 서버를 껐다 켜도 주소가 그대로다(→ sslip.io 주소와 인증서도 그대로)"
ALLOC=$(aws ec2 allocate-address --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{$TAGS},{Key=Name,Value=$NAME}]" --query AllocationId --output text)
aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOC" > /dev/null
IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)
echo "IP          $IP"
echo "WEB_HOST    shop.${IP//./-}.sslip.io"
echo "API_HOST    api.${IP//./-}.sslip.io"
echo "SSH         ssh -i $LOCAL/admin_ed25519 ubuntu@$IP"
