#!/usr/bin/env bash
# PreToolUse 훅: 도구를 쓰기 전에 막아야 할 입력을 거른다.
# 입력: Claude Code가 stdin으로 주는 JSON(tool_name, tool_input, cwd).
# 막으면 exit 2와 stderr의 이유를 에이전트에게 돌려준다. 통과면 exit 0.
set -uo pipefail

input=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$input")
cwd=$(jq -r '.cwd // ""' <<<"$input")
[[ -n "$cwd" && -d "$cwd" ]] || cwd=$PWD
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-$cwd}")

deny() {
  echo "하네스 가드가 막았다: $1" >&2
  exit 2
}

# 경로를 절대 경로로 바꾸고 ., .., 겹친 /를 글자 단위로 정리한다(파일이 없어도 된다).
normalize() {
  local p=$1 base=$2 part out=()
  [[ $p == /* ]] || p="$base/$p"
  IFS=/ read -ra parts <<<"$p"
  for part in "${parts[@]}"; do
    case $part in
      "" | .) ;;
      ..) ((${#out[@]})) && unset 'out[${#out[@]}-1]' ;;
      *) out+=("$part") ;;
    esac
  done
  local joined
  joined=$(IFS=/; echo "${out[*]}")
  echo "/$joined"
}

is_env_file() {
  local name
  name=$(basename "$1")
  [[ $name == .env || $name == .env.* ]] && [[ $name != *.example ]]
}

check_file_edit() {
  local path=$1
  [[ -n "$path" ]] || return 0
  local abs
  abs=$(normalize "$path" "$cwd")
  if is_env_file "$abs"; then
    deny "$path 는 환경 값 파일이다. 키와 비밀번호가 있어 에이전트가 고치지 않는다. 새 값이 필요하면 .env.example에 이름만 더하고 사람에게 알려라."
  fi
  if [[ $abs == */prisma/migrations/* && -e $abs ]]; then
    deny "$path 는 이미 있는 마이그레이션이다. 적용된 마이그레이션을 고치면 DB마다 상태가 갈라진다. 바꿀 내용은 새 마이그레이션(prisma migrate dev --create-only)으로 만들어라."
  fi
}

# rm -r 의 대상이 저장소 밖이거나 루트(/, 저장소 루트)면 막는다.
check_rm() {
  local -a words=("$@")
  local i=0 recursive=0 arg
  # sudo, command 같은 앞말을 건너뛴다
  while ((i < ${#words[@]})) && [[ ${words[i]} == sudo || ${words[i]} == command || ${words[i]} == builtin ]]; do ((i++)); done
  [[ ${words[i]:-} == rm || ${words[i]:-} == */rm ]] || return 0
  local -a targets=()
  for arg in "${words[@]:i+1}"; do
    case $arg in
      --recursive) recursive=1 ;;
      --*) ;;
      -*) [[ $arg == *[rR]* ]] && recursive=1 ;;
      *) targets+=("$arg") ;;
    esac
  done
  ((recursive)) || return 0
  local t abs
  for t in "${targets[@]}"; do
    t=${t#[\"\']}; t=${t%[\"\']}
    t=${t/#\~/$HOME}; t=${t/#\$HOME/$HOME}; t=${t/#\$\{HOME\}/$HOME}
    if [[ $t == *'$'* || $t == *'`'* ]]; then
      deny "rm -r 대상 '$t' 에 펼치지 않은 변수가 있다. 지울 경로를 글자 그대로 써라."
    fi
    # 끝의 glob(*)은 그 부모 디렉터리를 지우는 것으로 본다
    while [[ $t == *'*' ]]; do t=${t%\*}; t=${t%/}; [[ -n $t ]] || t=/; done
    abs=$(normalize "$t" "$cwd")
    if [[ $abs == / || $abs == "$root" ]]; then
      deny "rm -r 로 $abs 를 지우려 한다. 루트와 저장소 루트는 지우지 않는다."
    fi
    if [[ $abs != "$root"/* ]]; then
      deny "rm -r 대상 $abs 가 저장소($root) 밖이다. 저장소 안의 파일만 지운다."
    fi
  done
}

check_bash() {
  local cmd=$1
  local sp='[[:space:]]'
  # git push (git -C <dir> push, git -c k=v push, 명령 중간의 git push 포함)
  if [[ $cmd =~ (^|[\;\&\|\(\`]|$sp)git(${sp}+(-C|-c)${sp}+[^[:space:]]+|${sp}+--[a-z-]+(=[^[:space:]]+)?)*${sp}+push($sp|$) ]]; then
    deny "git push는 사람이 한다. 로컬 커밋까지만 하고 보고하라."
  fi
  # 셸 리디렉션이나 tee, sed -i 로 .env 파일 쓰기
  if [[ $cmd =~ ([>]|tee${sp}+(-a${sp}+)?|sed${sp}+-i[^;\&\|]*${sp})${sp}*[\"\']?([^[:space:]\"\'\;\&\|]*/)?\.env(\.[A-Za-z0-9_.-]+)?([\"\'[:space:]\;\&\|]|$) ]]; then
    local hit=${BASH_REMATCH[0]}
    [[ $hit == *.example* ]] || deny "명령이 .env 파일을 쓰려 한다. 환경 값 파일은 에이전트가 고치지 않는다."
  fi
  # 명령을 ; && || | 로 나눠 rm -r 을 하나씩 본다
  local nl=$'\n' split=$cmd seg
  for sep in '&&' '||' ';' '|' '(' ')' '&'; do split=${split//"$sep"/$nl}; done
  while IFS= read -r seg; do
    local -a words=()
    read -ra words <<<"$seg"
    ((${#words[@]})) && check_rm "${words[@]}"
  done <<<"$split"
  return 0
}

case $tool in
  Edit | Write | MultiEdit)
    check_file_edit "$(jq -r '.tool_input.file_path // ""' <<<"$input")" ;;
  NotebookEdit)
    check_file_edit "$(jq -r '.tool_input.notebook_path // ""' <<<"$input")" ;;
  Bash)
    check_bash "$(jq -r '.tool_input.command // ""' <<<"$input")" ;;
esac
exit 0
