# 13: Auth.js GitHub 로그인

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Auth.js%20%7C%20Redis%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [12-trpc](https://github.com/seungwoo7050/node-order/tree/12-trpc) 브랜치

아이디·비밀번호 로그인 옆에 "GitHub로 로그인"을 더합니다. GitHub와의 OAuth 절차는 Next 쪽 Auth.js가 맡고, 백엔드는 GitHub 토큰을 확인한 뒤 60초짜리 일회용 코드를 내주며, 프론트는 이 코드를 기존 액세스 토큰과 httpOnly refresh 쿠키로 바꿉니다. 백엔드의 `.env`는 저장소에서 빠지고 `.env.example`로 바뀌었습니다.

## 지원 범위

- `12-trpc`까지의 기능: JWT 로그인과 refresh 회전, 주문·결제, outbox와 BullMQ 메일, socket.io 알림, presigned 이미지 업로드, 카테고리 트리, PostgreSQL RLS, tRPC(`/trpc`), 서비스 워커 오프라인 화면
- `POST /auth/github`
  - 본문의 GitHub 액세스 토큰을 GitHub `POST /applications/{client_id}/token`으로 확인해, 우리 OAuth 앱에 발급된 토큰인지 본다
  - 다른 앱에 발급된 토큰이면 401을 돌려주고 사용자를 만들지 않는다
  - `githubId`로 사용자를 찾거나 만들고(id는 `github-<GitHub 숫자 id>`, 비밀번호 없음), 일회용 코드를 돌려준다
- `POST /auth/exchange`
  - 일회용 코드는 Redis에 SHA-256 해시를 키로 60초 저장하고 `GETDEL`로 꺼내므로 한 번만 쓸 수 있다
  - 성공하면 액세스 토큰은 본문으로, refresh token은 httpOnly 쿠키로 돌려준다
- 회원가입에서 `github-`로 시작하는 id를 거절한다
- Auth.js(`next-auth` 5 베타)
  - `/login`의 "GitHub로 로그인" 버튼이 PKCE(S256)를 붙여 GitHub 인가 화면으로 보낸다. 콜백 주소는 `/api/auth/callback/github`
  - `jwt` 콜백이 GitHub 토큰을 백엔드 `/auth/github`에 넘기고, 받은 코드를 Auth.js 세션(5분)에 담는다
  - `/auth/github/complete`가 코드를 우리 토큰으로 바꾸고 Auth.js 세션을 끝낸 뒤 `/shop`으로 보낸다. 세션이 없으면 `/login`으로 돌려보낸다
- `users`에 `github_id` 칸 추가(마이그레이션 `0015_github_id`, 유일 인덱스)
- 백엔드는 부팅할 때 `.env.local`이 있으면 읽는다
- 요청 로그 메시지를 `METHOD URL STATUS 응답시간ms` 한 줄로 바꿨다(pino 설정을 `logger/logger.options.ts`로 분리)

## 구성

`12`에서 바뀐 곳만 적습니다.

```text
.
├── order-api-nest/
│   ├── .env.example                  # .env에서 이름을 바꿈, GITHUB_CLIENT_ID·SECRET 추가
│   ├── docker-compose.yml            # api 서비스에 GITHUB_CLIENT_ID·SECRET 전달
│   ├── prisma/
│   │   ├── schema.prisma             # User.githubId
│   │   └── migrations/0015_github_id/
│   ├── src/
│   │   ├── main.ts                   # .env.local이 있으면 먼저 읽음
│   │   ├── app.module.ts             # LoggerModule.forRoot(loggerOptions)
│   │   ├── logger/logger.options.ts  # pino 설정(새 파일)
│   │   ├── users/dto/create-user.dto.ts # github- 접두사 거절
│   │   └── auth/
│   │       ├── github.ts             # GitHub 토큰이 우리 앱에 발급된 것인지 확인
│   │       ├── auth-code.store.ts    # 일회용 코드(Redis, 60초, GETDEL)
│   │       ├── github-login.dto.ts   # GithubLoginDto, ExchangeCodeDto
│   │       ├── auth.service.ts       # loginWithGithub, exchangeCode
│   │       ├── auth.controller.ts    # POST /auth/github, POST /auth/exchange
│   │       └── auth.module.ts        # AuthCodeStore 등록
│   └── test/github-login.e2e-spec.ts # 가짜 GitHub 서버를 쓰는 e2e
├── order-console-next/
│   ├── .env.example                  # AUTH_GITHUB_ID, AUTH_GITHUB_SECRET, AUTH_URL, AUTH_SECRET
│   ├── package.json                  # next-auth
│   ├── auth.ts                       # Auth.js 설정(GitHub provider, jwt·session 콜백)
│   ├── types/next-auth.d.ts          # 세션·JWT에 exchangeCode 선언
│   ├── lib/api-client.ts             # exchangeCode()
│   ├── app/
│   │   ├── api/auth/[...nextauth]/route.ts # Auth.js 라우트 핸들러
│   │   ├── login/                    # "GitHub로 로그인" 버튼과 signIn 서버 액션
│   │   └── auth/github/complete/     # 코드를 우리 토큰으로 바꾸는 완료 화면
│   └── e2e/
│       ├── github-login.spec.ts      # PKCE 인가 주소, 세션 없는 완료 화면
│       └── *.spec.ts                 # 로그인 버튼 이름을 exact로 찾도록 수정
└── package-lock.json
```

## 실행

필요한 도구와 포트는 `12`와 같습니다(Node.js, Docker, PostgreSQL `5433`, Redis `6380`, 저장소 `9000`/`9001`, 백엔드 `4000`, 프론트 `3000`). 달라진 점은 백엔드 `.env`를 견본에서 만들어야 한다는 것과 GitHub OAuth 앱 값입니다.

```sh
npm ci

cd order-api-nest
cp .env.example .env
docker compose up -d db redis storage
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev # :4000
```

GitHub 로그인에는 GitHub OAuth 앱의 Client ID와 secret이 필요하고, OAuth 앱의 콜백 주소는 `http://localhost:3000/api/auth/callback/github`입니다. 값은 커밋하지 않는 `.env.local`에 둡니다.

- `order-api-nest/.env.local`: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `order-console-next/.env.local`: `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (`AUTH_URL`은 견본 값 그대로)

백엔드는 `--env-file .env`로 먼저 읽은 값을 `.env.local`이 덮어쓰지 않으므로, `.env`에 복사된 `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` 줄은 지웁니다.

다른 터미널에서 프론트를 운영 빌드로 띄웁니다.

```sh
cd order-console-next
cp .env.example .env.local # 위 값을 채운다
npm run build
npm run start # :3000
```

http://localhost:3000/login 에서 확인합니다. 시드 계정은 `kim`, `lee`, `park`, `choi`이고 비밀번호는 `.env`의 `DEMO_PASSWORD`(`1234`)입니다. GitHub 값이 없으면 GitHub 로그인만 실패하고 나머지는 그대로 동작합니다.

## 테스트

백엔드 e2e용 테스트 DB는 처음 한 번 만듭니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
cd order-api-nest
npm test
npm run test:e2e
npm run lint
```

`test/github-login.e2e-spec.ts`는 가짜 GitHub 서버를 띄우므로 GitHub 값 없이 돕니다. 다른 앱이 받은 토큰 거절, 같은 GitHub 계정의 재로그인이 같은 사용자로 이어지는지, 코드 재사용 거절, 같은 코드로 동시에 10번 보내면 하나만 성공하는지를 확인합니다.

프론트 e2e는 백엔드가 `4000`에 떠 있어야 합니다. Playwright가 `npm run build && npm run start`로 운영 빌드를 띄우고, `3000`에 이미 떠 있는 서버가 있으면 그것을 씁니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e
npm run lint
```

`e2e/github-login.spec.ts`는 GitHub로 나가는 요청을 가로채므로 실제 GitHub에 가지 않습니다. "GitHub로 로그인"이 PKCE(S256)를 붙인 인가 주소로 보내는지, 세션 없이 완료 화면을 열면 `/login`으로 돌려보내는지 검사합니다. 프론트 `.env.local`에 Auth.js 값이 있어야 합니다. 실제 GitHub 승인까지 가는 흐름은 브라우저에서 확인합니다.

## 정리

```sh
cd order-api-nest
docker compose --profile app down    # 컨테이너만 내림
docker compose --profile app down -v # DB·저장소 볼륨까지 삭제
```
