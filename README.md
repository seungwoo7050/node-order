# 21: 공개 데모

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Redis%20%7C%20PostgreSQL%20%7C%20S3-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [20-operations](https://github.com/seungwoo7050/node-order/tree/20-operations) 브랜치

데모 로그인이 고정 계정(`lee`, `kim`) 대신 누를 때마다 임시 사용자를 만들고, "관리자로"는 읽기 전용 역할 `demo_admin`으로 들어갑니다. IP별 요청 수 제한을 더하고, 카테고리·상품·사진을 저장소의 파일(`prisma/seed/`)로 고정해 시드가 그 상태로 되돌립니다. 주문·사용자 목록 등 관리용 API를 관리자 전용으로 막습니다.

## 지원 범위

- 방문자별 데모 계정
  - `POST /auth/demo`가 누를 때마다 임시 사용자(`demo-<16진수 8자리>`)를 만들고, 품목이 든 견본 주문 1~2건(결제 완료 1건, 취소 1건)을 넣음. 견본 주문은 재고를 줄이지 않음
  - 임시 사용자는 `users.expires_at`(기본 24시간 뒤, `DEMO_USER_TTL_SECONDS`)으로 표시. 리더 인스턴스의 `DemoUserCleanupJob`이 10분마다(`DEMO_CLEANUP_INTERVAL_MS`) 만료된 사용자를 주문·토큰과 함께 지우고, 결제 대기 주문의 재고는 돌려줌
- 읽기 전용 데모 관리자
  - 역할 `demo_admin`(마이그레이션 `0019`). 머리글의 "관리"와 관리 화면은 보이지만 사진 올리기 입력은 꺼져 있고, 이유를 화면에 글자로 보여 줌
  - `AdminGuard`가 `demo_admin`을 "데모 관리자는 볼 수만 있습니다"(403)로 막음
  - 관리자 전용 API: `GET /orders`, `GET /orders/totals`, `GET /orders/:id`, `POST /orders`, `GET`·`POST /users`, `PATCH`·`DELETE /categories/:id`, 상품 이미지 업로드
  - 진짜 관리자(`admin`)는 서버에서 SQL로만 정함(`19`와 같음)
- 요청 수 제한(IP마다 1분 고정 창, Redis)
  - `POST /auth/login`, `/auth/demo`, `/auth/exchange`, `/auth/refresh`는 `AUTH_RATE_LIMIT_PER_MINUTE`, 나머지는 `RATE_LIMIT_PER_MINUTE`. 넘으면 429와 `Retry-After`, 응답마다 `RateLimit-Limit`·`RateLimit-Remaining`
  - `/health`, `/metrics`, `/payments/webhook`은 세지 않음. 거절 수는 지표 `http_rate_limited_total{bucket}`
  - Redis에 닿지 못하면 세지 않고 통과시킴
  - `TRUST_PROXY`가 있으면 Express `trust proxy`로 `X-Forwarded-For`의 방문자 주소로 셈. Next 서버가 대신 부르는 `/auth/github`에도 그 헤더를 넘김
  - 두 한도 환경 변수가 없으면 꺼짐(로컬·테스트). 운영 `deploy/compose.yml`은 300·20, `TRUST_PROXY=uniquelocal`
- 고정 카탈로그와 시드
  - 카테고리 9개·상품 16개는 `order-api-nest/prisma/seed/catalog.json`, 사진은 `prisma/seed/photos/*.webp`
  - 시드가 사진을 고정 키 `seed/<파일 이름>`으로 저장소(S3)에 올리고(같은 크기의 객체가 있으면 건너뜀), 카테고리·상품을 `id`로 덮어씀. 모든 테이블을 비우던 `TRUNCATE`는 없앰
  - 시드가 되돌리는 것: 카테고리·상품·재고, 시드 사용자(`kim`·`lee`·`park`·`choi`)의 비밀번호와 주문, 임시 사용자. 남기는 것: GitHub 사용자와 그 주문, 사용자의 역할
  - 만든 사람의 사진(`photos/maker-*`, 상품 4개)은 커밋하지 않음(`.gitignore`). 파일도 저장소의 키도 없으면 그 상품은 사진 없이 들어가고 시드가 경고를 찍음. 운영 S3에는 `deploy/aws/62-seed-private-photos.sh`로 올림
- 워크플로에 `workflow_dispatch`(손으로 실행)를 더함

## 구성

`20`에서 바뀐 곳만 적습니다.

```text
.
├── .github/workflows/ci.yml          # workflow_dispatch
├── deploy/
│   ├── compose.yml                   # api: 요청 수 제한·TRUST_PROXY, migrate: S3 값(시드가 사진을 올림)
│   └── aws/62-seed-private-photos.sh # 새 파일: maker-*.webp → s3://<버킷>/seed/
├── order-api-nest/
│   ├── .gitignore                    # /prisma/seed/photos/maker-*
│   ├── prisma/
│   │   ├── schema.prisma             # Role.demo_admin, User.expiresAt
│   │   ├── migrations/0018_demo_user_expiry/, 0019_demo_admin_role/
│   │   ├── seed.ts                   # catalog.json 기준으로 되돌림
│   │   └── seed/                     # 새 폴더: catalog.json, photos/
│   ├── scripts/list-objects.mjs      # 접두사를 인자로
│   ├── src/
│   │   ├── auth/demo-user.ts         # 새 파일: 임시 사용자·견본 주문 만들기, 사용자 지우기
│   │   ├── auth/                     # auth.service.ts, admin.guard.ts, jwt.strategy.ts
│   │   ├── leader/demo-user-cleanup.job.ts  # 새 파일
│   │   ├── rate-limit/               # 새 폴더: 미들웨어와 모듈
│   │   ├── orders/, users/, categories/  # 컨트롤러에 AdminGuard
│   │   ├── storage/storage.service.ts    # ensureBucket, putIfAbsent
│   │   ├── metrics/metrics.ts        # http_rate_limited_total
│   │   └── main.ts                   # TRUST_PROXY
│   └── test/                         # admin-only·rate-limit(새 파일), demo-login·categories 수정
├── order-console-next/
│   ├── auth.ts                       # /auth/github에 X-Forwarded-For
│   ├── lib/use-profile.ts            # useCanSeeAdmin(admin, demo_admin)
│   ├── app/nav.tsx, login/page.tsx
│   ├── app/admin/products/           # 읽기 전용 표시
│   └── e2e/                          # 데모 관리자 읽기 전용 테스트 추가, 상품 id를 새 카탈로그에 맞춤
└── README.md
```

## 실행

필요한 도구와 포트는 `20`과 같습니다(API 4000, 웹 3000, Postgres 5433, Redis 6380, 저장소 9000).

```sh
npm ci
docker compose up -d                                   # db, redis, storage, jaeger
npm exec -w order-api-nest -- prisma generate
npm exec -w order-api-nest -- prisma migrate deploy
npm exec -w order-api-nest -- prisma db seed           # 끝에 "seed 완료: 상품 16개(...)"
npm run dev:api   # :4000
npm run dev:web   # :3000 (다른 터미널)
```

http://localhost:3000/login 의 "일반 사용자로"·"관리자로"는 누를 때마다 임시 계정을 새로 만듭니다. 비밀번호 로그인은 `kim`(관리자)·`lee`·`park`·`choi`와 `order-api-nest/.env`의 `DEMO_PASSWORD`(`1234`)입니다.

### 배포

저장소 변수 `DEPLOY_BRANCH`와 `production` 환경의 허용 브랜치를 `21-public-demo`로 바꾸고 푸시하면, 마이그레이션 `0018`·`0019`까지 `18`의 배포 작업이 적용합니다. 그 뒤 `deploy/aws`에서 만든 사람의 사진을 올리고, 서버에서 시드를 한 번 돌립니다(다음부터는 `20`의 04:00 데모 초기화가 돌림).

```sh
./62-seed-private-photos.sh
ssh -i .local/admin_ed25519 ubuntu@<서버 IP> 'cd /opt/node-order && docker compose run --rm -T migrate npx prisma db seed'
```

## 테스트

테스트 DB는 처음 한 번 만들고, 마이그레이션이 늘 때마다 적용합니다.

```sh
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npm exec -w order-api-nest -- prisma migrate deploy
```

```sh
npm run lint
npm run typecheck
npm run test:api   # 단위 + e2e
npm run test:web   # 프론트 단위(Vitest) + Playwright e2e
```

- 새 API e2e: `admin-only.e2e-spec.ts`(관리자 전용 API마다 로그인 없이 401, 일반 사용자 403, 데모 관리자 403), `rate-limit.e2e-spec.ts`(429와 `Retry-After`, 로그인 계열 한도, 헬스·웹훅 제외, WebSocket 제외). `demo-login.e2e-spec.ts`는 임시 사용자·견본 주문·만료 정리를 봄
- `test:web`은 3000번에 서버가 떠 있으면 그것을 쓰고, 없으면 `npm run build && npm run start`로 띄웁니다. 서비스 워커는 프로덕션 빌드에서만 등록되므로 `npm run dev:web`은 끄고, API(`npm run dev:api`)는 켜 둡니다.
- CI의 작업 구성은 `20`과 같습니다.

## 정리

```sh
docker compose down          # -v를 붙이면 DB·저장소 볼륨도 지움
```
