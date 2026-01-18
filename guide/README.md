# 운영: 타이머, 로그, 장애 연습, 백업·복원

## 목표

이 프로젝트는 [`19-design`](https://github.com/seungwoo7050/node-order/tree/19-design)으로부터 시작한다.

[`18`](https://github.com/seungwoo7050/node-order/tree/18-deploy)에서 배포하고 `19`에서 다듬은 서비스는 이제 매일 돌아간다.

이 문서는 "배포한 다음"에 하는 일을 실제 운영 서버에서 해 본다. 서버(EC2·RDS·S3)는 지우지 않고 다음 단계에서도 그대로 쓴다.

1. 정해진 시각에 도는 일(백업, 데모 데이터 초기화)을 systemd 타이머로 만든다

2. 로그가 디스크를 채우지 않게 하고, JSON 로그를 jq로 읽는다

3. 일부러 장애를 낸다(Redis 중단, Redis 종료, 서버 재부팅). 무엇이 감지되고 무엇이 저절로 돌아오는지 본다

4. DB를 매일 백업하고, 실제로 복원해서 확인한다. RDS 자동 백업도 켜고 둘을 비교한다

5. 지표와 비용을 본다

6. 배포 쪽을 정리한다(문서만 바뀐 푸시, 실행 권한, 쌓이는 이미지)

<!-- 재측정 -->
```text
서버의 타이머                           매일(한국 시간)
  node-order-backup.timer       03:30   pg_dump → s3://.../backups/ (7일 뒤 자동 삭제)
  node-order-reset-demo.timer   04:00   데모 데이터를 시드 상태로

장애 연습                                결과
  Redis를 사람이 멈춤          ready 503으로 감지, 다시 켤 때까지 멈춰 있음(켜고 1초 뒤 복구)
  Redis가 스스로 종료          Docker가 1초 안에 다시 띄움(재시작 1회)
  서버 재부팅                  약 29초 멈춘 뒤 전부 저절로 복귀
```

> 시작 기준점:  
> `19`까지의 코드(저장소 루트가 곧 통합본이다)와, `18`에서 만든 운영 서버(EC2·RDS·S3, `<서버 IP>`, `/opt/node-order`)가 있어야 한다.  
> 이 문서의 서버 쪽 스크립트는 `deploy/ops/`, 이 PC에서 돌리는 AWS 스크립트는 `deploy/aws/`에 있다. 경로는 모두 저장소 루트 기준이다.  
> SSH 키와 서버 `.env`의 원본은 `18`에서 만든 `deploy/aws/.local/`에 있다. `.gitignore`에 걸려 커밋으로 따라오지 않으므로 앞 단계의 폴더에서 옮겨 와 있어야 한다.  
> 서버에 들어가는 `ssh` 명령은 저장소 루트에서 친다. 키와 실행 위치는 0장 개념 6에서 다룬다.  
> 배포는 `18`과 같은 서버·같은 워크플로로 한다. 이 브랜치에서 푸시한 것이 배포되려면 저장소 변수 `DEPLOY_BRANCH`와 `production` 환경의 허용 브랜치 목록이 이 브랜치를 가리켜야 한다(`18`에서 만든 두 장치다).

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 옵션·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 장애다 | 친다. 확인한 뒤 원래대로 켠다 |
| `진단 N.` | 7단계에서 "어디서 틀어졌나"를 가르는 절차 | 친다(서버에서) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 스크립트가 완성된다. 3장은 `작업 1`로 감시를 띄운 뒤 `실험`을 따라가고, 7장은 `진단 N.`을 따라간다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지다. 제목만 보고 커밋할 변경이 있는지 가른다.

| 태그 | 무엇이 남는가 | 커밋 |
|---|---|---|
| `[커밋]` | 저장소의 파일: `deploy/ops/`·`deploy/aws/`의 스크립트, systemd 단위 파일, compose, 워크플로, 실행 권한 | 한다 |
| `[실행]` | 저장소 밖의 상태: AWS 리소스의 설정, 서버에 설치한 패키지. 다음 작업이 이 상태에 기댄다 | 안 한다 |
| `[확인]` | 남는 것이 없다: 상태 감시, 지표·크레딧 조회 | 안 한다 |
| `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 실험 전과 같아진다 | 안 한다 |

- 한 작업에 여럿이 섞이면 센 쪽 하나만 붙인다: `[커밋]` > `[원복]` > `[실행]` > `[확인]`. 스크립트를 만들고 서버에서 바로 돌려 보는 작업은 `[커밋]`이다.

- 3장의 `실험`은 블록 안에서 원래대로 켜므로 따로 `[원복]` 작업이 없다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 7장 "진단 3"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`과 `용어`만 있다. 8·9장은 체크리스트라서 `남길 것`을 두지 않았다.

- 결과 블록에 나오는 날짜·시각·바이트 수·걸린 시간은 이 문서를 쓸 때 찍힌 값이다. 직접 쳤을 때 값이 달라도 괜찮다. 같은 줄이 같은 모양으로 나오는지(성공·실패, 어느 칸에 무엇이 오는지)를 본다.

- 셸 스크립트는 첫 줄이 `#!/usr/bin/env bash`여야 실행된다. 그래서 스크립트 코드 블록에서는 파일 경로 주석을 둘째 줄에 두었다. 둘째 줄의 경로 주석은 실제 파일에는 없다.

- 이미 있는 파일을 고치는 곳은 `diff` 블록으로 보인다. `-` 줄이 지금, `+` 줄이 바꾼 뒤이고, 앞뒤 몇 줄은 위치를 찾기 위한 문맥이다.

| 단계 | 하는 일 |
|---|---|
| [0. 운영에 대한 사전지식](#0-운영에-대한-사전지식) | 운영에서 하는 일, 서버 스크립트의 공통 부분(`lib.sh`), `set -euo pipefail`, `docker run -i`, 따옴표와 펼치는 셸, SSH와 명령을 치는 위치(작업 없음) |
| [1. 1단계: 정해진 시각에 도는 일](#1-1단계-정해진-시각에-도는-일) | `ops/`를 서버로 올리는 길을 만들고, 데모 초기화와 systemd 타이머를 설치한다 |
| [2. 2단계: 로그](#2-2단계-로그) | 컨테이너 로그에 크기 제한을 걸고, pino JSON 로그를 jq로 요약한다 |
| [3. 3단계: 일부러 장애 내기](#3-3단계-일부러-장애-내기) | Redis 중단·종료, 서버 재부팅에서 무엇이 감지되고 무엇이 저절로 돌아오는지 본다 |
| [4. 4단계: 백업과 복원](#4-4단계-백업과-복원) | `pg_dump`를 S3에 올리고, 보관 기간을 S3에 맡기고, 임시 DB에 복원해 대조한다. RDS 자동 백업을 켜고 비교한다 |
| [5. 5단계: 지표와 비용](#5-5단계-지표와-비용) | CloudWatch 지표와 t3 CPU 크레딧, 남은 크레딧을 본다 |
| [6. 6단계: 배포 쪽 정리](#6-6단계-배포-쪽-정리) | 문서만 바뀐 푸시 건너뛰기, 실행 권한 사고, 이미지 정리와 그 권한 |
| [7. 디버깅](#7-디버깅) | 타이머·디스크를 확인하고, 에러 신호 표로 원인을 가른다. 도전 과제 |
| [8. 완성 확인](#8-완성-확인) | 시험해보기와 체크리스트 |
| [9. 다음 단계](#9-다음-단계) | 자가 점검, 서버를 내릴 때 쓸 도구, 이 문서에서 다루지 않은 것 |

## 0. 운영에 대한 사전지식

### 개념 1 | 운영에서 하는 일

| 무엇을 | 왜 | 이 문서 |
|---|---|---|
| 정해진 시각에 도는 일 | 사람이 매일 기억해서 할 수 없다 | 1장 |
| 로그 | 문제가 생긴 뒤 "무슨 일이 있었나"에 답하는 유일한 기록 | 2장 |
| 장애 대응 | 무엇이 저절로 돌아오고, 무엇은 사람이 해야 하는지 미리 알아 둔다 | 3장 |
| 백업·복원 | 복원해 보지 않은 백업은 있다고 말할 수 없다 | 4장 |
| 지표·비용 | 느려지기 전에, 돈이 새기 전에 안다 | 5장 |
| 배포 정리 | 쓸데없는 실행과 쌓이는 저장소를 막고, 배포가 실패하는 함정을 미리 막는다 | 6장 |

### 개념 2 | 서버에서 돌리는 스크립트의 공통 부분

`psql`·`pg_dump`·AWS CLI를 서버에 설치하지 않고, 필요할 때 이미지로 실행한다. 서버에 설치한 것은 Docker와 jq뿐이다.

서버의 운영 스크립트는 모두 맨 앞에서 아래 `lib.sh`를 읽는다(`source`). 여기서는 읽기만 한다. 파일은 1장 작업 1에서 같은 내용으로 만든다.

```sh
# deploy/ops/lib.sh
# shellcheck shell=bash disable=SC2034
# 서버(/opt/node-order/ops)의 운영 스크립트가 함께 쓰는 것. 직접 실행하지 않는다
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."     # /opt/node-order — compose.yml과 .env가 있는 곳

env_of() { sed -n "s/^$1=//p" .env; }       # .env의 값 하나
BUCKET=$(env_of S3_BUCKET)
REGION=$(env_of AWS_REGION)
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }   # systemd 저널에도 시각과 함께 남는다

# psql·pg_dump·pg_restore는 서버에 설치하지 않고 PostgreSQL 17 이미지로 실행한다(RDS와 같은 판)
# RDS 인증서 묶음을 넣고 sslrootcert로 확인한다. DB 주소는 .env에서 컨테이너 안으로만 넘긴다
# PGOPTIONS : "없어서 건너뛴다" 같은 NOTICE는 찍지 않는다(경고·오류는 그대로)
pg() { docker run --rm -i --env-file .env -e PGOPTIONS="-c client_min_messages=warning" -v "$PWD/rds-ca.pem:/rds-ca.pem:ro" postgres:17 "$@"; }
# AWS CLI도 이미지로. 키 없이 EC2의 IAM 역할을 쓴다(메타데이터 홉 제한 2라 컨테이너에서도 닿는다)
aws_() { docker run --rm -i -e AWS_REGION="$REGION" amazon/aws-cli "$@"; }
```

- AWS CLI에 키를 주지 않는다. 컨테이너 안에서도 EC2의 IAM 역할을 쓴다. `18`의 `50-server.sh`가 메타데이터 홉 제한을 2로 둔 덕분이다(`HttpPutResponseHopLimit=2`).

- 역할의 권한은 `18`의 `30-storage.sh`가 준 그대로다. 버킷 안 객체의 읽기·쓰기·지우기와 목록 보기다. 백업을 같은 버킷의 `backups/` 아래에 두므로 권한을 더할 필요가 없다.

- DB 주소는 `.env`에서 컨테이너 안으로만 넘긴다(`--env-file`). 명령줄에 비밀번호가 나타나지 않는다.

배포할 때 CI가 `ops/`를 서버로 올린다. 이때 실행 권한이 따라가야 한다(6장 작업 2). CI를 고치는 것은 1장 작업 1에서 한다.

#### `source`와 `${BASH_SOURCE[0]}`

`source lib.sh`는 `lib.sh`를 새 프로세스로 실행하지 않고, 부른 스크립트의 셸 안에서 그 자리에 읽어 실행한다.

C의 `#include`처럼 그 자리에 붙여 넣는다고 보면 된다. 다만 컴파일 전에 텍스트를 붙이는 것이 아니라, 실행하다가 그 줄에서 읽는다.

`./backup.sh`처럼 파일을 실행하는 것과는 반대다. `./`로 실행하면 셸이 자식 프로세스를 새로 띄워 그 안에서 돌린다. 자식이 바꾼 현재 폴더(`cd`)·변수·셸 옵션은 자식이 끝날 때 함께 사라지고, 부른 셸에는 남지 않는다.

```sh
# s.sh 내용: cd /tmp; X=hello
./s.sh;        echo "$PWD X=$X"   # 원래 폴더, X는 비어 있다(자식 셸에서만 바뀌었다)
source ./s.sh; echo "$PWD X=$X"   # /tmp X=hello(지금 셸이 바뀌었다)
```

평소에 `source`를 쓰는 곳도 모두 "지금 셸을 바꾸려는" 경우다. `source ~/.zshrc`는 고친 설정을 지금 터미널에 다시 읽히고, `source .venv/bin/activate`는 지금 셸의 `PATH`에 가상 환경을 앞세운다. `activate`를 `./`로 실행하면 자식 셸의 `PATH`만 바뀌었다가 사라지므로 아무 일도 없었던 것처럼 보인다. `lib.sh`를 `source`로 읽는 것도 같은 이유다. 부른 스크립트의 셸에 `cd`·`set -euo pipefail`·함수(`pg`, `aws_`)를 남기려는 것이다.

그래서 `lib.sh` 안의 `set -euo pipefail`과 `cd`가 부른 스크립트에 그대로 남는다. `backup.sh`가 `.env`를 경로 없이 읽을 수 있는 것은 `lib.sh`가 `/opt/node-order`으로 `cd`해 두었기 때문이다.

`lib.sh` 안에서 `$0`은 `lib.sh`가 아니라 부른 스크립트(`backup.sh`)의 이름이다.

읽히는 파일 자신의 경로는 `${BASH_SOURCE[0]}`에 있다. `lib.sh`가 `dirname "${BASH_SOURCE[0]}"`를 쓰고, 각 스크립트가 `dirname "$0"`을 쓰는 이유다.

### 개념 3 | `set -euo pipefail`과 `trap`: 스크립트가 실패를 알아채는 방식

셸은 기본으로 명령이 실패해도 다음 줄로 넘어간다.

타이머가 새벽에 부르는 스크립트에서 이것은 위험하다. 덤프가 실패했는데 "백업 끝"을 찍고 성공으로 끝날 수 있다.

`lib.sh`의 `set -euo pipefail` 한 줄이 이 기본값을 바꾼다.

| 옵션 | 뜻 | 이 문서에서 걸리는 곳 |
|---|---|---|
| `-e` | 명령이 0이 아닌 코드로 끝나면 스크립트를 그 자리에서 멈춘다 | `logs.sh`의 `grep '^{' \|\| true`. 그 기간에 로그가 한 줄도 없으면 `grep`이 1로 끝나므로 `\|\| true`로 막는다 |
| `-u` | 정의하지 않은 변수를 쓰면 에러로 멈춘다(`FORCE: unbound variable`) | `reset-demo.sh`의 `${FORCE:-}`. 값이 없으면 빈 문자열로 펼친다 |
| `-o pipefail` | 파이프 전체의 종료 코드를, 실패한 명령 중 가장 오른쪽 것으로 한다. 없으면 마지막 명령의 코드만 본다 | `backup.sh`의 `pg_dump ... \| aws_ s3 cp -`. 앞의 `pg_dump`가 실패해도 뒤의 업로드는 성공으로 끝나므로, `pipefail`이 없으면 실패를 모른다 |

- `-e`는 `if`의 조건, `&&`·`||`의 왼쪽에서 실패한 명령으로는 멈추지 않는다. `[ -n "$X" ] && ...`처럼 "있으면 한다"를 쓸 수 있는 이유다.

- `trap '명령' ERR`는 `-e` 때문에 멈추게 되는 실패가 생기면, 멈추기 직전에 그 명령을 실행한다. `backup.sh`가 잘린 덤프 조각을 지우는 데 쓴다. `trap - ERR`로 해제한다.

- `trap 함수 EXIT`는 성공이든 실패든 스크립트가 끝날 때 항상 실행한다. C의 `atexit()`와 비슷하다. `restore-check.sh`가 임시 DB를 지우는 데 쓴다.

- 스크립트의 종료 코드는 systemd가 그대로 받는다. 0이면 `Result=success`, 아니면 실패로 기록된다. 그래서 "할 일이 없다"(`DEMO_LOGIN`이 1이 아님)는 `exit 0`, "해서는 안 된다"(오늘 백업 없음)는 `exit 1`로 구분했다.

> C에서 `write()`의 반환값을 확인하지 않으면 실패를 모르고 지나가는 것과 같다. `set -euo pipefail`은 셸 스크립트의 모든 줄에 "반환값을 확인하고, 실패면 멈춰라"를 붙이는 것이다.

### 용어 | Docker 옵션 (`docker run`)

- `docker run --rm -i`: 실행이 끝나면 컨테이너를 지우고(`--rm`), 표준 입력을 컨테이너에 연결한다(`-i`). 파이프로 덤프를 주고받을 수 있으며, 아래 "`-i`: 파이프가 컨테이너를 지나가게 하려면"에서 다룬다.

- `--env-file .env`: 파일의 `이름=값`을 컨테이너의 환경 변수로 넘긴다. 그 값을 누가 펼치는지는 아래 "`--env-file`로 넘긴 값은 컨테이너 안의 셸이 펼친다"에서 다룬다.

- `-v "$PWD/rds-ca.pem:/rds-ca.pem:ro"`: RDS 인증서 묶음을 읽기 전용으로 넣는다. 접속 주소의 `sslmode=verify-full`과 `sslrootcert`가 이 파일로 서버를 확인한다. 이 파일은 `18`의 `user-data.sh`가 서버의 `/opt/node-order/rds-ca.pem`에 받아 두었다.

- `-e PGOPTIONS="-c client_min_messages=warning"`: "없어서 건너뛴다" 같은 NOTICE는 찍지 않는다. 경고와 오류는 그대로 나온다.

### 개념 4 | `-i`: 파이프가 컨테이너를 지나가게 하려면

`docker run`은 기본으로 컨테이너의 표준 입력을 연결하지 않는다.

앞 명령이 파이프로 아무리 보내도 컨테이너 안의 프로그램은 빈 입력을 읽고 끝난다. 에러도 나지 않는다.

```sh
echo hello | docker run --rm postgres:17 cat      # 출력 없음(종료 코드 0)
echo hello | docker run --rm -i postgres:17 cat
hello
echo hello | docker run --rm -it postgres:17 cat  # 종료 코드 1
the input device is not a TTY
```

이 문서의 백업(4장 작업 1)과 복원 확인(4장 작업 3)은 컨테이너 두 개를 파이프로 잇는다.

받는 쪽(`aws_ s3 cp -`, `pg sh -c 'pg_restore ...'`)에 `-i`가 없으면 덤프가 그 컨테이너에 닿지 않는다. 그래서 `pg`와 `aws_` 둘 다 `-i`를 기본으로 붙였다.

| 옵션 | 뜻 | 파이프·타이머에서 |
|---|---|---|
| `-i` | 표준 입력을 컨테이너에 연결한다 | 필요하다 |
| `-t` | 가상 터미널(TTY)을 붙인다 | 쓰지 않는다. 입력이 터미널이 아니면 실패한다 |
| `-it` | 둘 다. 손으로 컨테이너 셸을 열 때 쓴다 | 쓰지 않는다 |

- `-i`를 빠뜨려도 에러가 나지 않는다는 점이 함정이다. 받는 쪽은 빈 입력을 정상 입력으로 여길 수 있다.

- 1장 작업 2의 `docker compose run --rm -T`의 `-T`는 반대로 TTY를 붙이지 않게 한다. 타이머가 부를 때는 터미널이 없으므로 명시해 둔다. `18`의 `deploy.sh`가 `docker compose run --rm -T migrate ...`로 쓰는 것도 같은 이유다.

> C로 치면 자식 프로세스의 표준 입력을 닫아 두느냐, 파이프의 읽는 쪽을 `dup2`로 붙여 주느냐의 차이다. `-i`가 후자다.

### 개념 5 | `--env-file`로 넘긴 값은 컨테이너 안의 셸이 펼친다

`.env`의 `ADMIN_DATABASE_URL`은 서버 셸의 변수가 아니다. `--env-file`로 컨테이너 안에만 생긴다.

그래서 그 값을 쓰는 명령은 컨테이너 안의 `sh`가 펼치도록 작은따옴표로 감싸서 넘긴다. 4장 작업 1의 백업이 `pg sh -c 'pg_dump "$ADMIN_DATABASE_URL&..."'`로 쓰는 이유다.

```sh
# .env: ADMIN_DATABASE_URL=postgresql://order_owner:secret@db/order_api?sslmode=verify-full
pg sh -c 'echo "$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem"'
postgresql://order_owner:secret@db/order_api?sslmode=verify-full&sslrootcert=/rds-ca.pem

pg sh -c "echo \"$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem\""
&sslrootcert=/rds-ca.pem
# 서버 셸이 먼저 펼쳤는데, 서버 셸에는 그 변수가 없다
```

4장 작업 3의 복원 확인에는 세 가지 모양이 모두 나온다.

| 쓰는 법 | 누가 펼치는가 | 이 문서의 예 |
|---|---|---|
| `'... "$X" ...'` | 컨테이너 안의 `sh` | 4장 작업 1·3 `pg sh -c 'pg_dump "$ADMIN_DATABASE_URL..."'` |
| `"... \$X ..."` | 컨테이너 안의 `sh`(`\$`가 서버 셸을 건너뛴다) | 4장 작업 3 `live=$(pg sh -c "psql \"\$ADMIN_DATABASE_URL...")` |
| `'...'$X'...'` | 서버 셸(작은따옴표를 잠깐 닫고 붙인다) | 4장 작업 3 `'$CHECK_DB'` |

- 마지막 모양은 서버 셸의 변수(`CHECK_DB=order_api_restore_check`)를 컨테이너에 넘길 명령 안에 끼워 넣을 때 쓴다. `pg sh -c 'echo "DROP DATABASE IF EXISTS '$CHECK_DB'"'`는 `DROP DATABASE IF EXISTS order_api_restore_check`를 찍는다.

- `--env-file`은 값의 따옴표를 벗기지 않는다. `.env`에 `X="quoted"`로 적으면 컨테이너 안의 값이 `"quoted"`(따옴표 포함)가 된다. `.env`에는 따옴표 없이 적는다.

> 따옴표의 종류가 "어느 셸이 펼치는가"를 정한다. DB 주소는 컨테이너 안에만 있으므로 컨테이너 쪽에서 펼쳐야 한다.

### 개념 6 | SSH: 서버에 들어가는 길과 명령을 치는 위치

이 문서의 명령은 세 곳 중 하나에서 친다. 블록마다 어디서 치는지가 다르므로, 먼저 이 구분을 잡아 둔다.

| 치는 곳 | 어떻게 들어가나 | 이 문서에서 |
|---|---|---|
| 이 PC(저장소 루트) | 터미널을 열고 `cd`로 저장소 루트로 간다 | 파일 만들기·커밋·푸시, `deploy/aws/`의 AWS 스크립트, `docker compose config` |
| 서버(EC2) | 이 PC에서 `ssh`로 들어간다 | `systemctl`·`journalctl`·`/opt/node-order/ops/…` 스크립트, `docker compose ps`·`logs` |
| 컨테이너 안 | 서버에서 `docker compose exec`·`run`으로 들어간다 | `redis-cli`, 시드(`npx prisma db seed`) |

서버 쪽 스크립트도 컨테이너가 아니라 서버 자체에서 돈다. 타이머를 돌리는 systemd와 스크립트가 부르는 `docker`가 서버에 있기 때문이다. 스크립트가 컨테이너를 잠깐 띄워 일을 맡기는 것뿐이다(개념 2의 `pg`, `aws_`).

#### SSH는 다른 컴퓨터의 셸을 내 터미널로 가져온다

`ssh 사용자@주소`는 그 컴퓨터에 로그인해 셸을 하나 연다. 그 뒤로 치는 명령은 모두 그 컴퓨터에서 돈다. `exit`로 나온다.

뒤에 따옴표로 명령을 붙이면 셸을 열어 두지 않고, 그 명령 하나만 서버에서 돌린 뒤 결과를 가지고 돌아온다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> # 서버의 셸을 연다. 나올 때는 exit
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'timedatectl | grep "Time zone"' # 명령 하나만 서버에서 돌리고 돌아온다
                Time zone: Etc/UTC (UTC, +0000)
```

긴 한 줄이지만 조각은 다섯 개다.

```text
ssh  -i deploy/aws/.local/admin_ed25519  -o UserKnownHostsFile=deploy/aws/.local/known_hosts  ubuntu@<서버 IP>  'timedatectl | grep "Time zone"'
①   ②                                  ③                                                   ④                ⑤
```

| 조각 | 뜻 |
|---|---|
| ① `ssh` | SSH로 다른 컴퓨터에 접속하는 프로그램이다. macOS에 기본으로 들어 있다 |
| ② `-i <파일>` | identity(신원) 파일, 즉 로그인에 쓸 **개인 키 파일**을 고른다. 빼면 `ssh`는 기본 자리(`~/.ssh/id_ed25519` 등)의 키만 시도하는데, 이 서버에 등록된 키는 그곳에 없으므로 `Permission denied (publickey)`로 끝난다 |
| ③ `-o 이름=값` | 설정 하나를 이번 명령에만 바꾼다. `~/.ssh/config`에 한 줄 적는 것과 같은 설정을 명령줄에서 준다. 여기서는 `UserKnownHostsFile`(서버 확인용 목록 파일)을 기본 `~/.ssh/known_hosts` 대신 저장소의 파일로 바꾼다 |
| ④ `ubuntu@<서버 IP>` | 어느 컴퓨터에 어느 사용자로 들어가는지다. `@` 앞이 서버의 사용자 이름, 뒤가 주소다 |
| ⑤ `'명령'` | 있으면 그 명령 하나만 서버에서 돌리고 돌아온다. 없으면 서버의 셸을 열어 둔다 |

②와 ③의 경로를 다시 쪼개면 이렇다.

| 경로 조각 | 뜻 |
|---|---|
| `deploy/aws/` | `18`에서 만든, 이 PC에서 돌리는 AWS 스크립트(`00-check.sh`~`99-leftovers.sh`)의 폴더 |
| `.local/` | 그 스크립트들이 만든 **비밀 파일**을 모아 두는 폴더다. 이름이 `.`으로 시작해 `ls`에서 숨겨지고, `deploy/aws/.gitignore`의 `.local/` 한 줄 때문에 커밋되지 않는다. `40-database.sh`·`50-server.sh`가 `chmod 700`(나만 열 수 있음)으로 만든다 |
| `admin_ed25519` | 사람이 쓰는 개인 키다. `admin`은 쓰는 사람(관리자), `ed25519`는 키를 만든 서명 방식의 이름이다. 짝인 공개 키는 같은 이름에 `.pub`가 붙은 파일이다. `50-server.sh`가 `ssh-keygen`으로 만들었다 |
| `known_hosts` | 이 서버의 호스트 키(서버의 공개 키)를 적어 둔 파일이다. `60-server-env.sh`가 처음 접속할 때 적었다. 아래 "`known_hosts`: 내가 들어가는 서버가 그 서버가 맞는지"에서 다룬다 |

`.local/`에는 이 둘 말고도 `18`의 스크립트가 만든 비밀이 함께 있다. CI용 키(`ci_ed25519`), DB 비밀번호(`db-admin-password`, `db-app-password`), 서버에 올린 `.env`의 원본(`server.env`) 등이다. 모두 이 PC에만 있는 원본이다. 개인 키를 잃어버리면 그 짝인 공개 키로는 다시 들어갈 수 없다. 공개 키에서 개인 키를 되살릴 수 없기 때문이다.

- 따옴표 안의 명령은 서버의 셸이 펼친다. 개념 5에서 본 "어느 셸이 펼치는가"가 여기서도 같다. 작은따옴표로 감싸면 이 PC의 셸은 아무것도 펼치지 않고 그대로 넘긴다.

- `ubuntu`는 Ubuntu 이미지의 기본 사용자다. 서버 주소(`<서버 IP>`)는 `50-server.sh`가 마지막에 찍은 `SSH` 줄이나 저장소 Variables의 `DEPLOY_HOST`에 있다.

#### 비밀번호 대신 키로 들어간다

SSH의 키는 비밀번호처럼 "같은 값을 양쪽이 알고 있는" 것이 아니다. 한 번에 만든 두 개의 값, 키 쌍이다.

- **개인 키**: 서명을 만든다. 이 PC 밖으로 나가지 않는다. 서버에도 보내지 않는다.

- **공개 키**: 그 서명이 짝인 개인 키로 만든 것인지 확인만 할 수 있다. 공개 키로는 서명을 만들 수 없고, 공개 키에서 개인 키를 거꾸로 계산해 낼 수도 없다. 그래서 서버에 등록하든 남에게 보이든 상관없다.

비밀번호는 로그인할 때마다 그 값 자체를 서버로 보낸다. 서버가 가짜이거나 털리면 비밀번호도 함께 넘어간다. 키는 개인 키를 보내지 않고 "개인 키로 만든 서명"만 보낸다. 서명은 접속마다 달라지는 값 위에 만들므로(아래 "접속 한 번에 일어나는 일"), 누가 엿봐도 다음 접속에 다시 쓸 수 없다.

두 파일은 모양부터 다르다.

```sh
head -1 deploy/aws/.local/admin_ed25519        # 개인 키
-----BEGIN OPENSSH PRIVATE KEY-----
cat deploy/aws/.local/admin_ed25519.pub        # 공개 키(한 줄: 방식, 값, 이름표)
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5… node-order-admin
ssh-keygen -lf deploy/aws/.local/admin_ed25519.pub   # 공개 키의 지문(짧게 줄인 확인용 값)
256 SHA256:<지문> node-order-admin (ED25519)
```

- `ed25519`는 서명 방식의 이름이다. 오래된 RSA보다 키가 짧고 빠르다. `50-server.sh`의 `ssh-keygen -t ed25519`가 이것으로 만들었다.

- 지문은 긴 공개 키를 해시로 줄인 값이다. 두 키가 같은지 눈으로 비교할 때 쓴다.

`18`의 `50-server.sh`가 키 쌍을 두 벌 만들었다. 서버는 등록된 공개 키와 짝이 맞는 개인 키를 가진 쪽만 들여보낸다.

| 파일 | 누가 쓰나 | 공개 키를 서버에 넣은 곳 |
|---|---|---|
| `deploy/aws/.local/admin_ed25519` | 사람(이 PC) | `aws ec2 import-key-pair`로 등록하고 인스턴스를 만들 때 `--key-name`으로 넣었다 |
| `deploy/aws/.local/ci_ed25519` | GitHub Actions(Secrets의 `DEPLOY_SSH_KEY`) | 첫 부팅 때 `authorized_keys`에 덧붙였다 |

- 서버는 비밀번호 로그인을 막아 두었다(`user-data.sh`의 `PasswordAuthentication no`). 키가 맞지 않으면 다른 길 없이 `Permission denied (publickey)`로 끝난다.

- `-i`는 쓸 개인 키 파일이다. 개인 키 파일은 나만 읽을 수 있어야 한다(`-rw-------`, `chmod 600`). 다른 사람도 읽을 수 있으면 `ssh`가 `UNPROTECTED PRIVATE KEY FILE!`이라며 그 키를 쓰지 않는다.

#### `known_hosts`: 내가 들어가는 서버가 그 서버가 맞는지

키는 서버가 나를 확인하는 장치다. 반대로 내가 서버를 확인하는 장치가 `known_hosts`다. 서버마다 고유한 호스트 키가 있고, `known_hosts`에 적어 둔 호스트 키와 다르면 `ssh`가 접속을 멈춘다. 주소를 가로챈 다른 컴퓨터에 들어가지 않게 하려는 것이다.

`60-server-env.sh`가 처음 접속할 때 이 서버의 호스트 키를 `deploy/aws/.local/known_hosts`에 적어 두었다(`StrictHostKeyChecking=accept-new`). `-o UserKnownHostsFile=…`은 기본 파일(`~/.ssh/known_hosts`) 대신 이 파일을 보라는 뜻이다. 그래서 처음 들어갈 때도 "이 서버를 믿겠느냐"고 묻지 않는다.

#### 접속 한 번에 일어나는 일

`ssh -v`를 붙이면 접속 과정을 한 줄씩 찍는다. 저장소 루트에서 아무 명령 하나를 붙여 쳐 보면 아래 줄들이 보인다(많은 줄 가운데 단계마다 하나씩 골랐다).

```sh
ssh -v -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'echo hi'
debug1: Connecting to <서버 IP> [<서버 IP>] port 22.                                           ①
debug1: Connection established.
debug1: Remote protocol version 2.0, remote software version OpenSSH_9.6p1 Ubuntu-3ubuntu13.20 ②
debug1: kex: algorithm: sntrup761x25519-sha512@openssh.com                                     ③
debug1: kex: client->server cipher: chacha20-poly1305@openssh.com MAC: <implicit> compression: none
debug1: Server host key: ssh-ed25519 SHA256:<서버 호스트 키 지문>                              ④
debug1: Host '<서버 IP>' is known and matches the ED25519 host key.
debug1: Found key in deploy/aws/.local/known_hosts:1
debug1: SSH2_MSG_NEWKEYS received                                                              ⑤
debug1: Authentications that can continue: publickey                                           ⑥
debug1: Offering public key: deploy/aws/.local/admin_ed25519 ED25519 SHA256:<지문> explicit
debug1: Server accepts key: deploy/aws/.local/admin_ed25519 ED25519 SHA256:<지문> explicit
Authenticated to <서버 IP> ([<서버 IP>]:22) using "publickey".
debug1: Sending command: echo hi                                                               ⑦
hi
debug1: Exit status 0
```

| 단계 | 하는 일 |
|---|---|
| ① TCP 연결 | 서버의 22번 포트에 TCP로 붙는다. 보안 그룹이 22번을 열어 두었기 때문이다(`20-network.sh`의 `for port in 80 443 22`) |
| ② 판 맞추기 | 양쪽이 SSH 프로토콜 판(2.0)과 프로그램 이름을 주고받는다 |
| ③ 키 교환 | 양쪽이 각자 임시 값을 만들어 일부만 주고받고, 그것으로 **같은 세션 키를 각자 계산**한다. 세션 키 자체는 선으로 지나가지 않으므로 엿들어도 알 수 없다. 이 접속에서만 쓰고 버린다 |
| ④ 서버 확인 | 서버가 자기 호스트 키(개인 키)로 ③의 내용에 서명해 보낸다. 이 PC는 그 서명을 `known_hosts`에 적힌 공개 키로 확인한다. 맞지 않으면 여기서 멈춘다 |
| ⑤ 암호화 시작 | 이후의 모든 바이트는 ③의 세션 키로 암호화된다(`chacha20-poly1305`). 아래의 로그인도 이 암호 안에서 오간다 |
| ⑥ 사용자 확인 | 서버가 받는 방법이 `publickey` 하나뿐이라고 알린다(비밀번호는 막았다). 이 PC는 공개 키를 내밀고, 서버가 `authorized_keys`에 있다고 하면 ③에서 생긴 이 접속만의 값에 개인 키로 서명해 보낸다. 서버는 공개 키로 서명을 확인한다 |
| ⑦ 명령 실행 | 암호화된 통로 위에 채널을 하나 열어 명령(`echo hi`)을 보낸다. 서버의 셸이 실행하고, 출력과 종료 코드(`Exit status 0`)가 같은 통로로 돌아온다 |

- 키가 두 종류 쓰인다. 오래 쓰는 **키 쌍**(서버의 호스트 키, 내 `admin_ed25519`)은 "누구인가"를 확인하는 데만 쓴다. 실제 데이터를 암호화하는 것은 접속마다 새로 만드는 **세션 키**다. 키 쌍의 서명·확인은 느리고, 세션 키 하나로 양쪽이 같은 값을 써서 암호화·복호화하는 쪽이 빠르기 때문이다.

- ④와 ⑥은 방향만 반대인 같은 일이다. ④는 서버가 서명하고 내가 `known_hosts`의 공개 키로 확인한다. ⑥은 내가 서명하고 서버가 `authorized_keys`의 공개 키로 확인한다. 어느 쪽도 개인 키를 보내지 않는다.

- 서명할 대상이 ③에서 이 접속만을 위해 생긴 값이라, 지난 접속의 서명을 가로채 다시 보내도 통하지 않는다.

- 22번 포트는 어디서든(`0.0.0.0/0`) 열려 있다. 그래도 ⑥에서 키가 없으면 들어올 수 없다. 인터넷에는 22번 포트를 훑으며 흔한 사용자 이름으로 들어가 보는 프로그램이 늘 돈다. 서버 로그를 보면 하루에도 수백 줄씩 찍힌다(`sudo journalctl -u ssh --since -24h | grep -c "Invalid user"`). 비밀번호 로그인을 막아 둔 이유다.

- CI의 배포 작업도 같은 과정을 거친다. `scp`도 SSH 위에서 파일을 보내는 명령이라 ①~⑥이 같고, ⑦에서 명령 대신 파일 내용이 지나간다. 이때 쓰는 키가 `ci_ed25519`(Secrets의 `DEPLOY_SSH_KEY`)이고, `known_hosts`가 Secrets의 `DEPLOY_KNOWN_HOSTS`다.

> C의 소켓으로 치면 ①이 `connect()`, ③~⑤가 그 소켓 위에 암호 계층을 까는 일, ⑦이 그 위에서 `write()`·`read()`로 명령과 출력을 주고받는 일이다. HTTPS(TLS)도 같은 뼈대다. 다만 HTTPS는 보통 서버만 증명서로 확인하고, SSH는 ⑥에서 사용자도 키로 확인한다.

#### 경로가 상대 경로라 저장소 루트에서 친다

`-i deploy/aws/.local/admin_ed25519`와 `UserKnownHostsFile=deploy/aws/.local/known_hosts`는 지금 있는 폴더 기준의 상대 경로다. 다른 폴더에서 치면 둘 다 찾지 못하고, 아래 세 줄이 한꺼번에 나온다.

```text
Warning: Identity file deploy/aws/.local/admin_ed25519 not accessible: No such file or directory.
The authenticity of host '<서버 IP> (<서버 IP>)' can't be established.
ubuntu@<서버 IP>: Permission denied (publickey).
```

키를 찾지 못해 키 없이 접속했고(첫 줄), `known_hosts`도 찾지 못해 서버를 처음 보는 것처럼 물었고(둘째 줄), 비밀번호 로그인이 막혀 있어 거절됐다(셋째 줄). 키가 틀린 것이 아니라 치는 위치가 틀린 것이다. 저장소 루트로 `cd`하고 다시 친다.

`.local/`은 `.gitignore`에 걸려 있어 저장소를 새로 받으면 없다. 앞 단계의 폴더에서 옮겨 와야 한다(시작 기준점).

> C로 치면 `fopen("deploy/aws/.local/admin_ed25519", "r")`이 현재 작업 폴더 기준으로 파일을 찾는 것과 같다. 프로그램을 어디서 실행했는지에 따라 같은 상대 경로가 다른 파일을 가리킨다.

## 1. 1단계: 정해진 시각에 도는 일

### 작업 1. [커밋] 운영 스크립트 자리와 서버로 올리는 길 만들기

이 문서에서 만드는 서버 쪽 파일은 모두 `deploy/ops/`에 둔다.

```sh
mkdir -p deploy/ops/systemd
```

먼저 모든 운영 스크립트가 맨 앞에서 읽는 공통 파일을 만든다. 0장 개념 2에서 읽은 그 파일이다. 이후의 `backup.sh`·`reset-demo.sh`·`logs.sh`·`restore-check.sh`가 모두 이 파일에 기대므로, 이것부터 만든다.

```sh
# deploy/ops/lib.sh
# shellcheck shell=bash disable=SC2034
# 서버(/opt/node-order/ops)의 운영 스크립트가 함께 쓰는 것. 직접 실행하지 않는다
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."     # /opt/node-order — compose.yml과 .env가 있는 곳

env_of() { sed -n "s/^$1=//p" .env; }       # .env의 값 하나
BUCKET=$(env_of S3_BUCKET)
REGION=$(env_of AWS_REGION)
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }   # systemd 저널에도 시각과 함께 남는다

# psql·pg_dump·pg_restore는 서버에 설치하지 않고 PostgreSQL 17 이미지로 실행한다(RDS와 같은 판)
# RDS 인증서 묶음을 넣고 sslrootcert로 확인한다. DB 주소는 .env에서 컨테이너 안으로만 넘긴다
# PGOPTIONS : "없어서 건너뛴다" 같은 NOTICE는 찍지 않는다(경고·오류는 그대로)
pg() { docker run --rm -i --env-file .env -e PGOPTIONS="-c client_min_messages=warning" -v "$PWD/rds-ca.pem:/rds-ca.pem:ro" postgres:17 "$@"; }
# AWS CLI도 이미지로. 키 없이 EC2의 IAM 역할을 쓴다(메타데이터 홉 제한 2라 컨테이너에서도 닿는다)
aws_() { docker run --rm -i -e AWS_REGION="$REGION" amazon/aws-cli "$@"; }
```

다른 스크립트가 `source`로 읽기만 하므로 실행 권한은 필요 없다(`chmod +x`를 하지 않는다). 커밋할 때 `git ls-files -s deploy/ops`에 `deploy/ops/lib.sh`가 `100644`로 있어야 한다.

CI의 배포 작업이 `ops/`도 서버로 올리게 한다.

```diff
# .github/workflows/ci.yml — deploy 작업
       - name: 설정 파일 올리기
-        run: scp deploy/compose.yml deploy/Caddyfile deploy/deploy.sh ubuntu@${{ vars.DEPLOY_HOST }}:/opt/node-order/
+        # 운영 스크립트(ops/)도 올린다. -p : 실행 권한을 그대로 — systemd는 실행 권한이 없는 파일을 실행하지 않는다
+        run: scp -rp deploy/compose.yml deploy/Caddyfile deploy/deploy.sh deploy/ops ubuntu@${{ vars.DEPLOY_HOST }}:/opt/node-order/
       - name: 새 이미지로 바꾸기
```

- `-r`은 폴더(`deploy/ops`)를 통째로 올린다. 서버에는 `/opt/node-order/ops/`가 생긴다.

- `-p`는 원본 파일의 권한을 그대로 옮긴다. 원본이 저장소에서 체크아웃된 파일이므로, 저장소에 기록된 권한이 서버까지 간다.

2장의 `logs.sh`가 쓰는 jq를 서버에 설치한다. 새로 만드는 서버는 첫 부팅 스크립트가 설치한다.

```diff
# deploy/aws/user-data.sh
 apt-get update
-apt-get install -y docker.io docker-compose-v2
+apt-get install -y docker.io docker-compose-v2 jq # jq — JSON 로그 읽기(ops/logs.sh)
 usermod -aG docker ubuntu # ubuntu 사용자가 sudo 없이 docker를 쓴다
```

`user-data.sh`는 EC2가 처음 켜질 때 한 번만 돈다. `18`에서 이미 만든 서버에는 jq가 있는지 먼저 본다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'which jq || sudo apt-get install -y jq'
/usr/bin/jq
```

지금 서버(Ubuntu 24.04)에는 이미지에 jq가 들어 있어 설치할 것이 없다. 그래도 `user-data.sh`에 적어 두는 것은, `logs.sh`가 jq에 기댄다는 사실을 서버를 만드는 스크립트에 드러내 두려는 것이다. 이미지가 바뀌어 jq가 빠져도 새 서버에는 설치된다.

이 폴더에 만드는 실행 스크립트(`*.sh`, `lib.sh` 제외)는 만들 때마다 `chmod +x`를 한다.

git은 이 실행 비트를 `100755`로 기록하고, CI의 `scp -p`가 그대로 서버로 옮긴다. 빠뜨리면 타이머가 실패한다(6장 작업 2).

이후 작업에서 파일을 만들고 커밋해 푸시하면, CI의 배포 작업이 서버의 `/opt/node-order/ops/`를 새 내용으로 바꾼다.

### 개념 | `lib.sh`가 빠지면 스크립트는 실패를 모른 채 끝까지 달린다

`lib.sh`를 만들지 않고(또는 커밋하지 않고) 배포하면, 서버에서 `backup.sh`를 돌렸을 때 이렇게 된다.

```text
/opt/node-order/ops/backup.sh: line 2: /opt/node-order/ops/lib.sh: No such file or directory
/opt/node-order/ops/backup.sh: line 7: log: command not found
/opt/node-order/ops/backup.sh: line 7: aws_: command not found
/opt/node-order/ops/backup.sh: line 8: pg: command not found
…
/opt/node-order/ops/backup.sh: line 13: log: command not found
```

첫 줄에서 멈추지 않고 마지막 줄까지 간다. 멈추게 하는 `set -euo pipefail`이 바로 그 빠진 `lib.sh` 안에 있기 때문이다. 셸은 기본값대로 실패한 줄을 넘기고 다음 줄로 간다(0장 개념 3).

더 나쁜 것은 마지막 줄이다. `TZ=Asia/Seoul date +%F > .last-backup-ok`는 `log`·`pg`·`aws_` 없이도 성공한다. 그래서 스크립트는 **종료 코드 0**으로 끝나고, systemd는 `Result=success`로 기록하며, 지금 폴더에 "오늘 백업 성공" 표시까지 남긴다. `lib.sh`의 `cd`도 돌지 않았으므로 그 표시는 `/opt/node-order`가 아니라 명령을 친 폴더에 생긴다. `/opt/node-order`에서 쳤다면 데모 초기화(작업 2)가 이 가짜 표시를 믿고, 백업이 없는 날에 데이터를 지운다.

- 이렇게 돌았다면 가짜 표시를 지운다. `rm -f /opt/node-order/.last-backup-ok ~/.last-backup-ok`. 그다음 `lib.sh`를 커밋해 배포하고 다시 돌린다.

- 스크립트 쪽에서 막으려면 `source "$(dirname "$0")/lib.sh" || exit 1`처럼 읽기에 실패하면 바로 끝내게 한다. `set -e`보다 앞에 있는 줄은 `set -e`가 지켜 주지 못하기 때문이다.

> C로 치면 `#include`한 헤더가 없는데 컴파일이 멈추지 않고, 없는 함수 호출을 모두 건너뛴 채 `return 0`까지 실행된 것과 같다. 셸은 실행하면서 읽으므로 이런 일이 실제로 생긴다(0장 "`source`와 `${BASH_SOURCE[0]}`").

### 작업 2. [커밋] 데모 데이터 매일 초기화

`19`에서 로그인 화면에 "데모로 둘러보기"를 열었다. 데모 관리자(`kim`)로 누구나 들어와 상품 사진을 바꿀 수 있다. 화면에도 "데모 데이터는 매일 초기화됩니다."라고 적어 두었으니, 실제로 매일 시드 상태로 되돌린다.

```sh
#!/usr/bin/env bash
# deploy/ops/reset-demo.sh
# 데모 데이터를 시드 상태로 되돌린다(데모 관리자를 공개했으므로 매일 초기화). systemd 타이머가 매일 부른다
# - 시드는 사용자·상품·주문 등의 테이블을 TRUNCATE하고 데모 데이터를 다시 만든다
#   → GitHub로 로그인한 계정·주문도 사라지고, 모두 로그아웃된다(refresh 토큰도 지워진다)
# - 올린 상품 이미지는 S3에 남지만 어느 상품도 가리키지 않게 된다 → 앱의 고아 이미지 정리가 1시간 남짓 뒤 지운다
source "$(dirname "$0")/lib.sh"

if [ "$(env_of DEMO_LOGIN)" != "1" ]; then
  log "DEMO_LOGIN이 1이 아니다 — 데모 서비스가 아니므로 초기화하지 않는다"
  exit 0
fi
# 초기화 전 데이터는 03:30 백업에만 남는다 → 오늘(한국 시간) 백업이 성공하지 않았으면 지우지 않는다. 손으로 강제하려면 FORCE=1
if [ "$(cat .last-backup-ok 2>/dev/null)" != "$(TZ=Asia/Seoul date +%F)" ] && [ "${FORCE:-}" != 1 ]; then
  log "오늘 백업이 성공하지 않았다 — 초기화하지 않는다(backup.sh를 확인하고, 강제하려면 FORCE=1)"
  exit 1
fi
log "데모 데이터 초기화 시작"
# 마이그레이션 이미지에 시드 스크립트와 tsx가 들어 있다. 배포 스크립트가 현재 버전의 이 이미지를 남겨 둔다
docker compose run --rm -T migrate npx prisma db seed 2>&1 | tail -1
log "데모 데이터 초기화 끝"
```

```sh
chmod +x deploy/ops/reset-demo.sh
```

초기화가 무엇을 지우고 무엇을 남길지는 지금은 "시드를 다시 돌린다" 하나로 둔다. 초기화 범위는 `21`에서 다시 정한다.

### 개념 | 데모 초기화가 지우는 것과 지키는 것

#### 시드만 다시 돌리면 된다

`order-api-nest/prisma/seed.ts`는 맨 앞에서 `categories`, `refresh_tokens`, `outbox_events`, `idempotency_keys`, `order_items`, `orders`, `products`, `users`를 `TRUNCATE ... RESTART IDENTITY CASCADE`하고, 데모 사용자 4명(`kim`은 관리자)·카테고리·상품 4개·주문 5건을 다시 만든다. `stripe_events`는 목록에 없어 남는다.

시드는 `DEMO_PASSWORD`로 데모 사용자의 비밀번호를 만든다. 운영 compose의 `migrate` 서비스가 `.env`의 `DEMO_PASSWORD`를 넘기므로 `docker compose run migrate npx prisma db seed`만으로 된다.

마이그레이션 이미지(`order-api-nest/Dockerfile`의 `migrate` 단계)는 빌드 단계를 그대로 이어받아 개발 의존성(`tsx`)과 `prisma/seed.ts`를 갖고 있다. `deploy.sh`는 지금 태그가 아닌 이미지만 지우므로, 지금 버전의 마이그레이션 이미지가 서버에 늘 남아 있다.

상품을 새로 만들므로, 올렸던 이미지는 S3에 남지만 어느 상품도 가리키지 않는 파일이 된다. [`06`](https://github.com/seungwoo7050/node-order/tree/06-file-upload)의 고아 이미지 정리(`orphan-image-cleanup.job.ts`)가 10분마다 돌며, 1시간 넘게 쓰이지 않은 `products/` 파일을 지운다.

#### 그날 백업이 성공했을 때만 지운다

초기화 전 데이터는 03:30 백업에만 남는다. 백업이 실패한 날 그대로 지우면 그날 데이터가 어디에도 남지 않는다.

`backup.sh`가 성공하면 `.last-backup-ok`에 날짜를 적고, 초기화는 그 날짜가 오늘(한국 시간)일 때만 돈다. 아니면 실패로 끝나 저널에 남는다.

> systemd의 `After=`는 순서만 정하고 성공 여부는 보지 않는다. 그래서 스크립트에서 확인한다.

#### 잃는 것도 적어 둔다

GitHub로 로그인한 계정과 그 주문, refresh 토큰이 모두 사라진다(모두 로그아웃). 데모 서비스라서 받아들인다.

`DEMO_LOGIN`이 1이 아니면 아무것도 하지 않는다.

#### 초기화된 주문의 Stripe 웹훅이 나중에 와도 괜찮은가

[`14`](https://github.com/seungwoo7050/node-order/tree/14-stripe)의 웹훅 처리(`payments.service.ts`)는 `stripeSessionId`로 주문을 찾지 못하면 `ignored`를 돌려준다(200). 시드가 만든 주문에는 세션이 없으므로 옛 세션의 웹훅은 모두 여기에 걸린다. Stripe가 재시도를 반복하지 않는다.

### 작업 3. [커밋] systemd 타이머

cron 대신 systemd 타이머를 쓴다. 실행 기록이 저널에 남고(`journalctl -u`), 손으로 한 번 돌리기도 쉽다(`systemctl start`).

`node-order-backup.service`가 부르는 `backup.sh`는 4장 작업 1에서 만든다.

단위 파일은 지금 모두 설치해도 되지만, 아래 "설치하고 한 번 돌려 보기"의 백업 확인은 4장 작업 1을 마친 뒤에 돌린다. 먼저 돌리면 실행할 파일이 없어 `status=203/EXEC`로 실패한다.

#### 단위 파일 네 개

타이머와 서비스를 한 쌍씩, 백업과 데모 초기화에 하나씩 만든다.

```ini
# deploy/ops/systemd/node-order-backup.timer
# 매일 한국 시간 03:30. 서버 시계는 UTC지만 시간대를 붙여 적을 수 있다
# Persistent=true : 그 시각에 서버가 꺼져 있었으면, 켜진 뒤에 한 번 따라잡아 실행한다
[Unit]
Description=node-order DB 백업 매일

[Timer]
OnCalendar=*-*-* 03:30:00 Asia/Seoul
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# deploy/ops/systemd/node-order-backup.service
# DB 백업 한 번. 타이머(node-order-backup.timer)가 부른다. 직접 돌리기: sudo systemctl start node-order-backup
[Unit]
Description=node-order DB 백업(pg_dump → S3)
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
User=ubuntu
ExecStart=/opt/node-order/ops/backup.sh
```

```ini
# deploy/ops/systemd/node-order-reset-demo.timer
# 매일 한국 시간 04:00 — 백업(03:30) 뒤에. 초기화 전의 데이터가 백업에 남는다
[Unit]
Description=node-order 데모 데이터 초기화 매일

[Timer]
OnCalendar=*-*-* 04:00:00 Asia/Seoul
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# deploy/ops/systemd/node-order-reset-demo.service
# 데모 데이터 초기화 한 번. 직접 돌리기: sudo systemctl start node-order-reset-demo
[Unit]
Description=node-order 데모 데이터 초기화
Wants=network-online.target docker.service
After=network-online.target docker.service node-order-backup.service

[Service]
Type=oneshot
User=ubuntu
ExecStart=/opt/node-order/ops/reset-demo.sh
```

서버 시계는 UTC다(`timedatectl` → `Etc/UTC`). `04:00 Asia/Seoul`처럼 시간대를 붙여 적으면 systemd가 UTC로 바꿔 계산한다.

계산 결과는 `systemd-analyze calendar`에 `OnCalendar=`의 값을 그대로 넘겨 미리 본다. systemd의 명령이라 이 PC(macOS)에는 없고, 서버(EC2)에서 친다.

이 명령은 문자열(시각 표현)만 계산하고 서버의 파일은 보지 않는다. 그래서 커밋·푸시·배포를 기다릴 필요가 없다. 단위 파일을 쓰는 지금, `OnCalendar=`에 적은 값이 생각한 시각으로 풀리는지 바로 확인하는 용도다. 첫 줄이 친 명령이고, 아래가 그 출력이다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'systemd-analyze calendar "*-*-* 03:30:00 Asia/Seoul"'
Normalized form: *-*-* 03:30:00 Asia/Seoul
    Next elapse: Fri 2026-01-16 18:30:00 UTC
       From now: 4h 57min left
```

`Next elapse`가 다음에 돌 시각이다. 한국 03:30은 UTC로 전날 18:30이다. 날짜는 명령을 친 날에 따라 달라지므로 위와 같지 않아도 된다. 시각이 `18:30:00 UTC`이면 맞다.

백업이 먼저(03:30), 초기화가 나중(04:00)이라 초기화 전의 데이터가 백업에 남는다.

#### 설치 스크립트

단위 파일을 systemd의 자리로 복사하고 타이머를 켜는 스크립트다. 서버에서 한 번 실행한다.

```sh
#!/usr/bin/env bash
# deploy/ops/install-timers.sh
# 서버에서 한 번 실행한다(sudo 필요): systemd 단위 파일을 설치하고 타이머를 켠다. 다시 실행해도 결과는 같다
#   sudo /opt/node-order/ops/install-timers.sh
set -euo pipefail
cd "$(dirname "$0")/systemd"
install -m 644 ./*.service ./*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now node-order-backup.timer node-order-reset-demo.timer
systemctl list-timers 'node-order-*' --no-pager
```

```sh
chmod +x deploy/ops/install-timers.sh
```

- `lib.sh`를 읽지 않는다. `.env`도 Docker도 쓰지 않고, `systemd/` 폴더 기준으로만 움직이기 때문이다.

- `install -m 644`는 복사하면서 권한을 정한다. 단위 파일은 systemd가 읽기만 하므로 실행 권한이 필요 없다.

#### 설치하고 한 번 돌려 보기

여기서부터 나오는 `/opt/node-order/…` 명령은 이 PC가 아니라 서버(EC2)에 SSH로 들어가 친다. 컨테이너 안이 아니라 서버 자체다. 타이머를 돌리는 systemd도, 스크립트가 부르는 `docker`도 서버에 있다.

서버의 `/opt/node-order/ops/`에 파일이 생기는 길은 하나다. 이 PC에서 커밋해 이 브랜치를 원격에 푸시하면, CI의 배포 작업이 끝날 때 `scp`가 `deploy/ops/`를 서버로 올린다(작업 1). 그래서 순서는 이렇다.

1. 이 PC에서 지금까지 만든 `deploy/ops/`와 CI 수정을 커밋하고 푸시한다.

2. GitHub Actions의 배포 작업이 초록으로 끝날 때까지 기다린다. 배포만 건너뛰었다면 `DEPLOY_BRANCH`가 이 브랜치가 아니다(시작 기준점).

3. 서버에 들어가 설치한다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP>
ls -l /opt/node-order/ops # 올라온 스크립트와 실행 권한(-rwxr-xr-x)을 먼저 본다
sudo /opt/node-order/ops/install-timers.sh

# 출력
Created symlink /etc/systemd/system/timers.target.wants/node-order-backup.timer → /etc/systemd/system/node-order-backup.timer.
Created symlink /etc/systemd/system/timers.target.wants/node-order-reset-demo.timer → /etc/systemd/system/node-order-reset-demo.timer.
NEXT                            LEFT LAST PASSED UNIT                        ACTIVATES                    
Fri 2026-01-16 18:30:00 UTC 4h 18min -         - node-order-backup.timer     node-order-backup.service
Fri 2026-01-16 19:00:00 UTC 4h 48min -         - node-order-reset-demo.timer node-order-reset-demo.service

2 timers listed.
Pass --all to see loaded but inactive timers, too.
```

타이머를 기다리지 않고 서비스를 한 번 돌려 확인한다. 같은 서버 셸에서 친다. 다만 이 서비스가 부르는 `backup.sh`는 4장 작업 1에서 만들고, 위와 같은 길(커밋 → 푸시 → 배포)로 서버에 올라온다. 지금은 건너뛰고 4장 작업 1을 마친 뒤 돌아와 친다.

```sh
sudo systemctl start node-order-backup
systemctl show node-order-backup -p Result
Result=success
journalctl -u node-order-backup -n 4 -o cat
```

<!-- 재측정 -->
```text
2026-01-18T13:11:29Z 백업 시작 → s3://node-order-images-<계정 번호>/backups/order_api-20260118T131129Z.dump
2026-01-18T13:11:32Z 백업 끝: backups/order_api-20260118T131129Z.dump (30204 바이트)
node-order-backup.service: Deactivated successfully.
```

`sudo systemctl start`는 서비스가 끝날 때까지 기다린다.

`Type=oneshot`이기 때문이다. 돌아온 뒤 `Result`를 보면 성공했는지 바로 알 수 있다.

### 용어 | systemd 단위 파일 문법

- `OnCalendar=*-*-* 04:00:00 Asia/Seoul`: 매일(연-월-일 모두 `*`) 그 시각에 돈다. 끝에 붙인 시간대로 계산한다.

- `Persistent=true`: 그 시각에 서버가 꺼져 있었으면, 켜진 뒤 한 번 따라잡아 실행한다.

- `WantedBy=timers.target`: `enable`하면 부팅할 때 타이머가 켜진다. 서비스가 아니라 타이머를 켜는 이유는 아래 "타이머와 서비스는 이름으로 짝을 짓는다"에서 다룬다.

- `Type=oneshot`: 한 번 실행하고 끝나는 서비스다. 타이머가 부를 때마다 새로 돈다.

- `Wants=` / `After=`: 함께 켤 것과 그 뒤에 시작할 순서를 정한다. 앞의 것이 성공했는지는 보지 않는다(작업 2 다음의 "그날 백업이 성공했을 때만 지운다").

- `User=ubuntu`: 스크립트를 root가 아니라 `ubuntu` 사용자로 실행한다. `ubuntu`는 docker 그룹에 있어서 sudo 없이 `docker`를 쓴다(`user-data.sh`의 `usermod -aG docker ubuntu`).

### 개념 | systemd와 저널: `log()`가 `printf`만 해도 기록이 남는 이유

systemd는 서버가 켜질 때 가장 먼저 뜨는 프로세스(PID 1)다. 이후의 서비스는 모두 systemd가 자식 프로세스로 띄우고 관리한다.

systemd가 띄운 서비스의 표준 출력과 표준 에러는 터미널이 아니라 저널(journald)로 간다.

그래서 스크립트의 `log()`는 파일에 쓰지 않고 `printf`로 찍기만 한다. `journalctl -u node-order-backup`이 그 줄들을 서비스 이름으로 모아 보여 준다.

- 저널은 줄마다 받은 시각을 따로 붙인다. `log()`가 시각을 한 번 더 찍는 것은 `-o cat`(시각 없이 본문만)으로 볼 때나, 손으로 실행해 터미널에서 볼 때도 같은 모양이 되게 하려는 것이다.

- 스크립트가 0이 아닌 코드로 끝나면 systemd는 서비스를 실패로 기록한다. `systemctl show -p Result`의 값과 저널의 마지막 줄(`Failed with result 'exit-code'.` 같은 것)로 드러난다.

- 실행 파일 자체를 띄우지 못하면(파일이 없거나 실행 권한이 없으면) 스크립트는 한 줄도 돌지 않는다. 이때 저널에는 스크립트의 `log` 줄 대신 `status=203/EXEC`가 남는다.

> C 프로그램을 데몬으로 만들 때 직접 하던 일(fork, 표준 출력을 로그 파일로 돌리기, 죽으면 다시 띄우기)을 systemd가 대신한다. 스크립트는 표준 출력에 찍고 종료 코드로 성공을 알리기만 하면 된다.

### 개념 | 타이머와 서비스는 이름으로 짝을 짓는다

위의 네 파일은 `ops/systemd/`에 있다. 타이머 파일에는 무엇을 실행할지가 없다.

타이머는 **확장자만 다르고 이름이 같은 서비스**를 시작한다. 다른 이름의 서비스를 부르려면 `[Timer]`에 `Unit=`을 적는다.

```text
node-order-backup.timer → node-order-backup.service → ExecStart=/opt/node-order/ops/backup.sh
node-order-reset-demo.timer → node-order-reset-demo.service → ExecStart=/opt/node-order/ops/reset-demo.sh
```

위 `list-timers` 결과의 UNIT과 ACTIVATES 칸이 이 짝이다.

`enable`하는 것도 서비스가 아니라 타이머다. `[Install]`(`WantedBy=timers.target`)은 타이머 파일에만 있다.

`install-timers.sh`는 단위 파일을 `/etc/systemd/system/`에 복사한 뒤 이렇게 켠다.

```sh
systemctl daemon-reload # 바뀐 단위 파일을 다시 읽는다
systemctl enable --now node-order-backup.timer node-order-reset-demo.timer
```

| 구분 | `.timer` | `.service`(`Type=oneshot`) |
|---|---|---|
| 정하는 것 | 언제 | 무엇을 |
| `enable` | 한다(부팅할 때 타이머가 켜진다) | 하지 않는다 |
| 손으로 한 번 돌리기 | 해당 없음 | `systemctl start <서비스>` |
| 기록을 보는 곳 | `list-timers`의 NEXT·LAST | `journalctl -u <서비스>` |

- `Type=oneshot` 서비스는 스크립트가 끝나면 비활성으로 돌아간다. 위 저널의 `Deactivated successfully.`가 그것이다. 다음 날 타이머가 다시 시작한다.

- 백업과 초기화의 순서를 실제로 정하는 것은 두 타이머의 시각(03:30, 04:00)이다. `After=node-order-backup.service`는 두 서비스가 함께 시작될 때의 순서만 정한다.

- 단위 파일을 고친 뒤에는 `daemon-reload`를 해야 systemd가 새 내용을 읽는다. CI는 `ops/systemd/`의 파일을 서버로 올리기만 하므로, 단위 파일을 바꾼 배포 뒤에는 `install-timers.sh`를 다시 실행한다.

> cron 한 줄로 치면 `.timer`가 시각 칸, `.service`가 명령 칸이다. 둘을 나눠 두었기 때문에 명령만 따로 `systemctl start`로 돌려 볼 수 있다.

### 개념 | 헷갈리는 곳: LAST가 설치한 시각으로 찍힌다

설치 직후 `systemctl list-timers`의 LAST 칸이 설치 시각으로 바뀌어, 초기화가 바로 돌았나 싶을 수 있다. 저널에는 손으로 돌린 백업만 있다.

LAST는 `Persistent` 타이머가 켜질 때 만드는 기록 파일(`/var/lib/systemd/timers/stamp-...`)의 시각이다.

> 실제로 돌았는지는 저널로 본다.

### 남길 것

- **찾아보면 되는 것**: `OnCalendar`의 문법, `Persistent=`·`Wants=`·`After=`·`Type=oneshot`의 뜻, `systemctl list-timers`·`journalctl -u ... -n ... -o cat`·`systemd-analyze calendar`의 옵션. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 타이머는 "언제", 서비스는 "무엇을"이다. 켜 두는(`enable`) 것은 타이머이고, 손으로 한 번 돌려 보는(`systemctl start`) 것은 서비스다.
  - 공통 파일(`lib.sh`)을 `source`로 읽는 스크립트는 그 파일이 없으면 `set -e`도 함께 없다. 실패를 모르고 끝까지 달려 성공으로 끝날 수 있다.
  - `After=`는 순서만 정하고 성공은 보지 않는다. 앞의 일이 성공했을 때만 해야 하는 일(데모 초기화)은 스크립트가 직접 확인한다(`.last-backup-ok`).
  - 돌았는지는 `list-timers`의 LAST가 아니라 저널(`journalctl -u`)과 `Result`로 본다.
  - 첫 부팅 스크립트(`user-data.sh`)는 서버를 만들 때 한 번만 돈다. 이미 있는 서버에는 같은 일을 손으로 하고, 다음에 만들 서버를 위해 스크립트도 고친다.

- **에러 신호**:
  - 검사·테스트는 모두 초록인데 배포만 건너뛰어 서버에 `ops/`가 없다 → `DEPLOY_BRANCH`가 아직 앞 단계 브랜치다(시작 기준점)
  - `ops/lib.sh: No such file or directory`에 이어 `log: command not found`·`pg: command not found` → `deploy/ops/lib.sh`를 만들고 커밋했는지(`git ls-files -s deploy/ops`). 이미 돌았다면 가짜 `.last-backup-ok`를 지운다
  - 저널에 `status=203/EXEC` → 스크립트 파일이 서버에 있는지, 실행 권한이 있는지(`ls -l /opt/node-order/ops`, 저장소의 `git ls-files -s`)
  - 저널에 `오늘 백업이 성공하지 않았다` → `journalctl -u node-order-backup`과 `/opt/node-order/.last-backup-ok`의 날짜
  - 타이머가 생각한 시각과 9시간 어긋나 돈다 → `OnCalendar`에 시간대를 적었는지(`systemd-analyze calendar`)
  - `list-timers`의 LAST가 설치 시각이다 → 정상이다. 실제 실행은 저널로 본다

## 2. 2단계: 로그

### 작업 1. [커밋] 로그가 디스크를 채우지 않게

서버의 컨테이너 로그 설정을 보면 크기 제한이 없다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> "docker info --format '{{.LoggingDriver}}'; docker inspect -f '{{json .HostConfig.LogConfig.Config}}' node-order-api-1"
json-file
{}
```

- 바깥을 큰따옴표로 감싼 것은 Go 템플릿(`{{…}}`)을 작은따옴표로 서버에 넘기기 위해서다. 이 PC의 셸이 큰따옴표 안에서 펼칠 것(`$`, 백틱)이 없으므로 그대로 서버로 간다.

`json-file` 드라이버는 기본으로 한 파일에 끝없이 쓴다. 디스크(`50-server.sh`가 만든 16GB)가 차면 DB가 RDS여도 Docker와 서버가 멈춘다.

그래서 운영 compose에서 서비스마다 제한을 건다.

```diff
# deploy/compose.yml — 맨 위에 x-logging을 두고, 다섯 서비스에 logging: *logging 한 줄씩 더한다
 name: node-order
 
+# 컨테이너 로그(json-file)는 기본으로 크기 제한 없이 쌓인다 → 파일 하나 10MB, 3개까지만 두고 오래된 것부터 지운다
+x-logging: &logging
+  driver: json-file
+  options: { max-size: "10m", max-file: "3" }
+
 services:
   caddy:
+    logging: *logging
     image: caddy:2
     restart: unless-stopped
@@
   redis:
+    logging: *logging
     image: redis:7
     restart: unless-stopped
@@
   migrate:
+    logging: *logging
     image: ghcr.io/seungwoo7050/node-order/order-api-migrate:${IMAGE_TAG:?}
     profiles: ["tools"]
@@
   api:
+    logging: *logging
     image: ghcr.io/seungwoo7050/node-order/order-api:${IMAGE_TAG:?}
     restart: unless-stopped
@@
   web:
+    logging: *logging
     image: ghcr.io/seungwoo7050/node-order/order-web:${IMAGE_TAG:?}
     restart: unless-stopped
```

커밋해 푸시하면 배포 스크립트의 `docker compose up -d`가 설정이 바뀐 컨테이너를 새로 만든다. 배포 뒤에 다시 본다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> "docker inspect -f '{{json .HostConfig.LogConfig.Config}}' node-order-api-1"
{"max-file":"3","max-size":"10m"}
```

배포 뒤에는 떠 있는 네 컨테이너(caddy, redis, api, web) 모두 이 값이다. `migrate`는 `docker compose run`으로 돌 때만 생기는 컨테이너라 평소에는 없다.

#### 로그 설정은 컨테이너를 만들 때 정해진다

로그 드라이버와 옵션은 컨테이너를 만들 때 정해지고, 떠 있는 컨테이너에서는 바꿀 수 없다. compose 파일만 고치고 컨테이너가 다시 만들어지지 않았다면 `docker inspect`는 계속 `{}`를 보여 준다.

`json-file`의 로그는 서버의 `/var/lib/docker/containers/<컨테이너 id>/<컨테이너 id>-json.log`에 쌓인다.

`docker logs`와 `docker compose logs`가 읽는 것이 이 파일이다. `max-file: "3"`이면 이 파일이 10MB를 넘을 때 옆에 번호 붙은 파일로 넘기고, 세 개를 넘으면 가장 오래된 것을 지운다.

### 용어 | Compose 문법 (로그 설정)

- `x-logging:`: `x-`로 시작하는 최상위 키는 Compose가 무시하는 확장 필드다. 여러 서비스가 함께 쓸 설정을 둘 때 쓴다.

- `&logging` / `*logging`: YAML 앵커와 별칭이다. `&`로 이름을 붙인 값을 `*`로 그대로 가져다 쓴다. 일부만 바꿀 때의 함정은 아래 "YAML 앵커와 `x-` 확장 필드"에서 다룬다.

- `max-size` / `max-file`: 로그 파일 하나의 최대 크기와 남길 파일 수다.

### 개념 | YAML 앵커와 `x-` 확장 필드

`&`와 `*`는 Compose가 아니라 YAML의 기능이다. 파일을 읽는 단계에서 `*logging` 자리에 `&logging`이 붙은 값이 그대로 복사된다.

C의 `#define`처럼 해석하기 전에 치환된다고 보면 된다. 그래서 `x-logging` 한 곳을 고치면 모든 서비스가 함께 바뀐다.

`x-`는 그 값을 놓아 둘 자리다. Compose는 최상위에 모르는 키가 있으면 거부하는데, `x-`로 시작하는 키만은 해석하지 않고 넘어간다.

`docker compose config`는 compose 파일을 읽어 최종 설정을 펼쳐 보여 준다. 서버에 올리지 않고 이 PC의 저장소 루트에서 바로 확인할 수 있다. `--no-interpolate`는 `${IMAGE_TAG:?}` 같은 변수를 채우지 않고 그대로 둔다. 이 PC에는 서버의 `.env`가 없으므로, 이것을 빼면 문법을 보기도 전에 `required variable IMAGE_TAG is missing a value`로 멈춘다.

```sh
# x-logging을 logging-defaults로 잠깐 바꾸고
docker compose -f deploy/compose.yml config --no-interpolate
validating …/deploy/compose.yml: (root) Additional property logging-defaults is not allowed
```

확인했으면 `x-logging`으로 되돌린다.

서비스 하나만 조금 다르게 하려면 YAML의 병합 키 `<<:`를 쓴다.

도전 과제 2에서 `api`만 다른 드라이버를 쓰는 경우가 이렇다. 단, 병합은 한 단계만 한다.

```yaml
services:
  api:
    logging:
      <<: *logging
      options: { max-size: "50m" } # options만 바꾸려는 의도
```

```sh
docker compose -f deploy/compose.yml config --no-interpolate
# api의 logging 부분
    logging:
      driver: json-file
      options:
        max-size: 50m
```

`max-file: "3"`이 사라졌다. `<<:`는 `options` 안까지 섞지 않고, 같은 이름의 키(`options`)를 통째로 바꾼다.

- 바꿀 키가 중첩된 값 안에 있으면, 그 안의 값을 모두 다시 적는다(`options: { max-size: "50m", max-file: "3" }`).

- 앵커는 같은 YAML 파일 안에서만 쓸 수 있다.

- 결과가 의심스러우면 `docker compose config`로 펼쳐진 최종 설정을 본다. 앵커와 별칭이 모두 풀린 모양으로 나온다.

> 펼친 뒤에는 서비스마다 자기 값을 가진다. 위처럼 `api`에서 `options`를 바꿔도, `*logging`을 그대로 쓴 `caddy`는 `max-file: "3"`을 유지한다.

### 작업 2. [커밋] JSON 로그를 jq로 읽기

API 로그는 [`07`](https://github.com/seungwoo7050/node-order/tree/07-operations)에서 붙인 pino JSON이다. 운영(`NODE_ENV=production`)에서는 `pino-pretty`를 거치지 않아 한 줄이 JSON 하나다. 요청 한 건은 이렇게 생겼다(줄임).

```json
{"level":30,"time":1768570327438,"pid":7,"hostname":"99db01b63ed3","req":{"id":"6571b735-…","method":"GET","url":"/health/ready","query":{},"headers":{…},"remoteAddress":"::ffff:127.0.0.1"},"trace_id":"c715bc86…","span_id":"21cf94af…","res":{"statusCode":200,"headers":{…}},"responseTime":29,"msg":"GET /health/ready 200 29ms"}
```

지금 서버의 로그에서 바로 볼 수 있다. 배포를 기다릴 필요가 없다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'cd /opt/node-order && docker compose logs api --no-log-prefix --since 1h | grep "^{" | tail -1'
```

`req`·`res`에는 요청·응답 헤더가 통째로 들어 있어 한 줄이 길다. `trace_id`·`span_id`는 [`15`](https://github.com/seungwoo7050/node-order/tree/15-monitoring)에서 붙인 추적의 값이다.

`msg`는 `order-api-nest/src/logger/logger.options.ts`의 `customSuccessMessage`가 만든 문장이다. 사람이 읽기 좋지만 jq로 거르기에는 문장보다 필드가 낫다. 요청 줄에만 `responseTime`이 있으므로 이것으로 요청 줄을 고른다.

자주 보는 것을 한 번에 보여 주는 스크립트를 둔다.

```sh
#!/usr/bin/env bash
# deploy/ops/logs.sh
# API 로그(pino JSON)를 jq로 요약한다. 사용: ops/logs.sh [기간, 기본 1h]   예) ops/logs.sh 30m, ops/logs.sh 24h
# 헬스 체크(/health...)는 컨테이너가 10초마다 부르므로 빼고 센다 — 넣으면 하루 8,640줄이 실제 요청을 덮는다
source "$(dirname "$0")/lib.sh"
SINCE=${1:-1h}
LOGS=$(docker compose logs api --no-log-prefix --since "$SINCE" | grep '^{' || true)   # JSON 줄만(부팅 메시지 등은 빼고)
# 요청 줄은 pino-http가 남긴 것이라 responseTime이 있다. msg 문장은 logger.options.ts에서 바뀔 수 있어 쓰지 않는다
REQ='select(has("responseTime") and (.req.url | startswith("/health") | not))'

echo "== 최근 $SINCE — 상태 코드별 요청 수(헬스 체크 제외)"
echo "$LOGS" | jq -r "$REQ | .res.statusCode" | sort | uniq -c | sort -rn

echo "== 5xx 응답"
echo "$LOGS" | jq -r "$REQ | select(.res.statusCode >= 500) | \"\(.time / 1000 | todate) \(.res.statusCode) \(.req.method) \(.req.url)\"" | tail -20

echo "== 느린 요청 상위 5(밀리초)"
echo "$LOGS" | jq -r "$REQ | \"\(.responseTime) \(.req.method) \(.req.url)\"" | sort -rn | head -5

echo "== 경고·오류 로그(level 40 이상)"
echo "$LOGS" | jq -r 'select(.level >= 40) | "\(.time / 1000 | todate) \(if .level >= 50 then "ERROR" else "WARN " end) \(.msg)"' | tail -20
```

```sh
chmod +x deploy/ops/logs.sh
```

커밋해 푸시하고 배포가 끝나면 서버에서 돌린다.

<!-- 재측정 -->
```sh
/opt/node-order/ops/logs.sh 24h
== 최근 24h — 상태 코드별 요청 수(헬스 체크 제외)
      8 200
      1 204
== 5xx 응답
== 느린 요청 상위 5(밀리초)
61 GET /trpc/products.list?batch=1&input=%7B%7D
40 POST /auth/refresh
38 GET /trpc/me.orders?batch=1&input=%7B%7D
10 GET /trpc/me.profile?batch=1&input=%7B%7D
8 POST /auth/logout
== 경고·오류 로그(level 40 이상)
```

- `docker compose logs`는 `compose.yml`이 있는 폴더에서 돌아야 한다. `lib.sh`가 `/opt/node-order`로 `cd`해 두었으므로 어디서 불러도 된다.

- `--no-log-prefix`는 줄 앞의 `api-1  | ` 같은 서비스 이름을 떼어, 줄이 `{`로 시작하게 한다. 그래야 `grep '^{'`로 JSON 줄만 고를 수 있다.

### 용어 | jq 문법

- `jq -r`: 문자열을 따옴표 없이 그대로 찍는다.

- `select(조건)`: 조건이 참인 줄만 다음으로 넘긴다. 아래 "jq 필터는 JSON 값의 흐름을 잇는다"에서 다룬다.

- `has("responseTime")`: 객체에 그 키가 있으면 참이다.

- `.req.url`: 객체 안의 값을 점으로 따라가 꺼낸다.

- `startswith("/health") | not`: 앞의 결과를 `|`로 다음 필터에 넘긴다. `not`은 참·거짓을 뒤집는다.

- `"\(식)"`: 문자열 안에 식의 값을 끼워 넣는다. 스크립트에서 `\"`로 쓰인 이유는 아래에서 다룬다.

- `.time / 1000 | todate`: pino의 밀리초 시각을 초로 바꾼 뒤 ISO 날짜 문자열로 만든다.

- `if 조건 then A else B end`: 조건에 따라 값을 고른다.

### 개념 | jq 필터는 JSON 값의 흐름을 잇는다

jq는 입력에서 JSON 값을 하나씩 꺼내 필터에 통과시킨다. pino 로그는 한 줄이 JSON 하나이므로 필터가 줄마다 한 번 돈다.

필터 안의 `|`는 셸의 파이프처럼 앞의 결과를 뒤 필터의 입력으로 넘긴다.

아래 예의 `logs.txt`는 위 모양의 로그 세 줄이다. `GET /health/ready` 요청, `POST /auth/refresh` 요청, 그리고 요청이 아닌 경고 한 줄(`{"level":40,...,"msg":"slow query"}`)이다.

이 PC에서 치는 예다. `logs.txt`는 아무 폴더에나 만들어 두고 그 폴더에서 친다.

```sh
jq -r '.req.url' logs.txt
/health/ready
/auth/refresh
null

jq -r 'select(.level >= 40) | .msg' logs.txt
slow query
```

- 없는 필드를 꺼내면 에러가 아니라 `null`이다. 세 번째 줄에는 `req`가 없다.

- `select`는 값을 바꾸지 않는다. 조건이 거짓이면 그 값을 흐름에서 뺀다.

- `and`는 왼쪽이 거짓이면 오른쪽을 보지 않는다. `REQ`가 `has("responseTime")`을 먼저 보는 이유다. 순서를 바꾸면 경고 줄에서 `null`에 `startswith`를 부르게 되어, 앞의 줄들을 찍은 뒤 `jq: error (at logs.txt:3): startswith() requires string inputs`로 실패한다(종료 코드 5).

`logs.sh`는 jq 프로그램을 셸 문자열로 넘긴다. 따옴표에 따라 누가 무엇을 펼치는지가 달라진다.

| 셸에서 쓴 모양 | 결과 |
|---|---|
| `"$REQ \| \"\(.responseTime) ...\""` | 셸이 `$REQ`를 펼친다. jq의 문자열 따옴표는 셸에 먹히지 않게 `\"`로 쓴다 |
| `'select(.level >= 40) \| "\(.time ...)"'` | 셸이 아무것도 펼치지 않는다. jq 문자열을 `"` 그대로 쓴다 |
| `'$REQ \| .res.statusCode'` | jq가 `$REQ`를 자기 변수로 읽는다. `jq: error: $REQ is not defined` |

> 셸의 `|`는 줄 단위 텍스트를, jq의 `|`는 JSON 값을 넘긴다. 둘이 한 줄에 섞여 있으면 따옴표 안쪽이 jq의 것이다.

### 개념 | 무엇을 세고 무엇을 볼 수 없는가

#### 헬스 체크는 빼고 센다

컨테이너 헬스 체크가 10초마다 `/health/ready`를 부른다(`deploy/compose.yml`의 `interval: 10s`). 하루면 8,640줄이라 실제 요청을 덮는다.

#### 문장이 아니라 필드로 고른다

`msg`는 사람이 읽으라고 만든 문장이라, 로거 설정 한 줄로 모양이 바뀐다. pino-http의 기본 문장(`request completed`)을 기대한 필터는 지금 설정(`customSuccessMessage`)에서는 한 줄도 고르지 못하고, 에러 없이 빈 결과만 낸다. 기계가 고를 때는 구조가 정해진 필드(`responseTime`, `res.statusCode`)를 쓴다.

#### 24시간을 물었는데 몇 줄뿐이다

`docker compose logs`는 지금 컨테이너의 로그만 보여 준다.

배포로 컨테이너가 다시 만들어지면 그 전 로그는 사라진다. 서버를 지우면 전부 사라진다.

> 그래서 실무에서는 로그를 서버 밖(CloudWatch Logs, Loki 등)으로 보낸다. 이 문서는 범위 밖으로 둔다(도전 과제 2).

### 남길 것

- **찾아보면 되는 것**: `max-size`·`max-file`의 값 형식, YAML 앵커·별칭·병합 키(`<<:`)의 문법, jq의 `select`·`has`·`todate`·`"\(식)"`·`if ... then ... else ... end`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - `json-file` 로그는 기본으로 제한 없이 쌓여 디스크를 채운다. 로그 설정은 컨테이너를 만들 때 정해지므로, 바꾼 뒤 컨테이너가 다시 만들어져야 적용된다.
  - `docker compose logs`는 지금 컨테이너의 로그뿐이다. 재배포나 서버 삭제 전의 일을 물으려면 로그를 서버 밖으로 보내야 한다.
  - 헬스 체크처럼 기계가 부르는 요청은 빼고 센다. 넣으면 실제 요청이 묻힌다.
  - 로그를 기계로 거를 때는 사람용 문장(`msg`)이 아니라 필드를 본다. 문장이 바뀌면 필터는 에러 없이 빈 결과를 낸다.

- **에러 신호**:
  - 배포 뒤에도 `docker inspect ... LogConfig.Config`가 `{}` → `deploy/compose.yml`의 그 서비스에 `logging: *logging`이 있는지, 서버의 `compose.yml`이 새 것인지
  - `Additional property logging-defaults is not allowed` → 공유 설정의 최상위 키가 `x-`로 시작하는지
  - `startswith() requires string inputs` → `and`의 왼쪽에서 요청 줄만 먼저 골랐는지
  - `jq: error: $REQ is not defined` → 셸 변수를 작은따옴표 안에 넣었다. 큰따옴표로 감싼다
  - `jq: command not found` → 서버에 jq가 없다. `sudo apt-get install -y jq`
  - 요청이 있었는데 `logs.sh`의 요청 수가 비어 있다 → 필터가 `msg` 문장에 기대는지. 요청 줄 하나를 `jq .`로 보고 필드 이름을 확인한다

## 3. 3단계: 일부러 장애 내기

연습은 운영 서버에서 한다. 이 PC에서 1초마다 `/health/ready`를 불러 결과를 본다. 서비스가 잠깐씩 멈추므로 사람이 적은 시간에 한다.

### 작업 1. [확인] 이 PC에서 1초마다 상태 보기

실험하는 동안 다른 터미널에 켜 둔다. 주소는 저장소 Variables의 `API_HOST`와 같다.

```sh
API=https://<API_HOST>
while true; do
  printf '%s ' "$(date +%T)"
  curl -s -m 2 -w ' %{http_code}\n' "$API/health/ready"
  sleep 1
done
```

- `-m 2`는 2초 안에 응답이 없으면 포기한다. 서버가 꺼져 있을 때 한 번에 오래 멈춰 있지 않게 한다.

- 응답을 받지 못하면 `%{http_code}`가 `000`을 찍는다. 재부팅 실험에서 보는 `000`이 이것이다.

- `API`는 반드시 `https://`로 시작해야 한다. 저장소 변수 `API_HOST`에는 주소만 있고 `https://`가 없다. 그 값만 넣거나 `http://`로 적으면 본문 없이 `308`만 찍힌다. curl은 주소에 방식이 없으면 `http://`로 보내는데, Caddy는 HTTPS 인증서를 받은 주소로 들어온 HTTP 요청을 모두 같은 주소의 `https://`로 돌려보낸다(`308 Permanent Redirect`, `Location: https://…`). `deploy/Caddyfile`에 따로 적지 않아도 Caddy가 알아서 하는 일(자동 HTTPS)이다. 브라우저는 이 응답을 따라가지만, curl은 `-L`을 주지 않으면 따라가지 않고 `308`에서 멈춘다. 감시는 `/health/ready`의 응답을 봐야 하므로 `-L`로 가리지 말고 주소를 `https://`로 고친다.

- 컨테이너 상태는 서버에서 `docker compose ps`로 본다. `Up ... (healthy)`, `Exited (0)` 같은 STATUS 칸이 아래 결과에 나온다.

- 아래 결과 블록은 감시 화면과 `docker compose ps`, 상품 목록·데모 로그인을 손으로 불러 본 결과를 시각 순으로 모은 것이다.

### 실험 | Redis를 사람이 멈춘다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'cd /opt/node-order && docker compose stop redis'
```

```text
== 13:13:07 멈추기 전
  ready      {"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok"}} 200
  상품 목록   200
  데모 로그인  200
== 13:13:15 Redis 멈춘 뒤
  ready      {"status":"fail","checks":{"db":"ok","redis":"1000ms 초과","storage":"ok"}} 503
  상품 목록   200
  데모 로그인  200
== 13:13:48 30초 뒤 컨테이너 상태 (/opt/node-order/ 위치에서 docker compose ps)
  api Up 14 minutes (healthy)
  redis Exited (0) 38 seconds ago
== Redis를 켜고 1초 뒤 ready 200 (/opt/node-order/ 위치에서 docker compose up -d redis)
```

확인했으면 Redis를 다시 켠다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'cd /opt/node-order && docker compose start redis'
```

#### 감지는 된다

`07`의 `/health/ready`(`health.controller.ts`)가 503과 함께 무엇이 문제인지(`redis: 1000ms 초과`) 알려 준다.

검사마다 1초 상한(`withTimeout(check(), 1000)`)을 두었기 때문에, 멈춘 Redis를 끝없이 기다리지 않고 1초 뒤 실패로 답한다.

#### 일부만 멈춘다

상품 목록과 데모 로그인은 Redis를 쓰지 않아 그대로다.

Redis를 쓰는 것만 영향을 받는다. [`13`](https://github.com/seungwoo7050/node-order/tree/13-authjs)의 GitHub 로그인 일회용 코드(`auth-code.store.ts`), 실시간 알림(`redis-io.adapter.ts`), [`04`](https://github.com/seungwoo7050/node-order/tree/04-redis)의 메일 큐(`mail.queue.ts`)다.

#### 30초가 지나도 API 컨테이너는 healthy다

헬스 체크는 10초 간격으로 6번 연속 실패해야 unhealthy가 된다(`deploy/compose.yml`의 `interval: 10s`, `retries: 6`).

그리고 **Docker는 unhealthy가 되어도 아무것도 하지 않는다.** 재시작 정책은 컨테이너가 "끝났을 때"만 동작한다.

> 누군가 알아야 한다. [`15`](https://github.com/seungwoo7050/node-order/tree/15-monitoring)의 경보 같은 장치가 운영 서버에도 있어야 하는 이유다(도전 과제 3).

#### 사람이 멈춘 컨테이너는 다시 켜지지 않는다

`restart: unless-stopped`이기 때문이다. 켜자 1초 만에 돌아온다.

### 실험 | Redis가 스스로 끝난다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'cd /opt/node-order && docker compose exec -T redis redis-cli shutdown nosave'
```

<!-- 재측정 -->
```text
재시작 횟수(전): 0
  redis Up Less than a second
== 죽고 나서 1초 뒤 ready 200(사람이 아무것도 하지 않음)
재시작 횟수(후): 1
  마지막 종료 코드 0, 시작 2026-01-17T13:14:25Z
```

재시작 횟수와 마지막 종료 코드는 서버에서 `docker inspect -f '{{.RestartCount}} {{.State.ExitCode}} {{.State.StartedAt}}' node-order-redis-1`로 본다.

```text
1 0 2026-01-17T14:42:44.425776146Z
```

사람이 멈추지 않고 프로세스가 스스로 끝나면, 재시작 정책이 곧바로 다시 띄운다. **같은 "멈춤"이라도 누가 멈췄는지에 따라 결과가 다르다.**

### 개념 | 재시작 정책은 "누가 멈췄는가"를 본다

Docker는 컨테이너마다 "사람이 멈췄다"는 표시를 기억한다. `docker stop`(`docker compose stop`)은 이 표시를 남기고, 프로세스가 스스로 끝나거나 죽으면 표시가 없다.

| 정책 | 프로세스가 스스로 끝남 | 사람이 `stop`한 뒤 | 사람이 멈춘 것을 Docker·서버가 다시 켜질 때 |
|---|---|---|---|
| `no`(기본) | 그대로 둔다 | 그대로 둔다 | 켜지 않는다 |
| `on-failure` | 0이 아닌 코드일 때만 다시 띄운다 | 그대로 둔다 | 켜지 않는다 |
| `always` | 다시 띄운다 | 그대로 둔다 | 켠다 |
| `unless-stopped` | 다시 띄운다 | 그대로 둔다 | 켜지 않는다 |

- 위 실험의 Redis는 종료 코드 0으로 끝났는데도 다시 떴다. `unless-stopped`는 종료 코드를 보지 않기 때문이다. `on-failure`였다면 그대로 꺼져 있었을 것이다.

- 어느 정책도 헬스 체크 결과는 보지 않는다. unhealthy 컨테이너를 다시 띄우려면 따로 장치가 필요하다(Docker Swarm·Kubernetes 같은 오케스트레이터, 또는 경보를 받은 사람).

### 실험 | 서버를 재부팅한다.

커널 보안 업데이트 등으로 실제로 생기는 일이다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'sudo systemctl reboot'
# 이 PC에서 1초마다 /health/ready
```

<!-- 재측정 -->
```text
  0초: 응답 없음/실패(000)
  25초: 502
  29초: ready 200 — 멈춘 시간 약 29초
  api Up 13 seconds (healthy)
  caddy Up 13 seconds
  redis Up 13 seconds
  web Up 13 seconds
  (타이머 두 개도 그대로)
```

사람이 아무것도 하지 않아도 돌아온다. 세 가지가 맞물린 결과다.

- Docker 서비스는 부팅할 때 켜진다(Ubuntu 패키지의 기본값).

- 컨테이너는 `restart: unless-stopped`이다.

- 타이머는 `enable`해 두었다.

그래도 **잠깐은 멈춘다.** 서버가 한 대인 한 피할 수 없다.

#### 멈춘 동안 응답은 두 번 바뀐다: `000` → `502` → `200`

감시 화면의 숫자는 "요청이 어디까지 닿았는가"를 보여 준다. 요청은 이 PC → 서버의 Caddy(443) → API 컨테이너(4000)로 간다.

| 감시 화면 | 그때 서버 | 누가 답했나 |
|---|---|---|
| `000` | 꺼졌거나 부팅 중이다. 443번 포트에서 받는 프로세스가 없다 | 아무도. curl이 2초(`-m 2`) 안에 연결하지 못하고 포기했다 |
| `502` | Caddy는 떴는데 API 컨테이너의 Node가 아직 4000번을 열지 않았다 | Caddy. 뒤로 넘기려다 실패해서 본문 없이 `502 Bad Gateway`로 답했다 |
| `503` | API는 떴지만 의존 서비스(DB·Redis·S3) 검사 하나가 아직 실패한다 | API. 이번 재부팅에서는 보이지 않았지만 Redis가 늦게 뜨면 끼어든다 |
| `200` | 다 떴다 | API |

`502`는 Caddy가 자기 로그에 이유를 남긴다. 재부팅 직후 서버에서 보면 이렇다(줄임).

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'cd /opt/node-order && docker compose logs caddy --since 10m --no-log-prefix | grep "connection refused" | tail -1'
{"level":"error","logger":"http.log.error","msg":"dial tcp 172.18.0.4:4000: connect: connection refused","request":{…,"uri":"/health/ready",…}}
```

`dial tcp …:4000: connect: connection refused`는 API 컨테이너의 주소에는 닿았지만 4000번에서 받는 프로세스가 없었다는 뜻이다. 컨테이너는 떴고 Node가 Nest를 띄우는 중이다.

#### 부팅 때는 `depends_on`이 순서를 지켜 주지 않는다

`deploy/compose.yml`에는 `caddy`가 `web`·`api`에, `web`이 `api`의 healthy에 기대도록(`depends_on`) 적혀 있다. 그런데 재부팅 직후 네 컨테이너의 시작 시각을 보면 거의 같다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'docker inspect -f "{{.Name}} {{.State.StartedAt}}" node-order-caddy-1 node-order-api-1 node-order-redis-1 node-order-web-1'
/node-order-caddy-1 2026-01-17T14:44:15.922505325Z
/node-order-api-1 2026-01-17T14:44:15.920312503Z
/node-order-redis-1 2026-01-17T14:44:15.925831621Z
/node-order-web-1 2026-01-17T14:44:15.940953592Z
```

`depends_on`은 `docker compose up`이 컨테이너를 만들고 켤 때 Compose가 지키는 순서다. 부팅 때 컨테이너를 다시 켜는 것은 Compose가 아니라 Docker 데몬이고, 데몬은 재시작 정책(`unless-stopped`)만 보고 모두 한꺼번에 켠다. 그래서 가볍게 뜨는 Caddy가 먼저 443을 받기 시작하고, Nest가 4000을 열 때까지 몇 초 동안 `502`가 난다. 이번에는 Caddy의 첫 `connection refused`부터 API의 `Starting Nest application...`까지 약 6초였다.

- 그 사이에 접속한 사용자도 같은 `502`를 본다. 서버가 꺼져 있던 `000` 구간과 합친 것이 실제로 멈춘 시간이다.

- 이 틈은 서버가 한 대이고 부팅 순서를 데몬에 맡기는 한 남는다. 줄이려면 Caddy가 API의 준비를 확인하고 넘기게 하거나(Caddy의 `reverse_proxy` 헬스 체크 옵션), 앞에 로드 밸런서를 두고 서버를 여러 대로 한다(9장 "이 문서에서 다루지 않은 것").

> C로 치면 서버 프로세스를 띄운 직후 `listen()`에 닿기 전에 들어온 `connect()`가 `ECONNREFUSED`를 받는 것과 같다. Caddy는 그 실패를 클라이언트에게 `502`로 바꿔 전한다.

### 남길 것

- **찾아보면 되는 것**: `docker compose stop`·`start`·`ps`, `redis-cli shutdown nosave`, 헬스 체크의 `interval`·`retries`, 재시작 정책 네 가지의 이름. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - Docker의 재시작 정책은 컨테이너가 "끝났을 때"만 움직인다. unhealthy는 표시일 뿐이고, 사람이 `stop`한 컨테이너는 `unless-stopped`가 다시 켜지 않는다.
  - readiness는 문제를 "감지"할 뿐 누구에게도 "알리지" 않는다. 사람에게 닿는 경보가 따로 있어야 한다.
  - 서버가 한 대면 재부팅 동안은 반드시 멈춘다.
  - `depends_on`은 `docker compose up` 때만 순서를 지킨다. 부팅 때 데몬이 다시 켜는 컨테이너는 한꺼번에 뜨므로, 앞단(Caddy)이 뒷단(API)보다 먼저 받기 시작하는 틈이 생긴다.

- **에러 신호**:
  - `/health/ready`가 503이고 `"redis":"1000ms 초과"` → 그 의존 서비스의 컨테이너 상태(`docker compose ps`)
  - `/health/ready`가 503인데 `api`는 `(healthy)` → 정상이다. 6번 연속 실패해야 unhealthy가 되고, 그래도 Docker는 아무것도 하지 않는다
  - 재부팅 직후 몇 초 동안 `502`, Caddy 로그에 `dial tcp …:4000: connect: connection refused` → API가 아직 4000번을 열지 않았다. 몇 초 뒤 200이면 정상이다. 계속되면 `docker compose logs api`
  - `redis Exited (0)`인 채로 다시 뜨지 않는다 → 사람이 멈춘 것이다. `docker compose start redis`
  - 감시 화면에 본문 없이 `308`만 찍힌다 → `API`가 `https://`로 시작하는지(Caddy가 HTTP를 HTTPS로 돌려보낸 것이다)

## 4. 4단계: 백업과 복원

### 작업 1. [커밋] 매일 백업

`18`의 `40-database.sh`는 RDS를 `--backup-retention-period 0`으로 만들었다. 자동 백업이 꺼져 있어서, 지금 이 DB의 백업은 하나도 없다. 먼저 매일 `pg_dump`를 떠서 S3에 둔다. 자동 백업은 작업 4에서 켜고 둘을 비교한다.

```sh
#!/usr/bin/env bash
# deploy/ops/backup.sh
# DB를 pg_dump로 떠서 S3(backups/)에 올린다. systemd 타이머가 매일 부른다
# - 덤프를 서버 디스크에 쓰지 않는다: pg_dump의 출력을 그대로 S3 업로드로 흘린다(파이프)
# - 보관 기간은 S3 수명 주기 규칙이 정한다(aws/70-backups.sh — 7일 뒤 삭제)
# - 덤프가 중간에 실패해도 업로드는 받은 만큼 올라간다 → 임시 경로에 올리고, 끝까지 성공했을 때만 backups/로 옮긴다
source "$(dirname "$0")/lib.sh"

KEY="backups/order_api-$(date -u +%Y%m%dT%H%M%SZ).dump"
TMP="backups-partial/${KEY#backups/}"   # backups/ 밖 — 복원 확인(restore-check.sh)이 잘린 덤프를 고르지 않게
trap 'aws_ s3 rm "s3://$BUCKET/$TMP" --only-show-errors || true' ERR   # 실패하면 올라간 조각을 지운다
log "백업 시작 → s3://$BUCKET/$KEY"
# --format=custom : 압축되고, pg_restore로 테이블 단위 복원도 된다 / --no-owner : 복원할 때 소유자를 그쪽 사용자로
pg sh -c 'pg_dump "$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem" --format=custom --no-owner' \
  | aws_ s3 cp - "s3://$BUCKET/$TMP" --only-show-errors
aws_ s3 mv "s3://$BUCKET/$TMP" "s3://$BUCKET/$KEY" --only-show-errors
trap - ERR
SIZE=$(aws_ s3api head-object --bucket "$BUCKET" --key "$KEY" --query ContentLength --output text)
log "백업 끝: $KEY ($SIZE 바이트)"
TZ=Asia/Seoul date +%F > .last-backup-ok   # 데모 초기화(reset-demo.sh)가 "오늘 백업이 됐는가"를 이 파일로 본다
```

```sh
chmod +x deploy/ops/backup.sh
```

커밋해 푸시하고 배포가 끝나면 서버에서 한 번 돌린다.

```sh
time /opt/node-order/ops/backup.sh
2026-01-17T15:05:01Z 백업 시작 → s3://node-order-images-<계정 번호>/backups/order_api-20260117T150501Z.dump
...
2026-01-17T15:05:15Z 백업 끝: backups/order_api-20260117T150501Z.dump (32703 바이트)
real    0m14.226s
user    0m0.065s
sys     0m0.078s
```

> 처음에는 postgres·aws-cli 이미지를 받느라 오래 걸리고, 두 번째부터는 몇 초다.

이제 1장 작업 3의 "설치하고 한 번 돌려 보기"에서 미뤄 둔 `sudo systemctl start node-order-backup` 확인을 돌릴 수 있다.

- 덤프는 소유자 계정(`ADMIN_DATABASE_URL`의 `order_owner`)으로 뜬다. [`10`](https://github.com/seungwoo7050/node-order/tree/10-rls)에서 `orders`·`order_items`에 행 수준 보안(RLS)을 켰지만 `FORCE`는 하지 않았으므로, 표의 소유자에게는 정책이 걸리지 않고 모든 행이 덤프에 들어간다. 앱 계정(`DATABASE_URL`의 `order_app`)으로 뜨면 정책에 걸린다.

### 용어 | pg_dump·AWS CLI 옵션

- `pg_dump --format=custom`: 압축된 형식으로 뜬다. `psql`이 아니라 `pg_restore`로 읽으며, 아래 "custom 형식은 `pg_restore`로 읽는다"에서 다룬다.

- `pg_dump --no-owner`: 복원할 때 소유자를 복원하는 쪽 사용자로 둔다.

- `aws s3 cp - <주소>`: 파일 대신 표준 입력(`-`)을 받아 그대로 올린다.

- `aws s3 mv`: S3 안에서 객체를 다른 키로 옮긴다.

- `${KEY#backups/}`: 셸의 변수 펼치기다. 값의 앞에서 `backups/`를 떼어 낸다.

### 개념 | custom 형식은 `pg_restore`로 읽는다

`pg_dump`의 기본 출력(plain)은 SQL 문장을 늘어놓은 텍스트라 `psql`에 그대로 넣어 실행한다.

`--format=custom`은 `pg_dump` 전용의 압축 형식이다. `psql`은 이것을 읽지 못하고, `pg_restore`가 읽는다.

이 PC의 임시 postgres 컨테이너(표 `products`, `users`)에서 확인한 모양이다. 컨테이너 안에서 친 명령이고, 접속 옵션(`-U postgres`)은 줄였다.
```sh
pg_dump --format=custom --no-owner postgres > a.dump
head -c 5 a.dump
PGDMP

psql -d r1 < a.dump
The input is a PostgreSQL custom-format dump.
Use the pg_restore command-line client to restore this dump to a database.

pg_restore --no-owner -d r1 < a.dump # 전부 복원한다(작업 3이 이렇게 쓴다)
pg_restore --no-owner -t products -d r2 < a.dump # 표 하나만 복원한다
pg_restore -l < a.dump # 목차만 본다
217; 1259 16384 TABLE public products postgres
218; 1259 16387 TABLE public users postgres
3422; 0 16384 TABLE DATA public products postgres
3423; 0 16387 TABLE DATA public users postgres
pg_restore -f - < a.dump # DB에 넣지 않고 SQL로 풀어서 찍는다
```

| 구분 | plain(기본) | custom(`--format=custom`) |
|---|---|---|
| 내용 | SQL 텍스트 | 압축된 전용 형식(`PGDMP`로 시작) |
| 복원 | `psql` | `pg_restore` |
| 표 하나만 복원 | 파일을 직접 잘라야 한다 | `pg_restore -t 표` |
| 내용 보기 | 그대로 읽는다 | `pg_restore -l`, `pg_restore -f -` |

- 백업 파일 이름의 `.dump`는 관례일 뿐이다. 형식은 파일 앞의 `PGDMP`로 알아본다.

- `pg_restore`도 파일 대신 표준 입력을 받는다. 작업 3이 S3에서 받은 덤프를 파이프로 바로 넘기는 이유다.

- `--no-owner`는 `pg_restore`에도 있다. 작업 3은 복원 쪽에도 붙였다.

> 작업 4 다음의 "RDS 자동 백업과 `pg_dump`는 서로를 대신하지 않는다"에서 말하는 "표 하나만 꺼낼 때"가 `pg_restore -t`다. plain 형식이었다면 SQL 파일에서 그 표의 부분을 손으로 찾아야 한다.

### 개념 | 백업 스크립트가 지키는 것

#### 덤프를 서버 디스크에 쓰지 않는다

`pg_dump`의 출력을 파이프로 S3 업로드(`aws s3 cp - ...`)에 바로 흘린다. 서버에 사용자 정보가 담긴 파일이 남지 않고, 디스크 크기와도 상관없다.

#### 끝까지 성공한 덤프만 `backups/`에 둔다

파이프 앞의 `pg_dump`가 중간에 실패해도 `aws s3 cp -`는 그때까지 받은 만큼을 올린다. 그대로 두면 잘린 덤프가 "가장 최근 백업"이 된다.

그래서 `backups-partial/`에 올렸다가 성공하면 옮기고, 실패하면 `trap`으로 지운다. `trap`마저 돌지 못해 남은 조각은 작업 2의 수명 주기 규칙이 하루 뒤 지운다.

#### 실패를 알아채는 것은 `pipefail`이다

위 장치는 "파이프가 실패했다"를 셸이 알아야 돈다. 실패했을 때 일어나는 순서는 이렇다.

1. `pg_dump`가 0이 아닌 코드로 끝난다. 뒤의 `aws_ s3 cp -`는 받은 만큼 올리고 0으로 끝난다.

2. `pipefail`(0장 개념 3) 덕분에 파이프 전체가 실패로 판정된다. `pipefail`이 없으면 마지막 명령의 0만 보고 성공으로 지나간다.

3. `set -e`가 스크립트를 멈추기 직전에 `trap ... ERR`이 `backups-partial/`의 조각을 지운다.

4. `aws_ s3 mv`와 `.last-backup-ok` 쓰기는 실행되지 않는다. 그날의 데모 초기화(1장 작업 2)는 백업이 없다고 보고 멈춘다.

5. 스크립트가 0이 아닌 코드로 끝나므로 systemd가 서비스를 실패로 기록한다.

### 작업 2. [커밋] 보관 기간은 S3가 정한다

백업 스크립트가 옛 파일을 지우는 일까지 하면, 스크립트가 틀렸을 때 백업이 모두 사라질 수 있다. 그래서 7일 뒤 삭제는 S3 수명 주기 규칙에 맡긴다.

이 스크립트는 서버가 아니라 이 PC에서 `18`의 AWS 스크립트들과 같은 자리(`deploy/aws/`)에 둔다.

```sh
#!/usr/bin/env bash
# deploy/aws/70-backups.sh
# 백업(backups/)의 보관 기간. 7일이 지난 덤프는 S3가 알아서 지운다 — 백업 스크립트가 지우는 일을 하지 않는다
# 상품 이미지(products/)에는 걸리지 않게 접두사로 한정한다
# put-bucket-lifecycle-configuration은 버킷의 규칙 전체를 바꾼다 → 이 버킷의 규칙은 모두 여기에 모은다
source "$(dirname "$0")/lib.sh"
BUCKET=$(bucket_name)

step "수명 주기 규칙: backups/ 7일, backups-partial/ 1일 뒤 삭제"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [
    {
      "ID": "expire-db-backups",
      "Status": "Enabled",
      "Filter": {"Prefix": "backups/"},
      "Expiration": {"Days": 7}
    },
    {
      "ID": "expire-partial-dumps",
      "Status": "Enabled",
      "Filter": {"Prefix": "backups-partial/"},
      "Expiration": {"Days": 1}
    }
  ]
}' > /dev/null   # 응답(기본 최소 크기 설정)은 보지 않는다
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --query 'Rules[].{id:ID,prefix:Filter.Prefix,days:Expiration.Days,status:Status}'
```

`lib.sh`는 `ops/lib.sh`가 아니라 `18`에서 만든 `aws/lib.sh`다. `bucket_name`과 `step`이 거기에 있고, 프로필(`node-order`)과 리전(`ap-southeast-2`)의 기본값도 거기서 정한다.

```sh
chmod +x deploy/aws/70-backups.sh
cd deploy/aws
./70-backups.sh
```

<!-- 재측정 -->
```sh
== 수명 주기 규칙: backups/ 7일, backups-partial/ 1일 뒤 삭제
[
    {
        "id": "expire-db-backups",
        "prefix": "backups/",
        "days": 7,
        "status": "Enabled"
    },
    {
        "id": "expire-partial-dumps",
        "prefix": "backups-partial/",
        "days": 1,
        "status": "Enabled"
    }
]
```

다시 실행해도 결과는 같다. 규칙 하나만 있던 버킷에 돌리면 두 개로 바뀐다.

- `backups/`로 한정했으므로 상품 이미지(`products/`)에는 걸리지 않는다. 고아 이미지 정리(`06`)도 `products/`만 보므로 백업을 건드리지 않는다.

- `put-bucket-lifecycle-configuration`은 규칙을 더하는 것이 아니라 버킷의 규칙 전체를 이 내용으로 바꾼다. 지금 버킷에는 `30-storage.sh`가 건 규칙이 없어서 괜찮다. 나중에 규칙을 더할 때는 이 JSON의 `Rules`에 함께 적는다.

- 둘째 규칙은 `backup.sh`가 끝내 치우지 못한 조각을 맡는다. `backup.sh`는 실패하면 `trap … ERR`로 `backups-partial/`의 조각을 지우지만, 그 `trap`이 돌지 못하거나 실패하는 경우가 있다.
  - 백업 도중 서버가 재부팅되거나 프로세스가 강제로 죽으면(`SIGKILL`) 셸이 실패를 알아챌 틈이 없어 `trap`이 돌지 않는다. 3장에서 해 본 재부팅이 03:30에 겹치면 이렇게 된다.
  - 네트워크가 끊겨 `aws_ s3 rm` 자체가 실패해도, `|| true`라 그냥 넘어간다.

  이렇게 남은 조각은 `backups/` 밖이라 첫째 규칙에 걸리지 않는다. 복원 확인(작업 3)이 고르지 않게 일부러 밖에 둔 자리이기 때문이다. 둘째 규칙이 없으면 영원히 남는다. 조각은 끝까지 가지 못한 덤프라 쓸 일이 없으므로 1일(수명 주기의 최소 단위)로 둔다.

- 실패를 정리하는 코드(`trap`)는 실패하는 상황에서 돌기 때문에 그 자신도 실패할 수 있다. 그래서 정리는 스크립트 하나에 맡기지 않고, 스크립트 밖에서 시간이 지나면 반드시 도는 장치(수명 주기 규칙)로 한 번 더 받친다.

### 작업 3. [커밋] 복원해 봐야 백업이다.

"백업 파일이 있다"는 "복원된다"가 아니다. 덤프가 비었거나, 판이 맞지 않거나, 권한이 빠졌을 수 있다.

그래서 최신 백업을 같은 RDS의 임시 DB에 복원해 운영과 행 수를 대조하고 지운다.

```sh
#!/usr/bin/env bash
# deploy/ops/restore-check.sh
# 가장 최근 백업을 임시 DB에 복원해 운영 DB와 행 수를 대조하고, 임시 DB를 지운다
# "백업이 있다"가 아니라 "복원된다"를 확인한다. 운영 DB는 읽기만 한다
source "$(dirname "$0")/lib.sh"
CHECK_DB=order_api_restore_check

# 백업이 하나도 없으면 Contents가 비어(null) sort_by가 실패한다 → 빈 배열로 바꿔 None을 받는다
KEY=$(aws_ s3api list-objects-v2 --bucket "$BUCKET" --prefix backups/ --query 'sort_by(Contents || `[]`, &LastModified)[-1].Key' --output text)
if [ "$KEY" = None ] || [ -z "$KEY" ]; then log "backups/에 백업이 없다"; exit 1; fi
log "복원 대상: $KEY"
# 중간에 실패해도 임시 DB가 남지 않게, 끝날 때 항상 지운다
drop_check_db() { pg sh -c 'psql "$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem" -qc "DROP DATABASE IF EXISTS '$CHECK_DB'"'; log "임시 DB를 지웠다"; }
trap drop_check_db EXIT

# 같은 RDS 안에 임시 DB를 만든다(소유자 order_owner에게 DB를 만들 권한이 있다). 주소의 DB 이름만 바꿔 쓴다
pg sh -c 'psql "$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem" -qc "DROP DATABASE IF EXISTS '$CHECK_DB'" -c "CREATE DATABASE '$CHECK_DB'"'
aws_ s3 cp "s3://$BUCKET/$KEY" - --only-show-errors \
  | pg sh -c 'pg_restore --no-owner -d "$(echo "$ADMIN_DATABASE_URL" | sed "s|/order_api?|/'$CHECK_DB'?|")&sslrootcert=/rds-ca.pem"'

# 같은 질의를 두 DB에 던져 비교한다
COUNTS="select 'users', count(*) from users union all select 'products', count(*) from products union all select 'orders', count(*) from orders union all select 'order_items', count(*) from order_items order by 1"
live=$(pg sh -c "psql \"\$ADMIN_DATABASE_URL&sslrootcert=/rds-ca.pem\" -At -F ' ' -c \"$COUNTS\"")
restored=$(pg sh -c "psql \"\$(echo \"\$ADMIN_DATABASE_URL\" | sed 's|/order_api?|/$CHECK_DB?|')&sslrootcert=/rds-ca.pem\" -At -F ' ' -c \"$COUNTS\"")
paste <(echo "$live") <(echo "$restored") | awk 'BEGIN { print "테이블        운영  복원" } { printf "%-12s %5s %5s%s\n", $1, $2, $4, ($2 == $4 ? "" : "  ← 다르다(백업 뒤에 바뀌었을 수 있다)") }'

# 행 수가 다른 것은 백업 뒤의 변경일 수 있어 경고만 한다. 표가 빠졌거나 사용자·상품이 0이면 복원 실패로 끝낸다(타이머·스크립트가 알 수 있게)
if [ "$(echo "$restored" | grep -c .)" -ne 4 ] || echo "$restored" | grep -Eq '^(users|products) 0$'; then
  log "복원 확인 실패: 표가 빠졌거나 비어 있다"; exit 1
fi
```

```sh
chmod +x deploy/ops/restore-check.sh
```

커밋해 푸시하고 배포가 끝나면 서버에서 돌린다.

```sh
time /opt/node-order/ops/restore-check.sh
2026-01-17T15:24:09Z 복원 대상: backups/order_api-20260117T150501Z.dump
테이블        운영  복원
order_items      9     9
orders           8     8
products         4     4
users            5     5
2026-01-17T15:24:13Z 임시 DB를 지웠다
real    0m5.120s
user    0m0.102s
sys     0m0.104s
```

시드만 돌린 직후라면 사용자 4, 상품 4, 주문 5, 주문 항목 0이다(`seed.ts`). 위보다 많으면 데모로 들어온 사람이 주문했거나 GitHub로 로그인한 것이다.

- 운영 DB는 읽기만 한다. 복원은 다른 이름의 DB(`order_api_restore_check`)에 하고, 중간에 실패해도 `trap`으로 지운다.

- 실패는 종료 코드로 알린다. 백업이 없거나, 복원된 표가 빠졌거나, 사용자·상품이 0이면 1로 끝난다. 행 수가 다른 것은 백업 뒤에 바뀐 것일 수 있어 표시만 한다.

- 행 수는 소유자 계정으로 센다. 작업 1의 덤프와 같은 이유로 RLS가 행을 숨기지 않는다.

- `PGOPTIONS`가 없으면 `NOTICE: database "order_api_restore_check" does not exist, skipping`이 섞여 나온다. 지우기 전에 확인하는 문장이라 숨겼다(`lib.sh`의 `pg`).

- 실제 장애에서 복원하는 순서는 같다. 대상 DB 이름만 운영 것으로 바뀐다. 그 전에 앱을 멈춰 새 쓰기가 들어오지 않게 한다.

- 대조 출력의 `paste <(...) <(...)`는 bash의 프로세스 치환이다. 두 명령의 출력을 파일처럼 넘겨 줄마다 옆으로 붙인다. 그래서 `awk`의 `$1 $2`는 운영 쪽, `$3 $4`는 복원 쪽 칸이다.

### 용어 | AWS CLI `--query` 문법(JMESPath)

- `` sort_by(Contents || `[]`, &LastModified) ``: `Contents`를 `LastModified` 순으로 정렬한다. 비어 있을 때를 대비한 `||`와 `&`의 뜻은 아래 "JMESPath 식 읽기"에서 다룬다.

- `[-1].Key`: 정렬한 배열의 마지막(가장 최근) 항목의 `Key`를 꺼낸다.

- `Rules[].{id:ID,...}`(작업 2의 수명 주기 확인): 배열의 각 항목에서 필드를 골라 새 이름의 객체로 만든다.

### 개념 | JMESPath 식 읽기

AWS CLI는 응답 JSON을 다 받은 뒤, `--query`의 JMESPath 식으로 필요한 부분만 골라 찍는다. 2장의 jq와 하는 일은 같지만 문법이 다르다.

백업 스크립트의 `--query ContentLength`(작업 1)처럼 필드 이름 하나만 적으면 그 값을 꺼낸다.

같은 식을 npm의 `jmespath` 라이브러리로 돌려 보면 각 조각이 하는 일이 보인다(응답은 `list-objects-v2`의 모양을 줄였다). 이 PC의 빈 폴더에서 `npm i jmespath`를 하고 `node`로 돌린다. 저장소에는 넣지 않는다.
```js
const { search } = require("jmespath");
const res = { Contents: [
  { Key: "backups/order_api-20260118T131129Z.dump", LastModified: "2026-01-18T13:11:32Z" },
  { Key: "backups/order_api-20260118T130952Z.dump", LastModified: "2026-01-18T13:10:12Z" },
] };

search(res, "Contents[-1].Key"); // 결과: "backups/order_api-20260118T130952Z.dump". 응답에 담긴 순서의 마지막일 뿐이다
search(res, "sort_by(Contents || `[]`, &LastModified)[-1].Key"); // 결과: "backups/order_api-20260118T131129Z.dump"

// 백업이 하나도 없으면 응답에 Contents가 없다
search({}, "sort_by(Contents, &LastModified)[-1].Key");
// 오류: sort_by() expected argument 1 to be type array but received type null instead.
search({}, "sort_by(Contents || `[]`, &LastModified)[-1].Key"); // 결과: null
```

| 조각 | 뜻 |
|---|---|
| `` `[]` `` | 백틱 안은 JSON 리터럴이다. 여기서는 빈 배열 |
| `A \|\| B` | `A`가 null이거나 비어 있으면 `B` |
| `&LastModified` | 값이 아니라 "각 항목의 `LastModified`를 보라"는 식 자체를 넘긴다 |
| `[-1]` | 배열의 마지막 항목 |
| `Rules[].{id:ID}` | 각 항목에서 골라 새 객체로 만든다 |

- `&LastModified`는 C의 `qsort`에 비교 함수를 넘기는 자리와 같다. 정렬 기준을 값이 아니라 "어떻게 꺼낼지"로 준다.

- 셸에서는 식 전체를 작은따옴표로 감싼다. 큰따옴표 안에서는 `` `[]` ``의 백틱이 셸의 명령 치환으로 읽힌다.

- `--query`는 CLI가 응답을 받은 뒤에 거른다. 받아 오는 양이 줄지는 않는다.

> `--query`의 결과가 null이면 `--output text`는 `None`이라는 글자를 찍는다. 스크립트가 빈 문자열과 함께 `[ "$KEY" = None ]`을 검사하는 이유다.

### 용어 | psql 옵션

- `-At -F ' '`: 머리글과 정렬 없이(`-A`, `-t`) 값만, 칸 사이를 공백 하나로(`-F ' '`) 찍는다. 두 결과를 나란히 비교하기 쉽다.

- `-qc "..."`: 안내 메시지 없이(`-q`) 문장 하나를 실행한다(`-c`).

### 작업 4. [커밋] RDS 자동 백업 켜기

`pg_dump`와 별도로, RDS가 스스로 뜨는 자동 백업을 켠다. 보존 기간은 1일로 둔다. 둘이 무엇을 다르게 지키는지는 아래 "RDS 자동 백업과 `pg_dump`는 서로를 대신하지 않는다"에서 비교한다.

자동 백업을 0에서 켜는 변경은 DB가 잠깐 멈출 수 있다. 3장 작업 1의 감시를 다른 터미널에 켜 두고, 사람이 적은 시간에 한다.

먼저 다음에 만들 서버를 위해 생성 스크립트를 고친다. `40-database.sh`는 RDS를 만들 때 한 번만 돈다(1장의 `user-data.sh`와 같은 사정).

```diff
# deploy/aws/40-database.sh
   --no-publicly-accessible --no-multi-az \
-  --backup-retention-period 0 \
+  --backup-retention-period 1 \
   --tags "$TAGS" \
```

지금 떠 있는 RDS는 명령으로 바꾼다. 이 PC의 터미널에서 커밋·푸시 없이 바로 친다. AWS API를 직접 불러 RDS 설정을 바꾸는 것이라 서버도 CI도 거치지 않고, 치는 즉시 적용된다. 상대 경로가 없으므로 어느 폴더에서 쳐도 된다. 위의 `40-database.sh` 수정은 다음에 만들 RDS를 위한 것이라 이 명령과 따로 커밋한다.

`aws/lib.sh`의 기본값과 같은 프로필·리전을 이 터미널에 둔다. `export`한 값은 그 터미널 창에만 남으므로 아래 명령은 같은 창에서 이어서 친다. 첫 명령이 `Your session has expired`로 실패하면 `aws login --profile node-order`로 다시 로그인한 뒤 친다.

```sh
export AWS_PROFILE=node-order AWS_REGION=ap-southeast-2 AWS_PAGER=""
aws rds modify-db-instance --db-instance-identifier node-order-db \
  --backup-retention-period 1 --apply-immediately \
  --query 'DBInstance.PendingModifiedValues'
# 출력
{
    "BackupRetentionPeriod": 1
}

aws rds wait db-instance-available --db-instance-identifier node-order-db

aws rds describe-db-instances --db-instance-identifier node-order-db \
  --query 'DBInstances[0].{retention:BackupRetentionPeriod,window:PreferredBackupWindow,restorable:LatestRestorableTime}'
  
# 출력
{
    "retention": 1,
    "window": "16:15-16:45",
    "restorable": "2026-01-17T15:28:19.799000+00:00"
}
```

- `--apply-immediately`가 없으면 다음 유지 관리 시간까지 미뤄진다.

- 켜면 RDS가 곧바로 첫 백업(스냅샷)을 뜬다. 그 뒤로는 하루에 한 번, `PreferredBackupWindow`(UTC로 적힌 30분)에 뜬다.

- `LatestRestorableTime`은 "이 시각까지는 되돌릴 수 있다"는 값이다. 보통 지금보다 몇 분 앞이다.

자동 백업으로 생긴 스냅샷을 본다.

```sh
aws rds describe-db-snapshots --db-instance-identifier node-order-db --snapshot-type automated \
  --query 'DBSnapshots[].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' --output text

# 출력
rds:node-order-db-2026-01-17-15-28      2026-01-17T15:28:19.799000+00:00        available
```

- 이름이 `rds:node-order-db-...`로 시작한다. 보존 기간이 지나면 RDS가 지운다. 사람이 지우지 않는다.

- 백업 저장 공간은 DB에 할당한 용량(20GB)까지는 따로 요금이 붙지 않는다. 보존 1일이면 이 안에 든다.

- `90-destroy.sh`는 RDS를 지울 때 `--delete-automated-backups`를 주므로, 자동 백업도 인스턴스와 함께 사라진다.

### 개념 | RDS 자동 백업과 `pg_dump`는 서로를 대신하지 않는다

<!-- 검증 안 됨: 새로 쓴 절 -->

| 구분 | RDS 자동 백업 | `pg_dump`(논리 백업) |
|---|---|---|
| 무엇을 뜨는가 | 디스크 스냅샷 + 트랜잭션 로그 | 표와 데이터를 SQL 수준으로 |
| 되돌릴 수 있는 시점 | 보존 기간 안의 아무 시각(PITR, 몇 분 전까지) | 덤프를 뜬 시각(하루 한 번) |
| 복원 결과 | **새 RDS 인스턴스**가 생긴다 | 아무 PostgreSQL의 아무 DB에 넣는다 |
| 복원 단위 | 인스턴스 통째 | DB 하나, 표 하나(`pg_restore -t`) |
| 옮기기 | 같은 엔진의 RDS로만 | 다른 판·다른 계정·이 PC의 Docker로도 |
| 누가 뜨고 지키는가 | AWS | 내가 만든 스크립트(`backup.sh`) |
| 이 문서의 보존 기간 | 1일 | 7일(S3 수명 주기) |

자동 백업이 있는데도 `pg_dump`를 매일 뜨고 복원까지 확인하는 이유는 세 가지다.

1. **자동 백업을 복원하면 새 인스턴스가 생긴다.** `restore-db-instance-to-point-in-time`은 지금 DB를 되돌리지 않고 다른 이름의 RDS를 새로 만든다. 만드는 데 몇 분이 걸리고 그동안 요금도 나간다. 매일 복원해 볼 수 있는 방법이 아니다. `restore-check.sh`는 같은 RDS 안에서 몇 초면 끝난다.

2. **`pg_dump` 쪽은 내가 짠 코드다.** `-i`를 빠뜨리거나(0장 개념 4) `pipefail`이 없으면(0장 개념 3) 에러 없이 빈 덤프나 잘린 덤프가 쌓인다. 이런 실패는 복원해 봐야만 드러난다. AWS가 뜨는 스냅샷은 그 동작을 AWS가 책임지지만, 내 스크립트는 내가 확인해야 한다.

3. **이 서비스는 매일 데이터를 지운다.** 데모 초기화(1장 작업 2)가 매일 04:00에 표를 비운다. "어제 그 사람의 주문 하나"를 꺼내려면 인스턴스를 통째로 되돌리는 PITR보다, 덤프에서 표 하나를 꺼내는 `pg_restore -t`가 맞다. 보존 1일인 자동 백업으로는 사흘 전 데이터에 닿지도 못한다.

반대로 `pg_dump`만으로는 "오늘 14시 3분, 잘못된 `UPDATE` 직전"으로 돌아갈 수 없다. 덤프 사이의 하루치 변경은 자동 백업의 트랜잭션 로그에만 있다.

> 둘은 지키는 것이 다르다. 운영이라면 자동 백업(보존 7일 이상)으로 시각 단위 복구를 하고, 논리 백업으로 표 단위 복구와 다른 곳으로 옮기기를 한다.

### 남길 것

- **찾아보면 되는 것**: `pg_dump`·`pg_restore`의 옵션(`--format=custom`, `--no-owner`, `-t`, `-l`), `aws s3 cp -`·`mv`, 수명 주기 규칙의 JSON 모양, JMESPath 문법, `psql -At -F`, `modify-db-instance --backup-retention-period`·`describe-db-snapshots`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 복원해 보지 않은 백업은 백업이 아니다. 복원 확인은 운영 DB를 읽기만 하고, 다른 이름의 DB에 복원해 대조한 뒤 지운다.
  - 파이프 앞이 실패해도 뒤는 받은 만큼 올린다. `pipefail`로 실패를 알아채고, 끝까지 성공한 것만 제자리(`backups/`)로 옮긴다.
  - 옛 백업을 지우는 일은 백업 스크립트가 아니라 S3 수명 주기에 맡긴다. 스크립트가 틀려도 백업이 한꺼번에 사라지지 않는다.
  - 실패 뒤의 정리(`trap`)도 실패할 수 있다. 재부팅·강제 종료에서는 아예 돌지 않는다. 정리가 꼭 필요한 것은 스크립트 밖의 장치(수명 주기)로 한 번 더 받친다.
  - RDS 자동 백업은 "시각"으로, `pg_dump`는 "표"로 되돌린다. 자동 백업의 복원은 새 인스턴스를 만들기 때문에 매일 확인하는 일은 `pg_dump` 쪽에서 한다.

- **에러 신호**:
  - `Unable to locate credentials` → 컨테이너에서 메타데이터에 닿지 않는다. 인스턴스의 홉 제한(`50-server.sh`의 `HttpPutResponseHopLimit=2`)
  - `The input is a PostgreSQL custom-format dump.` → custom 덤프를 `psql`에 넣었다. `pg_restore`로 읽는다
  - `sort_by() expected argument 1 to be type array but received type null instead.` → 백업이 없어 `Contents`가 null이다. `` Contents || `[]` ``
  - `backups/에 백업이 없다` → 백업 타이머의 저널(`journalctl -u node-order-backup`)
  - `복원 확인 실패: 표가 빠졌거나 비어 있다` → 그 덤프의 크기(`head-object`의 `ContentLength`)와 그날 백업 저널
  - `NOTICE: database "order_api_restore_check" does not exist, skipping` → 문제 아니다. `pg`에 `PGOPTIONS`가 빠졌는지
  - `describe-db-snapshots --snapshot-type automated`가 비어 있다 → `BackupRetentionPeriod`가 아직 0인지, 변경이 `PendingModifiedValues`에 남아 있는지(`--apply-immediately`)

## 5. 5단계: 지표와 비용

### 작업 1. [확인] EC2·RDS 지표 보기

CloudWatch의 기본 지표는 무료다. 이 PC의 터미널에서 커밋 없이 읽기 명령으로 본다. 4장 작업 4처럼 프로필·리전을 둔 창에서 아래를 차례로 친다.

```sh
export AWS_PROFILE=node-order AWS_REGION=ap-southeast-2 AWS_PAGER=""
# 서버의 인스턴스 id(aws/lib.sh의 instance_id와 같은 조회)
ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=node-order Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

# 6시간 전부터 지금까지(UTC). macOS의 date는 -v-6H, 리눅스의 date는 -d '6 hours ago'
START=$(date -u -v-6H +%FT%TZ); END=$(date -u +%FT%TZ)

# EC2: CPU 사용률과 크레딧 잔고의 시간별 평균
for m in CPUUtilization CPUCreditBalance; do
  echo "== EC2 $m"
  aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name $m \
    --dimensions Name=InstanceId,Value="$ID" --start-time "$START" --end-time "$END" \
    --period 3600 --statistics Average \
    --query 'sort_by(Datapoints, &Timestamp)[].[Timestamp, Average]' --output text
done

# 출력
== EC2 CPUUtilization
2026-01-17T18:36:00+09:00       2.2817389510678066
2026-01-17T19:36:00+09:00       2.255422795650177
2026-01-17T20:36:00+09:00       2.2595604166934895
2026-01-17T21:36:00+09:00       2.2946326961917385
2026-01-17T22:36:00+09:00       3.6218043962536712
2026-01-17T23:36:00+09:00       3.899865229142705
== EC2 CPUCreditBalance
2026-01-17T18:36:00+09:00       372.21454721527783
2026-01-17T19:36:00+09:00       393.48415645694445
2026-01-17T20:36:00+09:00       413.8854003227272
2026-01-17T21:36:00+09:00       435.2552459128206
2026-01-17T22:36:00+09:00       455.5796041227273
2026-01-17T23:36:00+09:00       474.85305251282045

# RDS: CPU 사용률, 남은 저장 공간(바이트), 연결 수의 시간별 최대
for m in CPUUtilization FreeStorageSpace DatabaseConnections; do
  echo "== RDS $m"
  aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name $m \
    --dimensions Name=DBInstanceIdentifier,Value=node-order-db --start-time "$START" --end-time "$END" \
    --period 3600 --statistics Maximum \
    --query 'sort_by(Datapoints, &Timestamp)[].[Timestamp, Maximum]' --output text
done

# 출력
== RDS CPUUtilization
2026-01-17T18:36:00+09:00       6.00325938736821
2026-01-17T19:36:00+09:00       5.408373826798908
2026-01-17T20:36:00+09:00       5.652689411018152
2026-01-17T21:36:00+09:00       5.458333333333333
2026-01-17T22:36:00+09:00       5.819277710251585
2026-01-17T23:36:00+09:00       10.089124774684558
== RDS FreeStorageSpace
2026-01-17T18:36:00+09:00       18319253504.0
2026-01-17T19:36:00+09:00       18319245312.0
2026-01-17T20:36:00+09:00       18319237120.0
2026-01-17T21:36:00+09:00       18319228928.0
2026-01-17T22:36:00+09:00       18319220736.0
2026-01-17T23:36:00+09:00       18319212544.0
== RDS DatabaseConnections
2026-01-17T18:36:00+09:00       1.0
2026-01-17T19:36:00+09:00       1.0
2026-01-17T20:36:00+09:00       2.0
2026-01-17T21:36:00+09:00       1.0
2026-01-17T22:36:00+09:00       3.0
2026-01-17T23:36:00+09:00       3.0
```

- `ID`·`START`·`END`는 이 창의 셸 변수다. 창을 새로 열면 다시 만든다.

- 시각은 UTC로 넘기지만, 결과는 CLI가 이 PC의 시간대(`+09:00`)로 바꿔 찍는다.

- `--period 3600`은 한 시간씩 묶고, `--statistics`는 그 한 시간을 무엇으로 줄일지다. 쌓이고 줄어드는 값(CPU, 크레딧)은 `Average`, 넘치면 안 되는 값(연결 수)은 `Maximum`으로 본다.

- `FreeStorageSpace`는 바이트다. 위 값은 약 18.3GB, 할당한 20GB 가운데 거의 그대로 남았다.

- `--query`는 4장의 JMESPath다. 지표는 시각 순서가 보장되지 않아 `sort_by`로 정렬한다.

### 개념 | t3는 "기준선 + 크레딧"으로 CPU를 쓴다

서버는 `50-server.sh`가 만든 t3.small이다. t3.small의 기준선은 20%다. 그보다 덜 쓰는 동안 크레딧이 쌓이고, 더 쓰면 크레딧을 꺼내 쓴다. 위 결과처럼 사용률이 기준선보다 한참 낮으면 잔고가 계속 쌓인다.

**잔고가 0이 되면 CPU가 기준선으로 묶여 갑자기 느려진다.** 그래서 t3 계열에서는 CPU 사용률보다 크레딧 잔고가 먼저 볼 지표다.

### 개념 | 서버를 줄여도 되는가

메모리는 서버에서 `free -h`와 `docker stats --no-stream`으로 본다. t3.small은 2GiB이고, `user-data.sh`가 스왑 2GiB를 더해 두었다.

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'free -h; docker stats --no-stream --format "{{.Name}} {{.MemUsage}}"'
               total        used        free      shared  buff/cache   available
Mem:           1.9Gi       856Mi       290Mi       2.8Mi       968Mi       1.0Gi
Swap:          2.0Gi        14Mi       2.0Gi
node-order-web-1 67.21MiB / 1.861GiB
node-order-api-1 257MiB / 1.861GiB
node-order-caddy-1 15.39MiB / 1.861GiB
node-order-redis-1 5.961MiB / 1.861GiB
```

- 판단은 `used`가 아니라 `available`로 한다. `buff/cache`는 디스크 캐시라 필요하면 커널이 돌려준다. 지금은 2GiB 중 약 1GiB가 남는다.

- 컨테이너 가운데 가장 큰 것은 API(약 260MiB)다.

t3.micro(1GiB)로 줄이면 스왑에 기대게 된다.

크기를 바꾸려면 서버를 멈추고 → 유형을 바꾸고 → 다시 켠다. 탄력적 IP라 주소는 그대로지만, 그동안 서비스가 멈춘다.

### 작업 2. [확인] 남은 크레딧 보기

```sh
aws freetier get-account-plan-state --query '{plan:accountPlanType,credits:accountPlanRemainingCredits.amount}'

# 출력
{
    "plan": "FREE",
    "credits": 158.93
}
```

Free 플랜은 가입할 때 크레딧을 주고, 정해진 활동(예산 설정, EC2·RDS 시작 등)을 하면 크레딧을 더 준다.

쓴 요금은 하루쯤 늦게 반영된다. 4장 작업 4에서 켠 자동 백업의 저장 공간도 여기서 무료 범위 안인지 며칠 뒤 확인한다.

> 비용을 서비스별로 보는 Cost Explorer API는 요청마다 요금($0.01)이 붙는다. 콘솔의 Billing 화면으로 본다.

### 남길 것

- **찾아보면 되는 것**: `get-metric-statistics`의 인자(`--namespace`, `--dimensions`, `--period`, `--statistics`), 지표 이름(`CPUUtilization`, `CPUCreditBalance`, `FreeStorageSpace`), `freetier get-account-plan-state`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - t3에서는 CPU 사용률보다 크레딧 잔고를 먼저 본다. 잔고가 0이 되면 CPU가 기준선(t3.small은 20%)으로 묶여 갑자기 느려진다.
  - 요금은 하루쯤 늦게 반영된다. 오늘 쓴 것은 내일 본다.

- **에러 신호**:
  - `CPUCreditBalance`가 시간마다 줄어든다 → 기준선보다 많이 쓰는 중이다. 0이 되기 전에 원인(느린 요청, 2장의 `logs.sh`)이나 서버 크기를 본다

## 6. 6단계: 배포 쪽 정리

### 작업 1. [커밋] 문서만 바꾼 푸시는 돌리지 않는다.

지금 워크플로는 가이드(`guide/README.md`)만 바꾼 커밋도 검사·이미지 빌드·배포를 모두 돌린다. 트리거가 모든 브랜치(`branches: ["**"]`)라 끝난 단계의 브랜치에서 문서를 고쳐도 검사가 돈다.

커밋마다 `[skip ci]`를 붙여 피할 수는 있지만, 기억에 기대는 방법이다. 워크플로에서 아예 거른다.

```diff
# .github/workflows/ci.yml
 on:
   push:
     branches: ["**"]
+    paths-ignore: ["**/*.md"] # 문서만 바꾼 푸시는 검사도 배포도 하지 않는다(**/는 루트의 README.md도 포함)
 
 permissions:
```

푸시한 커밋들이 바꾼 파일이 모두 이 목록에 걸리면 워크플로가 돌지 않는다. 코드 하나라도 섞여 있으면 돈다.

- 경로 패턴의 `**/`는 "폴더 0개 이상"이다. 그래서 `**/*.md`는 `guide/README.md`뿐 아니라 루트의 `README.md`에도 걸린다. 루트용 항목(`"README.md"`)을 따로 적을 필요가 없다.

### 개념 | 함정: 둘을 섞으면 돈다

스크립트 수정 커밋(`[skip ci]` 붙임) 위에 README 커밋을 얹어 한 번에 푸시하면 워크플로가 돈다. 두 장치가 보는 것이 다르기 때문이다.

| 장치 | 무엇을 보는가 |
|---|---|
| `paths-ignore` | 이번 푸시 전체에서 바뀐 파일. `.sh`가 하나라도 있으면 돈다 |
| `[skip ci]` | 이번 푸시의 맨 위 커밋 메시지. 아래 커밋의 `[skip ci]`는 보지 않는다 |

> 건너뛰려는 커밋은 따로 푸시하거나, 맨 위 커밋에 `[skip ci]`를 붙인다.

### 작업 2. [커밋] 사고: 스크립트에 실행 권한이 없었다

`ops/`를 서버로 올리는 첫 배포 뒤, 서버의 파일 권한이 이렇다면 사고다.

```text
-rw-r--r-- 1 ubuntu ubuntu  893 backup.sh
-rw-r--r-- 1 ubuntu ubuntu 1084 reset-demo.sh
```

`scp -p`는 권한을 그대로 옮긴다. 그러니 저장소에서부터 실행 권한이 없었다는 뜻이다. 1장에서 만든 `ops/`의 스크립트에 `chmod +x`가 빠지면 이렇게 된다.

`18`에서 만든 스크립트는 저장소에 실행 권한(`100755`)으로 들어 있다. `source`로 읽기만 하는 `aws/lib.sh` 하나만 `100644`다. 이 단계를 시작할 때의 저장소에서 센 결과다.

```sh
git ls-files -s '*.sh' | awk '{print $1}' | sort | uniq -c
   2 100644
  17 100755
```

배포 작업은 `deploy.sh`를 `bash /opt/node-order/deploy.sh`처럼 셸을 통해 실행한다(`ci.yml`의 "새 이미지로 바꾸기"). 셸이 파일을 읽어 실행하므로 파일의 실행 권한에 기대지 않는다.

타이머는 그렇게 할 수 없다. systemd는 `ExecStart=`의 파일을 직접 실행하므로 실행 권한이 있어야 한다.

그대로 두면 새벽 3시 30분에 타이머가 실패한다(저널에 `status=203/EXEC`, `Permission denied`). 권한만 바꾸는 커밋을 더한다(`git update-index --chmod=+x`). 다시 배포하면 서버의 스크립트가 `-rwxr-xr-x`가 되고, `systemctl start node-order-reset-demo`가 `Result=success`로 끝난다.

> 교훈: git은 파일 권한 중 실행 비트 하나만 기록한다(`100644`/`100755`). 실행해야 하는 파일은 커밋할 때 권한도 확인한다.

내 저장소에서도 확인한다. 1장부터 `chmod +x`를 해 왔다면 `deploy/ops/`의 스크립트도 모두 `100755`이고, `100644`는 `aws/lib.sh`와 `ops/lib.sh` 둘뿐이다.

```sh
git ls-files -s '*.sh' # 100755 이어야 하는 파일이 100644인지
git update-index --chmod=+x <파일>
```

`git update-index --chmod=+x`는 작업 폴더의 파일은 그대로 두고, 저장소에 기록될 권한만 바꾼다. 다음 커밋에 권한 변경(`mode change 100644 => 100755`)으로 들어간다.

### 작업 3. [커밋] 쌓이는 이미지 정리

배포 브랜치에 푸시할 때마다 이미지 세 개(API, 마이그레이션, 웹)가 GHCR에 쌓인다(`images` 작업의 `push:`가 배포 브랜치에서만 참이다. 다른 브랜치는 빌드만 하고 올리지 않는다). 배포가 성공한 뒤 같은 워크플로가 오래된 것을 지운다.

#### 먼저: push 한 번이 GHCR 버전 몇 개인지 맞춘다

지우는 작업은 "버전"을 센다. 그런데 지금 빌드 설정으로는 push 한 번이 버전 하나가 아니다. 배포된 이미지를 이 PC에서 들여다보면 세 겹이다(`docker login ghcr.io`가 된 상태에서, 태그는 서버 `.env`의 `IMAGE_TAG`).

```sh
docker buildx imagetools inspect ghcr.io/seungwoo7050/node-order/order-api:<IMAGE_TAG>
MediaType: application/vnd.oci.image.index.v1+json          ← 태그가 붙은 목록(인덱스)
Manifests:
  …@sha256:2f21…   Platform: linux/amd64                    ← 실제 이미지
  …@sha256:de4f…   Platform: unknown/unknown                ← 빌드 증명(provenance)
                   vnd.docker.reference.type: attestation-manifest
```

`docker/build-push-action`은 push할 때 기본으로 빌드 증명(provenance attestation, "이 이미지를 어느 커밋·워크플로가 만들었나"의 기록)을 붙인다. 그러면 이미지 하나와 증명 하나를 묶은 인덱스가 태그를 갖고, GHCR은 인덱스·이미지·증명을 **각각 버전 하나로** 센다. 태그는 인덱스에만 붙으므로 나머지 둘은 "이름 없는 버전"으로 보인다.

이대로 "최근 10개 버전만 남긴다"를 걸면 두 가지가 틀어진다.

- 남는 것은 push 10번이 아니라 약 3번 분량이다(10 ÷ 3).

- 10은 3의 배수가 아니라서, 경계에 걸린 push는 인덱스만 남고 그 아래 이미지 매니페스트가 지워질 수 있다. 그러면 태그는 목록에 보이는데 `docker pull`은 실패한다.

이 프로젝트는 증명을 쓰지 않으므로, 세 빌드 단계에서 끈다. 그러면 push 한 번에 이미지 매니페스트 하나만 올라가 버전 하나가 된다.

```diff
# .github/workflows/ci.yml — images 작업의 세 빌드 단계(API 이미지, 마이그레이션 이미지, 웹 이미지)에 같은 한 줄
           push: ${{ github.ref_name == vars.DEPLOY_BRANCH }}
+          provenance: false # push 한 번에 GHCR 버전 하나 — 정리 작업(prune-images)이 하위 매니페스트를 지우지 않게
           tags: ${{ env.IMAGE_PREFIX }}/order-api:${{ github.sha }}
```

- 이미 올라간 세 겹짜리 옛 버전은 그대로다. 정리 작업이 옛것부터 지우는 동안 옛 태그 몇 개는 깨질 수 있지만, 지금 배포된 것과 그 직전(되돌리기 대상)은 새 설정으로 올라간 것이라 상관없다.

- 다음 배포 뒤 같은 `imagetools inspect`를 하면 `MediaType`이 인덱스(`…image.index…`)가 아니라 이미지 매니페스트(`…manifest…`)로 나오고, `Manifests:` 목록이 없다.

#### 지우는 작업을 더한다

```diff
# .github/workflows/ci.yml — jobs 맨 끝(deploy 작업 다음)
       - name: 공개 주소로 확인
         run: |
           for i in $(seq 1 12); do curl -fsS https://${{ vars.API_HOST }}/health/ready && break; echo " ($i) 다시 시도"; sleep 5; done
           curl -fsS https://${{ vars.API_HOST }}/health/ready
           curl -fsS -o /dev/null -w "웹 %{http_code}\n" https://${{ vars.WEB_HOST }}/
+
+  prune-images:
+    name: 오래된 이미지 정리
+    # 배포가 성공한 뒤에만, 패키지마다 최근 10개 버전만 남긴다(provenance: false라 버전 하나 = push 한 번)
+    # 저장소에 패키지마다 Admin 권한(Package settings → Manage Actions access)이 있어야 지울 수 있다
+    needs: deploy
+    runs-on: ubuntu-latest
+    permissions:
+      packages: write
+    strategy:
+      matrix:
+        package: [order-api, order-api-migrate, order-web]
+    steps:
+      - uses: actions/delete-package-versions@v5
+        with:
+          package-name: node-order/${{ matrix.package }}
+          package-type: container
+          min-versions-to-keep: 10
```

위에서 provenance를 껐으므로 10개 버전은 push 10번이다. 가장 최근 것(지금 배포된 것)과 그 직전(되돌리기 대상)은 늘 남는다.

- 패키지 이름은 `env.IMAGE_PREFIX`(`ghcr.io/seungwoo7050/node-order`)에서 계정 뒤의 부분이다. `ghcr.io/seungwoo7050/node-order/order-api`는 `node-order/order-api`다.

- `needs: deploy`라서 배포가 실패하면 이 작업은 돌지 않는다. 실패한 배포 뒤에 되돌릴 이미지를 지우는 일이 없다. 배포 브랜치가 아니어서 배포 작업을 건너뛴 실행에서도 돌지 않는다.

- `strategy.matrix`는 같은 작업을 `package` 값마다 하나씩, 세 번 돌린다.

- `permissions: packages: write`는 이 작업에만 준다. 워크플로 맨 위의 기본 권한은 `contents: read`뿐이다.

### 작업 4. [실행] 저장소가 패키지를 지울 수 있게 권한 확인

<!-- 검증 안 됨: 새로 쓴 절 -->

`packages: write`는 워크플로 쪽 권한일 뿐이다. 패키지 쪽에서도 이 저장소를 받아 줘야 한다. `actions/delete-package-versions`는 container 패키지의 경우 저장소가 패키지 설정의 Manage Actions access에서 **Admin** 역할을 가져야 버전을 지울 수 있다고 적고 있다. 워크플로가 올린 패키지는 저장소와 이어지지만, 그때 어떤 역할이 붙는지는 계정 설정에 따라 다를 수 있으므로 직접 본다.

GitHub 웹에서 패키지 세 개(`order-api`, `order-api-migrate`, `order-web`)마다 한다.

1. 내 프로필 → Packages → 패키지 이름 → 오른쪽의 Package settings

2. Manage Actions access에 이 저장소(`node-order`)가 있고, 역할이 **Admin**인지 본다

3. 없으면 Add Repository로 이 저장소를 넣고 역할을 Admin으로, 있는데 Read·Write면 Admin으로 바꾼다

저장소 밖(GitHub의 패키지 설정)의 상태라 커밋할 것은 없다. 빠뜨리면 배포는 성공하고 `오래된 이미지 정리` 작업만 403으로 실패한다. 다음 배포 뒤 Actions 화면에서 이 작업 세 개(행렬)가 초록인지 본다.

### 남길 것

- **찾아보면 되는 것**: `paths-ignore`의 패턴 문법, `actions/delete-package-versions`의 입력(`min-versions-to-keep` 등), `build-push-action`의 `provenance`, `docker buildx imagetools inspect`, `git update-index --chmod`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - `paths-ignore`는 푸시 전체에서 바뀐 파일을, `[skip ci]`는 맨 위 커밋 메시지만 본다. 섞어 푸시하면 둘 다 기대와 다르게 돈다.
  - git은 실행 비트 하나만 기록하고, `scp -p`는 그것을 그대로 옮길 뿐이다. 저장소에서 644면 서버에서도 644이고, 타이머는 그 파일을 실행하지 못한다.
  - 쌓이는 것을 지우는 작업은 성공한 배포 뒤에만 돈다(`needs: deploy`). 되돌릴 대상은 늘 남긴다.
  - "몇 개 남긴다"는 무엇을 하나로 세는지부터 확인한다. 이미지 하나가 레지스트리에서는 여러 버전(인덱스·이미지·증명)일 수 있고, 그 일부만 지우면 남긴 태그가 깨진다.

- **에러 신호**:
  - 문서만 고쳤는데 워크플로가 돈다 → `paths-ignore`가 있는지, 같은 푸시에 코드 변경이 섞였는지
  - 서버의 스크립트가 `-rw-r--r--`, 저널에 `Permission denied` → 저장소의 권한(`git ls-files -s '*.sh'`)
  - `오래된 이미지 정리` 작업이 403으로 실패한다 → 패키지 설정의 Manage Actions access에 이 저장소가 Admin으로 있는지(작업 4)
  - 태그는 GHCR에 보이는데 `docker pull`이 `manifest unknown`으로 실패한다 → 인덱스의 하위 매니페스트가 지워졌다. 빌드 단계에 `provenance: false`가 있는지(작업 3)

## 7. 디버깅

### 진단 1. 타이머와 서비스가 돌았는지 보기

타이머 쪽 문제는 세 칸을 차례로 본다. 언제 돌 예정이고 마지막에 언제 돌았나, 결과가 무엇이었나, 스크립트가 무엇을 찍었나.

```sh
systemctl list-timers 'node-order-*' --no-pager   # NEXT·LAST
systemctl show node-order-backup -p Result         # success가 아니면 실패
journalctl -u node-order-backup -n 20 -o cat       # 스크립트의 log 줄과 systemd의 마지막 줄
```

- 저널에 스크립트의 `log` 줄이 하나도 없고 `status=203/EXEC`만 있으면, 스크립트가 시작조차 하지 못했다. 파일이 있는지와 실행 권한을 본다.

- 스크립트의 `log` 줄이 있고 중간에 끊겼으면, 마지막 줄 바로 다음 명령이 실패한 것이다(`set -e`, 0장 개념 3).

- 손으로 다시 돌려 볼 때는 `sudo systemctl start <서비스>`를 쓴다. 스크립트를 터미널에서 직접 실행하면 사용자와 환경이 서비스와 달라 다른 결과가 나올 수 있다.

### 진단 2. 디스크가 무엇으로 차는지 보기

```sh
df -h /                       # 서버 디스크 사용률
docker system df              # 이미지·컨테이너·볼륨이 차지한 양
docker inspect -f '{{json .HostConfig.LogConfig.Config}}' node-order-api-1   # 로그 제한이 걸렸는지
```

- 로그 제한이 `{}`이면 2장 작업 1이 그 컨테이너에 적용되지 않았다.

- 이미지가 크면 배포 스크립트가 옛 이미지를 지우지 못한 것이다(`docker images`, `deploy.sh`의 마지막 `docker rmi`·`docker image prune`).

### 진단 3. 에러 신호로 원인 가르기

메시지를 외우는 게 아니라, 보이는 것에서 어느 칸으로 가는지만 익히면 된다. 단계마다의 `남길 것` 셋째 줄을 모두 모았다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 단계 |
|---|---|---|---|
| `Identity file deploy/aws/.local/admin_ed25519 not accessible: No such file or directory` | 저장소 루트가 아닌 폴더에서 `ssh`를 쳤다(상대 경로를 찾지 못함) | `pwd`, 저장소 루트로 `cd` | 0 |
| `Permission denied (publickey)` | 서버가 받아 줄 키로 들어오지 않았다 | 바로 위 `Identity file` 경고가 있는지, `.local/`을 옮겨 왔는지 | 0 |
| `The authenticity of host … can't be established` | `known_hosts`를 찾지 못해 처음 보는 서버로 여겼다 | `UserKnownHostsFile`의 경로, 치는 위치 | 0 |
| `UNPROTECTED PRIVATE KEY FILE!` | 개인 키를 다른 사람도 읽을 수 있다 | `chmod 600 deploy/aws/.local/admin_ed25519` | 0 |
| 검사·테스트는 모두 초록인데 배포만 건너뜀 | 배포 브랜치가 아직 앞 단계 브랜치이거나 비어 있다 | 저장소 변수 `DEPLOY_BRANCH`(시작 기준점) | 1 |
| `ops/lib.sh: No such file or directory`, 이어서 `log: command not found` | 서버에 `lib.sh`가 없다. `set -e`도 그 안에 있어 스크립트가 끝까지 달리고 0으로 끝난다 | `git ls-files -s deploy/ops`에 `lib.sh`가 있는지, 가짜 `.last-backup-ok` 지우기(1장 작업 1) | 1 |
| 저널에 `status=203/EXEC` | 스크립트를 실행하지 못했다. 파일이 없거나 실행 권한이 없다 | `ls -l /opt/node-order/ops`, 저장소의 `git ls-files -s '*.sh'`(6장 작업 2) | 1 |
| 저널에 `오늘 백업이 성공하지 않았다` | 그날 백업이 실패해 데모 초기화가 멈췄다 | `journalctl -u node-order-backup`, `.last-backup-ok`의 날짜 | 1 |
| 저널에 `DEMO_LOGIN이 1이 아니다` | 데모 서비스가 아니라 초기화를 건너뛰었다(성공으로 끝남) | 서버 `.env`의 `DEMO_LOGIN` | 1 |
| 타이머가 생각한 시각과 9시간 어긋나 돈다 | `OnCalendar`에 시간대를 적지 않아 서버 시계(UTC)로 계산했다 | `systemd-analyze calendar` | 1 |
| `list-timers`의 LAST가 설치 시각이다 | `Persistent` 기록 파일의 시각이다 | `journalctl -u <서비스>` | 1 |
| 배포 뒤에도 `LogConfig.Config`가 `{}` | 로그 설정이 그 컨테이너에 적용되지 않았다 | 서버의 `compose.yml`에 `logging: *logging`이 있는지, 컨테이너가 다시 만들어졌는지 | 2 |
| `Additional property logging-defaults is not allowed` | Compose가 모르는 최상위 키를 거부했다 | 키 이름이 `x-`로 시작하는지 | 2 |
| `startswith() requires string inputs` | 요청이 아닌 줄의 `null`에 문자열 함수를 불렀다 | `select`의 `and` 순서 | 2 |
| `jq: error: $REQ is not defined` | 셸 변수가 작은따옴표 안에 있어 jq가 받았다 | 따옴표 종류 | 2 |
| `jq: command not found` | 서버에 jq가 없다 | `sudo apt-get install -y jq` | 2 |
| 요청이 있었는데 `logs.sh`의 요청 수가 비어 있다 | 필터가 로그의 실제 모양과 맞지 않는다(`msg` 문장에 기댔다) | 요청 줄 하나를 `jq .`로 보고 필드 이름 확인 | 2 |
| `logs.sh 24h`인데 몇 줄뿐이다 | 컨테이너가 다시 만들어져 그 전 로그가 사라졌다 | 정상이다. 오래 남기려면 서버 밖으로 보낸다 | 2 |
| 서버 디스크가 계속 찬다 | 로그 회전이 없거나, 옛 이미지가 남았다 | 진단 2 | 2 |
| `/health/ready` 503, `"redis":"1000ms 초과"` | 그 의존 서비스에 1초 안에 닿지 못한다 | `docker compose ps`의 그 서비스 | 3 |
| `/health/ready`가 503인데 컨테이너는 healthy | 6번 연속 실패해야 unhealthy가 된다. unhealthy여도 Docker는 아무것도 하지 않는다 | 경보(도전 과제 3) | 3 |
| 감시 화면(`curl … /health/ready`)에 본문 없이 `308` | `http://`(또는 방식 없이)로 보내 Caddy가 HTTPS로 돌려보냈다 | `API`가 `https://`로 시작하는지 | 3 |
| `/health/ready`가 본문 없이 `502`, Caddy 로그에 `connect: connection refused` | Caddy는 떴는데 API가 아직 4000번을 열지 않았다(부팅 직후엔 정상) | 몇 초 뒤 200이 되는지, 계속되면 `docker compose logs api` | 3 |
| `redis Exited (0)`인 채로 다시 뜨지 않는다 | 사람이 멈춘 컨테이너는 `unless-stopped`가 켜지 않는다 | `docker compose start redis` | 3 |
| `backup.sh`가 `Unable to locate credentials` | 컨테이너에서 메타데이터에 닿지 않는다 | 인스턴스의 홉 제한(`50-server.sh`) | 4 |
| `The input is a PostgreSQL custom-format dump.` | custom 덤프를 `psql`에 넣었다 | `pg_restore`로 읽는다 | 4 |
| `sort_by() expected argument 1 to be type array but received type null instead.` | 백업이 없어 `Contents`가 null이다 | `` Contents \|\| `[]` `` | 4 |
| `backups/에 백업이 없다` | 복원할 백업이 없다 | 백업 타이머의 저널 | 4 |
| `복원 확인 실패: 표가 빠졌거나 비어 있다` | 덤프가 잘렸거나 빈 DB를 떴다 | 덤프 크기(`head-object`), 그날 백업 저널 | 4 |
| 복원 확인에서 행 수가 다르다 | 백업 뒤에 쓰기가 있었다(정상일 수 있다) | 계속 다르면 덤프가 잘렸는지(`head-object`의 크기) | 4 |
| `NOTICE: database "order_api_restore_check" does not exist, skipping` | 지우기 전 확인 문장이다. 문제 아니다 | `pg`의 `PGOPTIONS` | 4 |
| 자동 백업 스냅샷이 없다(`--snapshot-type automated`가 빈 결과) | 보존 기간이 아직 0이거나 변경이 미뤄졌다 | `BackupRetentionPeriod`, `PendingModifiedValues` | 4 |
| `CPUCreditBalance`가 시간마다 줄어든다 | 기준선보다 많이 쓰는 중이다 | 느린 요청(`logs.sh`), 서버 크기 | 5 |
| 문서만 고쳤는데 배포가 돈다 | `paths-ignore`가 없거나, 같은 푸시에 코드 변경이 섞였다 | 6장 작업 1 | 6 |
| `오래된 이미지 정리` 작업이 403 | 저장소에 패키지를 지울 권한(Admin)이 없다 | 패키지 설정 → Manage Actions access(6장 작업 4) | 6 |
| GHCR에 태그는 보이는데 `docker pull`이 `manifest unknown` | 인덱스만 남고 하위 매니페스트가 지워졌다(push 한 번이 버전 여러 개) | 빌드 단계의 `provenance: false`(6장 작업 3) | 6 |
| 서버의 스크립트가 `-rw-r--r--`, `Permission denied` | 저장소에서부터 실행 비트가 없다 | `git ls-files -s '*.sh'` | 6 |

### 도전 과제

#### 1. 백업이 실패하면 알림 받기

systemd의 `OnFailure=`로 백업 서비스가 실패했을 때 도는 서비스를 붙인다. 그 서비스가 메일이나 웹훅을 보내게 한다.

백업이 실패하면 무엇이 일어나는가?

**답**

1. 백업 서비스의 `[Unit]`에 `OnFailure=node-order-notify-failure@%N.service`를 적는다. `%N`은 자기 이름에서 `.service`를 뗀 것이라, 실패하면 `node-order-notify-failure@node-order-backup.service`가 뜬다(`%n`을 쓰면 `....service.service`로 겹친다).

2. 알림 서비스는 `@`가 붙은 템플릿 하나로 둔다. `ExecStart=/opt/node-order/ops/notify-failure.sh %i`라 다른 서비스에도 같은 줄만 붙이면 된다. `install-timers.sh`가 `*.service`를 모두 설치하므로 설치 절차는 그대로다.

3. 스크립트는 `.env`의 `ALERT_WEBHOOK_URL`로, 실패한 단위 이름과 `journalctl -u <단위> -n 10`을 `{"text": ...}`(Slack 수신 웹훅의 모양)로 보낸다. JSON은 `jq -n --arg`로 만들어 로그에 따옴표가 섞여도 깨지지 않는다.

4. 백업을 일부러 실패시키면(예: `.env`의 `S3_BUCKET`을 잠깐 틀리게) 저널에 `Triggering OnFailure= dependencies.`가 찍히고, 수신기에 `[호스트] node-order-backup 실패`와 백업 저널 마지막 줄들이 온다. 로컬에서는 `scripts/alert-receiver.mjs`를 받는 쪽으로 쓸 수 있다.

5. `ALERT_WEBHOOK_URL`을 비우면 알림 서비스가 `ALERT_WEBHOOK_URL이 비어 있다`를 남기고 실패로 끝난다. 알림이 안 가는 것도 저널에 남는다.

> `OnFailure=`는 `Result`가 실패일 때만 돈다. 백업이 "성공했지만 덤프가 작다" 같은 일은 잡지 못하므로, 복원 확인(4장 작업 3)이 실패로 끝나게 해 둔 것과 함께 쓴다. 복원 확인도 타이머로 돌리면 같은 `OnFailure=` 한 줄로 알림이 붙는다.

#### 2. API 로그를 CloudWatch Logs로 보내기

Docker의 `awslogs` 드라이버로 API 로그를 CloudWatch Logs에 보낸다.

인스턴스 역할에 어떤 권한이 더 필요한가? 로그 보관 기간은 어떻게 정하는가? 둘 다 적어 본다.

**답**

1. 운영 compose의 `api`만 `logging`을 바꾼다. `driver: awslogs`, `awslogs-region`, `awslogs-group: /node-order/api`, 그리고 `mode: non-blocking`(+`max-buffer-size`)이다. 나머지 서비스는 `*logging`(2장 작업 1) 그대로 둔다. `<<:`로 병합할 때의 함정은 2장 "YAML 앵커와 `x-` 확장 필드"에서 다뤘다.

2. 자격 증명은 컨테이너가 아니라 Docker 데몬이 받는다. EC2에서는 인스턴스의 IAM 역할이다. 역할이 없는 곳(이 PC)에서 같은 옵션으로 컨테이너를 띄우면 시작부터 `failed to initialize logging driver: ... CreateLogStream ...`으로 실패한다. 드라이버가 컨테이너를 시작할 때 스트림부터 만든다는 뜻이다.

3. `mode: non-blocking`으로 바꾸면 같은 상황에서도 컨테이너가 뜨고, `docker logs`로 로그가 그대로 읽힌다. Docker가 로컬에도 사본을 남기므로 `logs.sh`(`docker compose logs`)도 계속 쓸 수 있다. 대신 권한이 빠진 것을 모르고 지나갈 수 있으므로, 배포 뒤 `aws logs describe-log-streams --log-group-name /node-order/api`로 스트림이 생겼는지 본다.

4. 역할에 더할 권한은 스트림을 만드는 `logs:CreateLogStream`과 로그를 보내는 `logs:PutLogEvents`다. 대상은 로그 그룹 하나(`arn:aws:logs:<리전>:<계정 번호>:log-group:/node-order/api:*`)로 좁힌다. 그룹은 스크립트가 미리 만들고 `awslogs-create-group`을 쓰지 않으므로 `logs:CreateLogGroup`은 주지 않는다. 지금 역할(`30-storage.sh`의 `s3-images`)과 같은 방식으로 인라인 정책을 하나 더한다.

5. 보관 기간은 드라이버가 아니라 로그 그룹에 건다. 그룹을 만들 때 `aws logs put-retention-policy --log-group-name /node-order/api --retention-in-days 7`을 함께 실행한다. 정하지 않으면 영구 보관이다.

6. 정리할 것도 늘어난다. 서버를 내릴 때 쓰는 `90-destroy.sh`가 역할의 새 인라인 정책과 로그 그룹을 지우고, `99-leftovers.sh`가 `/node-order/` 로그 그룹 수를 세게 한다.

#### 3. 운영 서버에 경보 붙이기

`15`의 Prometheus·Alertmanager를 운영 compose에 넣고, `/health/ready`가 1분 넘게 503이면 경보가 가게 한다.

3장 "Redis를 사람이 멈춘다"의 "누군가 알아야 한다"를 고치는 과제다.

Redis를 멈추면 언제 경보가 오는가?

**답**

1. Prometheus는 `/health/ready`를 직접 부르지 않는다(JSON이라 지표로 읽지 못한다). 대신 컨테이너 헬스 체크가 10초마다 부르는 요청이 `http_request_duration_seconds_count{route="/health/ready", status_code="503"}`으로 남는 것을 본다(`order-api-nest/src/metrics/metrics.ts`의 라벨 `method`·`route`·`status_code`).

2. 규칙은 "최근 30초에 503이 있었고 200은 없었다"를 `for: 1m` 동안 본다.

   ```yaml
   - alert: ApiNotReady
     expr: |
       sum(increase(http_request_duration_seconds_count{route="/health/ready", status_code="503"}[30s])) > 0
         unless sum(increase(http_request_duration_seconds_count{route="/health/ready", status_code="200"}[30s])) > 0
     for: 1m
   ```

   규칙은 로컬과 같은 `monitoring/alert-rules.yml`에 넣고 `monitoring/alert-rules.test.yml`에 테스트를 더한다. `npm run test:rules`가 `SUCCESS`여야 한다.

3. 운영 compose에 `prometheus`·`alertmanager`를 넣는다. 포트는 열지 않고, `restart: unless-stopped`, `*logging`, 보관 7일(`--storage.tsdb.retention.time=7d`)을 준다. 설정은 `deploy/monitoring/`에 두고, CI가 경보 규칙을 그 폴더로 복사해 함께 올린다.

4. 받을 곳의 주소(Slack 웹훅 등)는 비밀이라 Alertmanager의 `url_file`로 서버에만 있는 파일에서 읽는다. 파일이 없으면 Docker가 같은 이름의 빈 폴더를 붙이고, Alertmanager는 뜨지만 보낼 때 `read url_file: ... is a directory`로 실패한다.

5. Redis를 멈추면 ready는 바로 503, 규칙은 30초 남짓 뒤 pending, 1분 반쯤 뒤 firing이 되고 곧 수신기에 `[firing] ApiNotReady`가 온다. Redis를 켜면 1초 뒤 ready 200, 약 1분 뒤 `[resolved]`가 온다.

> 요청이 헬스 체크뿐인 로컬에서는 기존 `HighErrorRate`도 함께 울린다. 5xx 비율이 100%이기 때문이다. 운영에서는 실제 요청의 200에 묻혀 울리지 않을 수 있으므로 ready 전용 규칙이 따로 필요하다.

> Prometheus가 주기적으로 `/metrics`를 가져가므로 `logs.sh`의 요청 수에 `/metrics`가 섞인다. 헬스 체크처럼 `/metrics`도 빼고 센다.

## 8. 완성 확인

### 시험해보기

```sh
ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP> 'systemctl list-timers "node-order-*"; /opt/node-order/ops/logs.sh 1h; /opt/node-order/ops/restore-check.sh'
```

### 체크리스트

- [ ] 백업(03:30)과 데모 초기화(04:00)가 한국 시간 기준 타이머로 돌고, 저널에 결과가 남는다
- [ ] 컨테이너 로그에 크기 제한이 있고, `logs.sh`로 상태 코드·5xx·느린 요청·오류를 본다
- [ ] Redis 중단·종료, 서버 재부팅에서 무엇이 감지되고 무엇이 저절로 돌아오는지 확인했다
- [ ] 백업을 실제로 복원해 운영과 행 수를 대조했다
- [ ] RDS 자동 백업이 켜져 있고(보존 1일), `pg_dump`와 무엇이 다른지 설명할 수 있다
- [ ] CPU 크레딧 잔고와 남은 크레딧을 본다
- [ ] 문서만 바뀐 푸시는 워크플로가 돌지 않고, 배포가 성공하면 오래된 이미지가 정리된다(push 한 번 = GHCR 버전 하나)
- [ ] 스크립트는 저장소에서 `100755`다(`lib.sh` 두 개만 `100644`)

## 9. 다음 단계

[`01`](https://github.com/seungwoo7050/node-order/tree/01-postgres-prisma)의 DB와 Prisma에서 시작한 주문 서비스가 인증, 실시간, 결제, 관측, CI, 배포, 화면, 운영까지 왔다. 다음 단계(`21`)부터는 운영 중인 이 서비스 위에서 페이지네이션과 잠금, 캐시, 무중단 배포처럼 데이터와 트래픽이 늘 때의 문제를 다룬다. 데모 초기화의 범위도 `21`에서 다시 정한다.

### 서버를 내릴 때

서버는 다음 단계에서도 쓰므로 이 문서에서는 지우지 않는다. 나중에 내릴 때 쓸 도구는 `18`에서 이미 만들어 두었다.

- `deploy/aws/90-destroy.sh`: 이 프로젝트가 만든 AWS 리소스를 만든 순서의 반대로 지운다(RDS의 자동 백업과 S3의 백업도 함께 사라진다).

- `deploy/aws/99-leftovers.sh`: 지운 뒤 요금이 나가는 리소스가 남았는지 종류별로 센다.

### 자가 점검

소리 내어 설명할 수 있으면 통과다.

1. 데모 초기화가 GitHub로 로그인한 사람에게 주는 영향은? 초기화된 주문의 Stripe 웹훅이 나중에 오면 서버는 어떻게 하는가?

2. 컨테이너 로그를 회전하지 않으면 무슨 일이 생기는가? `docker compose logs`로 어제 일을 볼 수 없는 이유는?

3. `logs.sh`가 `msg` 문장이 아니라 `responseTime` 필드로 요청 줄을 고르는 이유는?

4. Redis를 사람이 멈췄을 때와 스스로 끝났을 때 결과가 다른 이유는? `/health/ready`가 503인데 아무도 모르는 이유는?

5. "백업이 있다"와 "복원된다"는 왜 다른가? 이 문서의 복원 확인은 운영 DB에 무엇을 하는가?

6. `backup.sh`에서 `pipefail`을 빼면, `pg_dump`가 중간에 실패한 날 무슨 일이 생기는가?

7. RDS 자동 백업을 켰는데도 `pg_dump` 복원 확인을 매일 하는 이유는? 반대로 `pg_dump`로는 할 수 없는 복구는?

8. t3에서 CPU 사용률보다 크레딧 잔고를 먼저 보는 이유는?

9. `deploy.sh`는 644여도 배포가 되는데, 이 문서의 타이머 스크립트는 왜 실행 권한이 있어야 하는가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 중앙 로그 수집(CloudWatch Logs, Loki)과 로그 기반 경보

- 자동 백업으로 실제 시각 복구(PITR)를 해 보기, 다른 리전으로 백업 복사

- 무중단 배포와 여러 대의 서버, 자동 크기 조정(Auto Scaling)

- 장애 기록(포스트모템)과 대응 절차서(런북)
