#!/usr/bin/env bash
# design-guard.test.sh: design-guard.sh 검증 테스트
# 막아야 할 입력은 exit 1, 정상 입력은 exit 0인지 확인한다.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
guard="$here/design-guard.sh"
fail=0

tmpdir=$(mktemp -d "/tmp/design-guard-test-XXXXXX")
trap 'rm -rf "$tmpdir"' EXIT

expect() {
  local want=$1 desc=$2 dir=$3 got
  "$guard" "$dir" >/dev/null 2>&1
  got=$?
  if [[ $got -eq "$want" ]]; then
    echo "ok   $desc"
  else
    echo "FAIL $desc (기대: $want, 실제: $got)"
    fail=1
  fi
}

echo "# 1. 현재 코드베이스 검사"
expect 0 "현재 저장소 order-console-next 통과" "$here/../../order-console-next"

echo "# 2. AI 슬롭 클래스 차단 검사"
# Dummy clean structure
mkdir -p "$tmpdir/test-slop/app" "$tmpdir/test-slop/designs" "$tmpdir/test-slop/lib"
echo '<div className="rounded p-4">clean</div>' > "$tmpdir/test-slop/app/page.tsx"
expect 0 "슬롭 없는 정상 마크업 통과" "$tmpdir/test-slop"

for slop in "bg-gradient-to-r" "from-purple-500" "from-indigo-600" "shadow-xl" "shadow-2xl" "rounded-2xl" "rounded-3xl"; do
  echo "<div className=\"$slop\">slop</div>" > "$tmpdir/test-slop/app/page.tsx"
  expect 1 "슬롭 클래스 ($slop) 감지 및 차단" "$tmpdir/test-slop"
done

echo "# 3. 'Brown Store' 하드코딩 재유입 차단 검사"
mkdir -p "$tmpdir/test-brown/app" "$tmpdir/test-brown/designs" "$tmpdir/test-brown/lib"
echo '<h1>Store Title</h1>' > "$tmpdir/test-brown/app/page.tsx"
expect 0 "상점명 하드코딩 없는 파일 통과" "$tmpdir/test-brown"

echo '<h1>Brown Store.</h1>' > "$tmpdir/test-brown/app/page.tsx"
expect 1 "'Brown Store.' 하드코딩 감지 및 차단" "$tmpdir/test-brown"

echo 'const name = "Brown Store";' > "$tmpdir/test-brown/lib/name.ts"
expect 1 "'Brown Store' 문자열 감지 및 차단" "$tmpdir/test-brown"

echo "# 4. 렌더러 교차 import 차단 검사"
mkdir -p "$tmpdir/test-cross/designs/muji-hara" "$tmpdir/test-cross/designs/editorial-atelier" "$tmpdir/test-cross/designs/zavanas-archive"
mkdir -p "$tmpdir/test-cross/app" "$tmpdir/test-cross/lib"

echo 'export const a = 1;' > "$tmpdir/test-cross/designs/muji-hara/catalog.tsx"
echo 'export const b = 2;' > "$tmpdir/test-cross/designs/editorial-atelier/catalog.tsx"
echo 'export const c = 3;' > "$tmpdir/test-cross/designs/zavanas-archive/catalog.tsx"
expect 0 "교차 import 없는 렌더러 통과" "$tmpdir/test-cross"

echo 'import { b } from "../editorial-atelier/catalog";' > "$tmpdir/test-cross/designs/muji-hara/catalog.tsx"
expect 1 "muji-hara -> editorial-atelier 교차 import 차단" "$tmpdir/test-cross"

echo 'import { a } from "../muji-hara/catalog";' > "$tmpdir/test-cross/designs/editorial-atelier/catalog.tsx"
expect 1 "editorial-atelier -> muji-hara 교차 import 차단" "$tmpdir/test-cross"

echo 'import { a } from "../muji-hara/catalog";' > "$tmpdir/test-cross/designs/zavanas-archive/catalog.tsx"
expect 1 "zavanas-archive -> muji-hara 교차 import 차단" "$tmpdir/test-cross"

exit $fail
