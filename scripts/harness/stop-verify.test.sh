#!/usr/bin/env bash
# stop-verify.sh 테스트: 검사 명령을 가짜(HARNESS_VERIFY_CMD)로 바꿔 판정만 본다.
# 진짜 verify:fast를 부르면 이 테스트가 다시 자신을 부르게 되므로 쓰지 않는다.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
hook="$here/stop-verify.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0

cat >"$tmp/fail.sh" <<'EOF'
#!/usr/bin/env bash
echo x >>"$(dirname "$0")/calls"
echo "> verify:fast"
echo "▶ lint"
echo "  ✗ lint (3s) - 로그: .harness/logs/lint.log"
echo "    src/a.ts:1:1: warning eslint(no-debugger)"
echo "verify(fast): lint ✗ typecheck ✓"
echo "실패: lint"
exit 1
EOF
cat >"$tmp/pass.sh" <<'EOF'
#!/usr/bin/env bash
echo x >>"$(dirname "$0")/calls"
echo "verify(fast): lint ✓"
EOF
chmod +x "$tmp"/*.sh

ok() { echo "ok   $1"; }
no() { echo "FAIL $1"; fail=1; }

# stop <상태 디렉터리> <검사 명령> [cwd] → stdout을 $out, exit를 $code에
stop() {
  out=$(jq -n --arg c "${3:-$root}" '{session_id:"t1", stop_hook_active:false, cwd:$c}' \
    | HARNESS_STATE_DIR=$1 HARNESS_VERIFY_CMD=$2 HARNESS_STOP_MAX_BLOCKS=3 "$hook" 2>/dev/null)
  code=$?
}
calls() { if [[ -f $1/calls ]]; then wc -l <"$1/calls" | tr -d ' '; else echo 0; fi; }

# 1. 실패하면 끝내기를 막고 요약을 돌려준다
s="$tmp/s1"; mkdir -p "$s"; cp "$tmp"/*.sh "$s"/
stop "$s" "$s/fail.sh"
if [[ $code == 0 && $(jq -r .decision <<<"$out" 2>/dev/null) == block ]]; then ok "실패하면 decision=block"; else no "실패하면 decision=block (exit $code, 출력 $out)"; fi
reason=$(jq -r .reason <<<"$out" 2>/dev/null)
if [[ $reason == *"lint ✗"* && $reason == *"no-debugger"* && $reason != *"▶ lint"* ]]; then ok "reason에 실패 요약이 있다"; else no "reason에 실패 요약이 있다: $reason"; fi

# 2. 통과하면 막지 않는다
s="$tmp/s2"; mkdir -p "$s"; cp "$tmp"/*.sh "$s"/
stop "$s" "$s/pass.sh"
if [[ $code == 0 && -z $out ]]; then ok "통과하면 끝내게 둔다"; else no "통과하면 끝내게 둔다 (exit $code, 출력 $out)"; fi

# 3. 작업 트리가 그대로면 다시 검사하지 않는다
stop "$s" "$s/pass.sh"
if [[ $(calls "$s") == 1 && -z $out ]]; then ok "같은 지문이면 검사를 건너뛴다"; else no "같은 지문이면 검사를 건너뛴다 (호출 $(calls "$s")번)"; fi

# 4. 연달아 3번 막은 뒤에는 사람에게 넘긴다
s="$tmp/s4"; mkdir -p "$s"; cp "$tmp"/*.sh "$s"/
blocked=0
for _ in 1 2 3; do stop "$s" "$s/fail.sh"; [[ $(jq -r .decision <<<"$out" 2>/dev/null) == block ]] && ((blocked++)); done
stop "$s" "$s/fail.sh"
if [[ $blocked == 3 && $code == 0 && -z $out ]]; then ok "3번 막은 뒤 4번째는 넘긴다"; else no "3번 막은 뒤 4번째는 넘긴다 (막음 $blocked, 마지막 출력 $out)"; fi

# 5. 실패 뒤 고쳐서 통과하면 막은 횟수를 지운다
s="$tmp/s5"; mkdir -p "$s"; cp "$tmp"/*.sh "$s"/
stop "$s" "$s/fail.sh"; stop "$s" "$s/fail.sh"; stop "$s" "$s/pass.sh"
if ! ls "$s"/*.blocks >/dev/null 2>&1; then ok "통과하면 막은 횟수를 지운다"; else no "통과하면 막은 횟수를 지운다"; fi

# 6. 이 저장소가 아니면 아무것도 하지 않는다
s="$tmp/s6"; mkdir -p "$s/notrepo"; cp "$tmp"/*.sh "$s"/
stop "$s" "$s/fail.sh" "$s/notrepo"
if [[ $code == 0 && -z $out && $(calls "$s") == 0 ]]; then ok "저장소 밖이면 건너뛴다"; else no "저장소 밖이면 건너뛴다 (출력 $out)"; fi

exit $fail
