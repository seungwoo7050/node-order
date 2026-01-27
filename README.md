# 21: 공개 데모

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Redis%20%7C%20PostgreSQL%20%7C%20S3-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [20-operations](https://github.com/seungwoo7050/node-order/tree/20-operations) 브랜치

공개 URL의 데모는 모든 방문자가 같은 데모 계정(`lee`, `kim`)을 써서 서로의 주문이 보였고, "관리자로" 들어가면 누구나 상품을 바꿀 수 있었습니다. 이 단계에서는 방문자마다 계정을 나누고, 데모 관리자를 읽기 전용으로 두고, 요청 수를 제한하고, 매일 초기화되는 카탈로그를 저장소의 파일로 고정합니다.

## 지원 범위

- 방문자별 데모 계정
  - `POST /auth/demo`가 누를 때마다 임시 사용자(`demo-<8자리>`)를 만들고, 품목이 든 견본 주문 1~2건을 넣음
  - 임시 사용자는 `users.expires_at`(24시간 뒤)으로 표시. 리더가 도는 `DemoUserCleanupJob`이 10분마다 만료된 사용자를 지우고, 결제 대기 주문의 재고는 돌려줌

- 읽기 전용 데모 관리자
  - 역할 `demo_admin`. 관리 화면은 보이지만 쓰기 버튼은 꺼져 있고 이유를 글자로 보여 줌
  - 쓰기 API와 주문·사용자 목록 API는 `AdminGuard`가 403으로 막음(`test/admin-only.e2e-spec.ts`)
  - 진짜 관리자는 서버에서 SQL로만 정함

- 요청 수 제한(IP마다 1분, Redis 고정 창)
  - 로그인 계열(`/auth/login`, `/auth/demo`, `/auth/exchange`, `/auth/refresh`) 20건, 나머지 300건. 넘으면 429와 `Retry-After`
  - `/health`, `/metrics`, `/payments/webhook`은 세지 않음
  - Caddy 뒤에서는 `TRUST_PROXY=uniquelocal`로 `X-Forwarded-For`의 방문자 주소로 셈. Next 서버가 대신 부르는 `/auth/github`도 그 헤더를 넘김
  - 환경 변수가 없으면 꺼짐(로컬·테스트). 운영 compose에서 켬

- 고정 카탈로그와 매일 초기화
  - 카테고리·상품은 `order-api-nest/prisma/seed/catalog.json`, 사진은 `prisma/seed/photos/`(출처는 `prisma/seed/README.md`)
  - 시드가 사진을 고정 키 `seed/<파일 이름>`으로 저장소에 올리고(이미 있으면 건너뜀), 상품을 `id`로 덮어씀
  - 초기화가 되돌리는 것: 카테고리·상품·재고, 시드 사용자의 주문, 임시 사용자. 남기는 것: GitHub 사용자와 그 주문·로그인, 역할
  - 만든 사람의 사진(`photos/maker-*`)은 커밋하지 않음. 운영 S3에는 `deploy/aws/62-seed-private-photos.sh`로 올림

## 구성

```text
.
├── order-api-nest/
│   ├── prisma/
│   │   ├── migrations/0018_demo_user_expiry/, 0019_demo_admin_role/
│   │   ├── seed.ts                 # catalog.json 기준으로 되돌림(TRUNCATE 없음)
│   │   └── seed/                   # catalog.json, README.md, photos/
│   ├── src/auth/demo-user.ts       # 임시 사용자·견본 주문 만들기, 사용자 지우기
│   ├── src/leader/demo-user-cleanup.job.ts
│   ├── src/rate-limit/             # 요청 수 제한 미들웨어
│   └── test/                       # admin-only, demo-login, rate-limit e2e
├── order-console-next/             # 관리 화면의 읽기 전용 표시, auth.ts의 X-Forwarded-For
├── deploy/
│   ├── compose.yml                 # 요청 수 제한·TRUST_PROXY, migrate의 S3 값
│   └── aws/62-seed-private-photos.sh
└── README.md
```

## 실행

```sh
npm ci
docker compose up -d                                   # db, redis, storage, jaeger
npm exec -w order-api-nest -- prisma generate
npm exec -w order-api-nest -- prisma migrate deploy
npm exec -w order-api-nest -- prisma db seed
npm run dev:api   # :4000
npm run dev:web   # :3000 (다른 터미널)
```

http://localhost:3000/login 에서 "일반 사용자로" / "관리자로"를 누르면 데모 계정이 새로 만들어집니다. 비밀번호 로그인은 `kim` / `1234`(관리자)입니다.

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
npm run test:web   # 프론트 단위 + Playwright e2e
```

`test:web`은 3000번에 떠 있는 서버를 그대로 씁니다. `npm run dev:web`은 끄고(서비스 워커가 프로덕션 빌드에서만 등록됨), API(`npm run dev:api`)는 켜 둡니다.
