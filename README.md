# 13: Auth.js GitHub 로그인

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Auth.js%20%7C%20Redis%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [12-trpc](https://github.com/seungwoo7050/node-order/tree/12-trpc) 브랜치의 `order-api-nest`, `order-console-next`

아이디·비밀번호 로그인에 "GitHub로 로그인"을 더합니다. GitHub와 주고받는 OAuth 절차는 Auth.js(Next)가 맡고, 로그인이 끝나면 지금까지 쓰던 우리 토큰(액세스 토큰 + httpOnly refresh 쿠키)으로 갈아타므로 refresh 회전, RLS, tRPC가 그대로 동작합니다.

## 지원 범위

- `12-trpc`까지의 기능 전부

  - JWT 로그인과 refresh 회전, 주문·결제(`Idempotency-Key`), outbox와 BullMQ 메일, socket.io 알림

  - presigned 이미지 업로드, 카테고리 트리, PostgreSQL RLS, tRPC(`/trpc`), 서비스 워커 오프라인 화면

- GitHub 토큰 확인 `POST /auth/github`

  - Next 서버가 넘긴 GitHub 액세스 토큰이 우리 OAuth 앱에 발급된 것인지 GitHub의 `POST /applications/{client_id}/token`으로 확인

  - 같은 사람의 토큰이라도 다른 앱이 받은 것이면 401

  - `githubId`로 사용자를 찾거나 만들고(`github-<숫자 id>`, 비밀번호 없음), 60초짜리 일회용 코드를 발급

  - 일반 회원가입에서는 `github-`로 시작하는 id를 쓸 수 없음

- 코드 교환 `POST /auth/exchange`

  - 일회용 코드는 Redis에 SHA-256 해시를 키로 저장하고 `GETDEL`로 꺼내므로, 동시에 여러 번 내도 한 번만 성공

  - 성공하면 액세스 토큰은 본문으로, refresh token은 httpOnly 쿠키로 돌려줌

- Auth.js(`next-auth` 5 베타)

  - `/login`의 "GitHub로 로그인" 버튼은 PKCE(S256)를 붙여 GitHub 인가 화면으로 보냄. 콜백 주소는 `/api/auth/callback/github`

  - `jwt` 콜백에서 GitHub 토큰을 백엔드에 넘기고, 받은 일회용 코드를 세션(5분)에 담음

  - 완료 화면 `/auth/github/complete`가 코드를 우리 토큰으로 바꾼 뒤 Auth.js 세션을 끝내고 `/shop`으로 이동

- 그 밖의 변경

  - `users`에 `github_id` 칸 추가(마이그레이션 `0015_github_id`)

  - 백엔드는 `.env.local`이 있으면 부팅할 때 먼저 읽음. 비밀 값은 커밋하지 않는 이 파일에 둠

  - 요청 로그를 `METHOD URL STATUS 응답시간ms` 한 줄로 줄임

## 구성

```text
.
├── package.json                      # npm 워크스페이스 루트
├── order-api-nest/                   # NestJS API
│   ├── src/
│   │   ├── auth/
│   │   │   ├── github.ts             # GitHub 토큰이 우리 앱에 발급된 것인지 확인
│   │   │   ├── auth-code.store.ts    # 일회용 코드(Redis, 60초, GETDEL)
│   │   │   ├── auth.service.ts       # loginWithGithub, exchangeCode
│   │   │   └── auth.controller.ts    # POST /auth/github, POST /auth/exchange
│   │   ├── logger/logger.options.ts  # pino 설정
│   │   └── main.ts                   # .env.local이 있으면 먼저 읽음
│   ├── prisma/                       # schema.prisma, migrations/0015_github_id
│   ├── test/github-login.e2e-spec.ts # 가짜 GitHub 서버를 쓰는 e2e
│   └── .env.example
├── order-console-next/               # Next.js(App Router) 주문 콘솔
│   ├── auth.ts                       # Auth.js 설정(GitHub provider, jwt/session 콜백)
│   ├── app/
│   │   ├── api/auth/[...nextauth]/   # Auth.js 라우트 핸들러
│   │   ├── auth/github/complete/     # 일회용 코드를 우리 토큰으로 바꾸는 완료 화면
│   │   └── login/                    # 로그인 폼과 "GitHub로 로그인" 버튼
│   ├── lib/api-client.ts             # exchangeCode 추가
│   ├── types/next-auth.d.ts          # 세션·JWT에 exchangeCode 선언
│   ├── e2e/github-login.spec.ts      # PKCE 인가 주소와 완료 화면 접근 확인
│   └── .env.example
└── README.md
```

## 실행

의존성은 루트에서 한 번 설치합니다.

```sh
npm ci
```

백엔드를 `4000`에 띄웁니다. 처음이면 마이그레이션과 시드까지 합니다. PostgreSQL은 `5433`, Redis는 `6380`, 저장소는 `9000`/`9001`을 씁니다.

```sh
cd order-api-nest
cp .env.example .env
docker compose up -d db redis storage
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev # :4000
```

GitHub 로그인에는 GitHub OAuth 앱의 Client ID와 secret이 필요합니다. OAuth 앱의 콜백 주소는 `http://localhost:3000/api/auth/callback/github`이고, 값을 만드는 방법은 [guide](guide/README.md)의 "1. 준비"를 따릅니다.

비밀 값은 커밋되지 않는 `.env.local`에 둡니다. 이미 있는 환경 변수는 `.env.local`이 덮어쓰지 않으므로, 백엔드 `.env`에 복사된 `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` 줄은 지웁니다.

- 백엔드 `order-api-nest/.env.local`: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

- 프론트 `order-console-next/.env.local`: `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (`AUTH_URL`은 견본 값 그대로)

다른 터미널에서 프론트를 운영 빌드로 띄웁니다(`3000`).

```sh
cd order-console-next
cp .env.example .env.local # 위 값을 채운다
npm run build
npm run start
```

http://localhost:3000/login 에서 확인합니다. 데모 계정은 `kim`, `lee`, `park`, `choi` / `1234`입니다.

비밀 값이 없어도 아이디·비밀번호 로그인과 나머지 기능은 그대로 동작하고, GitHub 로그인만 실패합니다.

## 테스트

백엔드 e2e용 테스트 DB는 처음 한 번 만듭니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

백엔드 테스트는 가짜 GitHub 서버를 쓰므로 비밀 값 없이 돕니다.

```sh
cd order-api-nest
npm test
npm run test:e2e
npm run lint
```

백엔드 e2e는 다른 앱이 받은 GitHub 토큰을 거절하는지, 같은 GitHub 계정이 같은 사용자로 이어지는지, 일회용 코드가 한 번만(동시에 10번 내도 하나만) 쓰이는지 확인합니다.

프론트 e2e는 백엔드가 `4000`에 떠 있어야 합니다. Playwright가 운영 빌드를 직접 띄우므로 개발 서버는 꺼 둡니다(이미 `3000`에 떠 있으면 그것을 씁니다).

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e
npm run lint
```

프론트 e2e는 GitHub에 실제로 가지 않고, "GitHub로 로그인"이 PKCE를 붙인 인가 주소로 보내는지, 세션 없이 완료 화면을 열면 로그인 화면으로 돌려보내는지 검사합니다. 이때 프론트 `.env.local`에 Auth.js 값이 채워져 있어야 합니다.

실제 GitHub 승인까지 가는 흐름은 브라우저에서 직접 확인합니다.

## 정리

```sh
cd order-api-nest
docker compose --profile app down    # 컨테이너만 내림
docker compose --profile app down -v # DB·저장소 볼륨까지 삭제
```
