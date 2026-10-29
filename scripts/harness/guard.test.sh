#!/usr/bin/env bash
# guard.sh 테스트: 막아야 할 입력은 exit 2, 통과해야 할 입력은 exit 0인지 본다.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
guard="$here/guard.sh"
fail=0

# expect <기대 exit> <설명> <tool_name> <tool_input JSON> [cwd]
expect() {
  local want=$1 desc=$2 tool=$3 tin=$4 cwd=${5:-$root} got
  jq -n --arg t "$tool" --argjson i "$tin" --arg c "$cwd" '{tool_name:$t, tool_input:$i, cwd:$c}' \
    | "$guard" >/dev/null 2>&1
  got=$?
  if [[ $got == "$want" ]]; then echo "ok   $desc"; else echo "FAIL $desc (기대 $want, 실제 $got)"; fail=1; fi
}
file() { jq -n --arg p "$1" '{file_path:$p}'; }
cmd() { jq -n --arg c "$1" '{command:$c}'; }

mig="$root/order-api-nest/prisma/migrations"
existing=$(find "$mig" -name migration.sql | sort | head -1)

echo "# .env 편집 차단"
expect 2 "Edit .env"                    Edit  "$(file "$root/order-api-nest/.env")"
expect 2 "Write .env.local"             Write "$(file "$root/order-console-next/.env.local")"
expect 2 "MultiEdit 상대 경로 .env"     MultiEdit "$(file order-api-nest/.env)"
expect 2 "Bash 리디렉션으로 .env 쓰기"  Bash  "$(cmd 'echo X=1 >> order-api-nest/.env')"
expect 2 "Bash sed -i 로 .env 고치기"   Bash  "$(cmd "sed -i '' 's/a/b/' .env.local")"
expect 0 ".env.example 편집 허용"       Edit  "$(file "$root/order-api-nest/.env.example")"
expect 0 "Bash로 .env 읽기 허용"        Bash  "$(cmd 'grep PORT order-api-nest/.env')"

echo "# git push 차단"
expect 2 "git push"                     Bash "$(cmd 'git push origin main')"
expect 2 "git -C 경로 push"             Bash "$(cmd 'git -C /tmp/x push')"
expect 2 "명령 중간의 git push"         Bash "$(cmd 'git commit -m x && git push')"
expect 2 "git push --force"             Bash "$(cmd 'git push --force-with-lease')"
expect 0 "커밋 메시지 속 push 허용"     Bash "$(cmd 'git commit -m "push 버튼 고치기"')"
expect 0 "git log --grep push 허용"     Bash "$(cmd 'git log --grep push')"
expect 0 "git status 허용"              Bash "$(cmd 'git status')"

echo "# rm -rf 차단"
expect 2 "rm -rf /"                     Bash "$(cmd 'rm -rf /')"
expect 2 "rm -rf ~"                     Bash "$(cmd 'rm -rf ~')"
expect 2 "rm -rf 저장소 루트(.)"        Bash "$(cmd 'rm -rf .')"
expect 2 "rm -rf * (저장소 루트)"       Bash "$(cmd 'rm -rf *')"
expect 2 "rm -rf 저장소 밖 절대 경로"   Bash "$(cmd 'rm -rf /usr/local/lib')"
expect 2 "rm -rf ../ 로 밖으로"         Bash "$(cmd 'rm -rf ../other')"
expect 2 "rm -fr 하위에서 ../.."        Bash "$(cmd 'rm -fr ../..')" "$root/order-api-nest"
expect 2 "rm -rf 펼치지 않은 변수"      Bash "$(cmd 'rm -rf "$DIR"/')"
expect 2 "cd 뒤 rm -rf /"               Bash "$(cmd 'cd x && rm -rf /')"
expect 0 "rm -rf 저장소 안 빌드 출력"   Bash "$(cmd 'rm -rf order-console-next/.next dist')"
expect 0 "rm -rf node_modules/*"        Bash "$(cmd 'rm -rf node_modules/*')"
expect 0 "rm (재귀 아님) 밖 파일"       Bash "$(cmd 'rm /tmp/a.txt')"

echo "# 마이그레이션"
expect 0 "새 마이그레이션 생성 허용"    Write "$(file "$mig/9999_new_thing/migration.sql")"
expect 2 "기존 마이그레이션 Write 차단" Write "$(file "$existing")"
expect 2 "기존 마이그레이션 Edit 차단"  Edit  "$(file "$existing")"
expect 2 "migration_lock.toml 차단"     Edit  "$(file "$mig/migration_lock.toml")"

echo "# 일반 소스"
expect 0 "소스 Edit 허용"               Edit  "$(file "$root/order-api-nest/src/main.ts")"
expect 0 "새 소스 Write 허용"           Write "$(file "$root/order-console-next/app/new-page.tsx")"
expect 0 "schema.prisma 편집 허용"      Edit  "$(file "$root/order-api-nest/prisma/schema.prisma")"
expect 0 "Read는 거르지 않음"           Read  "$(file "$root/order-api-nest/.env")"

exit $fail
