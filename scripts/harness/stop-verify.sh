#!/usr/bin/env bash
# Stop·SubagentStop 훅: 에이전트가 끝내기 전에 `npm run verify:fast`를 강제한다.
#   - 통과하면 끝내게 둔다. 마지막으로 통과한 작업 트리 상태(지문)와 같으면 다시 돌리지 않는다.
#   - 실패하면 {"decision":"block","reason":<실패 요약>}으로 끝내기를 막고 요약을 에이전트에게 준다.
#   - 같은 세션에서 연달아 HARNESS_STOP_MAX_BLOCKS(기본 3)번 막았으면 더 막지 않고 사람에게 넘긴다
#     (고칠 수 없는 실패로 끝없이 도는 것을 막는 안전판).
# 테스트용 환경 변수: HARNESS_VERIFY_CMD(검사 명령), HARNESS_STATE_DIR(상태 저장 위치).
set -uo pipefail

input=$(cat)
cwd=$(jq -r '.cwd // ""' <<<"$input")
session=$(jq -r '.session_id // "none"' <<<"$input")
[[ -n "$cwd" && -d "$cwd" ]] || cwd=${CLAUDE_PROJECT_DIR:-$PWD}
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
[[ -f "$root/scripts/harness/verify.sh" ]] || exit 0

state=${HARNESS_STATE_DIR:-${TMPDIR:-/tmp}/node-order-harness}
mkdir -p "$state"
key=$(printf '%s' "$root" | shasum | cut -c1-12)
pass_file="$state/$key.pass"
block_file="$state/$key.${session//[^A-Za-z0-9_-]/}.blocks"
max=${HARNESS_STOP_MAX_BLOCKS:-3}

# 작업 트리 지문: HEAD + 바뀐 파일 목록 + 추적 파일 diff + 추적하지 않는 파일 내용
fingerprint() {
  (
    cd "$root" || exit 1
    git rev-parse HEAD 2>/dev/null
    git status --porcelain
    git diff HEAD 2>/dev/null
    git ls-files -o --exclude-standard -z | xargs -0 shasum 2>/dev/null
  ) | shasum | cut -d' ' -f1
}

fp=$(fingerprint)
if [[ -f "$pass_file" && $(cat "$pass_file") == "$fp" ]]; then
  rm -f "$block_file"
  exit 0
fi

out=$(cd "$root" && ${HARNESS_VERIFY_CMD:-npm run verify:fast} 2>&1)
status=$?

if ((status == 0)); then
  echo "$fp" >"$pass_file"
  rm -f "$block_file"
  exit 0
fi

blocks=$(($(cat "$block_file" 2>/dev/null || echo 0) + 1))
if ((blocks > max)); then
  rm -f "$block_file"
  echo "verify:fast가 ${max}번 연달아 실패해 더 막지 않는다. 실패를 사람에게 보고하라." >&2
  exit 0
fi
echo "$blocks" >"$block_file"

# 요약: npm 머리글과 통과한 단계 줄을 빼고 뒤에서 60줄
summary=$(grep -vE '^(> |▶ |  ✓ |$)' <<<"$out" | tail -n 60)
reason="npm run verify:fast가 실패해 아직 끝낼 수 없다(${blocks}/${max}). 아래 실패를 고치고 다시 끝내라. 전체 로그는 .harness/logs/에 있다.
$summary"
jq -n --arg r "$reason" '{decision:"block", reason:$r}'
exit 0
