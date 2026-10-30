#!/usr/bin/env bash
# port-owner.sh 테스트: 다른 체크아웃의 서버가 쥔 포트는 막고(1), 비었거나 이 저장소의 서버면 통과(0)인지 본다.
# 임시 포트에 node 서버를 띄워 cwd만 바꿔 가며 check_owner를 부른다(3000·4000은 건드리지 않는다).
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd -P)
# shellcheck source=port-owner.sh
source "$here/port-owner.sh"
tmp=$(cd "$(mktemp -d)" && pwd -P) # macOS의 /var → /private/var를 풀어 lsof·git이 내는 경로와 맞춘다
pids=()
trap '{ kill "${pids[@]}"; wait; } 2>/dev/null; rm -rf "$tmp"' EXIT
fail=0

if ! command -v lsof >/dev/null; then
  echo "ok   lsof가 없어 포트 검사를 건너뛴다(check_owner는 0)"
  exit 0
fi

# listen <cwd> → 그 디렉터리에서 빈 포트를 잡은 서버를 띄우고 $port에 포트를 둔다
listen() {
  local file="$tmp/port.${#pids[@]}"
  (cd "$1" && exec node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>require("fs").writeFileSync(process.argv[1],String(s.address().port)))' "$file") &
  last=$!
  pids+=("$last")
  for _ in $(seq 1 50); do [[ -s $file ]] && break; sleep 0.1; done
  port=$(cat "$file")
}

# expect <기대 exit> <설명> <포트> <저장소 루트>
expect() {
  local want=$1 desc=$2 got msg
  msg=$(check_owner "$3" "$4" 2>&1)
  got=$?
  if [[ $got == "$want" ]] && { [[ $want == 0 ]] || [[ $msg == *"다른 체크아웃의 서버"* ]]; }; then
    echo "ok   $desc"
  else
    echo "FAIL $desc (기대 $want, 실제 $got, 출력 $msg)"
    fail=1
  fi
}

mkdir -p "$tmp/other" "$tmp/plain" "$tmp/outer/inner"
git -C "$tmp/other" init -q
git -C "$tmp/outer" init -q
git -C "$tmp/outer/inner" init -q # 원본 체크아웃 아래에 만든 worktree와 같은 모양

echo "# 통과"
listen "$tmp/plain"; free=$port; kill "$last"; wait "$last" 2>/dev/null
expect 0 "아무도 쥐지 않은 포트"                     "$free" "$root"
listen "$root/order-api-nest"
expect 0 "이 저장소(하위 디렉터리 포함)에서 띄운 서버" "$port" "$root"

echo "# 막음"
listen "$tmp/other"
expect 1 "다른 git 저장소에서 띄운 서버"              "$port" "$root"
listen "$tmp/plain"
expect 1 "git 저장소가 아닌 곳에서 띄운 서버"         "$port" "$root"
listen "$tmp/outer"
expect 1 "worktree에서 볼 때 바깥 원본 체크아웃의 서버" "$port" "$tmp/outer/inner"
listen "$tmp/outer/inner"
expect 1 "원본에서 볼 때 안쪽 worktree의 서버(경로 접두어가 같아도)" "$port" "$tmp/outer"

exit $fail
