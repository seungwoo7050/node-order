# 17: CI

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-GitHub%20Actions%20%7C%20Docker%20Buildx%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [16-release-candidate](https://github.com/seungwoo7050/node-order/tree/16-release-candidate) 브랜치

GitHub Actions 워크플로 `.github/workflows/ci.yml`을 더해, 푸시할 때마다 `16`에서 루트 `package.json`에 모은 lint·타입 검사·백엔드 테스트·프론트 e2e·경보 규칙 테스트와 Docker 이미지 빌드를 돌립니다. 애플리케이션 코드는 바뀌지 않았습니다.

## 지원 범위

- `16-release-candidate`까지의 기능과 루트 명령(`lint`, `typecheck`, `test:api`, `test:web`, `test:rules`), `compose.yaml`의 `app`·`monitoring` 프로필
- `.github/workflows/ci.yml`
  - 모든 브랜치의 push에서 돈다(`branches: ["**"]`). 워크플로 파일이 있는 브랜치에서만 돈다
  - `permissions: contents: read`
  - `concurrency`로 같은 ref에 새로 푸시하면 이전 실행을 취소한다
  - 작업 5개가 각자의 러너에서 동시에 돈다

| 작업(id) | 하는 일 |
|---|---|
| 린트/타입 검사(`check`) | `npm ci`, `prisma generate`, `npm run lint`, `npm run typecheck` |
| 백엔드 테스트(`test-api`) | PostgreSQL 17·Redis 7·RustFS 서비스 컨테이너(`5433`, `6380`, `9000`), `psql`로 `order_api_test` 생성과 마이그레이션, `npm run test:api` |
| 프론트 e2e(`test-web`) | 같은 서비스 컨테이너에 마이그레이션·시드 후 API를 빌드해 백그라운드로 띄우고 `curl`로 `/health/ready`를 최대 60초 기다림. `order-console-next/.env.local`에 `AUTH_SECRET`(무작위)과 더미 GitHub 값을 넣고 `npm run test:web`. 실패하면 API 로그와 `test-results/`를 아티팩트 `test-web-logs`로 7일 보관 |
| 경보 규칙 테스트(`alert-rules`) | 체크아웃 후 `npm run test:rules`(promtool 컨테이너) |
| 이미지 빌드(`images`) | Buildx로 API(`target: runtime`)와 웹 이미지를 빌드만 함(`push: false`). 캐시는 `type=gha`, `scope`를 api·web으로 나눔 |

- 서비스 컨테이너의 포트·계정을 로컬 compose와 같게 열어, 커밋된 `order-api-nest/.env`를 CI에서 그대로 쓴다
- Stripe 테스트 키는 저장소 Secrets `STRIPE_SECRET_KEY`에서 받아 API를 띄우는 단계의 `env`에만 넘긴다. 실제 결제 e2e(`STRIPE_E2E=1`)는 `stripe listen`이 필요해 CI에서 돌리지 않는다
- 웹 이미지는 빌드할 때 타입 검사를 건너뛰므로(`SKIP_TYPECHECK=1`) 타입 검사는 `check` 작업이 맡는다

## 구성

`16`에서 바뀐 곳만 적습니다.

```text
.
└── .github/
    └── workflows/
        └── ci.yml        # check, test-api, test-web, alert-rules, images
```

## 실행

로컬 개발 환경과 실행 방법은 `16`과 같습니다(`docker compose --profile app up -d --build` 또는 개발 모드).

CI의 프론트 e2e 중 결제 버튼 테스트는 실제 Stripe에 세션을 만들므로, 저장소 Secrets에 Stripe 테스트 키를 넣어 둡니다. 값은 명령을 실행하면 입력받습니다.

```sh
gh secret set STRIPE_SECRET_KEY --repo <계정>/<저장소>
gh secret list --repo <계정>/<저장소>
```

워크플로 파일이 있는 브랜치에 푸시하면 CI가 돕니다.

```sh
git push
gh run watch # 방금 시작된 실행을 끝날 때까지 지켜봄
```

## 테스트

CI가 부르는 것은 루트 `package.json`의 명령이므로, 푸시 전에 같은 검사를 PC에서 돌립니다. 준비(compose 인프라, 테스트 DB)는 `16`과 같습니다.

```sh
npm run lint
npm run typecheck
npm run test:api
npm run test:web
npm run test:rules
```

CI 결과는 GitHub CLI로 봅니다.

```sh
gh run list --branch <브랜치>              # 최근 실행
gh run view <실행 id>                      # 작업별 결과
gh run view <실행 id> --log-failed         # 실패한 단계의 로그만
gh run download <실행 id> -n test-web-logs # 프론트 e2e 실패 때 올린 API 로그·Playwright 결과
gh run rerun <실행 id> --failed            # 실패한 작업만 다시
```

## 정리

로컬 컨테이너 정리는 `16`과 같습니다.

```sh
docker compose --profile app --profile monitoring down
docker compose --profile app --profile monitoring down -v # 볼륨까지 삭제
```
