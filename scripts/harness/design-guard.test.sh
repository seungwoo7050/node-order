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

echo "# 5. 인라인 스타일(style={{) 차단 검사"
mkdir -p "$tmpdir/test-style/designs" "$tmpdir/test-style/app"
echo 'export function A() { return <div className="test">clean</div>; }' > "$tmpdir/test-style/designs/comp.tsx"
expect 0 "인라인 스타일 없는 컴포넌트 통과" "$tmpdir/test-style"

echo 'export function B() { return <div style={{ color: "red" }}>bad</div>; }' > "$tmpdir/test-style/designs/comp.tsx"
expect 1 "인라인 스타일(style={{) 감지 및 차단" "$tmpdir/test-style"

echo "# 6. 디자인 폴더 className=\"...\" 리터럴 차단 검사"
mkdir -p "$tmpdir/test-classname/designs/muji-hara"
echo 'export function Clean() { return <div className={styles.card}>ok</div>; }' > "$tmpdir/test-classname/designs/muji-hara/catalog.tsx"
expect 0 "CSS Modules 객체 바인딩 통과" "$tmpdir/test-classname"

echo 'export function Bad() { return <div className="card-box">bad</div>; }' > "$tmpdir/test-classname/designs/muji-hara/catalog.tsx"
expect 1 "디자인 폴더 className 문자열 리터럴 차단" "$tmpdir/test-classname"

echo "# 7. 가짜 메타 문구 차단 검사"
mkdir -p "$tmpdir/test-meta/designs/muji-hara"
echo 'export const label = "무지 카탈로그";' > "$tmpdir/test-meta/designs/muji-hara/catalog.tsx"
expect 0 "정상 한국어 UI 라벨 통과" "$tmpdir/test-meta"

for meta in "SYS.36" "ARCH-01" "DATASHEET" "TELEMETRY" "標本" "EDITION 01 //" "[SYSTEM]" "PROTOCOL"; do
  echo "export const label = '$meta';" > "$tmpdir/test-meta/designs/muji-hara/catalog.tsx"
  expect 1 "가짜 메타 문구 ($meta) 감지 및 차단" "$tmpdir/test-meta"
done

echo "# 8. next.config.ts module.css 설정 검사"
mkdir -p "$tmpdir/test-nextcfg"
cat << 'EOF' > "$tmpdir/test-nextcfg/next.config.ts"
export default {
  turbopack: {
    rules: {
      "*.css": {
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};
EOF
expect 0 "module.css 제외가 올바르게 된 next.config.ts 통과" "$tmpdir/test-nextcfg"

cat << 'EOF' > "$tmpdir/test-nextcfg/next.config.ts"
export default {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};
EOF
expect 1 "module.css 제외 없는 @tailwindcss/turbopack 설정 차단" "$tmpdir/test-nextcfg"

echo "# 9. 11px 미만 font-size 차단 검사"
mkdir -p "$tmpdir/test-fontsize/designs/editorial-atelier"
echo '.clean { font-size: 11px; } .large { font-size: 14px; }' > "$tmpdir/test-fontsize/designs/editorial-atelier/style.module.css"
expect 0 "11px 이상 font-size 통과" "$tmpdir/test-fontsize"

echo '.tiny { font-size: 10px; }' > "$tmpdir/test-fontsize/designs/editorial-atelier/style.module.css"
expect 1 "10px font-size 차단" "$tmpdir/test-fontsize"

echo '.tiny { font-size: 9px; }' > "$tmpdir/test-fontsize/designs/editorial-atelier/style.module.css"
expect 1 "9px font-size 차단" "$tmpdir/test-fontsize"

echo "# 10. 4px 그리드 밖 간격 차단 검사"
mkdir -p "$tmpdir/test-spacing/designs/zavanas-archive"
echo '.box { margin: 12px; padding: 16px; border: 1px solid #000; top: 2px; }' > "$tmpdir/test-spacing/designs/zavanas-archive/style.module.css"
expect 0 "4px 배수 및 1px/2px 헤어라인 통과" "$tmpdir/test-spacing"

echo '.box { margin: 13px; }' > "$tmpdir/test-spacing/designs/zavanas-archive/style.module.css"
expect 1 "margin: 13px 비4px 간격 차단" "$tmpdir/test-spacing"

echo '.box { padding: 15px; }' > "$tmpdir/test-spacing/designs/zavanas-archive/style.module.css"
expect 1 "padding: 15px 비4px 간격 차단" "$tmpdir/test-spacing"

echo '.box { gap: 7px; }' > "$tmpdir/test-spacing/designs/zavanas-archive/style.module.css"
expect 1 "gap: 7px 비4px 간격 차단" "$tmpdir/test-spacing"

exit $fail
