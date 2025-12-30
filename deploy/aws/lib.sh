set -euo pipefail

: "${AWS_PROFILE:=node-order}"
: "${AWS_REGION:=ap-southeast-2}"
export AWS_PROFILE AWS_REGION AWS_PAGER=""

NAME=node-order
TAG_KEY=Project
TAG_VALUE=node-order
TAGS="Key=$TAG_KEY,Value=$TAG_VALUE"

vpc_id() { aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text; }
sg_id() { aws ec2 describe-security-groups --filters "Name=group-name,Values=$1" "Name=vpc-id,Values=$(vpc_id)" --query 'SecurityGroups[0].GroupId' --output text; }
instance_id() {
  aws ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text
}
eip_alloc() { aws ec2 describe-addresses --filters "Name=tag:Name,Values=$NAME" --query 'Addresses[0].AllocationId' --output text; }
account_id() { aws sts get-caller-identity --query Account --output text; }
bucket_name() { echo "$NAME-images-$(account_id)"; }
unquote() { local v=$1; v=${v#[\"\']}; v=${v%[\"\']}; printf '%s' "$v"; }
step() { printf '\n== %s\n' "$*"; }
