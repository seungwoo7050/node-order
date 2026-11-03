#!/usr/bin/env bash
# design-guard.sh: 스토어프론트 디자인 무결성 검사
# 1. AI 슬롭 스타일 클래스 차단 (bg-gradient-to-, from-purple-, from-indigo-, shadow-xl, shadow-2xl, rounded-2xl, rounded-3xl)
# 2. "Brown Store" 하드코딩 재유입 차단
# 3. 3대 디자인 렌더러 폴더 간 교차 import 차단
# 4. 인라인 스타일(style={{) 차단
# 5. 디자인 폴더 3곳에서 className=" 리터럴 차단
# 6. 가짜 메타 문구(SYS.36, ARCH- 등) 차단
# 7. next.config.ts의 @tailwindcss/turbopack 사용 시 module.css 제외 여부 검사
# 8. 11px 미만 글자 크기(9px, 10px) 차단
# 9. 4px 그리드 밖 간격 차단 (1px, 2px 헤어라인 제외)

set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
target_dir="${1:-$root/order-console-next}"

fail=0

# 1. AI 슬롭 클래스 검사
slop_patterns="bg-gradient-to-|from-purple-|from-indigo-|shadow-xl|shadow-2xl|rounded-2xl|rounded-3xl"
found_slop=$(grep -E -rn "$slop_patterns" "$target_dir/app" "$target_dir/designs" 2>/dev/null \
  | grep -v "\.next" \
  | grep -v "node_modules" \
  || true)

if [[ -n "$found_slop" ]]; then
  echo "FAIL [design-guard] AI 슬롭 스타일 클래스가 발견되었습니다:"
  echo "$found_slop"
  fail=1
fi

# 2. 상점명 하드코딩 검사
found_brown=$(grep -rn "Brown Store" "$target_dir/app" "$target_dir/designs" "$target_dir/lib" 2>/dev/null \
  | grep -v "\.next" \
  | grep -v "node_modules" \
  | grep -v "\.test\." \
  | grep -v "\.spec\." \
  || true)

if [[ -n "$found_brown" ]]; then
  echo "FAIL [design-guard] 'Brown Store' 하드코딩이 발견되었습니다:"
  echo "$found_brown"
  fail=1
fi

# 3. 디자인 렌더러 간 교차 import 검사
if [[ -d "$target_dir/designs" ]]; then
  cross_muji=$(grep -rnE 'from\s+["'"'"'].*(editorial-atelier|zavanas-archive)' "$target_dir/designs/muji-hara" 2>/dev/null || true)
  if [[ -n "$cross_muji" ]]; then
    echo "FAIL [design-guard] muji-hara에서 다른 렌더러를 교차 import했습니다:"
    echo "$cross_muji"
    fail=1
  fi

  cross_editorial=$(grep -rnE 'from\s+["'"'"'].*(muji-hara|zavanas-archive)' "$target_dir/designs/editorial-atelier" 2>/dev/null || true)
  if [[ -n "$cross_editorial" ]]; then
    echo "FAIL [design-guard] editorial-atelier에서 다른 렌더러를 교차 import했습니다:"
    echo "$cross_editorial"
    fail=1
  fi

  cross_zavanas=$(grep -rnE 'from\s+["'"'"'].*(muji-hara|editorial-atelier)' "$target_dir/designs/zavanas-archive" 2>/dev/null || true)
  if [[ -n "$cross_zavanas" ]]; then
    echo "FAIL [design-guard] zavanas-archive에서 다른 렌더러를 교차 import했습니다:"
    echo "$cross_zavanas"
    fail=1
  fi
fi

# 4. 인라인 스타일 금지
found_inline_style=$(grep -rn 'style={{' "$target_dir/designs" "$target_dir/app" 2>/dev/null \
  | grep -v "\.next" \
  | grep -v "node_modules" \
  || true)

if [[ -n "$found_inline_style" ]]; then
  echo "FAIL [design-guard] 인라인 스타일(style={{)이 발견되었습니다:"
  echo "$found_inline_style"
  fail=1
fi

# 5. 디자인 폴더 3곳에서 className=" 리터럴 차단
design_dirs=("$target_dir/designs/editorial-atelier" "$target_dir/designs/muji-hara" "$target_dir/designs/zavanas-archive")
for d in "${design_dirs[@]}"; do
  if [[ -d "$d" ]]; then
    found_classname=$(grep -rnE 'className="[^"]*"' "$d" 2>/dev/null || true)
    if [[ -n "$found_classname" ]]; then
      echo "FAIL [design-guard] 디자인 폴더에 className=\"...\" 리터럴이 발견되었습니다 ($d):"
      echo "$found_classname"
      fail=1
    fi
  fi
done

# 6. 가짜 메타 문구 금지
slop_meta_patterns='SYS\.[0-9]|ARCH-[0-9]|DATASHEET|TELEMETRY|標本|EDITION 0[0-9] //|\[SYSTEM\]|PROTOCOL'
found_meta_slop=$(grep -E -rn "$slop_meta_patterns" "$target_dir/app" "$target_dir/designs" 2>/dev/null \
  | grep -v "\.next" \
  | grep -v "node_modules" \
  || true)

if [[ -n "$found_meta_slop" ]]; then
  echo "FAIL [design-guard] 가짜 메타 슬롭 문구가 발견되었습니다:"
  echo "$found_meta_slop"
  fail=1
fi

# 7. next.config.ts의 @tailwindcss/turbopack 사용 시 module.css 제외 여부 검사
if [[ -f "$target_dir/next.config.ts" ]]; then
  if grep -q "@tailwindcss/turbopack" "$target_dir/next.config.ts" 2>/dev/null; then
    if ! grep -qE "module(\\\.)?\.?css" "$target_dir/next.config.ts" 2>/dev/null; then
      echo "FAIL [design-guard] next.config.ts에 @tailwindcss/turbopack이 적용되어 있지만 module.css 제외 규칙이 없습니다."
      fail=1
    fi
  fi
fi

# 8. 11px 미만 글자 크기(9px, 10px) 차단
for d in "${design_dirs[@]}"; do
  if [[ -d "$d" ]]; then
    found_sub11=$(grep -rnE 'font-size:\s*(9|10)px' "$d" 2>/dev/null || true)
    if [[ -n "$found_sub11" ]]; then
      echo "FAIL [design-guard] 11px 미만 font-size가 발견되었습니다 ($d):"
      echo "$found_sub11"
      fail=1
    fi
  fi
done

# 9. 4px 그리드 밖 간격 차단 (1px, 2px 헤어라인 제외)
non_4px_pattern='(margin|padding|gap|inset|top|left|right|bottom|height)[^;]*\b(5|6|7|9|10|11|13|14|15|17|18|19|21|22|23|25|26|27)px\b'
for d in "${design_dirs[@]}"; do
  if [[ -d "$d" ]]; then
    found_non_4px=$(grep -rnE "$non_4px_pattern" "$d" 2>/dev/null || true)
    if [[ -n "$found_non_4px" ]]; then
      echo "FAIL [design-guard] 4px 그리드에 맞지 않는 간격이 발견되었습니다 ($d):"
      echo "$found_non_4px"
      fail=1
    fi
  fi
done

if [[ $fail -eq 0 ]]; then
  echo "ok   [design-guard] 모든 디자인 가드 검사 통과"
  exit 0
else
  exit 1
fi
