set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

env_of() { sed -n "s/^$1=//p" .env; }
BUCKET=$(env_of S3_BUCKET)
REGION=$(env_of AWS_REGION)
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

pg() { docker run --rm -i --env-file .env -e PGOPTIONS="-c client_min_messages=warning" -v "$PWD/rds-ca.pem:/rds-ca.pem:ro" postgres:17 "$@"; }
aws_() { docker run --rm -i -e AWS_REGION="$REGION" amazon/aws-cli "$@"; }
