#!/usr/bin/env bash
set -euo pipefail
TAG=${1:?태그}
SRC=${2:-"$(dirname "$0")/.."}
cd "$SRC"
docker build -q -f order-api-nest/Dockerfile --target runtime -t "rehearsal/order-api:$TAG" .
docker build -q -f order-api-nest/Dockerfile --target migrate -t "rehearsal/order-api-migrate:$TAG" .
docker build -q -f order-console-next/Dockerfile -t "rehearsal/order-web:$TAG" \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:8081 --build-arg NEXT_PUBLIC_STORAGE_URL=http://localhost:9100 .
