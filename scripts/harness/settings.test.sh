#!/usr/bin/env bash
# .claude/settings.json의 훅 명령이 실제로 하네스 스크립트를 부르는지 본다.
# Claude Code처럼 명령 문자열을 sh -c로 저장소 하위 디렉터리에서 돌린다.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
settings="$root/.claude/settings.json"
fail=0

hook_cmd() { jq -r --arg e "$1" '.hooks[$e][0].hooks[0].command' "$settings"; }

# expect <기대 exit> <설명> <이벤트> <stdin JSON>
expect() {
  local want=$1 desc=$2 cmd got
  cmd=$(hook_cmd "$3")
  (cd "$root/order-api-nest" && printf '%s' "$4" | sh -c "$cmd" >/dev/null 2>&1)
  got=$?
  if [[ $got == "$want" ]]; then echo "ok   $desc"; else echo "FAIL $desc (기대 $want, 실제 $got)"; fail=1; fi
}

jq -e '.hooks.PreToolUse and .hooks.PostToolUse and .hooks.Stop' "$settings" >/dev/null \
  && echo "ok   PreToolUse·PostToolUse·Stop 훅이 있다" || { echo "FAIL 훅 설정이 빠졌다"; fail=1; }

push=$(jq -n --arg c "$root" '{tool_name:"Bash", tool_input:{command:"git push"}, cwd:$c}')
edit=$(jq -n --arg c "$root" --arg p "$root/README.md" '{tool_name:"Edit", tool_input:{file_path:$p}, cwd:$c}')
expect 2 "PreToolUse 명령이 guard.sh로 git push를 막는다" PreToolUse "$push"
expect 0 "PreToolUse 명령이 일반 편집을 통과시킨다"       PreToolUse "$edit"
expect 0 "PostToolUse 명령이 lint-file.sh를 부른다"        PostToolUse "$edit"

exit $fail
