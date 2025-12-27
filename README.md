# 17: CI

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-GitHub%20Actions%20%7C%20Docker%20Buildx%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [16-release-candidate](https://github.com/seungwoo7050/node-order/tree/16-release-candidate) 브랜치의 전체 워크스페이스(`order-api-nest`, `order-console-next`, `monitoring`, `compose.yaml`)

지금까지는 린트, 타입 검사, 백엔드 테스트, 프론트 e2e, 경보 규칙 테스트를 사람이 기억해서 PC에서 돌렸습니다.

이 단계에서는 GitHub Actions 워크플로 하나로, 푸시할 때마다 깨끗한 가상 머신에서 같은 검사와 Docker 이미지 빌드를 돌립니다. 애플리케이션 코드는 바꾸지 않습니다.

## 지원 범위

- 워크플로 `.github/workflows/ci.yml`

  - 모든 브랜치의 푸시에서 돎(`branches: ["**"]`). 워크플로 파일이 이 브랜치에서 처음 생기므로 실제로는 `17-ci`와 여기서 따는 이후 브랜치에서만 돎

  - `GITHUB_TOKEN`은 읽기 권한만(`permissions: contents: read`)

  - 같은 브랜치에 새로 푸시하면 아직 돌고 있는 이전 실행을 취소(`concurrency`)

- 다섯 작업이 서로 다른 러너에서 동시에 돎

  - 린트/타입 검사: 루트의 `npm run lint`, `npm run typecheck` 그대로. 커밋하지 않는 Prisma 생성 코드를 먼저 만듦

  - 백엔드 테스트: PostgreSQL·Redis·RustFS를 서비스 컨테이너로 띄우고, 테스트 DB 생성과 마이그레이션(앱 역할 포함) 뒤 `npm run test:api`. 포트를 로컬 compose와 같게(5433, 6380, 9000) 열어 커밋된 `order-api-nest/.env`를 그대로 씀

  - 프론트 e2e: 같은 서비스 컨테이너에 API를 빌드·시드해 뒤에서 띄우고 `/health/ready`가 200이 될 때까지 기다린 뒤 `npm run test:web`. 실패하면 API 로그와 Playwright 결과를 아티팩트 `test-web-logs`로 7일 보관

  - 경보 규칙 테스트: `npm run test:rules`(promtool 컨테이너). Node 설치 없이 체크아웃만

  - 이미지 빌드: API(`target: runtime`)와 웹 이미지를 빌드만 하고 올리지 않음(`push: false`). 층은 GitHub Actions 캐시(`type=gha`)에 API·웹을 나눠 저장

- Stripe 테스트 키는 저장소 Secrets(`STRIPE_SECRET_KEY`)에서 받아, API를 띄우는 단계의 `env`에만 넘김. 웹훅까지 가는 실제 결제 e2e(`STRIPE_E2E=1`)는 `stripe listen`이 필요해 CI에서 돌리지 않음

- 실행 중에 패키지를 내려받지 않음. API 준비를 기다리는 것도 러너에 있는 `curl`로 함

- 웹 이미지는 빌드할 때 타입 검사를 건너뛰므로(`SKIP_TYPECHECK`, `16-release-candidate`), 이미지 빌드의 통과는 코드가 맞다는 뜻이 아닙니다. 배포의 기준은 검사 작업의 통과입니다.

## 구성

```text
.
├── .github/
│   └── workflows/
│       └── ci.yml                    # 이 단계에서 새로 만든 파일. 작업 5개(check, test-api, test-web, alert-rules, images)
├── package.json                      # CI가 그대로 부르는 확인 명령(lint, typecheck, test:*)
├── package-lock.json                 # setup-node의 npm 캐시 키
├── compose.yaml                      # 서비스 컨테이너의 이미지·계정·포트가 이 파일과 같음
├── monitoring/                       # alert-rules.yml, alert-rules.test.yml (경보 규칙 테스트)
├── order-api-nest/                   # NestJS API
│   ├── .env                          # 학습용 데모 값(커밋됨). CI도 이 파일의 localhost 주소를 씀
│   └── Dockerfile                    # 이미지 빌드 작업은 runtime 단계만
├── order-console-next/               # Next.js 프론트
│   ├── .env.example                  # CI가 .env.local로 복사하고 AUTH_* 세 값만 채움
│   └── Dockerfile
└── README.md
```

## 실행

### 저장소 준비

GitHub CLI(`gh`)로 Stripe 테스트 키를 저장소 Secrets에 넣습니다. 값이 화면이나 셸 기록에 남지 않게 파일에서 바로 넘깁니다.

```sh
gh auth status
grep '^STRIPE_SECRET_KEY=' order-api-nest/.env.local | cut -d= -f2- | gh secret set STRIPE_SECRET_KEY --repo <계정>/<저장소>
gh secret list --repo <계정>/<저장소>
```

키가 없으면 프론트 e2e의 결제 테스트만 실패합니다.

### CI 돌리기

워크플로 파일이 있는 브랜치에 푸시하면 돕니다.

```sh
git push
gh run watch # 방금 시작된 실행을 끝날 때까지 지켜봄
```

```text
ci  17-ci  push
  린트/타입 검사   success  55초
  백엔드 테스트    success  82초
  프론트 e2e      success 133초
  경보 규칙 테스트  success   7초
  이미지 빌드      success  25초   # 캐시가 없는 첫 실행은 358초
```

## 결과 보기

```sh
gh run list --branch <브랜치>              # 최근 실행
gh run view <실행 id>                      # 작업별 결과
gh run view <실행 id> --log-failed         # 실패한 단계의 로그만
gh run download <실행 id> -n test-web-logs # 프론트 e2e 실패 때 올린 API 로그·Playwright 결과
gh run rerun <실행 id> --failed            # 실패한 작업만 다시
```

## 로컬에서 같은 검사

CI는 루트 `package.json`의 명령을 그대로 부르므로, 푸시하기 전에 PC에서 같은 것을 돌려 볼 수 있습니다. 준비(compose, 테스트 DB)는 `16-release-candidate`의 README와 같습니다.

```sh
npm run lint
npm run typecheck
npm run test:api
npm run test:web
npm run test:rules
```
