#!/usr/bin/env bash
# 경보 규칙과 런북·운영 Compose가 서로 맞는지 본다(도커 없이). 하네스 테스트(monitoring.test.sh)가 부른다.
#   check-monitoring.sh runbook <규칙 파일> <저장소 루트>   경보마다 runbook annotation이 있고, 그 파일·절(#앵커)이 있다
#   check-monitoring.sh tests <규칙 파일> <테스트 파일>     경보마다 promtool 테스트가 있다
#   check-monitoring.sh compose <compose.yml>               prometheus 보존 7일, prometheus·alertmanager 메모리 상한
#   check-monitoring.sh windows <규칙 파일> <prometheus 설정>  rate·increase 창이 스크레이프 간격의 4배 이상
# 문제가 있으면 한 줄씩 찍고 exit 1
set -uo pipefail

# GitHub 앵커: 소문자로, 글자·숫자·공백·-·_ 밖은 지우고, 공백은 -
slug() { tr '[:upper:]' '[:lower:]' <<<"$1" | sed -E 's/[^a-z0-9 _-]//g; s/ /-/g'; }
# 마크다운 파일의 제목들을 앵커로(한 줄에 하나)
anchors() { grep -E '^#{1,6} ' "$1" | sed -E 's/^#{1,6} +//' | while read -r h; do slug "$h"; done; }
# has_anchor <앵커 목록> <앵커>: 목록을 변수로 받는다(grep -q가 일찍 끝나 앞 파이프가 pipefail에 걸리지 않게)
has_anchor() { grep -qxF -- "$2" <<<"$1"; }

alerts() { sed -nE 's/^[[:space:]]*-[[:space:]]*alert:[[:space:]]*([A-Za-z0-9_]+).*/\1/p' "$1"; }

check_runbook() {
  local rules=$1 root=$2 fail=0 name link file anchor total runbooks f list
  total=$(alerts "$rules" | wc -l | tr -d ' ')
  runbooks=$(grep -cE '^[[:space:]]+runbook:' "$rules")
  if [[ ${total} != "${runbooks}" ]]; then echo "경보 ${total}개에 runbook annotation ${runbooks}개"; fail=1; fi
  # 경보 이름과 그 뒤 첫 runbook을 짝짓는다
  while read -r name link; do
    [[ -n ${link} ]] || { echo "${name}: runbook annotation이 없다"; fail=1; continue; }
    [[ ${link} == *"#"* ]] || { echo "${name}: runbook에 절(#앵커)이 없다: ${link}"; fail=1; continue; }
    file=${link%%#*}
    anchor=${link#*#}
    [[ -f "${root}/${file}" ]] || { echo "${name}: 런북 파일이 없다: ${file}"; fail=1; continue; }
    has_anchor "$(anchors "${root}/${file}")" "${anchor}" || { echo "${name}: ${file}에 절 #${anchor}가 없다"; fail=1; }
  done < <(awk '
    /^[[:space:]]*-[[:space:]]*alert:/ { if (name != "") print name, link; name = $3; link = "" }
    /^[[:space:]]+runbook:/ && link == "" { link = $2 }
    END { if (name != "") print name, link }' "$rules")
  # 런북 안의 [..](#앵커) 링크도 깨지지 않았는지
  for f in "${root}"/docs/runbook.md; do
    [[ -f ${f} ]] || continue
    list=$(anchors "${f}")
    while read -r anchor; do
      [[ -z ${anchor} ]] || has_anchor "${list}" "${anchor}" || { echo "런북 안 링크 #${anchor}의 절이 없다"; fail=1; }
    done < <(grep -oE '\]\(#[^)]+\)' "${f}" | sed -E 's/^\]\(#(.*)\)$/\1/' | sort -u)
  done
  return ${fail}
}

check_tests() {
  local rules=$1 tests=$2 fail=0 name
  for name in $(alerts "$rules"); do
    grep -qE "alertname:[[:space:]]*${name}\$" "$tests" || { echo "${name}: promtool 테스트가 없다"; fail=1; }
  done
  return ${fail}
}

# 규칙의 범위 벡터 창([30s], [2m] …)이 스크레이프 간격(초)의 4배 이상인지(rate·increase가 표본 2개로 흔들리지 않게)
check_windows() {
  local rules=$1 interval=$2 fail=0 w n unit sec
  while read -r w; do
    n=${w//[!0-9]/}
    unit=${w//[0-9]/}
    case ${unit} in s) sec=${n} ;; m) sec=$((n * 60)) ;; h) sec=$((n * 3600)) ;; d) sec=$((n * 86400)) ;; *) continue ;; esac
    if ((sec < interval * 4)); then echo "창 [${w}]이 스크레이프 간격 ${interval}s의 4배(${interval}s×4)보다 짧다"; fail=1; fi
  done < <(grep -oE '\[[0-9]+[smhd]\]' "$rules" | tr -d '[]' | sort -u)
  return ${fail}
}

# compose.yml에서 서비스 하나의 블록(다음 2칸 들여쓴 이름 전까지)
service_block() { awk -v s="  $2:" '$0 == s { on = 1; next } on && (/^  [a-zA-Z0-9_-]+:/ || /^[a-zA-Z]/) { on = 0 } on' "$1"; }

check_compose() {
  local compose=$1 fail=0 svc block
  for svc in prometheus alertmanager; do
    block=$(service_block "$compose" "${svc}")
    [[ -n ${block} ]] || { echo "${svc} 서비스가 없다"; fail=1; continue; }
    grep -qE '^[[:space:]]+mem_limit:[[:space:]]*[0-9]+[kmg]?' <<<"${block}" || { echo "${svc}: mem_limit이 없다"; fail=1; }
  done
  block=$(service_block "$compose" prometheus)
  grep -q -- '--storage.tsdb.retention.time=7d' <<<"${block}" || { echo "prometheus: 보존 기간 7일(--storage.tsdb.retention.time=7d)이 없다"; fail=1; }
  return ${fail}
}

case "${1:-}" in
  runbook) check_runbook "$2" "$3" ;;
  tests) check_tests "$2" "$3" ;;
  compose) check_compose "$2" ;;
  windows) check_windows "$2" "$(sed -nE 's/^[[:space:]]*scrape_interval:[[:space:]]*([0-9]+)s.*/\1/p' "$3" | head -1)" ;;
  *) echo "쓰는 법: check-monitoring.sh runbook|tests|compose ..."; exit 2 ;;
esac
