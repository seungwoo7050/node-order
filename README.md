# 24: 무중단 배포

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Prisma%20%7C%20Caddy%20%7C%20k6%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [23-caching](https://github.com/seungwoo7050/node-order/tree/23-caching) 브랜치

운영 배포를 같은 자리에서 컨테이너를 바꾸는 방식(`deploy.sh`)에서 블루·그린 두 벌을 번갈아 쓰는 방식(`release.sh`)으로 바꾸고, CI가 트래픽을 넘기기 전에 대기 환경을 Playwright로 스모크 테스트합니다. 주문 금액 칸 `price`를 `total_amount`로 바꾸는 과정을 여섯 개의 마이그레이션으로 나누고, 카탈로그 캐시 키에 형식 버전을 붙입니다. 이 PC에서 운영 구성을 띄우는 리허설 구성과 배포 중 끊김을 재는 도구를 더합니다.

## 지원 범위

- 블루그린 배포(`deploy/`)
  - 운영 Compose의 서비스 `api-blue`·`web-blue`(프로필 `blue`)와 `api-green`·`web-green`(프로필 `green`). 지금 트래픽을 받는 쪽과 각 태그는 서버 `.env`의 `ACTIVE`·`BLUE_TAG`·`GREEN_TAG`
  - Caddy는 `live/web.caddy`·`live/api.caddy`를 `import`하고, `release.sh`가 이 파일을 고쳐 `caddy reload`로 전환
  - `release.sh up <태그> [토큰]`: 대기 쪽에 새 이미지를 받아 마이그레이션 → 앱 역할 비밀번호 맞추기 → 기동(`--wait`). 준비되지 않으면 `abort`. 토큰을 주면 쿠키 `deploy_slot=<토큰>`을 든 웹 요청만 대기 쪽으로 보내고 응답에 `X-Deploy-Slot: preview`
  - `release.sh switch`: 트래픽을 대기 쪽으로 넘기고 `DRAIN_SECONDS`(기본 10초) 뒤 이전 쪽을 멈춤(지우지 않음). 지금·이전 태그 말고 GHCR 이미지는 지움
  - `release.sh abort`: 대기 쪽을 멈추고 태그와 라우팅을 되돌림. `release.sh <태그>`는 `up` 뒤 `switch`
  - `rollback.sh`: 멈춰 둔 이전 쪽을 다시 띄우고 트래픽을 넘김. DB는 되돌리지 않음
  - `ops/reset-demo.sh`는 `ACTIVE` 쪽 태그의 migrate 이미지로 시드를 돌림. `ops/psql.sh`는 서버에서 운영 DB에 `psql`
  - `deploy.sh`는 지움. `aws/60-server-env.sh`는 서버의 `ACTIVE`·`BLUE_TAG`·`GREEN_TAG`·`RATE_LIMIT_ALLOW_IPS` 값을 지키며 `.env`를 올림
- CI 배포 작업(`.github/workflows/ci.yml`)
  - 설정 파일 올리기 → `release.sh up <커밋> <무작위 토큰>` → 스모크(`npm run test:smoke`, 그 토큰의 쿠키로 대기 쪽) → `release.sh switch` → 공개 주소 확인
  - 스모크가 실패하면 `release.sh abort`, `test-results/`를 아티팩트로 남김
- 주문 금액 칸 이름 변경(expand-contract)
  - `0022` `total_amount` 추가 → `0023` `price` NULL 허용 → `0024` CHECK `NOT VALID` → `0025` 1만 행씩 커밋하는 백필 → `0026` 검증 뒤 NOT NULL → `0027` `lock_timeout` 1초를 둔 `price` 삭제
  - 앱은 `totalAmount`만 쓰고, API 응답과 `POST /orders` 입력의 이름은 `price` 그대로
- 캐시
  - 카탈로그 캐시 키 `catalog:v2`. 무효화와 시드는 옛 키 `catalog`도 지움
  - 캐시된 항목의 카테고리가 `{ id, name }` 배열(`categories`). 응답에는 이전과 같은 `categoryPath`도 붙임
- 요청 수 제한 허용 목록 `RATE_LIMIT_ALLOW_IPS`(쉼표로 구분, 일치하면 세지 않음). 운영 `RATE_LIMIT_PER_MINUTE`를 `.env`로 바꿀 수 있음(기본 300)
- 리허설: `deploy/compose.rehearsal.yaml`·`rehearsal.env`로 같은 `release.sh`를 이 PC에서 돌림(Caddy HTTP 웹 :8080·API :8081, Postgres :5434, 저장소 :9100). `rehearsal-build.sh <태그>`가 `rehearsal/*` 이미지를 만들고, `rehearsal-snapshot.sh save|restore [이름]`이 DB를 템플릿 DB로 저장·복원
- 측정 도구(`order-api-nest/`)
  - k6 `loadtest/steady.js`: 목록·상세(초당 30), 내 주문(10), 주문 쓰기(10)를 일정 속도로. 관리자 `loadtest` 계정과 `LOADTEST_PASSWORD`가 필요
  - `scripts/downtime-report.mjs <csv>`: k6 CSV에서 실패 수·종류·가장 긴 연속 실패 구간·초별 실패
  - `scripts/write-stall.mjs [초]`: 주문을 계속 넣으며 100ms 넘게 걸린 쓰기를 셈(`DATABASE_URL`)
  - `scripts/ws-watch.mjs [초] [API]`: WebSocket 끊김과 못 받은 주문 알림
- 화면 머리글·제목을 "Brown Store."로 바꿈

## 구성

`23`에서 바뀐 곳만 적습니다.

```text
.
├── .github/workflows/ci.yml            # 배포: up → 스모크 → switch, 실패하면 abort
├── deploy/
│   ├── compose.yml                     # api-/web-의 blue·green, migrate의 RELEASE_TAG, IMAGE_PREFIX
│   ├── Caddyfile                       # import /etc/caddy/live/*.caddy, PUBLIC_SCHEME
│   ├── release.sh, rollback.sh         # 새 파일 (deploy.sh는 지움)
│   ├── compose.rehearsal.yaml, rehearsal.env, rehearsal-build.sh, rehearsal-snapshot.sh  # 새 파일
│   ├── .env.example, .gitignore        # ACTIVE·BLUE_TAG·GREEN_TAG·RATE_LIMIT_ALLOW_IPS, live/
│   ├── aws/60-server-env.sh            # 서버의 블루그린 값 지키기
│   └── ops/                            # psql.sh(새 파일), lib.sh·reset-demo.sh(ACTIVE 태그)
├── order-api-nest/
│   ├── prisma/
│   │   ├── schema.prisma               # Order.totalAmount
│   │   ├── migrations/0022_* ~ 0027_*
│   │   ├── seed.ts, seed/catalog.json
│   ├── src/
│   │   ├── cache/                      # catalog:v2, 옛 키도 지움
│   │   ├── products/product-list.ts    # categories { id, name }
│   │   ├── me/, orders/, users/, trpc/, auth/demo-user.ts  # totalAmount ↔ price
│   │   └── rate-limit/                 # 허용 목록
│   ├── loadtest/steady.js              # 새 파일
│   ├── scripts/                        # downtime-report, write-stall, ws-watch(새 파일), bulk-orders.sql·page-drift 수정
│   └── test/                           # rate-limit(허용 목록), catalog-cache(옛 키), 나머지는 total_amount에 맞춤
├── order-console-next/
│   ├── package.json                    # test:smoke
│   ├── playwright.smoke.config.ts      # 새 파일: SMOKE_URL, DEPLOY_SLOT_TOKEN 쿠키
│   ├── smoke/release.smoke.ts          # 새 파일
│   └── app/layout.tsx, app/nav.tsx     # 제목
└── README.md
```

## 실행

개발 환경(`npm run dev:api`, `npm run dev:web`, `compose.yaml`)은 `23`과 같습니다.

### 리허설

저장소 루트에서 이미지를 만들고 첫 버전을 띄운 뒤, 시드를 넣습니다.

```sh
deploy/rehearsal-build.sh b1
cp deploy/rehearsal.env deploy/.env
deploy/release.sh b1                                       # 처음에는 blue
(cd deploy && RELEASE_TAG=b1 docker compose run --rm -T migrate npx prisma db seed)
```

웹은 http://localhost:8080, API는 http://localhost:8081 입니다. 다음 버전은 다른 태그로 빌드해 `deploy/release.sh b2`(또는 `up b2 <토큰>` → `switch`), 되돌리기는 `deploy/rollback.sh`입니다.

### 운영

`deploy/aws`에서 `60-server-env.sh`를 다시 실행해 서버 `.env`에 블루그린 줄을 더하고, 저장소 변수 `DEPLOY_BRANCH`와 `production` 환경의 허용 브랜치를 `24-zero-downtime-release`로 바꾼 뒤 푸시하면 CI가 배포합니다. 첫 배포는 `ACTIVE`가 비어 있으므로 blue에 띄우고, `switch`가 `live/`를 붙인 Caddy를 다시 만들면서 이전 구성의 `api`·`web` 컨테이너를 지웁니다(`--remove-orphans`).

```sh
# 서버(/opt/node-order)에서 손으로 되돌리기
bash rollback.sh
```

## 테스트

```sh
npm run lint
npm run typecheck
npm run test:api
npm run test:web
```

- API e2e 추가분: 허용 목록 IP는 세지 않음(`rate-limit.e2e-spec.ts`), 옛 형식 키를 읽지 않고 무효화 때 함께 지움(`catalog-cache.e2e-spec.ts`)
- 스모크(데모 사용자로 들어가 목록과 상세)는 대기 환경에 띄운 뒤 그 주소로 돌립니다.

```sh
deploy/release.sh up b2 <토큰>
SMOKE_URL=http://localhost:8080 DEPLOY_SLOT_TOKEN=<토큰> npm run test:smoke -w order-console-next
deploy/release.sh switch                                   # 실패했다면 deploy/release.sh abort
```

배포 중 끊김은 k6를 띄운 채 다른 터미널에서 배포하고 보고서로 봅니다. `steady.js`는 관리자 `loadtest` 계정으로 로그인하므로 리허설 DB에 먼저 만듭니다(비밀번호는 `password.ts`와 같은 scrypt 형식).

```sh
export LOADTEST_PASSWORD=<8자 이상>
node -e 'const c=require("crypto");const s=c.randomBytes(16).toString("hex");const h=c.scryptSync(process.env.LOADTEST_PASSWORD,Buffer.from(s,"hex"),64).toString("hex");console.log(`INSERT INTO users (id, name, role, password_hash) VALUES (\x27loadtest\x27, \x27loadtest\x27, \x27admin\x27, \x27scrypt$${s}$${h}\x27) ON CONFLICT (id) DO UPDATE SET role = \x27admin\x27, password_hash = EXCLUDED.password_hash;`)' \
  | (cd deploy && docker compose exec -T db psql -U order_owner -d order_api)

mkdir -p order-api-nest/loadtest/out
k6 run -e API=http://localhost:8081 -e DURATION=90s --out csv=order-api-nest/loadtest/out/run.csv order-api-nest/loadtest/steady.js
node order-api-nest/scripts/downtime-report.mjs order-api-nest/loadtest/out/run.csv
```

CI는 검사·테스트 작업이 `23`과 같고, 배포 작업이 위 "CI 배포 작업"대로 바뀌었습니다.

## 정리

```sh
(cd deploy && docker compose --profile blue --profile green down -v)   # 리허설 컨테이너와 볼륨
rm deploy/.env && rm -rf deploy/live
docker compose down                                                     # 개발 컨테이너
```
