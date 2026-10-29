#!/usr/bin/env bash
# lint-file.sh 테스트: 린트 오류가 있는 파일은 exit 2와 stderr의 오류, 깨끗한 파일은 exit 0.
# 워크스페이스 설정을 그대로 쓰려고 탐침 파일을 워크스페이스 안에 잠깐 만들고 지운다.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
hook="$here/lint-file.sh"
fail=0
probes=()
trap 'rm -f "${probes[@]}"' EXIT

probe() { # probe <경로> <내용>
  printf '%s\n' "$2" >"$root/$1"
  probes+=("$root/$1")
}

# expect <기대 exit> <설명> <경로> [stderr에 있어야 할 글자]
expect() {
  local want=$1 desc=$2 path=$3 needle=${4:-} err got
  err=$(jq -n --arg p "$path" --arg c "$root" '{tool_name:"Write", tool_input:{file_path:$p}, cwd:$c}' | "$hook" 2>&1 >/dev/null)
  got=$?
  if [[ $got != "$want" ]]; then
    echo "FAIL $desc (기대 $want, 실제 $got)"; fail=1
  elif [[ -n $needle && $err != *"$needle"* ]]; then
    echo "FAIL $desc (stderr에 '$needle' 없음)"; echo "$err" | sed 's/^/     /'; fail=1
  else
    echo "ok   $desc"
  fi
}

id=$$
probe "order-api-nest/src/harness-probe-bad-$id.ts" $'export function f(x: number) {\n  debugger;\n  return x;\n}'
probe "order-api-nest/src/harness-probe-ok-$id.ts" $'export function f(x: number) {\n  return x + 1;\n}'
probe "order-console-next/harness-probe-bad-$id.tsx" $'import { useState } from "react";\n\nexport function Probe({ on }: { on: boolean }) {\n  if (on) {\n    useState(0);\n  }\n  return null;\n}'
probe "order-console-next/harness-probe-ok-$id.tsx" $'export function Probe() {\n  return null;\n}'
probe "harness-probe-$id.ts" $'debugger;'

expect 2 "api: oxlint 오류를 돌려준다"         "$root/order-api-nest/src/harness-probe-bad-$id.ts" "no-debugger"
expect 0 "api: 깨끗한 파일은 조용히 통과"      "$root/order-api-nest/src/harness-probe-ok-$id.ts"
expect 2 "console: eslint 오류를 돌려준다"     "$root/order-console-next/harness-probe-bad-$id.tsx" "rules-of-hooks"
expect 0 "console: 깨끗한 파일은 조용히 통과"  "$root/order-console-next/harness-probe-ok-$id.tsx"
expect 2 "상대 경로도 cwd 기준으로 찾는다"     "order-api-nest/src/harness-probe-bad-$id.ts" "no-debugger"
expect 0 "워크스페이스 밖 파일은 건너뛴다"     "$root/harness-probe-$id.ts"
expect 0 "없는 파일은 건너뛴다"                "$root/order-api-nest/src/nope-$id.ts"
expect 0 "린트 대상이 아닌 파일은 건너뛴다"    "$root/README.md"

exit $fail
