#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
BUCKET=$(bucket_name)
PHOTOS="$(dirname "$0")/../../order-api-nest/prisma/seed/photos"

step "저장소에 넣지 않은 시드 사진 → s3://$BUCKET/seed/"
for f in "$PHOTOS"/maker-*.webp; do
  [ -e "$f" ] || { echo "$PHOTOS에 maker-*.webp가 없다"; exit 1; }
  aws s3 cp "$f" "s3://$BUCKET/seed/$(basename "$f")" --content-type image/webp --only-show-errors
  echo "올림  seed/$(basename "$f")"
done
