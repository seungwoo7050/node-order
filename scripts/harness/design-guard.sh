#!/usr/bin/env bash
# design-guard.sh: 스토어프론트 디자인 무결성 검사
# 1. AI 슬롭 스타일 클래스 차단 (bg-gradient-to-, from-purple-, from-indigo-, shadow-xl, shadow-2xl, rounded-2xl, rounded-3xl)
# 2. "Brown Store" 하드코딩 재유입 차단
# 3. 3대 디자인 렌더러 폴더 간 교차 import 차단

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
  # muji-hara -> editorial-atelier or zavanas-archive
  cross_muji=$(grep -rnE 'from\s+["'"'"'].*(editorial-atelier|zavanas-archive)' "$target_dir/designs/muji-hara" 2>/dev/null || true)
  if [[ -n "$cross_muji" ]]; then
    echo "FAIL [design-guard] muji-hara에서 다른 렌더러를 교차 import했습니다:"
    echo "$cross_muji"
    fail=1
  fi

  # editorial-atelier -> muji-hara or zavanas-archive
  cross_editorial=$(grep -rnE 'from\s+["'"'"'].*(muji-hara|zavanas-archive)' "$target_dir/designs/editorial-atelier" 2>/dev/null || true)
  if [[ -n "$cross_editorial" ]]; then
    echo "FAIL [design-guard] editorial-atelier에서 다른 렌더러를 교차 import했습니다:"
    echo "$cross_editorial"
    fail=1
  fi

  # zavanas-archive -> muji-hara or editorial-atelier
  cross_zavanas=$(grep -rnE 'from\s+["'"'"'].*(muji-hara|editorial-atelier)' "$target_dir/designs/zavanas-archive" 2>/dev/null || true)
  if [[ -n "$cross_zavanas" ]]; then
    echo "FAIL [design-guard] zavanas-archive에서 다른 렌더러를 교차 import했습니다:"
    echo "$cross_zavanas"
    fail=1
  fi
fi

if [[ $fail -eq 0 ]]; then
  echo "ok   [design-guard] 모든 디자인 가드 검사 통과"
  exit 0
else
  exit 1
fi
