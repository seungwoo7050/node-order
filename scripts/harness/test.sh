#!/usr/bin/env bash
# scripts/harness/*.test.sh를 모두 돌린다. 하나라도 실패하면 exit 1.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
command -v jq >/dev/null || { echo "jq가 없다. 하네스 훅과 테스트는 jq로 입력을 읽는다" >&2; exit 1; }
status=0
for t in "$here"/*.test.sh; do
  echo "## $(basename "$t")"
  bash "$t" || status=1
done
exit $status
