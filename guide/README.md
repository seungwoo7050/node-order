# CI: 푸시할 때마다 검사를 자동으로 돌리기

## 목표

이 프로젝트는 [`16-release-candidate`](https://github.com/seungwoo7050/node-order/tree/16-release-candidate)로부터 시작한다.

이 프로젝트는 사람이 기억해서 돌려야 했던 확인 명령들(린트, 타입 검사, 백엔드 테스트, 프론트 e2e, 경보 규칙)을 자동화한다.

완료 시 GitHub Actions이 새로운 커밋이 푸시될 때마다 가상 머신에서 검사와 Docker 이미지 빌드를 수행한다.

1. 린트/타입 검사 작업을 만들고, 워크플로가 어떤 브랜치에서 도는지 정한다

2. PostgreSQL·Redis·저장소를 서비스 컨테이너로 띄워 백엔드 테스트를 돌린다

3. API까지 띄워 프론트 e2e를 돌린다. Stripe 키는 저장소 Secrets에서 받고, 실패하면 로그를 남긴다

4. 경보 규칙 테스트와 이미지 빌드를 더하고, 캐시로 시간을 줄인다

5. 일부러 잘못된 코드를 푸시해 CI가 무엇을 잡고 무엇을 놓치는지 본다

```text
ci  17-ci  push
  린트/타입 검사   success  55초
  백엔드 테스트    success  82초
  프론트 e2e      success 133초
  경보 규칙 테스트  success   7초
  이미지 빌드      success  25초   # 처음에는 358초, 캐시 뒤에는 20~25초
```

> 시작 기준점:  
> 통합본이 저장소 루트에 있고(루트에 `package.json`·`package-lock.json`, `order-api-nest/`, `order-console-next/`, `monitoring/`, `compose.yaml`이 보인다), 그것을 올린 GitHub 저장소가 있다. 로컬에서 `npm run lint`, `npm run typecheck`, `npm run test:api`, `npm run test:web`, `npm run test:rules`가 통과한다.  
> 아래의 경로는 모두 이 저장소 루트부터 적는다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 문법·액션 입력의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 실패다 | 친다. 확인한 뒤 되돌린다 |
| `진단 N.` | 7장에서 "어느 작업, 어느 단계에서 틀어졌나"를 가르는 절차 | 친다(`gh`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 워크플로 파일이 완성된다. 7장만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지다. 제목만 보고 커밋할 변경이 있는지 가를 수 있다.

| 태그 | 무엇이 남는가 | 커밋 |
|---|---|---|
| `[커밋]` | 저장소의 파일. 이 문서에서는 `.github/workflows/ci.yml`에 작업·설정을 더하는 것 | 한다 |
| `[실행]` | 저장소 밖의 상태. 이 문서에서는 저장소 Secrets. 뒤의 작업이 기댄다 | 안 한다 |
| `[확인]` | 남는 것이 없다. 푸시해 실행 결과를 보거나 조회만 한다 | 안 한다 |
| `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 실험 전과 같아진다 | 안 한다 |

- 여러 성격이 섞이면 센 쪽 하나만 붙인다(`[커밋]` > `[원복]` > `[실행]` > `[확인]`).

- `[커밋]` 작업은 파일을 고치기만 하고, 그 변경을 `git commit`·`git push`하는 명령은 같은 단계 뒤쪽의 `[확인]` 작업(푸시하고 결과 보기)에 있다. 푸시해야 CI가 돌기 때문이다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 7장 "진단 2"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 저장소 설정뿐이고 8장은 체크리스트라서 `남길 것`을 두지 않았다.

- 이 문서에서 고치는 파일은 사실상 하나다. 저장소 루트의 `.github/workflows/ci.yml`이고, 단계마다 작업(job)을 하나씩 이어 붙인다.

| 단계 | 하는 일 |
|---|---|
| [0. CI에 대한 사전지식](#0-ci에-대한-사전지식) | CI가 하는 일, GitHub Actions의 단위, YAML 읽는 법(작업 없음) |
| [1. 준비](#1-준비) | `gh`로 저장소를 확인하고 Stripe 키를 Secrets에 넣는다 |
| [2. 1단계: 린트/타입 검사](#2-1단계-린트타입-검사) | 워크플로 파일을 만들고 린트/타입 검사 작업을 푸시해 돌린다 |
| [3. 2단계: 서비스 컨테이너로 백엔드 테스트](#3-2단계-서비스-컨테이너로-백엔드-테스트) | PostgreSQL·Redis·저장소를 띄우고 테스트 DB를 준비해 백엔드 테스트를 돌린다 |
| [4. 3단계: API를 띄워 프론트 e2e](#4-3단계-api를-띄워-프론트-e2e) | API를 뒤에서 띄우고 Playwright e2e를 돌린다. 실패하면 로그를 남긴다 |
| [5. 4단계: 경보 규칙, 이미지 빌드, 이전 실행 취소](#5-4단계-경보-규칙-이미지-빌드-이전-실행-취소) | 경보 규칙 테스트와 이미지 빌드를 더하고, 캐시와 이전 실행 취소를 건다 |
| [6. 5단계: 일부러 깨뜨려보기, 응답 모양을 바꾼 커밋](#6-5단계-일부러-깨뜨려보기-응답-모양을-바꾼-커밋) | 응답 모양을 바꾼 커밋을 푸시해 무엇이 잡히고 무엇이 빠지는지 본다 |
| [7. 디버깅](#7-디버깅) | `gh run`으로 결과를 보고, 증상으로 원인을 가른다 |
| [8. 완성 확인](#8-완성-확인) | 체크리스트 |
| [9. 다음 단계](#9-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. CI에 대한 사전지식

### 개념 1 | CI가 하는 일

CI(지속적 통합)는 "코드가 저장소에 들어올 때마다 같은 검사를 같은 환경에서 돌린다"는 약속이다.

사람이 돌리면 빠뜨리고, 자기 PC에서만 되는 일이 생긴다.

CI는 매번 **깨끗한 가상 머신**에서 처음부터 설치하고 검사하므로, "내 PC에 남아 있던 무언가 덕분에 되던 것"이 드러난다.

### 개념 2 | GitHub Actions의 단위

| 단위 | 뜻 |
|---|---|
| 워크플로(workflow) | `.github/workflows/*.yml` 파일 하나. 언제(`on`) 무엇을 돌릴지 |
| 작업(job) | 가상 머신(러너) 한 대에서 도는 묶음. 작업끼리는 동시에 돈다 |
| 단계(step) | 작업 안에서 차례로 실행하는 명령 하나. 하나가 실패하면 그 작업은 거기서 멈춘다 |
| 서비스 컨테이너 | 작업과 함께 뜨는 컨테이너(DB 등). compose의 서비스와 비슷하다 |
| Secrets | 저장소 설정에 암호화해 둔 값. 워크플로에서 `${{ secrets.이름 }}`으로 읽고, 로그에는 가려진다 |

GitHub는 푸시된 그 커밋 안의 `.github/workflows/`를 읽는다. 워크플로 파일이 없는 브랜치에 푸시하면 아무 일도 없다.

> 이 저장소는 단계마다 브랜치가 다르다(`01-postgres-prisma` … `16-release-candidate`). 워크플로 파일은 이 문서의 브랜치(`17-ci`)에서 처음 생기므로, CI는 `17-ci`와 거기서 따는 이후 브랜치에서만 돈다. `16-release-candidate`까지의 브랜치에는 파일이 없다.

작업끼리는 서로 다른 러너에서 돈다. 한 작업에서 설치한 `node_modules`나 만든 파일은 다른 작업에 보이지 않는다.

그래서 아래의 작업마다 `actions/checkout`과 `npm ci`가 반복된다. C로 치면 작업 하나가 별도 프로세스이고, 메모리를 나눠 쓰지 않는 것과 같다.

### 개념 3 | YAML: 들여쓰기가 곧 구조다

워크플로 파일은 YAML로 쓴다.

**들여쓰기**가 무엇이 무엇 안에 있는지를 정한다.

```yaml
jobs: # 맵(키: 값). 값이 아래 들여쓴 줄 전체다
  check: # jobs 안의 키
    runs-on: ubuntu-latest
    steps: # 값이 목록이다
      - run: npm ci # "- "로 시작하는 줄이 목록의 원소 하나
      - run: npm run lint
        working-directory: x # 바로 위 "- " 원소에 속한다(같은 들여쓰기)
```

| 표기 | 뜻 | 이 문서의 예 |
|---|---|---|
| `키: 값` | 맵의 한 칸 | `runs-on: ubuntu-latest` |
| `- ...` | 목록의 원소 | `steps:` 아래의 각 단계 |
| `{ a: 1, b: 2 }` | 한 줄로 쓴 맵 | 서비스 컨테이너의 `env` |
| `[a, b]` | 한 줄로 쓴 목록 | `branches: ["**"]`, `ports: ["5433:5432"]` |
| `# ...` | 주석 | |
| `키: \|` | 아래 들여쓴 여러 줄을 줄바꿈 그대로 문자열 하나로 | `run: \|` (2단계에서 다룬다) |

- 들여쓰기에는 공백만 쓴다. YAML은 탭을 들여쓰기로 받지 않는다.

- 같은 맵 안의 키는 하나뿐이어야 한다. 아래 단계에서 작업을 이어 붙일 때 `jobs:`를 새로 쓰지 않고, 이미 있는 `jobs:` 아래에 같은 깊이(공백 두 칸)로 붙인다.

- `"5433:5432"`처럼 콜론이 든 값은 따옴표로 감싸 문자열임을 분명히 한다.

## 1. 준비

새로 설치할 패키지는 없다. 통합본을 GitHub에 올려 둔 저장소에서 이어 간다.

### 작업 1. [확인] gh로 저장소 확인

이 문서는 GitHub 웹 화면 대신 GitHub CLI(`gh`)로 Secrets를 넣고 실행 결과를 본다.

로그인돼 있는지, 지금 폴더가 어느 GitHub 저장소에 연결돼 있는지 확인한다.

```sh
gh auth status # 로그인한 계정이 보이면 된다
git remote -v # origin이 가리키는 <계정>/<저장소>를 아래 명령에 쓴다
```

### 작업 2. [실행] Stripe 키를 저장소 Secrets에 넣기

Stripe 테스트 키를 저장소 Secrets에 넣는다(프론트 e2e의 결제 버튼이 Stripe 세션을 만든다).

값은 루트의 `.env`에 있다. 값이 화면이나 셸 기록에 남지 않게 파일에서 바로 넘긴다.

```sh
grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2- | gh secret set STRIPE_SECRET_KEY --repo <계정>/<저장소>
gh secret list --repo <계정>/<저장소>
STRIPE_SECRET_KEY	2025-12-26T07:43:24Z
```

등록한 뒤에는 GitHub에서도 값을 다시 볼 수 없다.

웹훅 비밀은 필요 없다. 웹훅까지 가는 실제 결제 테스트(`14`의 `STRIPE_E2E=1`)는 `stripe listen`이 필요해서 CI에서 돌리지 않는다.

## 2. 1단계: 린트/타입 검사

### 작업 1. [커밋] 워크플로 파일 만들기

워크플로 파일은 **저장소 루트**의 `.github/workflows/` 아래에 둔다. `order-api-nest/`나 `order-console-next/` 안이 아니다(아래 "워크플로 파일은 저장소 루트에만 둔다").

```sh
# 저장소 루트(package.json이 있는 곳)에서
mkdir -p .github/workflows
```

```yaml
# .github/workflows/ci.yml
# 새로 만든다. 이 단계에서는 check 작업 하나만 있다
# CI: 푸시할 때마다 린트/타입 검사·테스트·이미지 빌드를 GitHub의 가상 머신에서 돌린다
name: ci

on:
  push:
    # 모든 브랜치. 실제로는 이 파일이 있는 브랜치(17-ci와 거기서 따는 이후 브랜치)에서만 돈다
    branches: ["**"]

# 이 워크플로의 GITHUB_TOKEN은 저장소를 읽기만 한다(기본값은 더 넓을 수 있다). 코드를 받아 검사만 하므로 쓰기 권한이 필요 없다
permissions:
  contents: read

jobs:
  check:
    name: 린트/타입 검사
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx prisma generate
        working-directory: order-api-nest
      - run: npm run lint
      - run: npm run typecheck
```

`branches: ["**"]`는 모든 브랜치다. 이 저장소는 `17-ci` 이후의 단계 브랜치에서 모두 CI를 돌릴 것이라, 브랜치 이름을 적지 않고 패턴 하나로 덮는다. 범위를 좁히는 방법은 아래 "어느 브랜치에서 돌릴지 정하기"에 있다.

`npm run lint`와 `npm run typecheck`는 로컬에서 쓰던 루트 `package.json`의 스크립트 그대로다. CI용 명령을 따로 만들지 않는다.

### 작업 2. [확인] 푸시하고 결과 보기

```sh
git add .github/workflows/ci.yml
git commit -m "ci: 푸시마다 린트/타입 검사"
git push
gh run watch # 방금 시작된 실행을 끝날 때까지 지켜본다
```

`gh run watch`가 실행을 고르라고 하면 방금 푸시한 커밋의 것을 고른다. 작업 `린트/타입 검사`가 `success`로 끝나면 된다.

`gh run list`에 실행이 아예 없으면 파일 위치와 `branches`를 먼저 본다(7장 진단 2).

### 용어 | GitHub Actions 문법 (워크플로 뼈대)

- `on.push.branches`: 이 목록(이름 또는 패턴)에 맞는 브랜치에 푸시할 때만 돈다. 이 문서는 `["**"]`로 모든 브랜치를 고른다. 그래도 워크플로 파일이 없는 브랜치에서는 돌지 않는다(GitHub가 워크플로를 어디서 읽는지는 0장 개념 2). 패턴과 제외는 아래 "어느 브랜치에서 돌릴지 정하기"에서 다룬다.

- `permissions: contents: read`: 워크플로마다 자동으로 주어지는 `GITHUB_TOKEN`의 권한을 정한다. 저장소 설정에 따라 쓰기 권한까지 가질 수 있는데, 여기서는 저장소를 읽기만 하게 한다(이유는 아래 "권한은 읽기만 준다").

- 단계의 `working-directory`: 그 `run` 단계가 도는 폴더다(`working-directory: order-api-nest`). 주지 않으면 저장소 루트에서 돈다. 적용 범위는 아래 "`working-directory`는 `run`에만 통한다"에서 다룬다.

- `runs-on`: 작업이 돌 러너(가상 머신)의 종류다.

- `uses` / `run`: `uses`는 이미 만들어진 액션을 가져와 실행하고, `run`은 셸 명령을 실행한다. 아래 "`uses`와 `with`: 남이 만든 단계 가져오기"에서 다룬다.

### 개념 | 어느 브랜치에서 돌릴지 정하기

`on.push.branches`는 정확한 이름뿐 아니라 패턴도 받는다. 이 문서는 1)을 쓴다. 나머지는 범위를 좁히고 싶을 때 바꿔 넣는 예다.

```yaml
# 1) 이 문서의 방식: 브랜치를 가리지 않고 모든 브랜치에서 돌린다
on:
  push:
    branches: ["**"]

# 2) 단계 브랜치(17-ci, 18-...)에서만 돌린다
on:
  push:
    branches: ["[0-9][0-9]-*"]

# 3) feature/ 아래의 브랜치에서만 돌린다(feature/login, feature/pay/stripe 모두)
on:
  push:
    branches: ["feature/**"]

# 4) 모두 돌리되 일부는 뺀다
on:
  push:
    branches-ignore: ["wip/**", "docs/**"]
```

| 패턴 | 맞는 것 | 맞지 않는 것 |
|---|---|---|
| `**` | 모든 브랜치 | 태그 |
| `[0-9][0-9]-*` | `17-ci`, `18-deploy` | `feature/login`, `17-ci/fix`(`*`는 `/`를 넘지 않는다) |
| `feature/**` | `feature/login`, `feature/pay/stripe` | `feature`(뒤에 `/`가 없다) |

- 이 문서가 1)을 고른 이유: `17-ci` 이후의 단계 브랜치는 모두 이 브랜치에서 따서 만들고, 거기서도 CI를 돌릴 것이기 때문이다. 이름을 적으면 브랜치를 만들 때마다 `ci.yml`을 고쳐야 하지만, `**`면 새 브랜치가 파일을 물려받는 것만으로 돈다.

- 어느 패턴이든 **그 브랜치에 워크플로 파일이 있어야** 돈다. 브랜치 목록도 푸시된 그 커밋의 파일에서 읽는다(0장 개념 2). `16-release-candidate`까지의 브랜치는 파일이 없으므로 `**`여도 돌지 않는다.

- `*`나 `[`로 시작하는 값은 따옴표로 감싼다. YAML에서 맨 앞의 `*`는 별칭(7장 도전 과제 3), `[`는 한 줄 목록 표기라서 따옴표가 없으면 다르게 읽힌다.

- `branches`를 아예 빼고 `on: push`만 쓰면 모든 브랜치에 더해 **태그를 푸시할 때도** 돈다. 브랜치만 원해서 `["**"]`를 적었다.

- `branches`와 `branches-ignore`는 같은 이벤트에 함께 쓸 수 없다. 함께 쓰고 싶으면 `branches` 안에서 `!`로 뺀다. `!` 패턴은 앞에 맞추는 패턴이 먼저 있어야 한다.

  ```yaml
  branches: ["**", "!wip/**"] # 모두 돌리되 wip/ 아래는 뺀다
  ```

> 모든 브랜치로 잡았으므로 파일이 있는 브랜치에 푸시할 때마다 작업 다섯 개가 돈다. 캐시는 브랜치마다 따로라서(4단계 "캐시로 줄인 시간") 새 브랜치마다 첫 이미지 빌드는 오래 걸리고, 비공개 저장소라면 GitHub가 주는 러너 시간을 그만큼 쓴다.

### 개념 | 워크플로 파일은 저장소 루트에만 둔다

GitHub가 찾는 곳은 **저장소 루트의 `.github/workflows/`** 한 곳이다. 하위 폴더의 `.github/`는 보지 않는다.

이 저장소는 워크스페이스라 `order-api-nest/`, `order-console-next/`가 각자 `package.json`을 가진 프로젝트처럼 보여서, 그 안에 두고 싶어지기 쉽다.

`order-api-nest/.github/workflows/ci.yml`에 두면 푸시해도 아무 일이 없고, 에러도 나지 않는다. 그냥 "실행이 없다".

루트에 두면 `run` 명령도 루트에서 돌므로, 로컬에서 루트에서 치던 `npm run lint` 같은 스크립트를 그대로 쓴다.

### 개념 | `uses`와 `with`: 남이 만든 단계 가져오기

액션(action)은 "여러 워크플로에서 다시 쓰도록 묶어 둔 단계"다.

실체는 GitHub 저장소 하나이고, `uses: <계정>/<저장소>@<ref>`로 그 저장소의 특정 태그·브랜치·커밋에 있는 코드를 가져와 실행한다. `with`는 그 액션에 넘기는 입력값이다.

```yaml
steps:
  - uses: actions/checkout@v4 # github.com/actions/checkout 저장소의 v4 태그
  - uses: actions/setup-node@v4
    with: # setup-node가 정해 둔 입력 이름에 값을 넣는다
      node-version: 24
      cache: npm
  - run: npm ci # 이건 액션이 아니라 셸 명령이다
```

| 구분 | `uses` | `run` |
|---|---|---|
| 실행하는 것 | 다른 저장소에 있는 액션 코드 | 이 파일에 적은 셸 명령 |
| 값 넘기기 | `with`(액션이 정한 이름만) | `env`, 명령 인자 |
| `working-directory` | 통하지 않는다 | 통한다 |

- 첫 단계가 늘 `actions/checkout`인 이유는 0장 개념 1의 "깨끗한 가상 머신" 때문이다. 러너에는 처음에 저장소 코드가 없어서, 체크아웃 액션이 이 커밋을 내려받아야 다음 단계가 파일을 볼 수 있다.

- `with`에 어떤 이름을 쓸 수 있는지는 액션마다 다르다. 액션 저장소의 `action.yml`이나 README에 적혀 있다(이 문서는 "액션 입력" 묶음에 따로 모았다).

> `@v4`는 그 저장소의 태그 이름일 뿐이다. 태그가 가리키는 커밋이 바뀌면 실행되는 코드도 바뀐다(7장 도전 과제 2).

### 개념 | `working-directory`는 `run`에만 통한다

`run` 단계는 따로 정하지 않으면 **저장소 루트**(체크아웃한 곳)에서 돈다. 단계에 `working-directory`를 주면 그 단계 하나만 그 폴더에서 돈다.

`uses` 단계(액션)는 이 값을 모르고, 액션에 넘기는 경로는 늘 **저장소 루트부터** 적는다.

```yaml
steps:
  - run: npm ci # 저장소 루트에서 돈다(워크스페이스 전체 설치)
  - name: API 실행
    working-directory: order-api-nest # 이 단계만 order-api-nest/에서 돈다
    run: node --env-file=.env dist/main.js > api.log 2>&1 & # api.log는 order-api-nest/api.log에 생긴다
  - uses: actions/upload-artifact@v4
    with:
      path: order-api-nest/api.log # 액션 입력: 앞 단계의 working-directory를 모른다. 루트부터 적는다
```

- `working-directory`는 그 단계에만 통한다. 다음 단계는 다시 저장소 루트에서 시작한다.

- 루트의 `npm run lint`, `npm run test:web` 같은 스크립트는 워크스페이스 전체를 다루므로 `working-directory` 없이 루트에서 돌린다. 폴더를 바꾸는 것은 `prisma` 명령, API 실행, 브라우저 설치처럼 한 패키지 안에서만 뜻이 있는 명령뿐이다.

- 4단계의 `file: order-api-nest/Dockerfile`, 3단계 `upload-artifact`의 `path: order-api-nest/...`도 액션 입력이라 루트부터 적었다.

> 같은 파일을 `run`에서는 짧게(`api.log`), 액션 입력에서는 루트부터(`order-api-nest/api.log`) 부르게 된다. 액션 입력에서만 "파일을 찾지 못한다"로 실패하면, 이 규칙을 먼저 의심한다.

### 용어 | 액션 입력 (setup-node)

- `actions/setup-node`의 `node-version`: 러너에 설치할 Node 버전이다. 통합본의 Dockerfile(`node:24-slim`)과 같은 24로 맞췄다.

- `actions/setup-node`의 `cache: npm`: `~/.npm`을 루트의 잠금 파일(`package-lock.json`) 내용으로 저장해 두었다가 다음 실행에서 꺼낸다. `npm ci`가 내려받는 시간이 준다. 무엇이 저장되는지는 아래 "npm 캐시는 `node_modules`가 아니다"에서 다룬다.

### 개념 | npm 캐시는 `node_modules`가 아니다

`cache: npm`이 저장하는 것은 npm이 내려받은 패키지 압축 파일 보관소(`~/.npm`)다.

설치 결과인 `node_modules`는 저장하지 않는다. 그래서 캐시가 있어도 `npm ci` 단계는 그대로 남고, 매번 `node_modules`를 새로 만든다.

```yaml
- uses: actions/setup-node@v4
  with:
    cache: npm # 시작할 때 ~/.npm을 꺼내 오고, 작업이 끝나면 저장한다. 루트의 package-lock.json 내용으로 캐시 이름(키)을 만든다
- run: npm ci # 내려받기는 ~/.npm에서 대신하고, 설치(node_modules 만들기)는 매번 한다
```

| 구분 | 캐시에서 꺼냄 | 매번 새로 함 |
|---|---|---|
| 패키지 내려받기 | 예(`~/.npm`) | |
| `node_modules` 만들기 | | 예(`npm ci`가 지우고 새로 만든다) |
| `prisma generate` 같은 생성 코드 | | 예 |

- 캐시 키가 잠금 파일 내용에서 나오므로, 의존성을 바꿔 `package-lock.json`이 달라지면 새 캐시를 만든다.

- setup-node는 잠금 파일을 저장소 루트에서 찾는다. 이 저장소는 워크스페이스라 `package-lock.json`이 루트에 하나뿐이어서 위치를 따로 적지 않는다(잠금 파일이 하위 폴더에만 있는 저장소라면 `cache-dependency-path`로 적는다).

> 캐시는 "다시 내려받지 않는 것"까지만 해 준다. 깨끗한 머신에서 처음부터 설치한다는 CI의 약속(0장 개념 1)은 그대로다.

### 개념 | 왜 이렇게 생겼는가 (1단계)

#### 권한은 읽기만 준다

이 CI는 코드를 읽고 검사만 하므로 쓰기 권한이 필요 없다.

> 워크플로가 실행하는 패키지 하나가 나쁜 짓을 해도 저장소를 바꿀 수 없다.

#### `npx prisma generate`를 먼저 한다

Prisma 생성 코드(`src/generated/prisma/`)는 커밋하지 않는다(`01`, `order-api-nest/.gitignore`의 `/src/generated/prisma`). 타입 검사가 그 코드를 읽으므로 먼저 만든다.

깨끗한 머신이라 PC에서는 잊고 지나가던 단계가 여기서 필요해진다.

빠뜨리면 타입 검사가 `Cannot find module '../generated/prisma/client.js'`로 실패한다. 소스 여러 곳이 `import { Prisma } from "../generated/prisma/client.js"`처럼 그 폴더를 읽기 때문이다.

### 남길 것

- **찾아보면 되는 것**: `on.push.branches`와 그 패턴(`*`·`**`·`[0-9]`·`!`), `branches-ignore`, `permissions`, 단계의 `working-directory`, `uses:`의 `소유자/저장소@태그` 형식, `actions/setup-node`의 입력 이름. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - CI는 매번 빈 머신에서 시작한다. PC에서는 이미 돼 있어서 잊고 있던 단계(`prisma generate`처럼 커밋하지 않는 생성 코드)가 CI에서는 명시적인 단계가 된다.

  - `working-directory`는 그 `run` 단계 하나에만 통하고, 액션 입력(`with`)의 경로는 늘 저장소 루트부터 적는다.

- **에러 신호**:

  - 푸시했는데 실행이 없다 → 그 브랜치의 저장소 루트 `.github/workflows/`에 워크플로 파일이 있는지, `on.push.branches` 패턴에 그 브랜치가 맞는지

  - `Cannot find module '../generated/prisma/client.js'` → `npx prisma generate` 단계가 타입 검사보다 앞에 있는지

  - 단계가 하나도 돌지 않고 `Unable to resolve action action/checkout, repository not found` → 그 작업의 `uses:` 철자. `actions/checkout`의 `s`처럼 소유자·저장소 이름이 틀리면 작업 전체가 시작 전에 실패한다

## 3. 2단계: 서비스 컨테이너로 백엔드 테스트

### 작업 1. [커밋] test-api 작업 추가

`jobs:` 아래, `check` 작업 다음에 `test-api` 작업을 이어 붙인다.

```yaml
# .github/workflows/ci.yml
# jobs: 아래, check 작업 다음에 이어 붙인다(jobs: 줄은 이미 있다)
jobs:
  ...
  test-api:
    name: 백엔드 테스트
    runs-on: ubuntu-latest
    # 테스트가 쓰는 PostgreSQL·Redis·저장소. 포트는 로컬(compose)과 같게 열어 order-api-nest/.env를 그대로 쓴다
    services:
      db:
        image: postgres:17
        env: { POSTGRES_USER: order, POSTGRES_PASSWORD: order, POSTGRES_DB: order_api }
        ports: ["5433:5432"]
        options: --health-cmd "pg_isready -U order -d order_api" --health-interval 2s --health-retries 15
      redis:
        image: redis:7
        ports: ["6380:6379"]
      storage:
        image: rustfs/rustfs:latest
        env: { RUSTFS_ACCESS_KEY: localaccess, RUSTFS_SECRET_KEY: localsecret123 }
        ports: ["9000:9000"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: 테스트 DB 준비
        working-directory: order-api-nest
        run: |
          npx prisma generate
          PGPASSWORD=order psql -h localhost -p 5433 -U order -d order_api -c "CREATE DATABASE order_api_test"
          ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
      - run: npm run test:api
```

이미지 이름·계정·포트는 루트 `compose.yaml`의 `db`, `redis`, `storage` 서비스와 같다.

### 작업 2. [확인] 푸시하고 두 작업 확인

```sh
git add .github/workflows/ci.yml
git commit -m "ci: 서비스 컨테이너로 백엔드 테스트"
git push
gh run watch
```

이제 작업이 두 개다. 두 작업은 서로 다른 러너에서 동시에 돌고(0장 개념 2), `린트/타입 검사`와 `백엔드 테스트`가 모두 `success`면 된다.

### 용어 | GitHub Actions 문법 (서비스 컨테이너)

- `services`: 작업과 함께 뜨는 컨테이너들이다. `db`, `redis`, `storage`는 이름일 뿐이고, 각각 `image`·`env`·`ports`를 갖는다.

- `ports: ["5433:5432"]`: `러너 포트:컨테이너 포트`다. 러너에서 `localhost:5433`으로 컨테이너의 5432에 닿는다. 아래 "서비스 컨테이너에 닿는 주소"에서 다룬다.

- `options`: 컨테이너를 띄울 때 넘기는 Docker 옵션이다. `--health-cmd`가 성공할 때까지 단계 시작을 기다린다.

- `name`: 단계의 이름이다. 실행 화면에 명령 대신 이 이름이 보인다.

- `run: |`: 여러 줄 셸 명령을 한 단계에서 차례로 실행한다. 한 줄이 실패하면 어떻게 되는지는 아래 "`run: |`는 셸 스크립트 하나다"에서 다룬다.

### 개념 | 서비스 컨테이너에 닿는 주소

이 작업의 단계들은 컨테이너 안이 아니라 **러너(가상 머신) 위에서 바로** 돈다.

서비스 컨테이너는 그 옆에 뜬 Docker 컨테이너라서, 러너 쪽에서는 `ports`로 열어 둔 포트를 통해 `localhost`로 닿는다.

```yaml
services:
  db:
    image: postgres:17
    ports: ["5433:5432"] # 러너의 5433 → 컨테이너의 5432
steps:
  - run: PGPASSWORD=order psql -h localhost -p 5433 -U order -d order_api -c "SELECT 1" # localhost:5433
```

| 단계가 도는 곳 | DB 주소 | `ports` |
|---|---|---|
| 러너 위(이 문서) | `localhost:<러너 포트>` | 필요하다 |
| 작업을 `container:`로 컨테이너 안에서 돌릴 때 | `db:5432`(서비스 이름) | 없어도 된다 |

- `ports`를 빼면 컨테이너는 뜨지만 러너에서 닿을 길이 없다. 증상은 "DB에 연결하지 못한다"로, 7장 진단 2 표의 같은 줄로 간다.

- 서비스 이름(`db`, `redis`)으로 부르는 방식은 compose와 같지만, 그건 단계도 컨테이너 안에 있을 때만 통한다. 이 문서는 `.env`의 `localhost` 주소를 그대로 쓰려고 러너 방식을 골랐다(아래 "포트를 로컬과 같게 연다").

> 로컬에서 compose로 DB를 띄우고 PC의 터미널에서 `localhost:5433`으로 붙던 것과 같은 모양이다. 러너가 PC 자리에 있다.

### 개념 | `run: |`는 셸 스크립트 하나다

`|`는 YAML에서 "아래 들여쓴 줄들을 줄바꿈 그대로 하나의 문자열로"라는 표기다(0장 개념 3).

GitHub는 그 문자열을 임시 스크립트 파일로 저장해 셸 하나로 실행한다. 그래서 `cd`나 변수가 다음 줄까지 이어진다.

#### `bash -e`: 한 줄이 실패하면 멈춘다

리눅스 러너에서 `shell`을 따로 정하지 않으면 `bash -e`로 실행한다.

`-e`는 **명령 하나가 실패하면 그 자리에서 스크립트를 멈추고 단계를 실패로 끝낸다**는 뜻이다.

```sh
# a.sh
echo 하나
false
echo 둘
```

```sh
bash -e a.sh; echo "종료 코드: $?"
하나
종료 코드: 1
```

"테스트 DB 준비" 단계에서 `CREATE DATABASE`가 실패하면 마이그레이션 줄은 실행되지 않고 단계가 빨갛게 끝나는 것도 이 때문이다.

#### 예외와 단계 사이의 경계

- 예외가 있다. `A && B`의 `A`, `if`/`while`의 조건처럼 **실패를 검사하는 자리**에 있는 명령은 실패해도 멈추지 않는다. 3단계의 기다리기 반복문은 이 규칙에 기대고 있다(3단계 문법 묶음에서 다시 본다).

- `exit 0`은 스크립트를 끝내므로 그 단계를 성공으로 끝낸다. 그 뒤 줄은 실행되지 않는다.

- 단계끼리는 다른 셸이다. 한 단계에서 `cd`나 `export`한 것은 다음 단계에 남지 않으므로, 폴더는 `working-directory`로 정한다.

> C 프로그램에서 함수마다 반환값을 검사하고 실패면 바로 `return`하는 것을 셸이 줄마다 대신 해 준다고 보면 된다.

### 개념 | 테스트 DB 준비 세 줄에서 일어나는 일

서비스 컨테이너의 PostgreSQL은 `POSTGRES_DB: order_api` 덕분에 빈 `order_api` DB 하나만 가진 채 뜬다.

테이블도, 앱이 쓰는 역할(`order_app`)도, 테스트 DB도 없다. 로컬에서는 이미 있어서 잊고 있던 것들이다.

#### 한 줄씩

1. `npx prisma generate`: 1단계와 같은 이유다. 테스트도 생성 코드를 import한다.

2. `psql ... -c "CREATE DATABASE order_api_test"`: e2e 테스트가 쓰는 테스트 전용 DB를 만든다. 러너에는 `psql`이 이미 설치돼 있어서 따로 설치하지 않는다. 비밀번호는 `PGPASSWORD` 환경변수로 넘긴다(대화형 입력을 기다리지 않게).

3. `ADMIN_DATABASE_URL=... npx prisma migrate deploy`: 그 테스트 DB에 마이그레이션을 적용한다.

#### 마이그레이션이 역할까지 만든다

`10`에서 만든 마이그레이션 `20261005025007_app_role`이 `CREATE ROLE order_app ...`을 "없을 때만" 실행한다.

역할은 DB 하나가 아니라 PostgreSQL 서버 전체에 하나라서, 테스트 DB에 마이그레이션을 적용하는 순간 앱이 붙을 `order_app` 역할도 생긴다. 그래서 CI에 역할을 만드는 단계를 따로 두지 않았다.

#### 어느 주소로 붙는가

`prisma7.config.ts`는 `.env`를 읽은 뒤 `ADMIN_DATABASE_URL`(소유자 `order`)로 마이그레이션한다.

`.env`의 `ADMIN_DATABASE_URL`은 `order_api`를 가리키지만, 명령 앞에 붙인 `ADMIN_DATABASE_URL=...order_api_test`가 이미 환경에 있으므로 그 값이 쓰인다. 이 줄이 테스트 DB로 마이그레이션하는 핵심이다.

테스트가 시작되면 `test/setup-env.ts`가 `DATABASE_URL`을 `TEST_DATABASE_URL`(`order_app` 역할, `order_api_test`)로, `ADMIN_DATABASE_URL`을 `TEST_ADMIN_DATABASE_URL`로 바꿔 끼운다. 둘 다 커밋된 `.env`에 있다.

#### `migrate dev`가 아니라 `migrate deploy`

`migrate deploy`는 이미 커밋된 마이그레이션 파일을 차례로 적용하기만 한다. 스키마와 비교해 새 마이그레이션을 만들거나, 검증용 임시 DB(shadow DB)를 만들거나, 사람에게 묻지 않는다.

CI와 운영처럼 "정해진 것을 그대로 적용"해야 하는 곳은 `deploy`다. `migrate dev`는 개발자 PC에서 마이그레이션을 만들 때 쓴다.

### 개념 | 왜 이렇게 생겼는가 (2단계)

#### 포트를 로컬과 같게 연다

서비스 컨테이너의 포트를 로컬 compose와 같게(5433, 6380, 9000) 열었다.

그래서 커밋된 `order-api-nest/.env`(학습용 데모 값)의 `localhost:5433` 같은 주소가 CI에서도 그대로 맞는다.

> CI용 설정 파일을 따로 만들지 않아도 된다.

#### 테스트 DB와 저장소

`10` 이후의 테스트 DB 준비는 소유자 연결(`ADMIN_DATABASE_URL`)로 한다.

저장소(RustFS)도 띄우는 이유는 API가 뜰 때 버킷을 만들기 때문이다(`06`). 테스트도 앱 모듈 전체를 띄우므로 저장소가 없으면 시작하지 못한다.

### 남길 것

- **찾아보면 되는 것**: `services`의 `image`·`env`·`ports`·`options` 칸, `--health-cmd` 옵션 이름, `migrate deploy`와 `migrate dev`의 차이. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 러너 위에서 도는 단계는 서비스 컨테이너에 `localhost:<열어 둔 포트>`로 닿는다. 포트를 로컬 compose와 같게 열면 커밋된 `.env`를 그대로 쓸 수 있다.

  - 서비스 컨테이너의 DB는 빈 상태로 뜬다. 테스트 DB 만들기와 마이그레이션(역할 포함)을 CI가 직접 해야 한다.

  - `run: |`는 `bash -e` 스크립트 하나다. 한 줄이 실패하면 거기서 단계가 끝나고, 단계끼리는 셸을 공유하지 않는다.

- **에러 신호**:

  - "테스트 DB 준비"의 `psql`이 `Connection refused`, 또는 백엔드 테스트가 DB에 연결하지 못한다 → 서비스의 `ports`가 `.env`와 같은지, `--health-cmd`가 있는지

  - 테스트 DB 관련 `relation ... does not exist` → 테스트 DB에 마이그레이션을 소유자 연결(`ADMIN_DATABASE_URL=...order_api_test`)로 적용했는지

  - `TEST_DATABASE_URL이 없다 - 개발 DB를 지우지 않도록 테스트를 멈춘다` → `order-api-nest/.env`가 커밋돼 있는지(CI는 커밋된 파일만 본다)

  - 백엔드 테스트가 앱을 띄우다 저장소(S3)에서 실패한다 → `storage` 서비스와 `9000` 포트가 있는지

## 4. 3단계: API를 띄워 프론트 e2e

### 작업 1. [커밋] test-web 작업 추가

`jobs:` 아래, `test-api` 작업 다음에 `test-web` 작업을 이어 붙인다.

```yaml
# .github/workflows/ci.yml
# jobs: 아래, test-api 작업 다음에 이어 붙인다
jobs:
  ...
  test-web:
    name: 프론트 e2e
    runs-on: ubuntu-latest
    services:
      db:
        image: postgres:17
        env: { POSTGRES_USER: order, POSTGRES_PASSWORD: order, POSTGRES_DB: order_api }
        ports: ["5433:5432"]
        options: --health-cmd "pg_isready -U order -d order_api" --health-interval 2s --health-retries 15
      redis:
        image: redis:7
        ports: ["6380:6379"]
      storage:
        image: rustfs/rustfs:latest
        env: { RUSTFS_ACCESS_KEY: localaccess, RUSTFS_SECRET_KEY: localsecret123 }
        ports: ["9000:9000"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: API 빌드·데모 데이터·실행
        working-directory: order-api-nest
        env:
          # 결제 버튼이 Stripe 테스트 모드 세션을 만든다. 값은 저장소 Secrets에만 있다
          STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
        run: |
          npx prisma generate
          npx prisma migrate deploy
          npx prisma db seed
          npm run build
          node --env-file=.env dist/main.js > api.log 2>&1 &
          # 준비될 때까지 최대 60초 기다린다(러너에 이미 있는 curl만 쓴다 - 실행 중에 패키지를 내려받지 않는다)
          for _ in $(seq 1 60); do curl -sf localhost:4000/health/ready > /dev/null && exit 0; sleep 1; done
          cat api.log; exit 1
      - name: 프론트 환경 값
        working-directory: order-console-next
        run: |
          cp .env.example .env.local
          {
            echo "AUTH_SECRET=$(openssl rand -base64 32)"
            echo "AUTH_GITHUB_ID=ci-dummy-client-id"
            echo "AUTH_GITHUB_SECRET=ci-dummy-secret"
          } >> .env.local
      # 브라우저와 그것이 쓰는 리눅스 라이브러리를 설치한다
      - run: npx playwright install --with-deps chromium
        working-directory: order-console-next
      - run: npm run test:web
      - name: 실패하면 API 로그와 Playwright 결과를 남긴다
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: test-web-logs
          path: |
            order-api-nest/api.log
            order-console-next/test-results/
          retention-days: 7
```

`services`는 2단계의 `test-api`와 한 글자도 다르지 않다. 작업마다 러너가 따로라서 서비스 컨테이너도 작업마다 따로 띄워야 한다(줄이는 방법은 7장 도전 과제 3).

### 작업 2. [확인] 푸시하고 세 작업 확인

1장에서 Secrets에 `STRIPE_SECRET_KEY`를 넣었는지 먼저 확인한다(`gh secret list`).

```sh
git add .github/workflows/ci.yml
git commit -m "ci: API를 띄워 프론트 e2e, 실패하면 로그 보관"
git push
gh run watch
```

세 작업이 모두 `success`면 된다. `프론트 e2e`가 실패하면 실행 화면 아래에 `test-web-logs` 아티팩트가 생긴다(7장 진단 1의 `gh run download`).

### 용어 | GitHub Actions 문법 (Secrets·환경변수·조건)

- `${{ secrets.STRIPE_SECRET_KEY }}`: 저장소 Secrets의 값을 읽는 표현식이다. 로그에는 `***`로 가려진다. 셸 변수와의 차이는 아래 "`${{ }}`는 셸보다 먼저 바뀐다"에서 다룬다.

- 단계의 `env`: 그 단계에서만 쓰는 환경변수다. 작업 전체에 주려면 작업 수준에 `env`를 둔다.

- `node ... &`: 셸 문법으로, API를 뒤에서 돌려 둔 채 다음 줄로 넘어간다. 이 단계가 끝나도 API 프로세스는 작업이 끝날 때까지 살아 있어서 뒤의 `npm run test:web`이 붙을 수 있다.

- `for ... curl ... && exit 0; sleep 1; done`: 준비되면 `exit 0`으로 단계를 성공으로 끝내고, 60번 안에 준비되지 않으면 반복문을 빠져나와 로그를 찍고 `exit 1`로 실패한다. `curl`이 실패해도 `&&` 왼쪽이라 `-e`에 걸리지 않는다(2단계 "`run: |`는 셸 스크립트 하나다").

- `if: failure()`: 앞 단계가 실패했을 때만 이 단계를 실행한다. 아래 "단계를 돌릴지 정하는 `if`"에서 다룬다.

### 개념 | 프론트 e2e 작업이 띄우는 것들

이 작업 하나 안에서 프로세스가 네 겹으로 뜬다. 로컬에서는 터미널 여러 개로 나눠 띄우던 것을 러너 한 대에서 차례로 띄운다.

| 무엇 | 누가 띄우나 | 어디서 |
|---|---|---|
| PostgreSQL·Redis·RustFS | GitHub(서비스 컨테이너) | 작업 시작 전 |
| API(`localhost:4000`) | "API 빌드·데모 데이터·실행" 단계의 `node ... &` | 그 단계가 끝나도 뒤에서 살아 있다 |
| Next(`localhost:3000`) | Playwright(`playwright.config.ts`의 `webServer`) | `npm run test:web` 안에서 |
| Chromium | Playwright | 테스트마다 |

#### API 단계가 하는 일

2단계와 달리 여기서는 테스트 DB가 아니라 개발용 `order_api` DB를 쓴다. 프론트 e2e는 브라우저로 실제 API에 붙어 시드 사용자 `kim`으로 로그인하기 때문이다.

그래서 `migrate deploy`(인자 없이 `.env`의 `ADMIN_DATABASE_URL`, 즉 `order_api`)와 `db seed`를 차례로 한다.

`npm run build`는 `nest build`이고, `tsconfig.build.json`의 `rootDir: ./src` 때문에 결과가 `dist/main.js`에 생긴다. `node --env-file=.env`로 `.env`를 읽어 띄운다(`start:prod`와 같은 방식).

기다리는 주소는 `/health/ready`다. DB·Redis·저장소에 모두 닿아야 200이고, 하나라도 안 되면 503이라 `curl -f`가 실패로 본다.

포트만 열린 상태가 아니라 "일할 준비가 된" 상태를 기다리는 것이다.

#### Next는 Playwright가 띄운다

`npm run test:web`은 `order-console-next`의 `test:e2e`(Playwright)다. `playwright.config.ts`의 `webServer`가 `npm run build && npm run start`로 Next를 운영 모드로 띄운 뒤 테스트를 시작한다.

`next build`는 빌드하면서 타입 검사도 한다. 5단계의 `[WebServer] Failed to type check.`가 바로 여기서 나온다.

#### 브라우저는 따로 설치한다

`npm ci`는 Playwright 라이브러리만 설치하고 브라우저 실행 파일은 받지 않는다. `npx playwright install --with-deps chromium`이 Chromium과, 그것이 쓰는 리눅스 공유 라이브러리(`--with-deps`)를 설치한다.

PC에서는 예전에 한 번 설치해 둔 브라우저가 남아 있어서 잊기 쉬운 단계다.

### 개념 | `${{ }}`는 셸보다 먼저 바뀐다

`run` 안에는 두 종류의 치환이 섞여 있다. `${{ ... }}`는 GitHub의 표현식이고, `$(...)`, `$VAR`는 셸 문법이다.

둘은 **다른 시점에, 다른 프로그램이** 처리한다.

| 표기 | 누가 | 언제 |
|---|---|---|
| `${{ secrets.X }}`, `${{ github.ref }}` | GitHub | 단계를 실행하기 전에 YAML 글자 자체를 값으로 바꿔 둔다 |
| `$STRIPE_SECRET_KEY`, `$(openssl rand ...)` | 러너의 bash | 스크립트가 실행되는 중에 |

```yaml
# 이 문서의 방식: 표현식은 env에만 쓰고, 셸은 환경변수로 읽는다
env:
  STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
run: node --env-file=.env dist/main.js # API가 process.env로 읽는다

# 피하는 방식: 표현식을 run 안에 직접 쓴다
run: echo "커밋 메시지: ${{ github.event.head_commit.message }}"
```

#### 표현식을 스크립트에 바로 넣으면

두 번째처럼 쓰면 GitHub가 커밋 메시지 글자를 스크립트 안에 그대로 붙여 넣은 뒤 bash가 실행한다.

메시지에 `"; curl ... #` 같은 글자가 들어 있으면 그것이 명령으로 실행된다. 같은 값을 `env`로 넘겨 `"$MSG"`로 읽으면 셸은 그것을 값으로만 다룬다.

- `${{ }}`는 `run`뿐 아니라 `with`, `env`, `if`, `concurrency.group` 등 YAML의 값 자리 어디에나 쓸 수 있다.

- Secrets 값이 로그에서 `***`로 가려지는 것은 GitHub가 출력에서 그 글자를 찾아 지워 주는 것이다. 값을 바꿔 출력하면(예: base64로 인코딩) 가려지지 않는다.

- `node --env-file=.env`는 이미 환경에 있는 변수를 `.env`의 값으로 덮지 않는다. 그래서 단계의 `env`로 받은 `STRIPE_SECRET_KEY`가 그대로 API에 들어간다(커밋된 `.env`에는 이 키가 없다).

> C 전처리기의 `#define`이 컴파일 전에 글자를 바꿔 넣는 것과 비슷하다. 매크로 인자에 괄호를 안 치면 엉뚱하게 펼쳐지듯, 표현식을 스크립트에 바로 넣으면 값이 코드로 읽힐 수 있다.

### 개념 | 단계를 돌릴지 정하는 `if`

단계에 `if`가 없으면 `if: success()`로 본다. 즉 **앞 단계가 모두 성공했을 때만** 돈다.

하나가 실패하면 뒤 단계는 건너뛰는데(0장 개념 2), `if`에 상태 함수를 쓰면 이 기본을 바꿀 수 있다.

| 조건 | 언제 도는가 | 이 문서에서 |
|---|---|---|
| (없음) = `success()` | 앞 단계가 모두 성공했을 때 | 대부분의 단계 |
| `failure()` | 앞 단계 중 하나라도 실패했을 때 | 실패하면 로그 올리기 |
| `always()` | 성공·실패·취소와 상관없이 | 7장 도전 과제 1의 프론트 타입 검사 |
| `cancelled()` | 실행이 취소됐을 때 | 쓰지 않음 |

```yaml
- run: npm run test:web # 실패하면
- name: 실패하면 API 로그와 Playwright 결과를 남긴다
  if: failure() # 이 단계만 돌고
  uses: actions/upload-artifact@v4
# 이 뒤에 if 없는 단계가 있다면 건너뛴다
```

- `failure()` 단계가 돌았다고 작업이 성공으로 바뀌지는 않는다. 작업 결과는 여전히 실패다.

- `if`에서는 `${{ }}`를 생략할 수 있다. `if: failure()`와 `if: ${{ failure() }}`는 같다.

> 정리 작업처럼 "무슨 일이 있어도 해야 하는 일"은 `always()`, "실패했을 때만 볼 자료"는 `failure()`에 둔다. C의 `goto cleanup`처럼 실패 경로를 따로 두는 것이다.

### 용어 | 액션 입력 (upload-artifact)

- `actions/upload-artifact`의 `name`: 올린 묶음의 이름이다. 내려받을 때 이 이름으로 고른다(`gh run download -n test-web-logs`).

- `actions/upload-artifact`의 `path`: 실행이 끝난 뒤 내려받을 수 있게 올릴 파일·폴더 목록이다. `retention-days`는 보관 일수다.

### 개념 | 왜 이렇게 생겼는가 (3단계)

#### Secrets는 필요한 단계에만

`STRIPE_SECRET_KEY`를 작업 전체가 아니라 API를 띄우는 단계의 `env`에만 준다.

Next 빌드, 브라우저 설치, Playwright처럼 이 키가 필요 없는 단계의 프로세스는 이 값을 환경변수로 받지 않는다.

#### 프론트 `.env.local`

커밋하지 않는 파일이라 CI에서 만든다.

`.env.example`을 복사하면 `API_URL`, `NEXT_PUBLIC_API_URL`, `AUTH_URL` 같은 주소는 로컬 값 그대로 맞는다. 비어 있는 `AUTH_SECRET=`, `AUTH_GITHUB_ID=`, `AUTH_GITHUB_SECRET=` 세 줄만 채우면 된다.

`>>`로 파일 끝에 같은 키를 한 번 더 덧붙였다. 같은 키가 두 번 있으면 뒤의 줄이 쓰이므로 빈 값 줄을 지우지 않아도 된다.

`AUTH_SECRET`은 세션 쿠키를 암호화하는 키라 실행마다 `openssl rand`로 새로 만든다. 실행 한 번 동안만 쓰이니 저장해 둘 필요가 없다.

GitHub 로그인 값은 Mock 값이다. 프론트 e2e는 GitHub에 실제로 가지 않고 보내려던 주소만 검사하기 때문이다(`13`, `e2e/github-login.spec.ts`가 `github.com`으로 가는 요청을 가로챈다).

#### API를 기다리는 방법

처음에는 `npx wait-on`을 썼다. 로그를 보면 실행할 때마다 패키지를 내려받는다.

```text
npm warn exec The following package was not found and will be installed: wait-on@9.5.1
```

잠금 파일에 없는 코드를, 버전도 고정하지 않은 채 Secrets가 있는 작업 안에서 실행하는 셈이다. 그래서 러너에 이미 있는 `curl`로 반복하게 바꿨다.

> 실행 중에 패키지를 내려받지 않는다.

#### 실패하면 남기기

`if: failure()` 단계가 API 로그와 Playwright 결과(실패한 테스트마다 오류 화면 요약 `error-context.md`)를 아티팩트로 올린다. 실행 화면에서 내려받아 본다.

API는 뒤에서 돌며 출력을 `api.log`에 쓰고 있어서, 이 파일을 올리지 않으면 작업이 끝나는 순간 API 쪽에서 무슨 일이 있었는지 볼 길이 없다.

### 남길 것

- **찾아보면 되는 것**: `${{ secrets.이름 }}`, 단계의 `env`, `if:`의 상태 함수 표, `upload-artifact`의 입력, `npx playwright install --with-deps`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - `${{ }}`는 GitHub가 스크립트 글자를 미리 바꿔 넣는 것이다. Secrets나 사용자가 쓴 값은 `env`로 넘기고, 셸에서는 환경변수로 읽는다. 비밀은 필요한 단계에만 준다.

  - 뒤에서 띄운 서버는 "포트가 열렸다"가 아니라 "준비됐다"(`/health/ready`)를 기다리고, 실행 중에 패키지를 내려받지 않는다.

  - 실패했을 때 볼 자료(뒤에서 돈 서버의 로그, 테스트 결과)는 `if: failure()` 단계로 남겨 두지 않으면 러너와 함께 사라진다.

- **에러 신호**:

  - 프론트 e2e의 결제 테스트만 실패, API 로그에 `STRIPE_SECRET_KEY 환경변수가 없다` → `gh secret list`에 `STRIPE_SECRET_KEY`가 있는지

  - "API 빌드·데모 데이터·실행" 단계가 60초쯤 뒤 실패하고 그 아래에 `api.log` 내용이 찍힌다 → 찍힌 로그에서 API가 어느 의존 서비스에 닿지 못했는지

  - `npm warn exec The following package was not found and will be installed` → 그 `npx` 줄. 잠금 파일에 없는 패키지를 실행 중에 내려받고 있으니 러너에 이미 있는 도구(`curl` 등)로 바꾼다

  - 로컬에서는 되는데 CI에서만 실패 → PC에 남아 있던 것(설치된 브라우저, 생성 코드, `.env.local`, 이미 떠 있던 서비스)에 기대고 있었는지

## 5. 4단계: 경보 규칙, 이미지 빌드, 이전 실행 취소

### 작업 1. [커밋] alert-rules·images 작업 추가

`jobs:` 아래, `test-web` 작업 다음에 두 작업을 이어 붙인다.

```yaml
# .github/workflows/ci.yml
# jobs: 아래, test-web 작업 다음에 두 작업을 이어 붙인다
jobs:
  ...
  alert-rules:
    name: 경보 규칙 테스트
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run test:rules

  images:
    name: 이미지 빌드
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: API 이미지
        uses: docker/build-push-action@v6
        with:
          context: .
          file: order-api-nest/Dockerfile
          target: runtime
          push: false
          cache-from: type=gha,scope=api
          cache-to: type=gha,mode=max,scope=api
      - name: 웹 이미지
        uses: docker/build-push-action@v6
        with:
          context: .
          file: order-console-next/Dockerfile
          push: false
          cache-from: type=gha,scope=web
          cache-to: type=gha,mode=max,scope=web
```

### 작업 2. [커밋] 이전 실행 취소 넣기

이것은 작업이 아니라 워크플로 전체의 설정이다. 파일 최상위, `permissions:` 블록 바로 아래(`jobs:` 위)에 넣는다.

```yaml
# .github/workflows/ci.yml
# 최상위(들여쓰기 없음), permissions: 블록과 jobs: 사이에 넣는다
# 같은 브랜치에 새로 푸시하면 아직 돌고 있는 이전 실행은 취소한다
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

이것으로 `.github/workflows/ci.yml`이 완성된다. 위에서부터 `name`, `on`, `permissions`, `concurrency`, `jobs`(`check`, `test-api`, `test-web`, `alert-rules`, `images`) 순서다.

### 작업 3. [확인] 두 번 푸시해 캐시 확인

```sh
git add .github/workflows/ci.yml
git commit -m "ci: 경보 규칙 테스트, 이미지 빌드, 이전 실행 취소"
git push
gh run watch
```

다섯 작업이 모두 `success`면 된다. 첫 실행의 `이미지 빌드`는 캐시가 없어서 오래 걸린다.

같은 브랜치에 커밋을 하나 더 푸시해(빈 커밋이어도 된다) 두 번째 실행의 `이미지 빌드` 시간을 첫 실행과 비교한다.

```sh
git commit --allow-empty -m "ci: 캐시 확인"
git push
gh run list --branch <브랜치> # 두 실행의 소요 시간을 비교한다
```

### 용어 | GitHub Actions 문법 (실행 묶기)

- `concurrency`: 워크플로 최상위에 둔다. 같은 `group` 값의 실행은 하나만 돌고, `cancel-in-progress: true`면 새 실행이 이전 실행을 취소한다.

- `${{ github.ref }}`: 실행을 일으킨 브랜치(ref)다. 그래서 그룹이 브랜치마다 나뉜다.

### 용어 | 액션 입력 (Docker 빌드)

- `docker/setup-buildx-action`: 캐시 내보내기 같은 기능을 쓸 수 있는 Docker 빌더(Buildx)를 준비한다.

- `docker/build-push-action`의 `context` / `file` / `target`: 빌드 맥락 폴더, Dockerfile 경로, 빌드할 단계(stage)다.

- `push: false`: 이미지를 만들기만 하고 레지스트리에 올리지 않는다.

- `cache-from` / `cache-to: type=gha`: Docker 빌드의 층(layer)을 GitHub Actions 캐시에서 읽고 저장한다. `mode=max`는 중간 층까지 저장하고, `scope`는 API·웹 캐시를 서로 나눈다.

### 개념 | 경보 규칙 작업에 Node 설치가 없는 이유

`alert-rules` 작업에는 `setup-node`도 `npm ci`도 없다.

`npm run test:rules`가 실제로 하는 일은 루트 `package.json`에 적힌 `docker run ... prom/prometheus:latest test rules /m/alert-rules.test.yml` 한 줄이다. `npm run`은 `package.json`에서 그 명령 문자열을 꺼내 셸에 넘길 뿐이라 `node_modules`가 필요 없다.

러너 이미지에는 Node·npm과 Docker가 기본으로 들어 있다. 그래서 체크아웃만 하고 바로 돌린다.

7초로 가장 빠른 작업인 이유다.

`run`은 저장소 루트에서 돌므로 `$PWD/monitoring`은 루트의 `monitoring/`이다. 경보 규칙(`alert-rules.yml`)과 그 테스트(`alert-rules.test.yml`)가 그 폴더에 있다.

### 개념 | 이미지 빌드의 `context`와 `target`

#### `context`가 `.`(저장소 루트)인 이유

두 Dockerfile 모두 첫 줄 근처에서 `COPY package.json package-lock.json ./`로 **워크스페이스 루트**의 잠금 파일을 복사한다.

빌드 맥락(context)은 Docker가 `COPY`로 읽을 수 있는 폴더의 범위다. 그래서 Dockerfile은 `order-api-nest/` 안에 있어도 맥락은 그 위의 저장소 루트(`.`)여야 한다.

로컬의 `compose.yaml`이 `context: .`, `dockerfile: order-api-nest/Dockerfile`로 하던 것과 같고, 액션 입력이라 루트부터 적는다(2장 "`working-directory`는 `run`에만 통한다").

#### API에만 `target: runtime`이 있는 이유

API Dockerfile에는 `deps`, `build`, `migrate`, `prod-deps`, `runtime` 단계가 있다. `target: runtime`은 "실제로 배포할 이미지"를 고른다.

BuildKit은 그 대상에 필요한 단계만 빌드한다. `runtime`은 `migrate` 단계를 쓰지 않으므로 마이그레이션용 이미지는 이 작업에서 만들어지지 않는다.

웹 Dockerfile은 마지막 단계가 `runtime` 하나라서 `target` 없이도 그것이 만들어진다.

### 개념 | 왜 이렇게 생겼는가 (4단계)

#### 이미지 빌드는 올리지 않는다

Dockerfile이 아직 빌드되는지만 확인한다. 이미지를 레지스트리에 올리는 일은 이 문서에서 하지 않는다.

#### 캐시로 줄인 시간

같은 작업의 시간이 이렇게 바뀌었다.

```text
첫 실행: 이미지 빌드 358초
다음 실행: 20초, 25초    # 의존성 층이 캐시에서 나왔다
```

캐시는 **브랜치마다 따로**다. 한 브랜치에서 만든 캐시는 그 브랜치와, 기본 브랜치(GitHub에서 저장소를 열면 처음 보이는 브랜치)의 캐시만 읽을 수 있다.

이 문서의 워크플로를 임시 브랜치에서 다듬은 뒤 `17-ci` 브랜치를 새로 만들어 푸시했더니, 첫 실행의 이미지 빌드가 다시 273초 걸렸다. 이 저장소의 기본 브랜치(`01-postgres-prisma`)에는 CI가 없어서 공유할 캐시가 없다.

#### 이전 실행 취소

같은 브랜치에 연달아 푸시하면 이전 실행을 취소한다. 결과를 볼 필요가 없는 실행에 러너 시간을 쓰지 않는다.

취소된 실행은 실패가 아니라 `cancelled`로 끝난다. 그룹이 `ci-${{ github.ref }}`라서 다른 브랜치의 실행은 건드리지 않는다.

### 남길 것

- **찾아보면 되는 것**: `concurrency`의 두 칸, `build-push-action`의 `context`·`file`·`target`·`push`, `type=gha`의 `mode`·`scope`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - Docker 빌드의 맥락(context)은 `COPY`가 읽을 수 있는 범위다. 워크스페이스 루트의 잠금 파일을 복사하는 Dockerfile은 맥락이 그 루트여야 한다.

  - CI 캐시는 브랜치마다 따로다. 새 브랜치의 첫 실행은 기본 브랜치에 캐시가 없으면 처음부터 다시 빌드한다.

- **에러 신호**:

  - 이미지 빌드가 매번 오래 걸린다 → 캐시(`type=gha`)를 쓰는지, `package-lock.json`보다 소스를 먼저 복사해 의존성 층이 매번 깨지는지(`07` 1단계)

  - 새 브랜치의 첫 실행만 이미지 빌드가 다시 오래 걸린다 → 고칠 것이 없다. 캐시는 브랜치마다 따로이고, 기본 브랜치(`01-postgres-prisma`)에는 CI가 없어 물려받을 캐시가 없다. 두 번째 실행부터 빨라지는지만 본다

  - 실행이 `cancelled`로 끝났다 → 같은 브랜치에 새 커밋이 푸시됐는지(`concurrency`가 이전 실행을 취소한다)

  - 경보 규칙 테스트만 실패 → `monitoring/`의 `alert-rules.yml`과 `alert-rules.test.yml`이 서로 맞는지(로컬에서 `npm run test:rules`)

## 6. 5단계: 일부러 깨뜨려보기, 응답 모양을 바꾼 커밋

### 실험 | 응답 모양을 바꾼 커밋 푸시하기

`12`의 깨뜨려보기(백엔드가 "내 주문" 응답을 배열에서 `{ items, total }`로 바꿈)를 그대로 커밋해 푸시했다.

tRPC 라우터의 `me.orders`를 이렇게 바꾼다.

```ts
// order-api-nest/src/trpc/router.ts
// me 라우터의 orders만 바꾼다. 배열을 그대로 돌려주던 것을 { items, total }로 감싼다
    orders: protectedProcedure.query(async ({ ctx }) => {
      const items = await ctx.prisma.asUser(ctx.userId, (tx) =>
        tx.order.findMany({ where: { userId: ctx.userId }, select: orderSelect, orderBy: { id: "asc" } }),
      );
      return { items, total: items.length };
    }),
```

```sh
git commit -am "깨뜨려보기: 내 주문 응답을 { items, total }로"
git push
gh run watch
```

결과는 이렇다.

```text
전체: failure
  린트/타입 검사   failure  test/trpc.e2e-spec.ts(52,36): error TS2339: Property 'map' does not exist on type '{ items: ...; total: number; }'.
  백엔드 테스트    failure  TypeError: (intermediate value).map is not a function
  프론트 e2e      failure  [WebServer] Failed to type check.
  경보 규칙 테스트  success
  이미지 빌드      success
```

### 개념 | 세 작업이 서로 다른 방식으로 잡았다.

타입 검사, 실행 중 오류, 빌드가 각각 같은 문제를 다른 자리에서 본 것이다.

| 작업 | 잡은 자리 | 무엇을 봤나 |
|---|---|---|
| 린트/타입 검사 | `tsc --noEmit` | 백엔드 테스트 파일이 `me.orders()`의 결과에 `.map`을 부른다. 반환 타입이 바뀌어 컴파일 에러 |
| 백엔드 테스트 | vitest 실행 | 같은 줄이 실제로 실행돼 객체에 `.map`을 불렀다 |
| 프론트 e2e | Playwright가 띄운 `next build`의 타입 검사 | 화면(`app/me/orders/my-order-list.tsx`)이 `data.map`을 부른다 |

백엔드 테스트(vitest)는 타입을 검사하지 않고 실행만 한다. 그래서 같은 줄이 런타임 에러(`TypeError`)로 드러났다.

### 개념 | 타입 검사 작업에는 프론트의 에러가 보이지 않는다.

루트의 `typecheck`가 `백엔드 검사 && 프론트 검사`라서 백엔드에서 멈췄다.

이 변경은 백엔드 자신의 테스트 파일도 깨뜨렸기 때문이다. 하나를 고치면 다음 에러가 나오는 셈이다.

> 모든 에러를 한 번에 보려면 두 검사를 별도 단계로 나누고 뒤 단계에 `if: always()`(앞 단계가 실패해도 실행)를 준다(7장 도전 과제 1).

### 개념 | 이미지 빌드는 통과했다.

`16`에서 웹 이미지 빌드는 타입 검사를 건너뛰게 했다(`SKIP_TYPECHECK`). 이미지가 빌드된다고 코드가 맞는 것은 아니다.

웹 Dockerfile이 `SKIP_TYPECHECK=1`을 주고, `next.config.ts`의 `typescript: { ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1" }`가 그것을 받아 `next build`의 타입 에러를 무시한다. 이미지에는 백엔드 소스를 넣지 않아 프론트가 쓰는 백엔드 타입을 볼 수 없기 때문이다.

그래서 이미지 빌드를 검사 작업들과 따로 둔다. 배포한다면 이미지가 빌드되는 커밋이 아니라 검사 작업이 모두 통과한 커밋만 배포해야 한다.

### 작업 1. [원복] 되돌려 푸시하기

깨뜨린 커밋을 되돌리는 커밋을 만들어 푸시한다.

```sh
git revert --no-edit HEAD
git push
gh run watch
```

되돌려서 푸시하면 다시 모두 통과한다.

### 작업 2. [확인] 다른 브랜치에서는 돌지 않는지 확인

```sh
gh run list --branch 16-release-candidate --json databaseId --jq length
0
gh run list --branch 01-postgres-prisma --json databaseId --jq length
0
```

`branches: ["**"]`여도 워크플로 파일이 없는 브랜치에는 몇 번을 푸시해도 실행 기록이 없다.

### 남길 것

- **찾아보면 되는 것**: `git revert`, `gh run list --json ... --jq`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 같은 문제를 타입 검사·테스트 실행·빌드가 각각 다른 자리에서 잡는다. 어느 하나만으로는 빈틈이 있고, `&&`로 이은 검사는 앞에서 멈추면 뒤의 에러를 보여 주지 않는다.

  - 이미지가 빌드된다는 것은 코드가 맞다는 뜻이 아니다(`SKIP_TYPECHECK`). 배포의 기준은 검사 작업의 통과다.

- **에러 신호**:

  - 타입 검사에서 `error TS2339: Property 'map' does not exist on type '{ items: ...; total: number; }'` → 백엔드 응답 모양이 바뀌었다. 그 응답을 쓰는 쪽(테스트, 화면)의 에러 줄

  - 백엔드 테스트에서 `TypeError: (intermediate value).map is not a function` → 같은 원인이 실행 중에 드러난 것이다. 타입 검사 결과를 먼저 본다

  - 프론트 e2e에서 `[WebServer] Failed to type check.` → Playwright가 띄운 `next build`의 타입 검사 실패다. 그 위에 찍힌 `TS` 에러 줄

  - 검사 작업은 실패인데 이미지 빌드만 통과 → 정상이다. 웹 이미지는 `SKIP_TYPECHECK`로 타입 검사를 건너뛴다

## 7. 디버깅

### 진단 1. 결과 보기

```sh
gh run list --branch <브랜치> # 최근 실행
gh run view <실행 id> # 작업별 결과
gh run view <실행 id> --log-failed # 실패한 단계의 로그만
gh run download <실행 id> -n test-web-logs # 실패 때 올린 아티팩트
gh run rerun <실행 id> --failed # 실패한 작업만 다시
```

먼저 `gh run view`로 어느 작업이 실패했는지 보고, `--log-failed`로 그 작업의 실패한 단계 로그만 읽는다.

작업 이름(`린트/타입 검사` 등)과 단계 이름(`테스트 DB 준비` 등)이 그대로 보이므로 워크플로 파일의 어느 줄인지 바로 찾을 수 있다.

프론트 e2e가 실패했다면 `gh run download`로 받은 `api.log`와 `test-results/`의 `error-context.md`를 본다.

### 진단 2. 증상으로 원인 가르기

메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(파일 위치, 서비스 컨테이너, Secrets, 캐시)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| 푸시했는데 실행이 없다 | 그 브랜치에 워크플로 파일이 없거나, `on.push.branches` 패턴에 맞지 않는다 | 그 브랜치의 저장소 루트 `.github/workflows/`에 파일이 있는지, `branches` 패턴 | 1단계 |
| 타입 검사에서 `Cannot find module '../generated/prisma/client.js'` | `prisma generate`를 빠뜨렸다. 생성 코드는 커밋되지 않는다 | `npx prisma generate` 단계가 타입 검사보다 앞에 있는지 | 1단계 |
| 단계가 하나도 돌지 않고 `Unable to resolve action action/checkout, repository not found` | `uses:`에 적은 액션 저장소가 없다(철자 오류) | 그 작업의 `uses:` 줄. `actions/…`의 `s` | 1단계 |
| `psql`이 `Connection refused`, 또는 백엔드 테스트가 DB에 연결하지 못한다 | 서비스 컨테이너가 준비되기 전에 시작했거나, 포트를 `.env`와 다르게 열었다 | 헬스 체크 `options`, `ports` | 2단계 |
| 테스트 DB 관련 `relation ... does not exist` | 테스트 DB에 마이그레이션을 소유자 연결(`ADMIN_DATABASE_URL`)로 적용하지 않았다 | "테스트 DB 준비"의 `migrate deploy` 줄 | 2단계 |
| `TEST_DATABASE_URL이 없다 - 개발 DB를 지우지 않도록 테스트를 멈춘다` | 테스트가 읽는 `.env`에 테스트 DB 주소가 없다 | `order-api-nest/.env`가 커밋돼 있는지 | 2단계 |
| 백엔드 테스트가 앱을 띄우다 저장소(S3)에서 실패 | API가 뜰 때 버킷을 만드는데 저장소가 없다 | `storage` 서비스와 `9000` 포트 | 2단계 |
| 프론트 e2e의 결제 테스트만 실패, API 로그에 `STRIPE_SECRET_KEY 환경변수가 없다` | 저장소 Secrets에 키가 없다 | `gh secret list` | 3단계 |
| "API 빌드·데모 데이터·실행"이 60초쯤 뒤 실패하고 `api.log`가 찍힌다 | API가 `/health/ready`에 200을 주지 못했다 | 찍힌 `api.log`의 에러 줄 | 3단계 |
| `npm warn exec The following package was not found and will be installed` | 잠금 파일에 없는 패키지를 실행 중에 내려받는다 | 그 `npx` 줄. 러너에 있는 도구로 바꾼다 | 3단계 |
| 로컬에서는 되는데 CI에서만 실패 | PC에 남아 있던 것(설치된 브라우저, 생성 코드, `.env.local`, 이미 떠 있던 서비스)에 기대고 있었다 | 실패한 단계 바로 앞에 그것을 만드는 단계가 있는지 | 3단계 |
| 이미지 빌드가 매번 오래 걸린다 | 캐시(`type=gha`)를 쓰지 않거나, `package-lock.json`보다 소스를 먼저 복사해 의존성 층이 매번 깨진다 | `cache-from`·`cache-to`, Dockerfile의 `COPY` 순서(`07` 1단계) | 4단계 |
| 새 브랜치의 첫 실행만 이미지 빌드가 오래 걸린다 | 캐시는 브랜치마다 따로이고, 기본 브랜치에는 CI가 없어 물려받을 캐시가 없다 | 고칠 것 없음. 두 번째 실행부터 빨라지는지 | 4단계 |
| 실행이 `cancelled`로 끝났다 | 같은 브랜치의 새 실행이 이전 실행을 취소했다 | 그 사이에 푸시가 있었는지, `concurrency` | 4단계 |
| 경보 규칙 테스트만 실패 | 경보 규칙과 그 테스트가 어긋났다 | `monitoring/alert-rules.yml`, `alert-rules.test.yml`. 로컬에서 `npm run test:rules` | 4단계 |
| `error TS2339: Property 'map' does not exist on type '{ items: ...; total: number; }'` | 백엔드 응답 모양이 바뀌었다 | 그 응답을 쓰는 테스트·화면 | 5단계 |
| `TypeError: (intermediate value).map is not a function` | 같은 원인이 테스트 실행 중에 드러났다 | 타입 검사 작업의 결과 | 5단계 |
| `[WebServer] Failed to type check.` | Playwright가 띄운 `next build`의 타입 검사가 실패했다 | 그 위에 찍힌 `TS` 에러 줄 | 5단계 |
| 검사 작업은 실패인데 이미지 빌드만 통과 | 웹 이미지는 `SKIP_TYPECHECK`로 타입 검사를 건너뛴다 | 정상이다. 검사 작업 결과를 기준으로 본다 | 5단계 |

### 시험해보기

```sh
git push # 워크플로 파일이 있는 브랜치(17-ci 이후)
gh run watch # 끝날 때까지 지켜보기
gh run view --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

### 도전 과제

#### 1. 타입 검사를 두 단계로 나누기

`typecheck`를 백엔드·프론트 두 단계로 나누고, 뒤 단계에 `if: always()`를 준다.

깨뜨려보기의 에러가 양쪽 모두 보이는지 확인한다.

**답**

```yaml
# .github/workflows/ci.yml
# check 작업의 npm run typecheck 한 줄을 아래 두 단계로 바꾼다
      - run: npm run lint
      - name: 타입 검사(백엔드)
        run: npm exec -w order-api-nest -- tsc --noEmit
      - name: 타입 검사(프론트)
        if: always()
        working-directory: order-console-next
        run: |
          npx next typegen
          npx tsc --noEmit
```

명령은 루트 `typecheck`의 `&&` 앞뒤를 그대로 나눈 것이다. 깨뜨려보기의 커밋에서 두 단계의 명령을 차례로 돌리면 이렇게 된다.

1. 백엔드 단계가 `test/trpc.e2e-spec.ts(52,36): error TS2339: Property 'map' does not exist on type '{ items: ...; total: number; }'.`로 실패한다.

2. 프론트 단계는 `if: always()`라 그래도 돈다. `app/me/orders/my-order-list.tsx(18,13): error TS2339: Property 'map' does not exist on type '{ items: ...; total: number; }'.`가 나온다.

3. 같은 변경이 백엔드 테스트 파일과 프론트 화면 파일을 함께 깨뜨린다는 것이 한 번의 실행에서 보인다.

> 프론트 에러는 프론트 e2e 작업의 `[WebServer] Failed to type check.` 앞에도 찍히지만, 그 작업은 의존성 설치와 API 빌드를 다 마친 뒤에야 거기까지 간다.

#### 2. 액션을 커밋 해시로 고정하기

사용한 액션(`actions/checkout@v4` 등)을 태그 대신 커밋 해시로 고정한다.

태그는 액션 저자가 옮길 수 있다는 점과 연결해 이유를 적는다.

**답**

태그가 지금 가리키는 커밋은 `git ls-remote`로 찾는다. 주석 태그면 `^{}`가 붙은 줄이 실제 커밋이다.

```sh
git ls-remote --tags https://github.com/actions/checkout.git | grep -E 'refs/tags/v4(\^\{\})?$'
11d5960a326750d5838078e36cf38b85af677262	refs/tags/v4
```

```yaml
# .github/workflows/ci.yml
# 모든 uses의 @태그를 @커밋 해시로 바꾼다
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
      - uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3.12.0
      - uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6.19.2
```

1. `v4` 같은 태그는 이름표일 뿐이라, 액션 저장소의 주인이 언제든 다른 커밋으로 옮길 수 있다. 저장소가 탈취되면 공격자도 옮길 수 있다.

2. 태그가 옮겨지면 이 워크플로는 파일을 한 글자도 바꾸지 않았는데 다음 실행부터 다른 코드를 돌린다. 프론트 e2e 작업에는 `STRIPE_SECRET_KEY`가 들어 있다.

3. 커밋 해시는 커밋 내용에서 계산되므로, 같은 해시가 다른 코드를 가리킬 수 없다. 검토한 그 코드만 돈다.

> 뒤 주석(`# v4.4.0`)은 사람이 읽고 올릴 때 보라고 남긴다. 해시로 고정하면 새 버전이 자동으로 들어오지 않으므로, 버전을 올릴 때는 해시를 직접 바꾼다.

#### 3. 서비스 컨테이너 설정 줄이기

백엔드 테스트와 프론트 e2e가 같은 서비스 컨테이너 설정을 반복한다.

재사용 워크플로(`workflow_call`)나 YAML 앵커로 줄여 본다.

무엇이 달라지는가?

**답**

YAML 앵커를 쓰면 파일 하나 안에서 끝난다. 백엔드 테스트의 `services`에 이름(`&services`)을 붙이고, 프론트 e2e에서는 그 이름(`*services`)만 적는다.

```yaml
# .github/workflows/ci.yml
# test-api의 services에 앵커를 붙이고, test-web의 services 13줄을 별칭 한 줄로 바꾼다
  test-api:
    services: &services
      db:
        image: postgres:17
        # ... (redis, storage까지 그대로)

  test-web:
    services: *services
```

1. 프론트 e2e의 서비스 설정 13줄이 한 줄로 준다. 포트나 이미지를 바꿀 때 한 곳만 고치면 된다.

2. YAML을 읽는 쪽이 별칭을 앵커의 내용으로 펼친다. 펼친 결과는 원래 워크플로와 완전히 같고, `actionlint`도 그대로 통과한다.

> 앵커는 같은 파일 안에서만 통한다. 다른 워크플로와도 나누려면 작업 전체를 재사용 워크플로(`workflow_call`)로 빼야 한다.

### 남길 것

- **찾아보면 되는 것**: `gh run list` / `view` / `view --log-failed` / `download` / `rerun --failed`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 실패는 "어느 작업 → 어느 단계"로 좁힌 뒤 그 단계의 로그만 읽는다. 단계에 `name`을 붙여 두면 로그에서 워크플로의 그 줄을 바로 찾는다.

  - CI에서만 실패하면 먼저 "PC에는 있는데 깨끗한 머신에는 없는 것"을 찾는다.

- **에러 신호**: 이 장의 진단 2 표가 1~5단계의 에러 신호를 모두 모은 것이다.

## 8. 완성 확인

- [ ] 저장소 Secrets에 `STRIPE_SECRET_KEY`가 있고, 값은 어디에도 출력되지 않았다

- [ ] 푸시하면 다섯 작업(린트/타입 검사, 백엔드 테스트, 프론트 e2e, 경보 규칙, 이미지 빌드)이 돌고 모두 통과한다

- [ ] 워크플로 파일이 없는 브랜치에서는 실행되지 않는다

- [ ] 두 번째 실행부터 이미지 빌드가 캐시로 빨라졌다

- [ ] 응답 모양을 바꾼 커밋을 세 작업이 잡고, 이미지 빌드는 잡지 못하는 것을 확인했다

- [ ] 실패하면 API 로그와 Playwright 결과가 아티팩트로 남는다

## 9. 다음 단계

### 자가 점검

1. CI가 "깨끗한 가상 머신"에서 돈다는 것이 왜 중요한가? 이 문서에서 PC에서는 신경 쓰지 않다가 CI에서 필요해진 단계는?

2. 작업(job)과 단계(step)의 차이는? 하나가 실패하면 각각 어떻게 되는가?

3. 서비스 컨테이너의 포트를 로컬 compose와 같게 연 이유는?

4. Secrets를 작업 전체가 아니라 한 단계의 `env`에만 준 이유는? 포크에서 온 PR에서는 어떻게 되는가?

5. `npx wait-on`을 `curl` 반복으로 바꾼 이유는?

6. 이미지 빌드는 통과했는데 코드는 틀린 경우가 생긴 이유는? 그렇다면 배포는 무엇을 기준으로 해야 하는가?

7. `permissions: contents: read`는 무엇을 막는가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- PR마다 돌리기(`pull_request`), 브랜치 보호 규칙으로 통과한 PR만 합치기

- 여러 Node 버전·운영체제에서 돌리기(matrix)

- 테스트를 여러 러너에 나눠 돌리기(sharding), 실패한 테스트만 다시 돌리기

- 의존성 취약점 검사, 자동 업데이트(Dependabot), 코드 분석(CodeQL)

- 자체 호스팅 러너

- 통과한 커밋의 이미지를 레지스트리에 올리고 서버에 배포하기
