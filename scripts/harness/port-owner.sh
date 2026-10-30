#!/usr/bin/env bash
# 포트 점유 검사. with-api.sh가 source해서 쓰고, port-owner.test.sh가 막을 예·통과할 예를 검사한다.
#   check_owner <포트> <저장소 루트>
# 포트를 LISTEN 중인 프로세스의 cwd가 이 저장소(git 루트가 같음)가 아니면 이유를 찍고 1을 돌려준다.
# 비어 있거나, lsof가 없거나, cwd를 알 수 없으면 0(건너뜀).
# Playwright는 3000의 서버를, with-api.sh는 4000의 API를 다시 쓰므로 다른 체크아웃(worktree)의
# 서버를 쓰면 이 코드가 아닌 것을 검사하게 된다.
check_owner() {
  local port=$1 root=$2 owner dir
  command -v lsof >/dev/null || return 0
  owner=$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1)
  [[ -n $owner ]] || return 0
  dir=$(lsof -a -p "$owner" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  [[ -n $dir ]] || return 0
  # worktree가 원본 체크아웃 아래에 있을 수 있어 경로 접두어가 아니라 git 루트로 비교한다
  if [[ $(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) != "$root" ]]; then
    echo "with-api: $port 포트에 다른 체크아웃의 서버가 있다(pid $owner, $dir). 그 서버를 내리고 다시 돌려라." >&2
    return 1
  fi
}
