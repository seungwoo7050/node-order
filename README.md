# 03: 인증 심화

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL%20%7C%20JWT-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [02-transactions-and-concurrency](https://github.com/seungwoo7050/node-order/tree/02-transactions-and-concurrency) 브랜치

`kim`/`DEMO_PASSWORD` 고정 비교였던 로그인을 DB의 scrypt 비밀번호 해시 검증으로 바꾸고, 짧은 액세스 토큰과 httpOnly 쿠키의 refresh token(회전·재사용 감지)을 더했습니다.
로그인한 사용자 자신의 주문만 돌려주는 `/me/orders` 경로를 추가했습니다.

## 지원 범위

- 02의 API 전부(`/users`, `/orders`, `/orders/checkout`, `/products`, outbox 알림). 기존 `GET /orders`, `GET /orders/:id`는 인증 없이 그대로 열려 있습니다.
- 비밀번호
  - `POST /users`: 본문에 `password`(8자 이상) 필수, 사용자마다 솔트를 둔 scrypt 해시(`scrypt$<salt>$<hash>`)로 저장
  - 로그인 시 없는 id에도 더미 해시와 scrypt 비교를 한 번 수행
- 토큰
  - `POST /auth/login`: 본문으로 액세스 토큰(`ACCESS_TOKEN_TTL`, 기본 `15m`), `refresh_token` 쿠키(httpOnly, `SameSite=Strict`, `Path=/auth`, 7일, `NODE_ENV=production`일 때만 `Secure`)
  - `POST /auth/refresh`: 쿠키의 토큰을 회수하고 새 토큰을 발급. 이미 회수된 토큰이 오면 그 로그인 세션(family)의 남은 토큰을 모두 회수하고 401
  - 회수는 `revoked_at IS NULL` 조건부 `UPDATE`라서 같은 토큰으로 동시에 refresh해도 성공은 1번
  - DB에는 refresh token의 SHA-256 해시만 저장(`refresh_tokens` 테이블)
  - `POST /auth/logout`: 이 세션 회수, 204
  - `POST /auth/logout-all`(JWT 필요): 그 사용자의 모든 세션 회수, `{ revoked: <개수> }`
- `GET /me/orders`, `GET /me/orders/:id`(JWT 필요): 자기 주문만 조회. 남의 주문과 없는 주문 모두 404
- CORS에 `credentials: true`, `cookie-parser` 등록
- 마이그레이션 9개(02의 7개 + `password_hash` 컬럼, `refresh_tokens` 테이블)
- 시드 사용자 4명(`kim`, `lee`, `park`, `choi`)의 비밀번호는 모두 `.env`의 `DEMO_PASSWORD`

## 구성

`02`에서 바뀐 곳만 적습니다.

```text
order-api-nest/
├── .env                              # ACCESS_TOKEN_TTL 추가
├── package.json                      # cookie-parser 추가
├── prisma/
│   ├── schema.prisma                 # User.passwordHash, RefreshToken 추가
│   ├── migrations/
│   │   ├── 0008_add_password_hash/
│   │   └── 0009_add_refresh_tokens/
│   └── seed.ts                       # 사용자 비밀번호 해시 저장
├── scripts/
│   └── refresh-race.mjs              # 같은 쿠키로 refresh를 동시에 N번 보내고 결과를 출력
├── src/
│   ├── main.ts                       # cookie-parser, CORS credentials
│   ├── app.module.ts                 # MeModule 등록
│   ├── auth/
│   │   ├── password.ts               # scrypt 해시·검증
│   │   ├── auth.service.ts           # 로그인, refresh 회전·재사용 감지, 로그아웃
│   │   ├── auth.controller.ts        # login, refresh, logout, logout-all과 쿠키 설정
│   │   └── auth.module.ts            # ACCESS_TOKEN_TTL 적용
│   ├── me/                           # GET /me/orders, /me/orders/:id
│   └── users/                        # 가입 시 비밀번호 해시
└── test/
    └── auth.e2e-spec.ts              # refresh 회전·동시 refresh 회귀 테스트
```

## 실행

도구와 띄우는 순서는 02와 같습니다(PostgreSQL `localhost:5433`, API `localhost:4000`).
02에서 쓰던 DB라면 `npx prisma migrate deploy`로 새 마이그레이션 2개를 적용하고 `npx prisma db seed`로 비밀번호 해시가 있는 사용자를 다시 채웁니다.

```sh
cd order-api-nest
npm ci
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev
```

```sh
curl -i -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}'
# 응답 헤더에 Set-Cookie: refresh_token=...; HttpOnly
```

서버가 떠 있을 때 `node scripts/refresh-race.mjs <N>`(기본 10)은 `kim`으로 로그인한 뒤 같은 refresh 쿠키로 N번 동시에 refresh하고, 응답 코드별 개수와 `kim`의 발급된·아직 유효한 refresh token 수를 출력합니다.

## 테스트

테스트 DB(`order_api_test`) 준비는 02와 같고, 마이그레이션이 늘었으므로 다시 적용합니다.

```sh
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test            # 단위 테스트(vitest)
npm run test:e2e    # e2e 테스트
npm run lint        # oxlint
```

`test/auth.e2e-spec.ts`가 확인하는 것:

- refresh 한 번으로 받은 새 토큰 B가 있을 때, 처음 토큰 A를 다시 쓰면 401이고 그 뒤 B도 401
- 같은 토큰으로 동시에 refresh 10번 → 200은 1번, 유효한 refresh token 0개

02의 동시 결제·멱등 키 테스트(`test/checkout.e2e-spec.ts`)도 그대로 돕니다.

## 정리

```sh
docker compose down      # 컨테이너만 내림
docker compose down -v   # DB 볼륨까지 삭제
```
