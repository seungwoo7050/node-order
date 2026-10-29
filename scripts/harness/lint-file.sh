#!/usr/bin/env bash
# PostToolUse 훅: 방금 쓴 파일 하나를 그 파일이 속한 워크스페이스의 린터로 본다.
#   order-api-nest/src, order-api-nest/test → oxlint (npm run lint와 같은 범위)
#   order-console-next                     → eslint
# 오류나 경고가 하나라도 있으면(--max-warnings 0) exit 2와 stderr의 린터 출력을 에이전트에게
# 돌려준다(파일은 이미 쓰였다). oxlint는 이 설정에서 모든 규칙을 경고로 내므로 경고도 알린다.
# 깨끗하거나 대상이 아니면 조용히 exit 0.
set -uo pipefail

input=$(cat)
path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$input")
cwd=$(jq -r '.cwd // ""' <<<"$input")
[[ -n "$path" ]] || exit 0
[[ $path == /* ]] || path="${cwd:-$PWD}/$path"
[[ -f "$path" ]] || exit 0

dir=$(cd "$(dirname "$path")" && pwd -P)
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
root=$(cd "$root" && pwd -P)
rel="${dir#"$root"/}/$(basename "$path")"
bin="$root/node_modules/.bin"

case $rel in
  order-api-nest/src/*.ts | order-api-nest/test/*.ts | order-api-nest/src/*.js | order-api-nest/test/*.js)
    ws=order-api-nest; linter=oxlint ;;
  order-console-next/*.ts | order-console-next/*.tsx | order-console-next/*.js | order-console-next/*.jsx | order-console-next/*.mjs)
    ws=order-console-next; linter=eslint ;;
  *) exit 0 ;;
esac
[[ -x "$bin/$linter" ]] || exit 0

out=$(cd "$root/$ws" && "$bin/$linter" --max-warnings 0 "${rel#"$ws"/}" 2>&1)
status=$?
if ((status != 0)); then
  {
    echo "${linter}가 ${rel} 에서 린트 오류·경고를 찾았다. 고친 뒤 이어 가라."
    echo "$out" | tail -n 40
  } >&2
  exit 2
fi
exit 0
