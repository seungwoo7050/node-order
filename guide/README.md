# Auth.js: GitHub 계정으로 로그인

## 목표

이 프로젝트는 [`12-trpc`](https://github.com/seungwoo7050/node-order/tree/12-trpc)로부터 시작한다.

지금까지 로그인은 임의로 만든 아이디와 비밀번호 하나였지만 여기에 "GitHub로 로그인"을 더한다.

GitHub와 주고받는 OAuth 절차는 Auth.js(Next)에 맡기고, 로그인이 끝나면 지금까지 쓰던 **우리 토큰**(액세스 토큰 + httpOnly refresh 쿠키)으로 갈아탄다.

그래서 refresh 회전, RLS, tRPC가 그대로 동작한다.

1. Nest가 GitHub 토큰을 받아 "우리 앱에 발급된 토큰인지" GitHub에 확인한다

2. 확인되면 사용자를 찾거나 만들고 일회용 코드를 준다. 브라우저가 그 코드를 내면 우리 토큰을 받는다

3. Auth.js로 GitHub 로그인 버튼과 콜백을 붙이고, 운영 빌드에서만 드러나는 설정 문제를 겪는다

4. 같은 사람의 토큰이라도 다른 앱이 받은 토큰이면 막는 것, 일회용 코드가 두 번 쓰이지 않는 것을 테스트로 확인한다

```text
"GitHub로 로그인" → GitHub 승인 → 돌아와서 "로그인을 마무리하는 중..." → /shop (로그아웃 버튼)

Nest 로그
POST /auth/github   200   # Next 서버가 GitHub 토큰을 넘기고 일회용 코드를 받았다
POST /auth/exchange 200   # 0.17초 뒤, 브라우저가 코드를 내고 우리 토큰을 받았다

users
        id         |      name       | has_github | no_password
 github-<숫자 id>  | <GitHub 로그인> | t          | t
```

> 시작 기준점:  
> `12-trpc`까지 마친 워크스페이스(`order-api-nest` + `order-console-next`)에서 시작한다.  
> 토큰·refresh 쿠키, Redis, `authFetch`, 컨테이너 구성, CSP를 다시 쓴다.  
> GitHub OAuth 앱 하나가 필요하다. 만드는 과정은 1장 작업 3에서 버튼 순서대로 짧게 다룬다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 9장에서 "어느 층에서 틀어졌나"를 가르는 절차 | 필요할 때 친다 |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 9장만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 뒤의 태그는 그 작업이 무엇을 남기는지다. 커밋할 변경이 있는지 제목만 보고 가를 수 있다. 섞이면 센 쪽 하나만 붙였다(`[커밋]` > `[원복]` > `[실행]` > `[확인]`).

  | 태그 | 무엇이 남는가 | 커밋 |
  |---|---|---|
  | `[커밋]` | 저장소의 파일: 코드 작성·수정, 설정 파일, 견본 환경 파일, 테스트, 마이그레이션, 패키지 설치(`package.json`·lock) | 한다 |
  | `[실행]` | 저장소 밖의 상태: GitHub OAuth 앱 설정, 로그인으로 생긴 DB 행. 다음 작업이 이 상태에 기댄다 | 안 한다 |
  | `[확인]` | 남는 것이 없다: `curl`, 조회, 결과 읽기 | 안 한다 |
  | `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 이 문서는 각 `실험 \|`의 끝에서 되돌리므로 `[원복]` 작업은 따로 없다 | 안 한다 |

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 9장 "진단 2"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 9장(디버깅)과 10·11장(체크리스트, 자가 점검)에는 `남길 것`을 두지 않았다.

- 명령 블록의 첫 줄 주석 `# ./...`는 그 명령을 치는 폴더다. `./`는 워크스페이스 루트(`order-api-nest`와 `order-console-next`가 함께 있는 폴더)이고, `# ./order-api-nest`는 백엔드 폴더다. 블록 안에서 주석이 바뀌면 거기서부터 그 폴더로 옮겨서 친다. 주석이 없는 블록(`curl` 등)은 어느 폴더에서 쳐도 결과가 같다.

  `# order-api-nest/.gitignore`처럼 `./`로 시작하지 않는 주석은 실행 위치가 아니라 고칠 파일의 경로다.

- 1·2단계의 실험 ①·②는 7단계(8장)의 테스트로 결과를 확인한다. 처음 읽을 때는 결과만 보고, 테스트를 만든 뒤 돌아와 직접 해 봐도 된다.

| 단계 | 하는 일 |
|---|---|
| [0. OAuth에 대한 사전지식](#0-oauth에-대한-사전지식) | 인가 코드 흐름, 누가 무엇을 맡는지, 왜 Nest가 토큰을 다시 확인하는지(작업 없음) |
| [1. 준비](#1-준비) | `next-auth`를 설치하고, DB를 띄워 채우고, 비밀 값을 커밋하지 않는 `.env.local`에 둔다 |
| [2. 1단계(Nest): GitHub 토큰이 우리 앱의 것인지 확인](#2-1단계nest-github-토큰이-우리-앱의-것인지-확인) | `github_id` 칸을 만들고, 앱 토큰 확인 API로 다른 앱의 토큰을 막는다 |
| [3. 2단계(Nest): 일회용 코드](#3-2단계nest-일회용-코드) | Redis 일회용 코드와 `/auth/github`·`/auth/exchange`를 만들고, `GETDEL`이 왜 필요한지 깨뜨려 본다 |
| [4. 3단계(Next): Auth.js 붙이기](#4-3단계next-authjs-붙이기) | `auth.ts`·경로·타입 보강·로그인 버튼을 붙이고 운영 빌드의 `UntrustedHost`를 겪는다 |
| [5. 4단계: 코드를 우리 토큰으로 바꾸는 화면](#5-4단계-코드를-우리-토큰으로-바꾸는-화면) | 돌아온 화면에서 브라우저가 코드를 내고 Auth.js 세션을 지운다 |
| [6. 5단계: 실제로 로그인하기](#6-5단계-실제로-로그인하기) | 진짜 GitHub로 로그인하고 DB·Redis로 결과를 확인한다. 요청 로그를 읽기 좋게 줄인다 |
| [7. 6단계: 컨테이너에서](#7-6단계-컨테이너에서) | compose에 GitHub 값을 파일에 적지 않고 넘긴다 |
| [8. 7단계: 테스트](#8-7단계-테스트) | 가짜 GitHub 서버로 백엔드 규칙을, Playwright로 GitHub로 보내는 주소를 검사한다 |
| [9. 디버깅](#9-디버깅) | 흐름을 따라가며 막힌 곳을 찾고, 증상으로 원인을 가른다 |
| [10. 완성 확인](#10-완성-확인) | 체크리스트 |
| [11. 다음 단계](#11-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. OAuth에 대한 사전지식

### 개념 1 | OAuth 인가 코드 흐름: 교환권을 두 번 바꾸는 일

"GitHub로 로그인"은 다음 순서로 진행된다.

```text
브라우저  ── ① GitHub 로그인 화면으로 이동(client_id, redirect_uri, code_challenge)───▶ GitHub
브라우저  ◀─ ② 승인하면 redirect_uri로 돌려보냄(?code=인가 코드)──────────────────────  GitHub
Next 서버 ── ③ 인가 코드 + client secret + code_verifier ─────────────────────────────▶ GitHub
Next 서버 ◀─ ④ GitHub 액세스 토큰 ────────────────────────────────────────────────────  GitHub
```

②에서 브라우저 주소창으로 지나가는 것은 인가 코드(짧게 살고 한 번만 쓰는 교환권)다.

**진짜 열쇠인 액세스 토큰은 ③④에서 서버끼리만 주고받는다.** ③에는 Client secret이 필요하므로 브라우저는 할 수 없다.

PKCE는 ①에서 `code_challenge`(무작위 값의 해시)를 먼저 보내고, ③에서 원래 값(`code_verifier`)을 보여 주는 방식이다.

C로 치면 "답의 해시를 먼저 공개하고 나중에 답을 내는" 약속이다. 중간에서 인가 코드를 가로챈 사람은 원래 값을 모르므로 ③을 할 수 없다.

이 문서의 설계는 ④ 뒤에 같은 모양을 한 번 더 반복한다.

```text
Next 서버 ── ⑤ GitHub 액세스 토큰 ─────────────────────▶ Nest (GitHub에 "우리 앱의 토큰인가" 확인)
Next 서버 ◀─ ⑥ 일회용 코드(60초, 한 번만) ────────────── Nest
브라우저  ── ⑦ 일회용 코드 ────────────────────────────▶ Nest
브라우저  ◀─ ⑧ 우리 액세스 토큰 + refresh 쿠키 ───────── Nest (03의 로그인 응답과 같다)
```

⑦⑧을 브라우저가 직접 하는 이유는 refresh 쿠키 때문이다.

refresh 쿠키는 Nest가 브라우저에게 직접 `Set-Cookie`로 줘야 브라우저에 붙는다.

> Next 서버가 대신 받으면 쿠키는 Next 서버에 떨어진다.

### 개념 2 | 누가 무엇을 맡나

| 맡는 일 | 누가 |
|---|---|
| GitHub로 보내고 돌아오는 절차(①~④), PKCE, 콜백 처리 | Auth.js(Next) |
| GitHub 토큰이 진짜 우리 앱의 것인지 확인, 사용자 만들기 | Nest |
| 로그인 상태(액세스 토큰, refresh 회전, 로그아웃) | Nest |

Auth.js에도 자기 세션(암호화된 쿠키)이 있다.

이걸 그대로 로그인 상태로 쓰면 로그인 상태가 두 곳(Auth.js 세션, Nest 토큰)이 되고, 로그아웃·만료·회수를 두 번 맞춰야 한다.

그래서 Auth.js 세션은 ⑥의 일회용 코드를 브라우저에 건네는 데만 잠깐(5분 이하) 쓰고, 코드를 바꾸자마자 지운다.

### 개념 3 | 왜 Nest가 GitHub 토큰을 다시 확인하나

`/auth/github`는 HTTP 엔드포인트다. Next 서버만 부른다는 보장이 없고, 누구든 GitHub 토큰을 들고 와서 부를 수 있다.

그래서 Nest는 받은 토큰을 믿지 않고 GitHub에 직접 묻는다.

이때 무엇을 묻느냐가 중요하다. **"이 토큰으로 `GET /user`가 되는가"만 보면 다른 앱이 받은 토큰도 통과한다.**

사용자가 어떤 앱(게임, 확장 프로그램...)에 GitHub 로그인을 승인해 줬다면, 그 앱 운영자는 그 사람의 토큰을 갖고 있다.

그 토큰을 우리 `/auth/github`에 내면 우리 서비스에 그 사람으로 로그인된다. 1단계에서 재현한다.

## 1. 준비

### 작업 1. [커밋] `next-auth` 설치

```sh
# ./
npm install
npm install next-auth@beta -w order-console-next
```

`-w order-console-next`는 워크스페이스 중 프론트에만 설치한다는 뜻이다. `order-console-next/package.json`의 `dependencies`에 `"next-auth": "^5.0.0-beta.32"`가 생긴다.

### 작업 2. [실행] DB·Redis·스토리지 띄우고 DB 채우기

백엔드가 붙을 컨테이너를 띄우고, 개발 DB와 테스트 DB에 지금까지의 마이그레이션을 적용한다. 명령은 `12`에서 친 것과 같다.

```sh
# ./order-api-nest
docker compose up -d db redis storage
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
docker compose exec db createdb -U order order_api_test
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

| 명령 | 하는 일 |
|---|---|
| `docker compose up -d db redis storage` | PostgreSQL(`5433`), Redis(`6380`), 오브젝트 스토리지(`9000`)만 띄운다. `api`·`migrate`는 `app` 프로필이라 여기서는 안 뜬다(6단계에서 쓴다) |
| `npx prisma generate` | `schema.prisma`로 `src/generated/prisma`의 클라이언트 코드를 만든다. 생성물은 커밋하지 않으므로 새로 받은 폴더에는 없다 |
| `npx prisma migrate deploy` | `prisma/migrations`에서 아직 적용하지 않은 것만 적용한다. 스키마를 비교하거나 새 마이그레이션을 만들지는 않는다 |
| `npx prisma db seed` | `prisma/seed.ts`를 돌려 데모 사용자(`kim`, `lee`, `park`, `choi`, 비밀번호 `1234`)와 상품·주문을 넣는다. 맨 앞에서 테이블을 비우므로 다시 돌리면 처음 상태로 돌아간다 |
| `createdb ... order_api_test` | e2e 테스트가 쓰는 DB(`.env`의 `TEST_DATABASE_URL`)를 만든다. 이미 있으면 `already exists` 에러로 끝나는데, 정상이다(아래) |
| `ADMIN_DATABASE_URL=... migrate deploy` | 같은 마이그레이션을 테스트 DB에 적용한다. Prisma CLI는 `prisma7.config.ts`에서 `ADMIN_DATABASE_URL`을 먼저 읽으므로 그 값만 바꿔 주면 된다 |

`migrate`·`seed`가 `order_app`이 아니라 `order`(소유자) 계정으로 붙는 이유는 `10`과 같다. 테이블을 만들고 RLS를 무시해야 하는 일이라서다.

compose 프로젝트 이름은 `order-api-nest/docker-compose.yml`이 있는 폴더 이름(`order-api-nest`)으로 정해진다. `12`의 워크스페이스도 폴더 이름이 같으므로 볼륨(`order-api-nest_pgdata`)을 같이 쓴다. `12`의 컨테이너가 떠 있는 채로 여기서 `up`을 해도 같은 컨테이너로 잡히므로 포트가 부딪히지 않는다.

그래서 `12`를 마친 컴퓨터라면 위 명령의 상당수는 할 일이 없다. DB가 이미 있고 마이그레이션도 끝나 있다. 이때 출력은 다음과 같고, 이 상태가 정상이다.

```sh
$ docker compose exec db createdb -U order order_api_test
createdb: error: database creation failed: ERROR:  database "order_api_test" already exists

$ ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
Datasource "db": PostgreSQL database "order_api_test", schema "public" at "localhost:5433"
14 migrations found in prisma/migrations
No pending migrations to apply.
```

- `createdb`의 `error`는 "이미 있어서 새로 만들지 않았다"는 뜻이다. 어느 설정이 틀린 게 아니다. `createdb`에는 "없을 때만 만들기" 옵션이 없어서, 이미 있으면 에러로 끝난다.

- `14 migrations found`와 `No pending migrations`는 `12`까지의 마이그레이션(`0001`~`0014`)이 이 DB에 모두 들어가 있다는 뜻이다. 2장에서 `github_id` 마이그레이션을 더하면 이 수가 15가 된다.

- 데이터는 `12`에서 쓰던 그대로다. `db seed`를 다시 치면 데모 데이터로 돌아간다.

- 처음부터 다시 하고 싶으면 `docker compose down -v`로 볼륨까지 지운 뒤 위 명령을 처음부터 친다. 그러면 `createdb`가 에러 없이 끝나고 `migrate deploy`는 마이그레이션 14개를 적용한다. `12`의 DB도 같은 볼륨이라 함께 지워진다.

```sh
# ./order-api-nest
docker compose ps # db(healthy), redis, storage가 Up이면 된다
```

### 작업 3. [실행] GitHub OAuth 앱 만들고 값 받기

GitHub에 "이런 앱이 GitHub 로그인을 쓴다"고 등록하는 일이다. 0장 그림의 `client_id`, `redirect_uri`, `client secret`이 여기서 정해진다.

1. GitHub 오른쪽 위 프로필 사진 → **Settings**

2. 왼쪽 메뉴 맨 아래 **Developer settings**

3. 왼쪽 **OAuth Apps** → **New OAuth App**(앱이 하나도 없으면 **Register a new application**)

   > 바로 가는 주소는 `https://github.com/settings/developers`다. 같은 메뉴의 **GitHub Apps**는 저장소 권한을 세밀하게 받는 다른 종류의 앱이다. Auth.js의 GitHub 공급자는 OAuth App을 기준으로 하므로 이쪽을 만든다.

4. 양식을 채우고 **Register application**

   | 칸 | 넣을 값 | 뜻 |
   |---|---|---|
   | Application name | 아무 이름(예: `order-console-local`) | GitHub 승인 화면에 "○○이(가) 접근을 요청한다"로 보이는 이름 |
   | Homepage URL | `http://localhost:3000` | 승인 화면에 걸리는 앱 소개 주소. 로그인 동작에는 쓰이지 않는다 |
   | Application description | 비워 둔다 | 승인 화면에 보이는 설명(선택) |
   | Authorization callback URL | `http://localhost:3000/api/auth/callback/github` | 승인 뒤 GitHub가 인가 코드를 붙여 돌려보낼 주소(0장 ②의 `redirect_uri`). 요청의 `redirect_uri`가 이 주소와 맞지 않으면 GitHub가 거부한다 |
   | Enable Device Flow | 끈 채로 둔다 | 브라우저 없는 기기(CLI 등)가 코드를 입력해 로그인하는 방식. 이 문서는 쓰지 않는다 |

5. 만들어진 앱 화면에서 **Client ID**를 복사한다. 앱을 가리키는 공개 값이다. 브라우저 주소창(0장 ①)에도 그대로 실린다.

6. **Generate a new client secret** → 나온 값을 바로 복사한다. 앱임을 증명하는 비밀 값으로, 서버끼리의 요청(0장 ③, 1단계의 앱 토큰 확인)에만 쓴다.

   > 이 값은 만든 직후 한 번만 보인다. 놓쳤으면 새로 만들고 예전 것은 **Delete**한다. secret은 여러 개를 동시에 둘 수 있어서, 바꾸는 동안에도 기존 값이 끊기지 않는다.

OAuth 앱 하나에 콜백 주소는 하나뿐이다. 운영 주소(`https://...`)용 앱은 따로 만드는 것이 보통이다.

받은 값은 Client ID와 Client secret 두 개다. 이 두 값을 백엔드와 프론트가 각자 다른 이름으로 읽는다(작업 4, 5).

### 용어 | 콜백 URL과 `redirect_uri`, URL과 URI

같은 주소 하나를 부르는 이름이 곳마다 다르다.

| 어디서 | 부르는 이름 |
|---|---|
| OAuth 표준(RFC 6749) | redirection endpoint. 요청 파라미터 이름은 `redirect_uri` |
| GitHub 앱 설정 화면 | Authorization callback URL |
| Auth.js | `callbackUrl`, 경로 `/api/auth/callback/github` |
| 이 문서 | 콜백 주소 |

이름이 갈린 것은 같은 일을 다른 쪽에서 보기 때문이다.

- **redirect**는 GitHub 쪽에서 본 이름이다. GitHub는 이 주소로 직접 요청을 보내지 않는다. 브라우저에 "이 주소로 가라"는 리다이렉트(`302` + `Location`)를 돌려줄 뿐이고, 실제 요청은 브라우저가 보낸다(0장 ②).

- **callback**은 우리 앱 쪽에서 본 이름이다. 로그인하러 내보낸 사용자가 끝나고 "다시 불러 들어오는" 곳이다.

URL과 URI도 같은 식으로 섞여 쓰인다.

- **URI**(Uniform Resource Identifier)는 무언가를 가리키는 식별자 전체를 말한다. `urn:isbn:9788966262281`처럼 위치 없이 이름만 있는 것도 URI다.

- **URL**(Uniform Resource Locator)은 URI 중에서 어디로 가서 어떻게 가져오는지(스킴, 호스트, 경로)까지 담은 것이다. `http://localhost:3000/api/auth/callback/github`는 URI이면서 URL이다.

웹에서 쓰는 `http(s)://` 주소는 모두 URL이다. 그래서 표준 문서는 넓은 쪽인 URI를 쓰고, GitHub 화면은 익숙한 쪽인 URL을 쓴 정도의 차이다. 이 문서의 맥락에서는 같은 말로 읽어도 된다.

GitHub는 요청의 `redirect_uri`가 등록한 콜백 주소와 호스트·포트까지 같아야 받아 준다. 경로는 등록한 경로이거나 그 아래 경로여야 한다. Auth.js는 `AUTH_URL`(또는 요청의 호스트)로 `redirect_uri`를 만들어 보내므로, 등록 값과 `AUTH_URL`이 어긋나면 GitHub 화면에 `The redirect_uri is not associated with this application.`이 뜬다(9장 진단 2).

### 작업 4. [커밋] 백엔드 비밀 값은 커밋하지 않는 파일에 둔다

지금까지 백엔드 `.env`는 학습용 데모 값이라 커밋해 왔다.

하지만 GitHub의 Client secret은 진짜 비밀이다. 백엔드에 `.env.local`을 따로 두고 `.gitignore`에 넣는다.

```sh
# order-api-nest/.gitignore
# 맨 아래에 .env.local 한 줄을 설명 주석과 함께 추가한다
# 비밀 값(GitHub OAuth 앱의 client secret 등). 커밋하지 않는다
.env.local
```

견본 파일은 커밋한다. 값 자리는 비워 둔다.

```text
# order-api-nest/.env.local.example
# GitHub OAuth 앱. cp .env.local.example .env.local 로 만들어 값을 채운다. .env.local은 커밋하지 않는다
# 프론트의 AUTH_GITHUB_ID, AUTH_GITHUB_SECRET과 같은 값이다
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

```sh
# ./order-api-nest
cp .env.local.example .env.local # 작업 3의 Client ID와 Client secret을 채운다
```

작업이 끝나면 백엔드 폴더의 두 파일은 다음과 같다. `.env`는 `12`에서 쓰던 파일을 한 글자도 바꾸지 않는다. `.env.local`은 `.env`에서 무엇을 뺀 파일이 아니라, `.env`에 없는 값 두 개만 더하는 파일이다.

```text
# order-api-nest/.env (12 그대로. 커밋한다)
JWT_SECRET=...
DEMO_PASSWORD=1234
FRONTEND_URL=http://localhost:3000
PORT=4000
DATABASE_URL=postgresql://order_app:order_app@localhost:5433/order_api
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api
TEST_DATABASE_URL=postgresql://order_app:order_app@localhost:5433/order_api_test
TEST_ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test
ACCESS_TOKEN_TTL=15m
REDIS_URL=redis://localhost:6380
# ... MAIL_*, CLEANUP_*, S3_*, MAX_IMAGE_BYTES, UPLOAD_*, ORPHAN_* 그대로 ...

# order-api-nest/.env.local (GitHub 두 줄뿐. 커밋하지 않는다)
GITHUB_CLIENT_ID=<Client ID>
GITHUB_CLIENT_SECRET=<Client secret>
```

| 파일 | 담는 값 | 누가 읽나 | 커밋 |
|---|---|---|---|
| `.env` | 모든 실행 방식이 같이 쓰는 데모 값(DB 주소, 포트, JWT 키 ...) | 서버, Prisma CLI, e2e 테스트 | 한다 |
| `.env.local` | 진짜 비밀(GitHub 값)만 | 서버(`main.ts`)만 | 안 한다 |
| `.env.local.example` | `.env.local`의 키 이름, 값은 비움 | 사람(복사해서 쓴다) | 한다 |

- 같은 키를 두 파일에 함께 두지 않는다. 겹치면 어느 쪽 값이 쓰일지가 읽는 순서와 Node의 덮어쓰기 규칙에 달려서, 고친 값이 반영되지 않는 일이 생긴다.

- `.env`가 없다면 `12`의 워크스페이스에서 `order-api-nest/.env`를 복사해 온다. `.gitignore`에 `.env`가 들어 있는 저장소(예: 템플릿으로 만든 루트 `.gitignore`)라면 `git clone`만으로는 이 파일이 오지 않는다.

Nest는 `.env`만 읽으므로(`start:dev`가 `nest start --watch --env-file .env`다) `main.ts`의 맨 앞에서 이 파일도 읽는다.

```ts
// src/main.ts
// 맨 위 import 한 줄과 bootstrap 첫 줄을 추가한다
import { existsSync } from 'node:fs';
// ... 기존 import 그대로 ...

async function bootstrap() {
  // 커밋하지 않는 비밀 값(GITHUB_CLIENT_SECRET 등)은 .env.local에 둔다. 컨테이너에서는 파일 없이 환경변수로 받는다
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  // ... 기존 내용 그대로 ...
```

### 작업 5. [커밋] 프론트 환경 값

프론트는 원래 `.env.local`을 쓰고 있었다(`.env*`는 Next 템플릿의 `.gitignore`에 이미 들어 있다).

`.env.example`에 다음을 더하고, `.env.local`에 실제 값을 넣는다.

```sh
# order-console-next/.env.example
# 맨 아래에 추가한다
# Auth.js. 실제 값은 커밋하지 않는 .env.local에 넣는다
# 이 앱의 공개 주소. 운영 모드(next start)에서 없으면 UntrustedHost 에러
AUTH_URL=http://localhost:3000
# 세션 쿠키를 암호화하는 키. openssl rand -base64 32 로 만든다
AUTH_SECRET=
# GitHub OAuth 앱의 Client ID와 Client secret(콜백 주소: http://localhost:3000/api/auth/callback/github)
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
```

`AUTH_GITHUB_ID`·`AUTH_GITHUB_SECRET`은 백엔드의 `GITHUB_CLIENT_ID`·`GITHUB_CLIENT_SECRET`과 같은 값이다. 이름이 다른 것은 Auth.js가 `AUTH_<공급자>_ID` 규칙으로 찾기 때문이다.

### 개념 | 환경 값은 누가, 언제 읽나

이 문서부터 환경 값을 읽는 곳이 다섯이 된다. 어디서 읽는지 모르면 "값을 넣었는데 안 읽힌다"에서 오래 막힌다.

| 실행 방식 | 읽는 파일 | 언제 |
|---|---|---|
| 백엔드 `npm run start:dev` | `.env`(`--env-file`), 그다음 `.env.local`(`main.ts`의 `process.loadEnvFile`) | 프로세스가 뜰 때 한 번 |
| 백엔드 e2e 테스트 | `.env`(`test/setup-env.ts`의 `process.loadEnvFile()`) | 테스트 시작 때. `main.ts`를 거치지 않으므로 `.env.local`은 읽지 않는다 |
| 백엔드 `npx prisma ...`(`migrate`, `db seed`, `generate`) | `.env`(`prisma7.config.ts`의 `process.loadEnvFile()`). 그 안의 `ADMIN_DATABASE_URL`을 `datasource.url`로 쓴다 | 명령을 칠 때마다 |
| 백엔드 컨테이너 | 파일 없음. compose의 `environment`가 넘긴 환경변수 | 컨테이너가 뜰 때 |
| 프론트 `next dev`·`next build`/`next start` | `.env.local`(Next가 알아서 읽는다) | 서버가 뜰 때 |

- 파일은 프로세스가 뜰 때 한 번만 읽힌다. `start:dev`의 감시는 `src/`의 소스 변경에 반응하므로, `.env.local`의 값만 고쳤다면 서버를 직접 다시 띄운다.

- 테스트가 `.env.local`을 읽지 않는 것은 일부러다. 7단계의 테스트는 진짜 GitHub 값 대신 가짜 값(`test-client`, `test-secret`)을 코드에서 직접 넣는다.

- 컨테이너 이미지에는 `.env.local`이 들어가지 않는다(6단계). 그래서 `main.ts`는 파일이 있을 때만(`existsSync`) 읽는다.

- `.env.local`을 읽는 곳은 `main.ts` 하나뿐이다. 그래서 `.env`를 통째로 `.env.local`로 옮기면(`.env`를 없애면) 서버는 뜨지만 Prisma CLI와 e2e 테스트는 DB 주소를 잃는다. `.env`는 커밋하는 데모 값 그대로 두고, `.env.local`에는 GitHub 두 값만 둔다.

  ```text
  $ npx prisma migrate dev --name github-id
  Loaded Prisma config from prisma7.config.ts.
  Prisma schema loaded from prisma/schema.prisma.
  Error: The datasource.url property is required in your Prisma config file when using prisma migrate dev.
  ```

  설정 파일은 찾았는데(`Loaded Prisma config`) 그 안의 `datasource.url`이 `undefined`라는 뜻이다. `prisma7.config.ts`는 `.env`가 없으면 아무것도 읽지 않고 넘어가므로(`existsSync`), "파일이 없다"가 아니라 "url이 없다"로 드러난다.

### 남길 것

- **찾아보면 되는 것**: `npm install -w`, `prisma migrate deploy`와 `migrate dev`의 차이, GitHub OAuth 앱 설정 화면의 위치(Settings → Developer settings → OAuth Apps), `process.loadEnvFile`, Auth.js 환경변수 이름(`AUTH_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`). 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 진짜 비밀은 커밋하지 않는 파일(`.env.local`)에, 그 파일의 견본(`.env.local.example`)은 커밋한다. 데모 값 `.env`와 섞지 않는다.

  - 환경 파일은 프로세스가 뜰 때 한 번 읽힌다. 값을 고치면 다시 띄워야 하고, 테스트·컨테이너는 그 파일을 읽지 않는다.

  - 환경 파일은 누가 읽는지(서버, Prisma CLI, 테스트, 컨테이너)를 먼저 따진다. `.env`는 모두가 읽는 바탕이고, `.env.local`은 서버만 읽는 덧붙임이다.

- **에러 신호**:

  - `The datasource.url property is required in your Prisma config file` → `order-api-nest/.env`가 있는지. 값을 `.env.local`로만 옮기면 Prisma CLI가 못 읽는다

  - `Can't reach database server at localhost:5433`(서버 시작, `migrate`, `seed`) → `docker compose ps`에 `db`가 떠 있는지(작업 2)

  - `createdb: error: ... database "order_api_test" already exists` → 정상이다. `12`에서 만든 테스트 DB가 남아 있다(작업 2)

  - e2e에서 `The column users.github_id does not exist` → 테스트 DB에 `migrate deploy`를 했는지(작업 2, 1단계 작업 1)

  - `GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET 환경변수가 없다`(응답은 500) → `order-api-nest/.env.local`이 있는지, 값을 채운 뒤 서버를 다시 띄웠는지

  - `git status`에 `order-api-nest/.env.local`이 보인다 → `order-api-nest/.gitignore`에 `.env.local`이 있는지

  - GitHub 화면에 `The redirect_uri is not associated with this application.` → OAuth 앱의 Authorization callback URL과 프론트 `AUTH_URL`의 호스트·포트(작업 3)

## 2. 1단계(Nest): GitHub 토큰이 우리 앱의 것인지 확인

### 작업 1. [커밋] 사용자에 GitHub id 칸

```prisma
// prisma/schema.prisma
// User 모델의 passwordHash 아래에 githubId 필드 한 줄을 설명 주석과 함께 추가한다
model User {
  id            String         @id
  name          String
  // "scrypt$솔트$해시" 형식. NULL이면 비밀번호가 없는 계정 → 로그인할 수 없다
  passwordHash  String?        @map("password_hash")
  // GitHub 계정의 숫자 id. GitHub 로그인(login)은 바꿀 수 있지만 이 id는 바뀌지 않는다. 비밀번호 계정은 NULL
  githubId      String?        @unique @map("github_id")
  // ... 나머지 필드 그대로 ...
}
```

```sh
# ./order-api-nest
npx prisma migrate dev --name github-id
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

`migrate dev`는 개발 DB(`order_api`)에만 적용한다. 둘째 줄은 1장 작업 2와 같은 명령으로, 테스트 DB에도 이 마이그레이션을 적용한다. 빠뜨리면 7단계의 e2e가 `github_id` 칸이 없다며 실패한다.

생성된 SQL은 칸 하나와 유일 인덱스 하나다.

```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "github_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_github_id_key" ON "users"("github_id");
```

`@unique`인데 비밀번호 계정은 모두 NULL이다. PostgreSQL의 유일 인덱스는 NULL끼리를 같은 값으로 보지 않으므로, NULL인 행이 여럿이어도 충돌하지 않는다.

GitHub 사용자는 `github-<숫자 id>`라는 id로 만든다. GitHub의 로그인 이름(`login`)은 사용자가 바꿀 수 있으므로 찾는 기준은 숫자 id다.

> `10`의 `order_app` 역할은 기본 권한(`ALTER DEFAULT PRIVILEGES`) 덕분에 새 칸도 그대로 읽고 쓸 수 있다.

### 작업 2. [커밋] 공개 회원가입에서 `github-` id 막기

공개 회원가입(`POST /users`)에서는 `github-`로 시작하는 id를 받지 않는다.

남이 `github-<내 숫자 id>`를 먼저 차지하면 내 GitHub 첫 로그인이 id 충돌로 막히기 때문이다(숫자 id는 공개 정보다).

```ts
// src/users/dto/create-user.dto.ts
// import에 Matches를 더하고, id 줄에 @Matches를 붙인다
import { IsNotEmpty, IsString, Matches, MinLength } from "class-validator";

export class CreateUserDto {
  // github-로 시작하는 id는 GitHub 로그인이 만드는 계정 몫이다. 남이 먼저 차지하면 그 GitHub 사용자의 첫 로그인이 막힌다
  @IsString() @IsNotEmpty() @Matches(/^(?!github-)/, { message: "github-로 시작하는 id는 사용할 수 없습니다" }) id!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @MinLength(8) password!: string;
}
```

`/^(?!github-)/`는 "맨 앞이 `github-`가 아니면 맞음"이라는 정규식이다(`(?!...)`는 부정 전방 탐색). `github-1234`로 가입하면 전역 `ValidationPipe`가 400과 메시지 `github-로 시작하는 id는 사용할 수 없습니다`를 돌려준다.

### 작업 3. [커밋] GitHub에 묻기

```ts
// src/auth/github.ts
// GitHub에 "이 액세스 토큰이 우리 OAuth 앱에 발급된 것인가"를 묻는다(이 문서 1단계)
// POST /applications/{client_id}/token : 앱의 client id·secret으로 인증(Basic)해야 부를 수 있다.
// 토큰이 유효하고 이 앱의 것이면 200과 그 토큰의 주인(user)을, 다른 앱의 토큰이거나 취소·만료됐으면 404를 돌려준다
export type GithubUser = { id: string; login: string };

export async function verifyGithubToken(accessToken: string): Promise<GithubUser | null> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET 환경변수가 없다");
  // 테스트에서는 가짜 GitHub 서버 주소로 바꾼다
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";

  const res = await fetch(`${api}/applications/${clientId}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  if (res.status === 404 || res.status === 422) return null; // 이 앱의 토큰이 아니다(또는 형식이 틀렸다)
  if (!res.ok) throw new Error(`GitHub 토큰 확인 실패(${res.status})`); // GitHub 장애 등 - 로그인 실패가 아니라 서버 오류다
  const body = (await res.json()) as { user: { id: number; login: string } };
  return { id: String(body.user.id), login: body.user.login };
}
```

앱 토큰 확인 API가 "이 앱에 발급된 토큰인가"까지 보므로, 0장 개념 3의 구멍이 여기서 막힌다.

이 함수는 Nest 프로바이더가 아니라 그냥 함수다. 상태가 없으니 주입할 이유가 없고, 2단계의 `AuthService`가 import해서 부른다.

#### 결과가 셋으로 갈리는 이유

반환 값은 세 갈래다. 이 구분이 응답 코드를 정한다.

| GitHub 응답 | 함수의 결과 | 사용자가 받는 응답 |
|---|---|---|
| 200 | `{ id, login }` | 다음 단계로 간다 |
| 404, 422 | `null` | 401 "GitHub 토큰을 확인할 수 없습니다"(2단계에서 만든다) |
| 그 밖의 실패(5xx 등) | 예외 | 500. 사용자 잘못이 아니라 서버 쪽 문제다 |

환경변수가 비어 있을 때도 예외(500)다. 값이 없는 것은 요청을 보낸 쪽의 잘못이 아니기 때문이다.

환경변수를 모듈 맨 위가 아니라 **함수 안에서** 읽는다는 점도 기억해 둔다. 테스트가 서버를 띄운 뒤 `process.env`에 값을 넣어도 다음 호출부터 그 값이 쓰인다(7단계).

### 용어 | GitHub API (토큰 확인)

- `POST /applications/{client_id}/token`: 앱 자신만 부를 수 있는 API다. 토큰이 유효하고 이 앱에 발급된 것이면 200과 토큰의 주인(`user`)을, 다른 앱의 토큰이거나 취소·만료됐으면 404를 돌려준다. Client ID와 Client secret으로 하는 Basic 인증은 아래 "Basic 인증과 Bearer 인증"에서 다룬다.

- `GET /user`: 토큰 주인의 정보를 돌려준다. 토큰이 유효하기만 하면 어느 앱의 토큰이든 통과한다(아래 실험 ①에서 깨뜨려 본다).

### 개념 | Basic 인증과 Bearer 인증

HTTP의 `Authorization` 헤더 값은 `<방식> <증명 값>` 모양이고, 앞의 단어가 증명 값의 형식을 정한다. 이 문서에는 두 방식이 나온다.

Basic은 `아이디:비밀번호`를 이어 붙여 base64로 바꾼 값이다. 작업 3에서는 아이디 자리에 Client ID, 비밀번호 자리에 Client secret을 넣는다.

7단계의 가짜 GitHub 서버가 기대하는 값으로 직접 만들어 본다.

```js
const value = Buffer.from("test-client:test-secret").toString("base64");
console.log(value); // 출력: dGVzdC1jbGllbnQ6dGVzdC1zZWNyZXQ=
console.log(Buffer.from(value, "base64").toString()); // 출력: test-client:test-secret
```

| | Basic | Bearer |
|---|---|---|
| 증명 값 | `아이디:비밀번호`를 base64로 바꾼 것 | 토큰 그대로 |
| 증명하는 것 | 우리 OAuth 앱(Client ID·secret) | 토큰을 받은 사용자 |
| 이 문서에서 | 작업 3 `POST /applications/{client_id}/token` | 실험 ① `GET /user`, 7단계 테스트의 `/me/orders` 호출 |

- base64는 암호화가 아니라 인코딩이다. 위처럼 누구나 되돌릴 수 있으므로 Basic 헤더는 HTTPS(`https://api.github.com`) 위에서만 보낸다.

- 작업 3의 요청은 헤더(Basic)로 "묻는 쪽이 어느 앱인가"를, 본문의 `access_token`으로 "물어볼 토큰"을 보낸다. GitHub는 둘의 짝이 맞을 때만 200을 준다.

- 실험 ①처럼 Bearer로 사용자 토큰만 보내면 GitHub는 "어느 앱이 묻는가"를 알 수 없으므로 앱을 가려 줄 수도 없다.

> Basic 헤더는 Client secret을 사실상 평문으로 싣는다. 이 요청을 브라우저가 아니라 Nest(서버)에서만 보내는 이유다.

### 실험 | 일부러 깨뜨려보기 ①: `GET /user`만 보면

흔히 보는 확인 방식으로 바꿔 본다.

```ts
// src/auth/github.ts
// 깨뜨려보기: "토큰으로 GET /user가 되면 그 사람이다"
export async function verifyGithubToken(accessToken: string): Promise<GithubUser | null> {
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const res = await fetch(`${api}/user`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GitHub 토큰 확인 실패(${res.status})`);
  const user = (await res.json()) as { id: number; login: string };
  return { id: String(user.id), login: user.login };
}
```

같은 상태의 코드가 `practice/break-github-user-check/`에 있다.

7단계의 테스트는 가짜 GitHub 서버를 쓴다. 그 서버의 `GET /user`는 진짜 GitHub처럼 토큰이 유효하기만 하면 주인을 알려 준다.

같은 사람(4242)이 우리 앱에 준 토큰(`good-token`)과 다른 앱에 준 토큰(`token-of-another-app`)이 둘 다 통과한다.

```text
× 같은 사람의 토큰이라도 다른 앱이 받은 것이면 401이고 사용자를 만들지 않는다
AssertionError: expected 200 to be 401
```

다른 앱의 토큰으로 `/auth/github`가 200, 즉 일회용 코드를 내줬다. 그 코드를 바꾸면 4242번 사람의 계정으로 로그인된다.

> 원래대로 되돌리면 통과한다.

### 남길 것

- **찾아보면 되는 것**: GitHub 앱 토큰 확인 API의 경로와 응답 코드, `@Matches`와 부정 전방 탐색 문법, Basic 헤더 만드는 법. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - "토큰이 유효한가"와 "우리 앱에 발급된 토큰인가"는 다른 질문이다. 다른 서버가 넘겨준 토큰은 발급처에 "누구에게 발급됐나"까지 묻는다.

  - 외부 계정은 바뀌지 않는 숫자 id로 찾는다. 그 id로 만드는 우리 쪽 id(`github-...`)는 공개 가입에서 미리 막아 둔다.

- **에러 신호**:

  - `/auth/github`가 401 `GitHub 토큰을 확인할 수 없습니다` → 다른 앱의 토큰이거나, Nest의 `GITHUB_CLIENT_ID`가 프론트의 `AUTH_GITHUB_ID`와 다른 앱 것이다

  - `/auth/github`가 500, 로그에 `GitHub 토큰 확인 실패(<상태 코드>)` → GitHub 쪽 장애. 우리 코드나 사용자 문제가 아니다

  - 테스트에서 `AssertionError: expected 200 to be 401`(다른 앱 토큰 테스트) → `github.ts`가 `GET /user`만 보고 있는지

  - 회원가입이 400 `github-로 시작하는 id는 사용할 수 없습니다` → 정상이다. `github-` id는 GitHub 로그인 몫이다

## 3. 2단계(Nest): 일회용 코드

### 작업 1. [커밋] 저장소

코드는 60초만 살면 되고 한 번 쓰면 버린다.

`04`에서 쓴 Redis가 딱 맞는다. 값이 `EX`로 알아서 사라지기 때문이다.

```ts
// src/auth/auth-code.store.ts
import { createHash, randomBytes } from "node:crypto";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";

// 일회용 로그인 코드(이 문서 2단계). Next 서버가 받아 브라우저에 건네고, 브라우저가 한 번 내면 토큰으로 바뀐다
const CODE_TTL_SECONDS = 60;
// Redis에도 원문 대신 해시를 키로 쓴다 - Redis 내용이 새도 코드를 쓸 수 없다(refresh token과 같은 이유)
const keyOf = (code: string) => `auth-code:${createHash("sha256").update(code).digest("hex")}`;

@Injectable()
export class AuthCodeStore implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL!);

  async issue(userId: string): Promise<string> {
    const code = randomBytes(32).toString("base64url"); // 추측할 수 없는 무작위 값
    await this.redis.set(keyOf(code), userId, "EX", CODE_TTL_SECONDS); // 60초 뒤 Redis가 알아서 지운다
    return code;
  }

  // 꺼내면서 지운다(GETDEL). 읽기와 지우기가 명령 하나라서, 같은 코드로 두 요청이 동시에 와도 하나만 userId를 받는다
  consume(code: string): Promise<string | null> {
    return this.redis.getdel(keyOf(code));
  }

  async onModuleDestroy() {
    await this.redis.quit(); // 닫지 않은 연결이 종료를 붙잡는다
  }
}
```

- `randomBytes(32).toString("base64url")`: 32바이트(256비트) 무작위 값을 URL에 그대로 넣을 수 있는 문자(`A-Z a-z 0-9 - _`)로 바꾼다. 60초 안에 맞혀 볼 수 있는 크기가 아니다.

- 키는 `auth-code:<sha256 해시>`다. Redis를 들여다봐도(9장 진단 1의 `redis-cli --scan`) 원래 코드는 알 수 없다.

- Redis 연결은 이 클래스가 직접 만든다. 이 프로젝트의 다른 Redis 사용처(`health.controller.ts`, `mail.queue.ts`)도 각자 연결을 갖는다. 그래서 끌 때 `onModuleDestroy`에서 직접 닫는다.

### 용어 | Redis 명령 (일회용 코드)

- `SET 키 값 EX 초`(`redis.set(key, value, "EX", 60)`): 값을 저장하고, 정한 초가 지나면 Redis가 알아서 지운다.

- `GETDEL 키`(`redis.getdel(key)`): 값을 꺼내면서 지운다. 읽기와 지우기가 명령 하나라서 그 사이에 다른 요청이 끼어들 틈이 없다. 키가 없으면 `null`이다. 두 명령으로 나누면 어떻게 되는지는 아래 실험 ②에서 깨뜨려 본다.

### 작업 2. [커밋] 서비스에 두 메서드 더하기

`AuthService`가 `AuthCodeStore`를 주입받고, `login` 아래에 두 메서드를 더한다.

```ts
// src/auth/auth.service.ts
// import 두 줄을 더하고, 생성자에 codes를 받고, login 아래에 두 메서드를 더한다
import { AuthCodeStore } from "./auth-code.store.js";
import { verifyGithubToken } from "./github.js";
// ... 기존 import 그대로 ...

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly codes: AuthCodeStore,
  ) {}

  // ... login 그대로 ...

  // GitHub 로그인. 토큰이 우리 앱의 것인지 GitHub에 확인하고, 사용자를 찾거나 만든 뒤 일회용 코드를 준다
  async loginWithGithub(githubAccessToken: string): Promise<string> {
    const gh = await verifyGithubToken(githubAccessToken);
    if (!gh) throw new UnauthorizedException("GitHub 토큰을 확인할 수 없습니다");
    // GitHub의 숫자 id로 찾는다. 처음이면 만들고, 이미 있으면 바뀌었을 수 있는 login만 갱신한다
    const user = await this.prisma.user.upsert({
      where: { githubId: gh.id },
      create: { id: `github-${gh.id}`, name: gh.login, githubId: gh.id }, // 비밀번호가 없다 → id/password 로그인은 안 된다
      update: { name: gh.login },
    });
    return this.codes.issue(user.id);
  }

  // 일회용 코드를 우리 토큰(액세스 + refresh)으로 바꾼다. 비밀번호 로그인과 같은 토큰이다
  async exchangeCode(code: string): Promise<IssuedTokens> {
    const userId = await this.codes.consume(code);
    if (!userId) throw new UnauthorizedException("코드가 없거나, 이미 썼거나, 만료됐습니다");
    return this.issueTokens(this.prisma, userId, randomUUID());
  }
```

`upsert`는 "`where`로 찾아서 있으면 `update`, 없으면 `create`"를 한 번에 하는 Prisma 메서드다. `where`에는 `@unique`나 `@id`인 칸만 쓸 수 있으므로, 1단계 작업 1에서 `githubId`에 `@unique`를 붙인 것이 여기서 필요해진다.

### 작업 3. [커밋] DTO와 엔드포인트

```ts
// src/auth/github-login.dto.ts
import { IsNotEmpty, IsString } from "class-validator";

// Next 서버(Auth.js)가 보내는 GitHub 액세스 토큰
export class GithubLoginDto {
  @IsString() @IsNotEmpty() accessToken!: string;
}

// 브라우저가 내는 일회용 코드
export class ExchangeCodeDto {
  @IsString() @IsNotEmpty() code!: string;
}
```

```ts
// src/auth/auth.controller.ts
// import 한 줄을 더하고, login 아래에 두 메서드를 더한다
import { ExchangeCodeDto, GithubLoginDto } from "./github-login.dto.js";
// ... 기존 import 그대로 ...

  // Next 서버(Auth.js)가 GitHub 토큰을 보내면 일회용 코드를 돌려준다. 토큰은 여기서 확인만 하고 저장하지 않는다
  @Post("github")
  @HttpCode(200)
  async github(@Body() dto: GithubLoginDto) {
    return { code: await this.authService.loginWithGithub(dto.accessToken) };
  }

  // 브라우저가 일회용 코드를 내면 로그인과 똑같이 refresh 쿠키와 액세스 토큰을 준다
  @Post("exchange")
  @HttpCode(200)
  async exchange(@Body() dto: ExchangeCodeDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.exchangeCode(dto.code);
    res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 });
    return { accessToken };
  }
```

`/auth/exchange`의 응답은 `03`의 `/auth/login`과 같다. 같은 `issueTokens`로 refresh token 사슬(`familyId`)을 새로 시작하고, 같은 쿠키 설정으로 내보낸다.

그래서 이 뒤의 refresh 회전, 재사용 감지, 로그아웃은 비밀번호 로그인과 구별 없이 동작한다.

### 개념 | 컨트롤러 안에서 메서드의 자리

"`login` 아래에"는 읽기 좋으라고 정한 자리다. 두 메서드를 클래스 맨 위에 두든, `logout-all` 아래에 두든 동작은 같다.

Nest는 서버가 뜰 때 컨트롤러의 메서드를 위에서부터 훑어 `POST /auth/github`, `POST /auth/exchange`처럼 "HTTP 메서드 + 경로"마다 하나씩 라우트로 등록한다. 요청이 오면 이 둘이 맞는 라우트를 찾아 부르므로, 경로가 서로 다르면 순서가 결과에 끼어들 틈이 없다. 이 컨트롤러의 경로(`login`, `refresh`, `logout`, `logout-all`, `github`, `exchange`)는 모두 글자가 고정된 경로이고 서로 겹치지 않는다.

순서가 결과를 바꾸는 것은 한 요청이 두 라우트에 동시에 맞을 때다.

```ts
// 읽는 코드. 순서가 문제 되는 예
@Get(":id")  // GET /orders/me 도 여기 걸린다(id = "me")
findOne() {}

@Get("me")   // 위에서 먼저 잡히므로 영영 불리지 않는다
findMine() {}
```

라우트는 선언한 순서대로 등록되고 먼저 맞은 쪽이 요청을 가져가므로, `:id` 같은 매개변수 경로는 고정 경로보다 아래에 둔다.

순서와 상관없는 것도 함께 정리해 둔다.

- `@Post`·`@HttpCode`·`@UseGuards` 같은 데코레이터는 바로 아래 메서드 하나에만 붙는다. 메서드를 옮길 때는 위에 붙은 데코레이터를 함께 옮긴다.

- 클래스 위의 `@Controller("auth")`와 클래스에 붙인 가드는 자리와 상관없이 모든 메서드에 적용된다.

### 작업 4. [커밋] `AuthModule`에 `AuthCodeStore` 등록

```ts
// src/auth/auth.module.ts
// import 한 줄과 providers 배열의 AuthCodeStore만 추가한다
import { AuthCodeStore } from "./auth-code.store.js";
// ... 기존 import 그대로 ...

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ /* ... 그대로 ... */ }),
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, AuthService, AuthCodeStore],
})
export class AuthModule {}
```

`AuthService`의 생성자가 `AuthCodeStore`를 요구하므로, 같은 모듈의 `providers`에 없으면 Nest가 넣어 줄 것을 찾지 못한다.

그때는 서버가 뜨기 전에 `Nest can't resolve dependencies of the AuthService (PrismaService, JwtService, ?)`로 멈춘다. `?` 자리가 세 번째 매개변수, 곧 `AuthCodeStore`다.

### 작업 5. [확인] 엔드포인트가 열렸는지 확인

GitHub 토큰 없이 확인할 수 있는 쪽은 `/auth/exchange`다. 지어낸 코드를 내면 `consume`이 `null`을 돌려주므로 401이다.

```sh
curl -s -w " %{http_code}\n" -X POST localhost:4000/auth/exchange -H 'Content-Type: application/json' -d '{"code":"made-up"}'
{"message":"코드가 없거나, 이미 썼거나, 만료됐습니다","error":"Unauthorized","statusCode":401} 401
```

404가 나면 컨트롤러 메서드가 등록되지 않은 것이다. `@Post("exchange")`가 `AuthController` 안에 있는지 본다.

진짜 GitHub 토큰으로 `/auth/github`까지 확인하는 것은 Auth.js를 붙인 뒤 5단계에서 한다.

### 실험 | 일부러 깨뜨려보기 ②: 발급이 성공한 뒤에 지우면

"토큰 발급이 실패하면 코드를 다시 쓸 수 있게, 성공한 다음에 지우자"는 생각으로 바꿔 본다.

`AuthCodeStore`에 읽기(`GET`)와 지우기(`DEL`)를 따로 하는 메서드 둘을 더한다.

```ts
// src/auth/auth-code.store.ts
// consume 아래에 두 메서드를 잠깐 더한다
  // 깨뜨려보기 ②: 읽기(GET)와 지우기(DEL)를 따로 한다
  peek(code: string): Promise<string | null> {
    return this.redis.get(keyOf(code));
  }

  async remove(code: string): Promise<void> {
    await this.redis.del(keyOf(code));
  }
```

```ts
// src/auth/auth.service.ts
// 깨뜨려보기: exchangeCode를 이렇게 바꾼다
  async exchangeCode(code: string): Promise<IssuedTokens> {
    const userId = await this.codes.peek(code); // 먼저 읽고
    if (!userId) throw new UnauthorizedException("코드가 없거나, 이미 썼거나, 만료됐습니다");
    const tokens = await this.issueTokens(this.prisma, userId, randomUUID());
    await this.codes.remove(code); // 발급이 성공한 다음에 지운다(실패하면 다시 쓸 수 있게)
    return tokens;
  }
```

같은 상태의 코드가 `practice/break-delete-after-issue/`에 있다.

같은 코드로 요청 10개를 동시에 보내는 테스트(7단계)를 세 번 돌린다.

```text
AssertionError: expected [ 200, 200, 200, 200, 200 ] to have a length of 1 but got 5
AssertionError: expected [ 200, 200, 200, 200, 200 ] to have a length of 1 but got 5
AssertionError: expected [ 200, 200, 200 ] to have a length of 1 but got 3
```

코드 하나로 세션(refresh token 사슬)이 3~5개 생겼다. `02`의 lost update와 같은 모양이다.

"읽기"와 "지우기" 사이에 DB 쓰기(`issueTokens`)가 끼어 있어서, 그동안 들어온 다른 요청도 같은 값을 읽는다.

읽고 바로 지우게만 바꿔도 틈은 줄지만(이 환경에서 세 번 돌려 재현되지 않았다) 없어지지는 않는다.

**읽기와 지우기를 명령 하나로(`GETDEL`) 하면 Redis가 명령을 하나씩 처리하므로 틈 자체가 없다.**

> 되돌린다. `peek`·`remove`를 지우고 `exchangeCode`를 `consume` 한 줄로 돌려놓는다.

### 개념 | 왜 `GETDEL` 하나로 틈이 사라지나

`02`에서 재고를 지킬 때와 같은 문제다. "읽고 → 판단하고 → 쓰기"가 나뉘어 있으면 그 사이에 다른 요청이 끼어든다.

Redis 서버는 명령을 한 줄로 세워 하나씩 실행한다. 명령 하나가 실행되는 동안 다른 클라이언트의 명령은 끼어들지 못한다.

| 방식 | 요청 A와 B가 동시에 오면 |
|---|---|
| `GET` → 발급 → `DEL` | A의 `GET`, B의 `GET`이 둘 다 `userId`를 받는다. 둘 다 발급한다 |
| `GETDEL` | 둘 중 먼저 줄 선 쪽만 `userId`를 받고, 나머지는 `null`(401)이다 |

C로 치면 `if (flag) { flag = 0; ... }`를 두 스레드가 돌리는 것과 원자적 교환(`atomic_exchange(&flag, 0)`)의 차이다. 앞의 것은 둘 다 `flag == 1`을 읽을 수 있고, 뒤의 것은 하나만 1을 받는다.

"실패하면 다시 쓰게 하자"는 의도는 버린다. 발급이 실패하면 사용자는 GitHub 로그인을 처음부터 다시 하면 되고, 그 비용이 코드 하나로 세션 여러 개가 생기는 것보다 훨씬 싸다.

### 남길 것

- **찾아보면 되는 것**: `SET ... EX`, `GETDEL`, `randomBytes(...).toString("base64url")`, Prisma `upsert`의 인자. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 한 번만 써야 하는 값은 "꺼내면서 지우기"를 명령 하나로 한다. 읽기와 지우기 사이에 다른 일이 끼면 같은 값을 여러 요청이 쓴다.

  - 새 로그인 수단이 생겨도 로그인 상태는 하나다. 끝에서 같은 `issueTokens`를 부르면 refresh 회전·로그아웃이 그대로 따라온다.

- **에러 신호**:

  - `Nest can't resolve dependencies of the AuthService (PrismaService, JwtService, ?)` → `auth.module.ts`의 `providers`에 `AuthCodeStore`가 있는지

  - `/auth/exchange`가 401 `코드가 없거나, 이미 썼거나, 만료됐습니다` → 60초가 지났거나, 같은 코드를 두 번 냈다

  - 동시 교환 테스트가 `expected [ 200, 200, ... ] to have a length of 1` → `exchangeCode`가 읽기와 지우기를 따로 하는지

## 4. 3단계(Next): Auth.js 붙이기

여기부터는 `order-console-next`에서 작업한다.

### 작업 1. [커밋] `auth.ts` 설정

```ts
// auth.ts (order-console-next 루트)
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

// 서버(Next)에서 부르는 백엔드 주소. 브라우저용 NEXT_PUBLIC_API_URL과 따로 둔다(컨테이너 안에서는 주소가 다를 수 있다)
const API_URL = process.env.API_URL ?? "http://localhost:4000";

// Auth.js는 GitHub와 주고받는 OAuth 절차(state, PKCE, 콜백 처리)만 맡는다.
// 로그인이 끝나면 Nest가 주는 우리 토큰(액세스 토큰 + refresh 쿠키)으로 갈아탄다(이 문서 0장)
export const { handlers, auth, signIn, signOut } = NextAuth({
  // AUTH_GITHUB_ID, AUTH_GITHUB_SECRET 환경변수를 알아서 읽는다. AUTH_SECRET은 아래 세션 쿠키를 암호화하는 키다
  providers: [GitHub],
  // Auth.js 세션은 우리 토큰으로 바꾸기 전까지 잠깐만 쓴다 → 5분
  session: { strategy: "jwt", maxAge: 5 * 60 },
  // 로그인 시작과 실패 화면을 우리 /login으로
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    // 세션 쿠키(JWT)를 만들거나 읽을 때마다 불린다. account는 GitHub에서 막 돌아왔을 때 한 번만 있다
    async jwt({ token, account }) {
      if (account?.provider === "github" && account.access_token) {
        // GitHub 토큰을 Nest에 넘긴다. Nest가 "우리 앱의 토큰인지" GitHub에 확인하고 일회용 코드를 준다
        const res = await fetch(`${API_URL}/auth/github`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: account.access_token }),
        });
        if (!res.ok) throw new Error(`백엔드가 GitHub 로그인을 거절했습니다(${res.status})`);
        token.exchangeCode = ((await res.json()) as { code: string }).code;
      }
      // account.access_token(GitHub 토큰)은 token에 넣지 않는다 → 여기서 쓰고 버린다(이 문서 3단계)
      return token;
    },
    // auth()와 /api/auth/session이 돌려주는 값. 브라우저도 볼 수 있으므로 일회용 코드만 담는다
    session({ session, token }) {
      session.exchangeCode = token.exchangeCode;
      return session;
    },
  },
});
```

`import`의 `@/auth`(작업 3, 작업 4)는 이 파일을 가리킨다. `@/`는 `tsconfig.json`의 `paths`가 프로젝트 루트로 잡아 둔 별칭이다.

이 파일을 저장한 시점에는 `session.exchangeCode`에서 타입 에러가 난다. 작업 2에서 고친다.

### 개념 | `jwt`·`session` 콜백이 불리는 때와 담으면 안 되는 것

`jwt` 콜백은 세션 쿠키(JWT)를 만들거나 읽을 때마다 불린다. 그중 `account`는 GitHub에서 막 돌아왔을 때(④ 직후) 한 번만 들어온다.

그때 ⑤⑥을 하고 받은 일회용 코드만 Auth.js 세션에 넣는다. GitHub 액세스 토큰은 세션에 넣지 않는다.

| 콜백 | 불리는 때 | 돌려주는 값이 가는 곳 |
|---|---|---|
| `jwt` | 콜백 처리(④ 직후), 그리고 세션을 읽을 때마다 | 암호화된 세션 쿠키 안 |
| `session` | `auth()`나 `/api/auth/session`이 세션을 읽을 때 | `auth()`의 반환 값, `/api/auth/session`의 JSON |

`session` 콜백이 돌려주는 값은 `auth()`(서버)와 `/api/auth/session`(브라우저가 부를 수 있는 공개 엔드포인트)이 그대로 돌려준다.

**여기에 GitHub 토큰을 넣으면(검색하면 흔히 나오는 `session.accessToken = token.accessToken`) 그 토큰이 브라우저 JS로 읽힌다.** `03`에서 액세스 토큰을 메모리에만 둔 노력이 무색해진다.

> 일회용 코드는 어차피 브라우저에 건넬 값이고 60초 안에 한 번 쓰면 끝이므로 괜찮다.

`jwt` 콜백 안에서 `throw`하면 Auth.js는 로그인을 실패로 처리하고 `pages.error`(`/login`)로 돌려보낸다. Nest가 `/auth/github`를 401로 거절했을 때 사용자가 겪는 일이 이것이다(9장 진단 2).

### 작업 2. [커밋] 세션·토큰 타입 보강

세션·토큰 타입에 우리 칸을 더한다.

```ts
// types/next-auth.d.ts
// Auth.js의 세션·토큰 타입에 우리가 넣는 칸을 더한다(모듈 보강)
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    exchangeCode?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    exchangeCode?: string;
  }
}
```

왜 맨 위의 `import` 두 줄을 지우면 안 되는지는 아래 "모듈 보강과 맨 위의 `import`"에서 다룬다.

### 작업 3. [커밋] Auth.js가 처리할 경로 열기

```ts
// app/api/auth/[...nextauth]/route.ts
// /api/auth/* 를 Auth.js가 처리한다: signin, callback/github(GitHub가 돌려보내는 곳), session, signout ...
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

이 파일이 있어야 `/api/auth/*` 주소가 생긴다. 프론트 개발 서버를 띄우고 다른 터미널에서 확인한다.

```sh
# ./order-console-next
npm run dev # :3000. 이 터미널은 서버 로그를 보는 데 쓴다
```

```sh
curl -s localhost:3000/api/auth/providers
# {"github":{"id":"github","name":"GitHub","type":"oauth","signinUrl":"http://localhost:3000/api/auth/signin/github","callbackUrl":"http://localhost:3000/api/auth/callback/github"}}%

# 로그인하지 않았을 때의 세션
curl -s localhost:3000/api/auth/session
# null%
```

`callbackUrl`이 작업 3(1장)에서 OAuth 앱에 등록한 콜백 주소와 글자 하나까지 같아야 한다.

`/api/auth/providers`가 위 JSON 대신 다음을 돌려주면 Auth.js 설정이 빠진 것이다.

```text
{"message":"There was a problem with the server configuration. Check the server logs for more information."}
```

응답에는 일부러 원인을 싣지 않는다(설정 내용을 바깥에 흘리지 않으려고). 원인은 `npm run dev`를 띄운 터미널에 오류 이름으로 찍힌다.

```text
[auth][error] MissingSecret: Please define a `secret`. Read more at https://errors.authjs.dev#missingsecret
    at assertConfig (.../node_modules_@auth_core_....js)
    at Auth (...)
    ...
 GET /api/auth/providers 500 in 594ms
```

- `MissingSecret`은 세션 쿠키를 암호화할 키(`AUTH_SECRET`)가 없다는 뜻이다. `assertConfig`라는 이름대로, 요청을 처리하기 전에 설정부터 검사하다 멈췄다. 그래서 세션과 상관없어 보이는 `/providers`도 500이다.

- 서버 첫머리의 `- Environments: .env.local`은 그 파일을 읽었다는 뜻일 뿐, 필요한 키가 다 있다는 뜻은 아니다.

- 고치는 법: `openssl rand -base64 32`로 만든 값을 프론트 `.env.local`의 `AUTH_SECRET=`에 넣고(1장 작업 5), `npm run dev`를 다시 띄운다. `.env.local`은 서버가 뜰 때 읽힌다. 같은 작업의 `AUTH_URL`도 함께 들어 있는지 본다. 개발 서버에서는 없어도 동작하지만 운영 빌드에서 `UntrustedHost`로 막힌다(3단계 실험 ③).

> zsh에서 `curl -s` 응답 끝에 붙는 `%`는 응답의 일부가 아니다. 응답이 줄바꿈 없이 끝났다는 셸의 표시다.

`08`의 `proxy.ts`는 matcher에서 `api`를 빼 두었으므로 `/api/auth/*`에는 CSP를 붙이지 않는다. 고칠 것이 없다.

### 용어 | Auth.js API

`jwt`·`session` 콜백은 위 "`jwt`·`session` 콜백이 불리는 때와 담으면 안 되는 것"에서 다뤘다.

- `NextAuth(설정)`: Auth.js를 설정하고 `handlers`(라우트 처리기), `auth`(서버에서 세션 읽기), `signIn`, `signOut`을 돌려준다. `handlers`가 받는 경로는 아래 "`handlers`와 `[...nextauth]` 경로"에서 다룬다.

- `providers: [GitHub]`: GitHub 공급자를 쓴다. `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` 환경변수를 알아서 읽는다.

- `AUTH_SECRET`: 세션 쿠키를 암호화하는 키다. 설정에 적지 않아도 환경변수에서 읽는다.

- `session: { strategy: "jwt", maxAge }`: 세션을 DB가 아니라 암호화된 쿠키(JWT)에 담고, `maxAge`초 뒤 만료시킨다. `03`의 액세스 토큰(JWT)과의 차이는 아래 "JWT 세션은 암호화된 쿠키다"에서 다룬다.

- `pages: { signIn, error }`: 로그인 시작 화면과 실패 화면을 Auth.js 기본 화면 대신 우리 경로로 바꾼다.

- `declare module "next-auth"`(`types/next-auth.d.ts`): Auth.js의 `Session`·`JWT` 타입에 우리 칸을 더한다. 아래 "모듈 보강과 맨 위의 `import`"에서 다룬다.

### 개념 | JWT 세션은 암호화된 쿠키다

Auth.js 세션은 `authjs.session-token`이라는 httpOnly 쿠키 하나에 담긴다. 이름은 JWT지만 `03`에서 만든 액세스 토큰과 모양이 다르다.

`03`의 액세스 토큰은 **서명만 한** JWT라서 점으로 나뉜 3조각이고, 가운데 조각을 base64url로 풀면 누구나 내용을 읽는다.

Auth.js 세션은 `AUTH_SECRET`에서 만든 키로 **암호화한** JWT(JWE)라서 5조각이고, 키 없이는 읽을 수 없다.

#### `encode`·`decode`로 직접 확인

Auth.js가 쿠키를 만들고 풀 때 쓰는 함수(`next-auth/jwt`의 `encode`, `decode`)로 직접 확인한다. `salt`에는 쿠키 이름이 들어간다.

```js
import { encode, decode } from "next-auth/jwt";

const secret = "openssl-rand-base64-32-로-만든-값";
const salt = "authjs.session-token";
const cookie = await encode({ token: { exchangeCode: "abc" }, secret, salt, maxAge: 300 });

console.log(cookie.split(".").length); // 출력: 5
console.log(JSON.parse(Buffer.from(cookie.split(".")[0], "base64url")).enc); // 출력: A256CBC-HS512
console.log(await decode({ token: cookie, secret, salt })); // exchangeCode: 'abc'와 iat, exp, jti가 나온다
await decode({ token: cookie, secret: "다른-AUTH_SECRET", salt }).catch((e) => console.log(e.message)); // 출력: no matching decryption secret
```

| | `03`의 액세스 토큰 | Auth.js 세션 쿠키 |
|---|---|---|
| 형식 | 서명한 JWT(JWS), 3조각 | 암호화한 JWT(JWE), 5조각 |
| 내용 | base64url만 풀면 누구나 읽는다 | `AUTH_SECRET` 없이는 읽을 수 없다 |
| 막는 것 | 위조 | 위조와 엿보기 |
| 브라우저에서 | JS 메모리 | httpOnly 쿠키 |

- `strategy: "database"`는 쿠키에 세션 id만 두고 내용을 DB에 저장한다. 그러려면 DB 어댑터가 필요하다(11장 "이 문서에서 다루지 않은 것"). 이 문서는 세션을 5분만 쓰므로 쿠키로 충분하다.

- 쿠키가 암호화돼 있어도 `session` 콜백이 돌려준 값은 `/api/auth/session`에서 평문 JSON이 된다. 위에서 `session`에 GitHub 토큰을 넣지 말라고 한 이유다.

- `AUTH_SECRET`을 바꾸면 위 마지막 줄처럼 이미 발급된 세션 쿠키를 풀 수 없다.

> 같은 JWT라도 서명은 "고쳐 쓰지 못하게" 하고, 암호화는 "읽지도 못하게" 한다.

### 개념 | `handlers`와 `[...nextauth]` 경로

`app/api/auth/[...nextauth]/route.ts`의 `[...nextauth]`는 Next App Router의 catch-all 경로 조각이다.

폴더 이름이 `[...이름]`이면 그 자리부터 뒤의 경로를 몇 단계든 전부 받는다. 그래서 파일 하나가 `/api/auth/` 아래 주소를 모두 처리한다.

| 주소 | 하는 일 | 이 문서에서 |
|---|---|---|
| `/api/auth/signin/github` | GitHub 인가 화면으로 보낸다(①) | 실험 ③, 9장 진단 1 |
| `/api/auth/callback/github` | GitHub가 돌려보내는 곳. 인가 코드를 토큰으로 바꾸고(③④) `jwt` 콜백을 부른다 | 1장 작업 3의 콜백 주소 |
| `/api/auth/session` | `session` 콜백이 돌려준 값 | 작업 3의 `curl` |
| `/api/auth/providers` | 설정한 공급자 목록 | 작업 3의 `curl` |
| `/api/auth/signout` | 세션 쿠키를 지운다 | |

`route.ts`는 HTTP 메서드 이름(`GET`, `POST`)으로 함수를 내보내야 하는 파일이다. `handlers`가 `{ GET, POST }` 모양의 객체라서 구조 분해한 채로 바로 내보낸다.

```ts
export const { GET, POST } = handlers;
// 풀어 쓰면 아래와 같다
// export const GET = handlers.GET;
// export const POST = handlers.POST;
```

- `[이름]`은 한 단계만, `[...이름]`은 한 단계 이상을 받는다. `/api/auth` 자체는 `[...nextauth]`에 걸리지 않는다.

- 어느 동작(`signin`, `callback`, `session`...)인지는 Auth.js가 주소의 나머지 부분을 보고 고른다. 우리가 경로마다 파일을 만들 필요가 없다.

> 콜백 주소(`/api/auth/callback/github`)가 이 파일로 들어온다는 점이 중요하다. OAuth 앱에 등록한 주소와 이 경로가 어긋나면 9장 진단 2의 redirect_uri 오류가 난다.

### 개념 | 모듈 보강과 맨 위의 `import`

Auth.js의 `Session`·`JWT` 타입에는 `exchangeCode`가 없다. 보강 없이 `session.exchangeCode = token.exchangeCode`를 쓰면 타입 검사가 막는다.

```text
error TS2339: Property 'exchangeCode' does not exist on type 'Session'.
```

`types/next-auth.d.ts`의 `declare module "next-auth" { interface Session { ... } }`는 라이브러리 안의 `Session` interface에 칸을 더한다.

같은 이름의 interface 선언은 하나로 합쳐지기 때문이다(`type`으로 만든 타입은 이렇게 합칠 수 없다). 라이브러리 파일은 건드리지 않는다.

#### 흔한 실수: 쓰지 않아 보이는 `import`를 지운다

여기서 흔한 실수는 맨 위의 `import "next-auth";`를 "쓰지 않는 import"로 보고 지우는 것이다.

`import`나 `export`가 하나도 없는 파일에서 `declare module "next-auth"`는 보강이 아니라 **그 모듈의 선언을 새로 쓰는 것**이 된다. 그러면 원래 있던 칸이 사라진다.

```ts
// types/next-auth.d.ts에서 맨 위 두 import를 지우면
session.expires; // error TS2339: Property 'expires' does not exist on type 'Session'.
```

| 파일에 `import`/`export`가 | `declare module "next-auth"`의 뜻 |
|---|---|
| 있다 | 기존 모듈에 더한다(보강) |
| 없다 | 모듈 선언을 새로 쓴다(기존 타입이 가려진다) |

- 보강 파일은 값 없이 타입만 있으므로 `.d.ts`로 둔다. 실행되는 JS에는 아무것도 남지 않는다.

- `next-auth/jwt`의 `JWT`도 같은 방식으로 따로 보강한다. 모듈 이름이 다르면 다른 모듈이다.

> 보강 파일 맨 위의 `import`는 "이 파일은 모듈이다"라고 알리는 표시다. 쓰지 않아 보여도 지우지 않는다.

### 작업 4. [커밋] 로그인 버튼

```ts
// app/login/actions.ts
"use server";

import { signIn } from "@/auth";

// GitHub 로그인 화면으로 보낸다. 승인하고 돌아오면 /auth/github/complete로 간다
export async function signInWithGithub() {
  await signIn("github", { redirectTo: "/auth/github/complete" });
}
```

```tsx
// app/login/page.tsx
// import 한 줄을 더하고, 기존 폼과 에러 문구 아래에 폼 하나를 더한다
import { signInWithGithub } from "./actions";
// ... 기존 import 그대로 ...

      {error && <p role="alert">{error}</p>}
      {/* 서버 액션(actions.ts)을 action으로 넘긴다 - 누르면 서버가 GitHub 로그인 주소로 보낸다 */}
      <form action={signInWithGithub}>
        <button type="submit">GitHub로 로그인</button>
      </form>
```

로그인 화면은 클라이언트 컴포넌트(`"use client"`)지만, `"use server"` 파일의 함수는 가져다 `action`에 넘길 수 있다. 누르면 서버에서 `signIn`이 돌고, 브라우저는 GitHub로 이동한다.

`/auth/github/complete` 화면은 4단계에서 만든다. 지금 승인까지 가면 돌아온 곳이 404다.

### 개념 | 서버 액션: 브라우저에서 누르고 서버에서 도는 함수

`"use server"`가 맨 위에 붙은 파일의 `export async function`은 서버 액션이 된다.

- 브라우저 번들에는 함수 본문이 들어가지 않는다. 대신 "서버의 이 함수를 불러라"라는 참조만 들어간다. C로 치면 원격 프로시저 호출(RPC)의 스텁이다.

- 그래서 `signIn`처럼 `AUTH_SECRET`·`AUTH_GITHUB_SECRET`을 쓰는 서버 전용 코드를 클라이언트 컴포넌트의 버튼에 연결할 수 있다. 비밀 값은 서버를 떠나지 않는다.

- `signIn`은 GitHub 인가 주소로 보내는 리다이렉트로 끝난다. 그 전에 PKCE의 `code_verifier`를 쿠키로 심는다(작업 5에서 본다).

### 실험 | 일부러 깨뜨려보기 ③: 운영 빌드에서만 깨진다

1장 작업 5에서 `AUTH_URL`을 넣었다면, 프론트 `.env.local`에서 그 줄을 잠깐 지운다.

`npm run build && npm run start`로 띄우고 "GitHub로 로그인"을 누른다.

GitHub로 가지 않고 `http://localhost:3000/api/auth/signin/github`에 멈춘다. 서버 로그는 다음과 같다.

```text
[auth][error] UntrustedHost: Host must be trusted. URL was: http://localhost:3000/api/auth/signin/github?_rsc=. Read more at https://errors.authjs.dev#untrustedhost
```

Auth.js는 콜백 주소 같은 절대 주소를 만들 때 이 앱의 주소가 필요하다.

요청의 `Host` 헤더를 그대로 믿으면, 헤더를 조작한 요청으로 엉뚱한 주소가 만들어질 수 있다. 그래서 운영 모드에서는 Host 헤더를 믿지 않는다.

**개발 서버(`next dev`)에서는 믿어 주므로 이 문제가 배포하고 나서야 보인다.** `11` 이후 운영 빌드로 테스트해 온 덕분에 여기서 잡혔다.

`.env.local`에 `AUTH_URL=http://localhost:3000`을 다시 넣고 다시 띄운다. 배포할 때는 실제 공개 주소(`https://...`)를 넣는다.

### 작업 5. [확인] GitHub로 보내는 요청 살펴보기

작업 1~4로 버튼까지 붙었다. 이 작업은 코드를 고치지 않고, 버튼을 눌렀을 때 0장의 ①이 실제로 어떤 모양으로 나가는지 브라우저 개발자 도구로 본다. 남는 것은 없다. GitHub에서 승인까지 하는 것은 5단계에서 한다.

준비: 프론트 `.env.local`에 `AUTH_URL`·`AUTH_SECRET`·`AUTH_GITHUB_ID`·`AUTH_GITHUB_SECRET` 네 줄이 모두 있는지 먼저 본다(1장 작업 5). 실험 ③에서 지운 `AUTH_URL`을 되돌리지 않았으면 이 작업은 실험 ③과 똑같이 깨진다. 이 작업에서는 백엔드가 없어도 된다. GitHub로 보내는 것까지는 Next 서버 혼자 한다.

```sh
# ./order-console-next
npm run build && npm run start # :3000
```

1. 브라우저에서 `http://localhost:3000/login`을 연다.

2. 개발자 도구(`Cmd+Option+I`)의 **Network** 탭을 열고 **Keep log**를 켠다(이전 버전의 Chrome에서는 Preserve log). 버튼을 누르면 페이지가 GitHub로 넘어가는데, 이걸 켜지 않으면 넘어가는 순간 기록이 지워진다.

3. "GitHub로 로그인"을 누른다. GitHub 화면이 나오면 **아무것도 누르지 않고** 멈춘다.

   > GitHub로 넘어가지 않고 Network에 `POST /api/auth/signin/github`가 `500`으로 남으면 Next 서버를 띄운 터미널을 본다. `[auth][error] UntrustedHost`면 `AUTH_URL`이 없다(실험 ③). `MissingSecret`이면 `AUTH_SECRET`이 없다(작업 3). 값을 넣은 뒤 `npm run start`를 다시 띄운다. 운영 빌드도 `.env.local`은 서버가 뜰 때 읽으므로 다시 빌드할 필요는 없다.

   > GitHub로는 넘어갔는데 서버 로그에 `[auth][error] UnknownAction: Unsupported action`(스택 맨 위 `at Object.signin`)이 찍히는 경우가 있다. 누군가 `/api/auth/signin/github`를 **GET**으로 열었다는 뜻이다. 이 주소는 공급자를 고른 로그인 시작을 POST로만 받는다(`signIn`이 서버 안에서 POST로 부른다). GET으로 오면 "그런 동작은 없다"며 거절한다.
   >
   > 흔한 출처는 브라우저에 남은 그 주소다. 실험 ③이나 위의 500처럼 실패하면 브라우저 주소창이 `/api/auth/signin/github`에 멈춰 있는데, 그 탭에서 새로고침·뒤로 가기를 하면 GET이 나간다. Network(Keep log)에서 메서드가 `GET`인 `signin/github` 줄이 그것이다. 로그인 흐름과는 상관없으므로 GitHub 화면까지 왔다면 무시하고, 다음부터는 `/login`을 새로 열어 시작한다.

   > 이 OAuth 앱을 전에 승인한 적이 있으면 GitHub가 승인 화면 없이 곧바로 `localhost:3000`으로 돌려보낸다. 아직 4단계 화면이 없으므로 에러나 404로 끝나지만, Keep log 덕분에 아래 요청은 Network에 남아 있다.

4. Network 목록에서 이름이 `authorize?client_id=...`인 요청(도메인 `github.com`)을 누르고 **Payload** 탭을 연다. 쿼리 값이 한 줄씩 풀려 보인다.

   > GitHub에 로그인하지 않은 브라우저면 `authorize` 요청 뒤에 `login?client_id=...&return_to=...` 요청이 이어진다. 같은 값이 `return_to` 안에 인코딩돼 있으므로 `authorize` 요청 쪽을 본다.

5. 쿠키는 그보다 앞의 `login` 요청(도메인 `localhost`, 메서드 `POST`)에서 본다. 버튼이 부른 서버 액션 요청이다. **Headers** 탭의 Response Headers에 `set-cookie`가 두 줄 있다. 또는 브라우저의 뒤로 가기로 `localhost:3000/login`에 돌아와 **Application** 탭 → Cookies → `http://localhost:3000`을 열어 HttpOnly·SameSite 칸을 본다.

보이는 것을 정리하면 다음과 같다.

```text
/login/oauth/authorize
  client_id=<Client ID>
  redirect_uri=http://localhost:3000/api/auth/callback/github   # OAuth 앱에 등록한 콜백 주소와 같아야 한다
  response_type=code
  scope=read:user user:email
  code_challenge=<해시>  code_challenge_method=S256              # PKCE

브라우저에 남은 쿠키(localhost:3000)
  authjs.callback-url        httpOnly, SameSite=Lax
  authjs.pkce.code_verifier  httpOnly, SameSite=Lax              # ③에서 낼 원래 값
```

| 볼 것 | 맞는지 무엇과 대조하나 |
|---|---|
| `client_id` | 프론트 `.env.local`의 `AUTH_GITHUB_ID`, GitHub 앱 화면의 Client ID |
| `redirect_uri` | 1장 작업 3에서 등록한 Authorization callback URL. 한 글자라도 다르면 GitHub 화면에 `redirect_uri is not associated` |
| `code_challenge`·`code_challenge_method=S256` | 있기만 하면 된다. 값은 누를 때마다 바뀐다 |
| 주소 어디에도 없는 것 | `code_verifier`와 Client secret. 하나는 쿠키에, 하나는 Next 서버에만 있다 |

`code_verifier`는 httpOnly 쿠키라 페이지의 JS가 읽을 수 없다.

`SameSite=Lax`인 이유는 GitHub(다른 사이트)에서 돌아오는 이동(②)에도 쿠키가 실려야 하기 때문이다. `03`의 refresh 쿠키는 다른 사이트에서 시작된 요청에 실릴 일이 없으므로 `Strict`였다.

### 남길 것

- **찾아보면 되는 것**: `NextAuth` 설정 칸, `[...이름]` catch-all 경로, `declare module` 보강 문법, `/api/auth/*` 주소 목록, 개발자 도구 Network의 Keep log·Payload. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - `session` 콜백이 돌려주는 값은 브라우저가 읽는다. 그곳에는 브라우저에 줘도 되는 것(일회용 코드)만 담고, 외부 서비스 토큰은 서버에서 쓰고 버린다.

  - 개발 서버에서 되던 것이 운영 빌드에서만 깨질 수 있다(`UntrustedHost`). 인증처럼 주소를 다루는 기능은 운영 빌드로 확인한다.

  - Auth.js는 설정 문제를 응답에 싣지 않는다. 응답이 `There was a problem with the server configuration`뿐이면 원인은 Next 서버 로그의 `[auth][error] <오류 이름>`에서 찾는다.

- **에러 신호**:

  - `/api/auth/*`가 `There was a problem with the server configuration`, 서버 로그에 `MissingSecret` → 프론트 `.env.local`에 `AUTH_SECRET`이 있는지, 넣은 뒤 서버를 다시 띄웠는지

  - `[auth][error] UntrustedHost: Host must be trusted`(Network에 `POST /api/auth/signin/github` 500) → 프론트 `.env.local`에 `AUTH_URL`이 있는지

  - `[auth][error] UnknownAction: Unsupported action`(`at Object.signin`) → `/api/auth/signin/github`를 GET으로 열었다. 실패한 탭을 새로고침했다면 무시하고 `/login`부터 다시 한다

  - `error TS2339: Property 'exchangeCode' does not exist on type 'Session'.` → `types/next-auth.d.ts`가 있는지

  - `error TS2339: Property 'expires' does not exist on type 'Session'.` → `types/next-auth.d.ts` 맨 위의 `import` 두 줄을 지웠는지

  - `curl localhost:3000/api/auth/providers`가 404 → `app/api/auth/[...nextauth]/route.ts`의 폴더 이름과 위치

  - `/api/auth/session`의 JSON에 GitHub 토큰이 보인다 → `session` 콜백에 토큰을 넣었는지

## 5. 4단계: 코드를 우리 토큰으로 바꾸는 화면

GitHub에서 돌아오면(`redirectTo: "/auth/github/complete"`) 서버 컴포넌트가 Auth.js 세션에서 코드를 꺼낸다.

### 작업 1. [커밋] 완료 화면(서버 컴포넌트)

```tsx
// app/auth/github/complete/page.tsx
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { ExchangeCode } from "./exchange-code";

// GitHub에서 돌아온 직후의 화면. 서버에서 Auth.js 세션의 일회용 코드를 꺼내 브라우저 쪽 컴포넌트에 넘긴다
export default async function GithubCompletePage() {
  // 요청마다 그린다는 표시. 없으면 cacheComponents가 auth() 안의 난수 생성을 미리 그리기(prerender) 중에 만나 에러를 찍는다
  await connection();
  const session = await auth();
  if (!session?.exchangeCode) redirect("/login");
  return (
    <main>
      <h1>GitHub 로그인</h1>
      <ExchangeCode code={session.exchangeCode} />
    </main>
  );
}
```

`auth()`는 서버에서 Auth.js 세션 쿠키를 풀어 `session` 콜백의 결과를 돌려준다. 이 화면은 서버 컴포넌트라서 세션을 읽을 수 있지만, 브라우저에 붙을 refresh 쿠키를 받을 수는 없다(0장 개념 1).

그래서 코드만 꺼내 브라우저 쪽 컴포넌트에 넘긴다.

### 개념 | `await connection()`: "이 화면은 요청이 와야 그린다"

`auth()` 첫 줄 앞의 `await connection()`을 빼면 화면은 동작하지만, 운영 서버 로그에 요청마다 이런 에러가 찍힌다.

```text
Error: Route "/auth/github/complete": Next.js encountered the unstable value `crypto.getRandomValues()` while prerendering.
...
  - [dynamic] Render at request time by adding a dynamic data access (e.g. `await connection()`) before this call
```

`cacheComponents`(`05`)를 켠 Next는 화면을 되도록 미리 그려 두려 한다(prerender). 쿠키를 읽는 화면도 "쿠키까지 넣어서 미리 그려 볼 수 있는가"를 시험한다. 그런데 `auth()`는 안에서 CSRF 토큰 같은 난수를 만든다(`crypto.getRandomValues()`). 난수는 그릴 때마다 달라지므로 미리 그려 둘 수 없는 값이고, Next는 그 지점에서 멈추고 에러를 찍는다.

`await connection()`은 "여기서부터는 실제 요청이 들어와야 그린다"는 표시다. 그 아래의 `auth()`는 미리 그리기 대상에서 빠지므로 난수를 만들어도 문제가 없다. 에러 메시지가 제안하는 세 방법 중 `[dynamic]`에 해당한다. 로그인 결과를 다루는 화면이라 `[cache]`(결과를 캐시)는 맞지 않고, `[client]`는 세션을 서버에서 읽는다는 이 화면의 목적과 어긋난다.

> 응답은 여전히 `200` + 본문의 `NEXT_REDIRECT`다(작업 5). 바뀌는 것은 로그의 에러뿐이다.

### 작업 2. [커밋] 코드를 내는 클라이언트 컴포넌트

```tsx
// app/auth/github/complete/exchange-code.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { exchangeCode } from "@/lib/api-client";
import { endAuthjsSession } from "./actions";

// 일회용 코드를 브라우저가 직접 Nest에 낸다 → refresh 쿠키가 비밀번호 로그인 때와 똑같이 브라우저에 붙는다
export function ExchangeCode({ code }: { code: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // 개발 모드(StrictMode)는 effect를 일부러 두 번 돌린다 → 일회용 코드를 두 번 내면 두 번째는 401이다(이 문서 4단계)
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await exchangeCode(code);
        await endAuthjsSession();
        router.replace("/shop");
      } catch (e) {
        setError(e instanceof Error ? e.message : "알 수 없는 오류");
      }
    })();
  }, [code, router]);

  if (error) return <p role="alert">로그인을 마무리하지 못했습니다: {error}</p>;
  return <p>로그인을 마무리하는 중...</p>;
}
```

`router.replace`는 `push`와 달리 지금 주소를 기록에서 바꿔치기한다. 뒤로 가기를 눌러도 이미 쓴 코드의 화면으로 돌아오지 않는다.

맨 첫 줄의 `"use client"`는 빠뜨리면 안 된다. 이 파일을 가져다 쓰는 `page.tsx`는 서버 컴포넌트다. `app/` 아래 파일은 표시가 없으면 서버 컴포넌트로 취급되므로, 이 줄이 없으면 이 파일도 서버에서 그려질 컴포넌트가 된다. 서버 컴포넌트는 한 번 그려서 HTML로 보내고 끝이라 `useState`·`useEffect`·`useRouter`처럼 브라우저에서 계속 살아 있어야 하는 기능을 쓸 수 없다.

```text
> Build error occurred
./order-console-next/app/auth/github/complete/exchange-code.tsx:2:10
Error: You're importing a module that depends on `useEffect` into a React Server Component module. ...
Import trace:
  Server Component:
    ./order-console-next/app/auth/github/complete/exchange-code.tsx
    ./order-console-next/app/auth/github/complete/page.tsx
```

`Import trace`의 `Server Component:` 아래 목록이 "서버 컴포넌트로 취급된 파일"이다. 거기 `exchange-code.tsx`가 있으면 그 파일 첫 줄을 본다. 개발 서버는 이 화면을 처음 열 때에야 같은 에러를 내므로, 화면을 열어 보기 전까지는 `next build`에서 먼저 드러나기 쉽다.

### 작업 3. [커밋] Auth.js 세션을 지우는 서버 액션

```ts
// app/auth/github/complete/actions.ts
"use server";

import { signOut } from "@/auth";

// 우리 토큰으로 갈아탄 뒤 Auth.js 세션 쿠키를 지운다 - 로그인 상태는 한 곳(Nest 토큰)에서만 관리한다
export async function endAuthjsSession() {
  await signOut({ redirect: false });
}
```

### 작업 4. [커밋] `api-client.ts`에 `exchangeCode` 더하기

```ts
// lib/api-client.ts
// login 아래에 함수 하나를 더한다
// GitHub 로그인 뒤 받은 일회용 코드를 우리 토큰으로 바꾼다. 응답 처리는 login과 같다
export async function exchangeCode(code: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    credentials: "include",
  });
  const { accessToken } = await parse<{ accessToken: string }>(res);
  useAuthStore.getState().setAccessToken(accessToken);
}
```

`parse`와 `useAuthStore`는 같은 파일에 이미 있다(`05`). `parse`는 실패 응답의 `message`를 `ApiError`로 던지므로, 401이면 화면에 "로그인을 마무리하지 못했습니다: 코드가 없거나, 이미 썼거나, 만료됐습니다"가 뜬다.

`credentials: "include"`가 빠지면 응답의 `Set-Cookie`를 브라우저가 버린다. 로그인은 된 것처럼 보이지만 새로고침하면 풀린다.

### 개념 | `useRef`로 한 번만

개발 모드의 React는 버그를 찾으라고 effect를 일부러 한 번 더 실행한다(StrictMode). 보통은 같은 요청을 두 번 보내도 결과가 같아서 티가 안 난다.

일회용 코드는 다르다. 두 번째 요청은 2단계의 규칙대로 401이다.

그래서 컴포넌트가 다시 실행돼도 남아 있는 `ref`에 "이미 시작했다"를 적어 둔다.

| 저장 위치 | 다시 그려질 때 | 값을 바꾸면 |
|---|---|---|
| 지역 변수 | 매번 새로 만들어진다 | 아무 일 없다 |
| `useState` | 남아 있다 | 다시 그린다 |
| `useRef` | 남아 있다 | 다시 그리지 않는다 |

"이미 시작했다"는 화면에 보일 값이 아니고 다시 그릴 이유도 없으므로 `useRef`가 맞다. C로 치면 함수 안의 `static int started`와 비슷하다(다만 컴포넌트 인스턴스마다 따로다).

### 개념 | Auth.js 세션 지우기

코드를 바꾼 뒤 `signOut({ redirect: false })`로 Auth.js 쿠키를 지운다. 0장 개념 2대로 로그인 상태는 Nest 토큰 하나뿐이다.

`redirect: false`는 "지우기만 하고 다른 화면으로 보내지 마라"다. 화면 이동은 바로 다음 줄의 `router.replace("/shop")`가 한다.

> 로그아웃은 `03`의 로그아웃 버튼 그대로다.

### 작업 5. [확인] 세션 없이 이 화면을 열어 확인

세션 없이 이 화면을 열면 `/login`으로 돌려보낸다.

3단계에서 띄운 운영 서버(`npm run start`)가 아직 떠 있다면 먼저 내리고 다시 빌드한다. 운영 서버는 빌드할 때 있던 화면만 안다. 작업 1~4에서 더한 `/auth/github/complete`는 예전 빌드에 없으므로, 다시 빌드하지 않으면 아래 `curl`이 `200` 대신 `404`를 돌려준다. 개발 서버(`npm run dev`)는 요청이 올 때 그 자리에서 컴파일하므로 이 일이 없다.

```sh
# ./order-console-next
npm run build && npm run start
```

```sh
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" localhost:3000/auth/github/complete
200
curl -s localhost:3000/auth/github/complete | grep -o 'NEXT_REDIRECT;[a-z]*;/[a-z]*;[0-9]*'
NEXT_REDIRECT;replace;/login;307
```

`redirect("/login")`을 불렀는데 상태 코드는 `200`이고 `Location`도 없다. 정상이다. 돌려보내라는 지시는 응답 헤더가 아니라 본문 안에 들어 있다.

이 프로젝트는 `next.config.ts`에서 `cacheComponents: true`(`05`)를 켜 두었다. 이 설정에서 Next는 화면을 둘로 나눠 보낸다.

| 순서 | 무엇 | 이 화면에서 |
|---|---|---|
| 1 | 미리 만들어 둔 정적인 겉모양(shell). 상태 코드와 헤더가 이때 나간다 | 레이아웃. `200`이 이때 정해진다 |
| 2 | 요청마다 달라지는 부분. 같은 응답에 이어서 흘려보낸다(streaming) | `auth()`가 쿠키를 읽는 `page.tsx`. 여기서 `redirect`가 불린다 |

`redirect`가 불린 때는 이미 1에서 `200`과 헤더를 보낸 뒤다. HTTP 응답은 헤더를 한 번 보내면 바꿀 수 없으므로, Next는 이어지는 본문에 `NEXT_REDIRECT;replace;/login;307`이라는 지시를 싣는다. 브라우저에서는 React가 이걸 읽고 `/login`으로 옮긴다. 그래서 브라우저로 열면 `/login`으로 가고, 헤더만 보는 `curl`에는 `200`만 보인다.

응답 헤더의 `x-nextjs-postponed: 1`이 "뒷부분을 미뤄 두었다가 이어서 보냈다"는 표시다(`curl -sI`로 본다).

> `cacheComponents`를 끈 프로젝트라면 `page.tsx`를 다 그린 뒤에 헤더를 보내므로 `307`과 `Location: /login`이 그대로 나온다. 다른 글에서 `307`을 기대하는 예제를 보면 이 차이다.

확인할 것은 두 가지다. 브라우저로 `http://localhost:3000/auth/github/complete`를 열면 `/login`으로 가는지, `grep` 결과에 `/login`이 있는지.

### 남길 것

- **찾아보면 되는 것**: `auth()`, `signOut({ redirect: false })`, `router.replace`, `useRef`, `connection()`, `"use client"`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 쿠키는 그 응답을 받은 쪽에 붙는다. 브라우저에 붙어야 할 쿠키를 주는 요청은 브라우저가 직접(`credentials: "include"`) 보낸다.

  - 한 번만 실행돼야 하는 effect는 개발 모드에서 두 번 돈다고 생각하고 `useRef`로 막는다.

  - 운영 서버는 빌드할 때 있던 것만 안다. 화면을 더하거나 고쳤으면 `npm run build`부터 다시 한다.

  - `cacheComponents`에서는 겉모양을 먼저 보내므로 `redirect`가 상태 코드가 아니라 본문으로 전달된다. `curl`의 `200`만 보고 판단하지 않는다.

- **에러 신호**:

  - 운영 서버 로그에 ``Next.js encountered the unstable value `crypto.getRandomValues()` while prerendering`` → `page.tsx`에서 `auth()` 앞의 `await connection()`이 빠졌다

  - `next build`가 ``You're importing a module that depends on `useEffect` into a React Server Component module``(Import trace에 `Server Component: .../exchange-code.tsx`) → `exchange-code.tsx` 맨 첫 줄의 `"use client"`가 빠졌다

  - `/auth/github/complete`가 `404` → 이 화면을 만들기 전의 빌드로 운영 서버가 떠 있다. `npm run build`부터 다시 한다

  - 화면에 "로그인을 마무리하지 못했습니다: 코드가 없거나, 이미 썼거나, 만료됐습니다" → 60초가 지났거나, `useRef` 가드가 빠져 같은 코드를 두 번 냈다

  - `/auth/github/complete`가 바로 `/login`으로 간다(`curl`로는 `200` + 본문의 `NEXT_REDIRECT;replace;/login`) → Auth.js 세션에 `exchangeCode`가 없다. `jwt` 콜백이 코드를 받았는지, 이미 `signOut`된 뒤인지

  - 로그인은 되는데 새로고침하면 풀린다 → `/auth/exchange`를 브라우저가 직접 `credentials: "include"`로 불렀는지

## 6. 5단계: 실제로 로그인하기

### 작업 1. [실행] 브라우저로 로그인

백엔드(`npm run start:dev`)와 프론트(`npm run build && npm run start`)를 띄운다.

1. 브라우저에서 `http://localhost:3000/login`을 연다.

2. "GitHub로 로그인"을 누른다.

3. (처음이면) GitHub 승인 화면에서 "Authorize"를 누른다.

잠깐 "로그인을 마무리하는 중..."이 보이고 `/shop`으로 넘어가며, 내비게이션에 "로그아웃"이 보인다. "내 주문"은 새 사용자라 비어 있다.

### 작업 2. [확인] 서버 쪽에서 확인

서버 쪽에서 확인한다(GitHub 숫자 id와 로그인 이름은 `<...>`로 가렸다).

```text
# Nest 요청 로그(request completed 줄의 method, url, statusCode)
14:08:05.557 POST /auth/github 200
14:08:05.730 POST /auth/exchange 200
```

```sh
# ./order-api-nest
docker compose exec -T db psql -U order -d order_api -c \
  "SELECT id, name, github_id IS NOT NULL AS has_github, password_hash IS NULL AS no_password FROM users WHERE github_id IS NOT NULL"
        id         |      name       | has_github | no_password
 github-<숫자 id>  | <GitHub 로그인> | t          | t

docker compose exec -T db psql -U order -d order_api -c \
  "SELECT user_id, revoked_at IS NULL AS active, count(*) FROM refresh_tokens WHERE user_id LIKE 'github-%' GROUP BY 1,2"
     user_id       | active | count
 github-<숫자 id>  | t      |     1

docker compose exec -T redis redis-cli --scan --pattern 'auth-code:*' | wc -l
0  # 코드는 쓰자마자 사라졌다
```

`/auth/github`에서 `/auth/exchange`까지 0.17초. 그 사이에 GitHub 확인, 사용자 만들기, 코드 발급, 브라우저로 넘기기, 코드 교환이 모두 끝났다.

이 사용자는 `password_hash`가 없으므로 아이디·비밀번호 로그인으로는 들어올 수 없다.

`03`의 `login`은 `!user?.passwordHash`면 비밀번호가 틀렸을 때와 같은 401 `id 또는 password가 틀렸다`를 돌려준다.

### 개념 | 요청 로그를 읽기 좋게: 남기는 것과 보는 것을 나눈다

위의 Nest 로그는 요약한 모양이다. 실제 터미널에는 한 요청이 이렇게 찍힌다.

```text
[23:51:13.550] INFO (85293): request completed {"req":{"id":"8467fb1b-...","method":"POST","url":"/auth/github","query":{},"params":{...},"headers":{"host":"localhost:4000",...}},"res":{"statusCode":200,"headers":{...}},"responseTime":435}
```

이걸 매번 눈으로 걸러 읽는 것이 정상은 아니다. 로그는 "남기는 것"과 "보는 것"을 나눠서 다룬다.

- **남기는 것은 다 남긴다.** pino가 요청·응답을 JSON 한 덩어리로 찍는 것은 로그 수집 도구(Loki, CloudWatch, Datadog ...)가 필드로 검색하라는 뜻이다. 운영에서는 원문을 읽지 않고 `req.url = "/auth/exchange" AND res.statusCode >= 400` 같은 조건으로 걸러 본다. 위의 요약도 이 줄에서 `req.method`, `req.url`, `res.statusCode`만 뽑은 것이다.

- **보는 것은 개발 터미널에서만 줄인다.** 위 모양은 `src/app.module.ts`의 `pinoHttp.transport`(`pino-pretty`, `singleLine: true`)가 만든다. 운영(`NODE_ENV=production`)에는 `transport`가 없어서 JSON 그대로 나간다.

줄이는 방법은 둘이다. 이 문서는 지금 구조에서 손을 덜 대는 쪽(설정을 파일로 빼고 개발 터미널 출력만 줄이기)을 작업 3에서 하고, 다른 하나는 그 뒤의 개념에서 비교한다.

### 작업 3. [커밋] 로거 설정을 파일로 빼고 개발 터미널 출력 줄이기

`app.module.ts`는 모듈을 조립하는 곳(composition root)이라, 설정 내용이 길어지면 별도 파일로 빼는 것이 Nest에서 흔한 정리 방식이다. 이름은 "유틸 함수"보다 "설정"이 맞다. 무언가를 계산하는 함수가 아니라 `LoggerModule`에 넘길 값이기 때문이다.

`app.module.ts`에 있던 `pinoHttp` 설정을 그대로 옮기고, `customSuccessMessage`와 `transport.options.ignore` 두 가지만 더한다.

```ts
// src/logger/logger.options.ts
import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';

const isProd = process.env.NODE_ENV === "production";

export const loggerOptions: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? "info",
    genReqId: (req, res) => {
      const id = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
    // "request completed" 대신 요약을 메시지로 쓴다. req·res 원본은 그대로 남는다
    customSuccessMessage: (req, res, responseTime) => `${req.method} ${req.url} ${res.statusCode} ${responseTime}ms`,
    // 개발 터미널에서만 req·res 덩어리를 숨긴다. err(스택)는 계속 보인다. 운영은 transport 없이 JSON 그대로
    transport: isProd ? undefined : {
      target: "pino-pretty",
      options: { singleLine: true, ignore: "pid,hostname,req,res,responseTime" },
    },
  },
};
```

```ts
// src/app.module.ts
// randomUUID import를 지우고, LoggerModule.forRoot({ ... }) 전체를 한 줄로 바꾼다
import { LoggerModule } from 'nestjs-pino';
import { loggerOptions } from './logger/logger.options.js';
// ... 나머지 import 그대로 ...

@Module({
  imports: [
    LoggerModule.forRoot(loggerOptions),
    PrismaModule, StorageModule, /* ... 그대로 ... */],
  // ... 그대로 ...
})
export class AppModule {}
```

서버를 다시 띄우고 요청 두 개를 보내 본다.

```sh
# ./order-api-nest
npm run start:dev
```

```sh
curl -s -o /dev/null localhost:4000/products
curl -s -o /dev/null -X POST localhost:4000/auth/exchange -H 'Content-Type: application/json' -d '{"code":"x"}'
```

```text
[00:24:49.889] INFO: GET /products 200 79ms
[00:24:49.908] INFO: POST /auth/exchange 401 2ms
```

- 401도 `INFO`로 찍힌다. pino-http는 5xx나 예외가 난 요청만 `ERROR`로 올리고, 나머지는 "요청이 끝났다"는 같은 수준으로 남긴다. 4xx는 클라이언트가 틀린 것이라 서버 입장에서는 정상 처리다.

- `Mapped {...} route`처럼 요청이 아닌 로그는 메시지 뒤의 작은 JSON(`{"context":"RouterExplorer"}`)이 그대로 보인다. `ignore`는 `req`·`res` 같은 이름의 칸만 숨긴다.

- 운영(`NODE_ENV=production`)이나 컨테이너에서는 `transport`가 없으므로 `req`·`res`를 포함한 JSON 한 줄이 그대로 나간다. 메시지(`msg`)만 `"request completed"`에서 `"GET /products 200 79ms"`로 바뀐다.

### 개념 | 다른 방법: 앱은 JSON만 내고, 보기 좋게 만드는 일은 앱 밖에서

pino가 권하는 쪽은 이것이다. 앱 코드에는 `transport`를 두지 않고 언제나 JSON만 내며, 개발할 때만 출력을 `pino-pretty` 명령에 파이프(`|`)로 넘긴다. 보기 좋게 바꾸는 일이 앱 프로세스 밖으로 나가므로, 앱 코드에 "개발이면/운영이면" 분기가 사라진다.

파이프 명령을 서버를 켤 때마다 손으로 치는 것은 아니다. 한 번 시험해 볼 때만 그렇게 치고, 자리를 잡으면 스크립트와 설정 파일에 넣어 두고 지금처럼 `npm run start:dev`만 친다.

```sh
# ./order-api-nest (읽는 명령. 한 번 시험해 볼 때)
npm run start:dev | npx pino-pretty --singleLine --ignore pid,hostname,req,res,responseTime
```

```jsonc
// package.json (읽는 코드. 자리를 잡은 뒤)
"start:dev": "nest start --watch --env-file .env | pino-pretty",
```

```jsonc
// .pino-prettyrc (읽는 코드. pino-pretty 명령이 실행 폴더에서 찾아 읽는다)
{ "singleLine": true, "colorize": true, "ignore": "pid,hostname,req,res,responseTime" }
```

- 옵션을 `.pino-prettyrc`에 두면 스크립트 줄이 짧아지고, 옵션을 바꿀 때 `package.json`을 건드리지 않는다.

- 파이프가 붙는 것은 `start:dev`뿐이다. `start:prod`와 컨테이너는 파이프 없이 JSON을 그대로 내보내고, 그걸 로그 수집 도구가 받는다.

- 지금 코드에 그대로 파이프만 붙이면 줄여지지 않고 색까지 사라진다. 앱 안의 `transport`가 이미 JSON을 사람용 글자로 바꿔 내보내고, `pino-pretty` 명령은 JSON이 아닌 줄을 손대지 않고 흘려보내기 때문이다. 이 방법으로 가려면 `logger.options.ts`의 `transport`를 먼저 지운다.

- 색은 `colorize`가 정한다. 기본값은 "출력이 터미널이면 켜고, 파이프나 파일이면 끈다"다. 색은 터미널 제어 문자(`\x1b[32m` 같은 것)라서 파일에 섞이면 쓰레기 글자가 되기 때문이다. 파이프를 붙이면 앱 쪽 출력은 터미널이 아니라 파이프로 나가므로, 앱 안의 `pino-pretty`가 스스로 색을 끈다. 위 명령에서 색이 모두 같았던 이유다. 반대로 `pino-pretty` 명령의 출력은 터미널로 가므로 기본으로 색이 켜지지만, 확실히 하려면 `--colorize`(`-c`)를 주거나 `.pino-prettyrc`에 `"colorize": true`를 둔다.

  | 옵션 | 하는 일 |
  |---|---|
  | `colorize` / `-c` | 레벨(`INFO` 초록, `WARN` 노랑, `ERROR` 빨강 ...)과 메시지에 색을 입힌다 |
  | `customColors` | 레벨별 색을 바꾼다. 예: `"customColors": "info:blue,warn:yellow,error:red"` |
  | `colorizeObjects` | 줄 끝 JSON 덩어리에도 색을 입힌다(기본 켜짐) |
  | `levelFirst` | `INFO`를 시각보다 앞에 둬서 레벨로 훑기 쉽게 한다 |

  작업 3처럼 앱 안의 `transport`를 쓸 때도 출력을 파이프로 넘기면 같은 일이 생긴다. 그때는 `transport.options`에 `colorize: true`를 넣는다.

메시지를 요약으로 바꾸는 `customSuccessMessage`는 앱이 남기는 내용이므로 이 방법에서도 앱 설정(`logger.options.ts`)에 둔다.

| | 작업 3(앱 안의 `transport`) | 이 방법(앱 밖의 파이프) |
|---|---|---|
| 바꾸는 곳 | 앱 코드(설정 파일 하나) | 실행 명령, `.pino-prettyrc` |
| 운영 출력 | JSON 그대로(`transport` 없음) | JSON 그대로 |
| 앱 코드의 개발/운영 분기 | 남는다 | 없다 |
| 지금 구조에서 바꿀 양 | 작다 | `transport` 제거 + 스크립트 수정 |

원래 구조(`app.module.ts`에 `transport`가 이미 있었음)에서 손을 덜 대는 쪽이 작업 3이라 그쪽을 골랐다. 처음부터 짠다면 이 방법이 더 깔끔하다. 둘 다 "남기는 것"은 건드리지 않는다는 점이 같다.

### 남길 것

- **찾아보면 되는 것**: `redis-cli --scan --pattern`, `psql -c`로 한 줄 쿼리 보내기, pino-http의 `customSuccessMessage`, pino-pretty의 `ignore`·`colorize`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 로그인 하나가 여러 시스템(GitHub, Nest, Postgres, Redis, 브라우저 쿠키)을 지난다. 끝나고 나면 각 시스템에 남아야 할 것(사용자 행, refresh 사슬 하나)과 남으면 안 되는 것(일회용 코드)을 하나씩 확인한다.

  - 로그는 남기는 것과 보는 것을 나눈다. 남기는 것(운영 JSON)은 줄이지 않고, 보는 것(개발 터미널)만 줄인다.

- **에러 신호**:

  - GitHub 승인 뒤 다시 `/login`으로 돌아온다(주소에 `error` 쿼리) → Next 서버 로그의 `백엔드가 GitHub 로그인을 거절했습니다(<상태 코드>)`와 Nest 로그의 `/auth/github` 상태 코드

  - GitHub 사용자로 아이디·비밀번호 로그인이 401 `id 또는 password가 틀렸다` → 정상이다. 비밀번호가 없는 계정이다

## 7. 6단계: 컨테이너에서

### 작업 1. [커밋] compose에 GitHub 값 넘기기

컨테이너 구성에도 GitHub 값을 넘긴다.

값을 compose 파일에 적으면 커밋된다. 그래서 실행할 때 `.env.local`에서 읽게 한다.

```yaml
# docker-compose.yml
# api 서비스의 environment, OTEL_SERVICE_NAME 아래에 GITHUB_CLIENT_ID·GITHUB_CLIENT_SECRET 두 줄을 설명 주석과 함께 추가한다
      # GitHub OAuth 앱. 값은 파일에 적지 않고 실행할 때 넘긴다: docker compose --env-file .env.local --profile app up
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID:-}           # 없으면 빈 값 → GitHub 로그인만 500, 나머지는 정상
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET:-}
```

### 개념 | `${이름:-}`와 `${이름:?메시지}`

compose 파일의 `${...}`는 compose를 실행하는 셸 환경(과 `--env-file`로 준 파일)에서 값을 꺼내 끼워 넣는다. 컨테이너 안이 아니라 `docker compose` 명령이 도는 쪽에서 일어나는 일이다.

| 쓰는 법 | 값이 없으면 |
|---|---|
| `${이름}` | 빈 값으로 넣고 경고를 찍는다 |
| `${이름:-기본값}` | 기본값을 넣는다. `:-` 뒤가 비었으면 빈 값 |
| `${이름:?메시지}` | 메시지를 내고 compose 명령 전체가 멈춘다 |

`${이름:?메시지}`(값이 없으면 실패)도 쓸 수 있다. 하지만 그러면 `docker compose up -d db`처럼 이 값과 상관없는 명령까지 "값이 없다"며 멈춘다. 직접 해 보면 금방 불편하다(`practice/example-compose-required-env/`).

그래서 빈 값을 허락하고, 값이 필요한 순간(GitHub 로그인)에 `github.ts`가 에러를 내게 했다.

### 작업 2. [확인] 값을 넘겨 띄우고, 빼고 띄워 보기

```sh
# ./order-api-nest
docker compose --env-file .env.local --profile app up -d --build
curl -s -w " %{http_code}\n" -X POST localhost:4000/auth/github -H 'Content-Type: application/json' -d '{"accessToken":"gho_not_a_real_token"}'
{"message":"GitHub 토큰을 확인할 수 없습니다","error":"Unauthorized","statusCode":401} 401
# 값이 들어가 GitHub까지 물어봤다

docker compose --profile app up -d api # --env-file 없이
curl -s -w " %{http_code}\n" -X POST localhost:4000/auth/github -H 'Content-Type: application/json' -d '{"accessToken":"x"}'
{"statusCode":500,"message":"Internal server error"} 500
# 로그: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET 환경변수가 없다
curl -s -o /dev/null -w "%{http_code}\n" localhost:4000/products
200
```

`.env.local`은 루트 `.dockerignore`(`**/.env.*`)에 걸려 이미지에 들어가지 않는다. 컨테이너 안에는 `dist`와 `package.json`뿐이다.

그래서 컨테이너의 `main.ts`에서는 `existsSync('.env.local')`이 거짓이고, 값은 compose가 넘긴 환경변수로만 들어온다.

### 남길 것

- **찾아보면 되는 것**: `docker compose --env-file`, `${이름:-}`와 `${이름:?}`의 차이. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 비밀 값은 이미지에도 compose 파일에도 넣지 않고 실행할 때 넘긴다. 이미지에 들어가지 않는 것은 `.dockerignore`가 보장한다.

  - "값이 없으면 시작부터 실패"는 그 값과 상관없는 일까지 막는다. 필요한 기능에서만 실패하게 할지, 시작부터 막을지는 그 값이 얼마나 핵심인지로 정한다.

- **에러 신호**:

  - 컨테이너에서 `/auth/github`가 500, 로그에 `GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET 환경변수가 없다` → `docker compose`에 `--env-file .env.local`을 줬는지

## 8. 7단계: 테스트

### 작업 1. [커밋] 백엔드: 가짜 GitHub 서버

테스트에서 진짜 GitHub를 부를 수는 없다(토큰을 받으려면 사람이 승인해야 한다).

`github.ts`가 `GITHUB_API_URL`로 주소를 바꿀 수 있게 해 두었으므로, 테스트 안에서 작은 HTTP 서버를 띄워 GitHub 흉내를 낸다.

```ts
// test/github-login.e2e-spec.ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { adminDb } from "./admin-db.js";

// 가짜 GitHub. 두 API를 흉내 낸다
// - GET /user : 토큰이 유효하기만 하면 주인을 알려 준다. "good-token"(우리 앱이 받은 것)과
//               "token-of-another-app"(같은 사람이 다른 앱에 승인해 준 것) 둘 다 같은 사람(4242)이다
// - POST /applications/{client_id}/token : 우리 앱(test-client:test-secret)으로 인증했고 토큰이 우리 앱의 것("good-token")일 때만 200
function startFakeGithub(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "GET" && req.url === "/user") {
        const valid = ["Bearer good-token", "Bearer token-of-another-app"].includes(req.headers.authorization ?? "");
        res.writeHead(valid ? 200 : 401, { "Content-Type": "application/json" });
        res.end(JSON.stringify(valid ? { id: 4242, login: "octo" } : { message: "Bad credentials" }));
        return;
      }
      const appAuth = `Basic ${Buffer.from("test-client:test-secret").toString("base64")}`;
      const ok =
        req.method === "POST" &&
        req.url === "/applications/test-client/token" &&
        req.headers.authorization === appAuth &&
        JSON.parse(body || "{}").access_token === "good-token";
      res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ok ? { user: { id: 4242, login: "octo" } } : { message: "Not Found" }));
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

describe("GitHub 로그인 - 회귀 테스트", () => {
  let app: INestApplication;
  let baseUrl: string;
  let github: Server;

  beforeAll(async () => {
    github = await startFakeGithub();
    process.env.GITHUB_API_URL = `http://localhost:${(github.address() as AddressInfo).port}`;
    process.env.GITHUB_CLIENT_ID = "test-client";
    process.env.GITHUB_CLIENT_SECRET = "test-secret";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    await app.close();
    github.close();
    await adminDb.$disconnect();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const codeFor = async (accessToken: string) => (await (await post("/auth/github", { accessToken })).json()).code as string;

  it("우리 앱의 토큰이면 사용자를 만들고, 코드를 토큰으로 바꿔 내 주문까지 볼 수 있다", async () => {
    const code = await codeFor("good-token");
    const res = await post("/auth/exchange", { code });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toMatch(/^refresh_token=.*HttpOnly/);
    const { accessToken } = await res.json();

    const me = await fetch(`${baseUrl}/me/orders`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(me.status).toBe(200);
    expect(await adminDb.user.findUnique({ where: { githubId: "4242" } })).toMatchObject({ id: "github-4242", name: "octo", passwordHash: null });
  });

  it("다시 로그인해도 같은 사용자다(GitHub id로 찾는다)", async () => {
    await codeFor("good-token");
    await codeFor("good-token");
    expect(await adminDb.user.count()).toBe(1);
  });

  it("같은 사람의 토큰이라도 다른 앱이 받은 것이면 401이고 사용자를 만들지 않는다", async () => {
    const res = await post("/auth/github", { accessToken: "token-of-another-app" });
    expect(res.status).toBe(401);
    expect((await post("/auth/github", { accessToken: "made-up" })).status).toBe(401);
    expect(await adminDb.user.count()).toBe(0);
  });

  it("코드는 한 번만 쓸 수 있다", async () => {
    const code = await codeFor("good-token");
    expect((await post("/auth/exchange", { code })).status).toBe(200);
    expect((await post("/auth/exchange", { code })).status).toBe(401);
  });

  it("같은 코드로 동시에 여러 번 내도 하나만 성공한다", async () => {
    const code = await codeFor("good-token");
    const statuses = await Promise.all(Array.from({ length: 10 }, () => post("/auth/exchange", { code }).then((r) => r.status)));
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
  });
});
```

```sh
# ./order-api-nest
npm run test:e2e
 Test Files  7 passed (7)
      Tests  22 passed (22)
   Start at  00:31:54
   Duration  6.61s (transform 197ms, setup 29ms, import 3.00s, tests 2.97s, environment 0ms)
```

> 1단계와 2단계의 깨뜨려보기(실험 ①·②)는 각각 세 번째, 다섯 번째 테스트가 잡는다.

#### 다시 돌려 확인

1단계 실험 ①이나 2단계 실험 ②로 코드를 바꾼 채 `npm run test:e2e`를 돌리면 위에서 본 `AssertionError`가 난다. 원복하면 다시 22개가 통과한다.

### 개념 | 가짜 서버에 값을 넣는 순서와 `.env.local`

테스트는 `main.ts`의 `bootstrap()`을 거치지 않는다. `Test.createTestingModule({ imports: [AppModule] })`으로 모듈만 조립하므로, `main.ts` 맨 앞의 `.env.local` 읽기도 돌지 않는다.

그래서 진짜 GitHub 값이 테스트에 섞여 들어올 일이 없다. 테스트가 쓰는 값은 `beforeAll`이 `process.env`에 직접 넣은 세 개뿐이다.

- `server.listen(0)`: 포트 0은 "아무 빈 포트나"라는 뜻이다. 실제 포트는 `github.address()`로 알아내 `GITHUB_API_URL`에 넣는다. 다른 테스트나 개발 서버와 포트가 겹치지 않는다.

- `verifyGithubToken`은 `process.env`를 호출할 때마다 읽는다(1단계 작업 3). 그래서 `beforeAll`에서 값을 바꾸는 방식이 통한다. 모듈 맨 위에서 `const clientId = process.env...`로 한 번만 읽었다면, import되는 순간의 값(없음)이 굳어 버린다.

- `main.ts`가 하던 `cookieParser`·`ValidationPipe` 설정도 테스트에서 직접 다시 한다. 빠뜨리면 `getSetCookie()`나 DTO 검증이 실제 서버와 다르게 동작한다.

- 가짜 서버는 "진짜 GitHub처럼 동작한다"는 가정 위에 있다. 404·422 규칙처럼 GitHub 문서에 적힌 동작만 흉내 내고, 진짜 승인 흐름은 5단계처럼 손으로 확인한다.

### 작업 2. [커밋] 프론트: GitHub로 보내는 주소

프론트 테스트도 GitHub에 가지 않는다. `github.com`으로 가는 요청을 가로채 빈 화면을 돌려주고, 보내려던 주소만 검사한다.

```ts
// e2e/github-login.spec.ts
import { expect, test } from "@playwright/test";

test("GitHub로 로그인을 누르면 PKCE를 붙여 GitHub 인가 화면으로 보낸다", async ({ page }) => {
  // 실제 GitHub에는 가지 않는다 - github.com으로 가는 요청을 가로채 빈 화면을 돌려주고, 보내려던 주소만 검사한다
  await page.route("https://github.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "stub" }));
  await page.goto("/login");
  const [request] = await Promise.all([
    page.waitForRequest((req) => req.url().startsWith("https://github.com/login/oauth/authorize")),
    page.getByRole("button", { name: "GitHub로 로그인" }).click(),
  ]);

  const params = new URL(request.url()).searchParams;
  expect(params.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/github"); // OAuth 앱에 등록한 콜백 주소와 같아야 한다
  expect(params.get("response_type")).toBe("code");
  expect(params.get("code_challenge_method")).toBe("S256"); // PKCE
  expect(params.get("client_id")).toBeTruthy();

  // 돌아왔을 때 PKCE 검증에 쓸 값은 httpOnly 쿠키로 브라우저에 남아 있다
  const cookies = await page.context().cookies("http://localhost:3000");
  expect(cookies.find((c) => c.name === "authjs.pkce.code_verifier")?.httpOnly).toBe(true);
});

test("Auth.js 세션 없이 완료 화면을 열면 로그인 화면으로 돌려보낸다", async ({ page }) => {
  await page.goto("/auth/github/complete");
  await expect(page).toHaveURL(/\/login$/);
});
```

`Promise.all`로 "요청을 기다리기"와 "클릭"을 같이 거는 이유는 순서 때문이다. 클릭한 뒤에 기다리기 시작하면 그 사이에 요청이 이미 지나가 버릴 수 있다.

### 작업 3. [커밋] 기존 테스트의 로그인 버튼 찾기 고치기

이 버튼을 더하고 기존 테스트를 돌리면 로그인하는 테스트가 전부 깨진다.

```text
Error: locator.click: Error: strict mode violation: getByRole('button', { name: '로그인' }) resolved to 2 elements:
```

`getByRole("button", { name: "로그인" })`은 이름에 "로그인"이 들어간 버튼을 찾으므로 "GitHub로 로그인"도 걸린다. Playwright는 하나를 골라 누르지 않고 멈춘다(strict mode).

로그인 버튼을 누르는 줄은 파일 네 개에 하나씩 있다. **네 곳을 모두** 바꾼다. `shop.spec.ts`만 고치면 나머지 세 파일의 테스트 4개가 같은 에러로 깨진다.

| 파일 | 줄이 있는 곳 |
|---|---|
| `e2e/shop.spec.ts` | 맨 위 로그인 도우미 함수 |
| `e2e/offline.spec.ts` | "로그인이 필요한 응답은 캐시하지 않는다" 테스트 안 |
| `e2e/trpc.spec.ts` | 테스트 맨 앞 |
| `e2e/upload.spec.ts` | `loginAsKim` 도우미 함수 |

```ts
// 네 파일 모두 같은 줄. name 옆에 exact: true만 더한다
  await page.getByRole("button", { name: "로그인", exact: true }).click();
```

빠진 곳이 없는지 찾아 본다. `exact`가 없는 줄이 하나도 안 나오면 된다.

```sh
# ./order-console-next
grep -n 'name: "로그인" }' e2e/*.spec.ts
```

```sh
# ./order-console-next
npm run test:e2e
  11 passed
```

Playwright는 테스트를 돌릴 때마다 `test-results/`에 결과(`.last-run.json`, 실패한 테스트의 기록)를 남긴다. 돌릴 때마다 다시 만들어지는 결과물이라 커밋하지 않는다. Next 템플릿의 `.gitignore`에는 이 폴더가 없으므로 더한다.

```sh
# order-console-next/.gitignore
# "# testing" 아래 /coverage 다음에 설명 주석과 함께 한 줄을 더한다
# Playwright가 테스트를 돌릴 때마다 다시 만드는 결과(.last-run.json, 실패 기록)
/test-results
```

이미 `git add`로 올라간 뒤라면 `.gitignore`만으로는 빠지지 않는다. `git restore --staged test-results`로 내린다.

### 작업 4. [커밋] `shop.spec.ts`에서 서비스 워커 막기

위까지 하면 대부분 11개가 통과한다. 하지만 전체를 여러 번 돌리면 서너 번에 한 번꼴로 `shop.spec.ts`의 결제 테스트 하나가 깨진다. 이 문서의 코드와 상관없이 숨어 있던 문제다.

```text
✘  8 e2e/shop.spec.ts:55:5 › 결제 응답이 중간에 사라져 다시 눌러도 주문은 하나만 생긴다 (5.6s)
    Error: expect(locator).toBeVisible() failed
    Locator: getByText(/결제 실패/)
```

이 테스트는 `page.route`로 첫 번째 결제 응답을 끊어(`connectionreset`) "결제 실패"를 띄운 뒤, 다시 눌러 주문이 하나만 생기는지 본다. 깨질 때의 화면(`test-results/.../error-context.md`)에는 "결제 실패" 대신 `결제 완료: 주문 #15`가 떠 있고, DB에도 그 주문이 생겨 있다. 첫 결제가 끊기지 않고 그대로 성공했다는 뜻이다.

원인을 좁히려고 이 테스트에 `page.on("request")`, `context.on("request")`, `page.route` 안에 기록을 남겨 반복해 돌렸다. 통과할 때는 `POST /auth/refresh` → `POST /orders/checkout`(가로챔) → 끊김 → 다시 `POST /orders/checkout`(201)이 모두 찍힌다. 깨질 때는 **결제 요청이 하나도 찍히지 않았다.** 요청은 서버에 닿았는데(주문이 생겼다) Playwright는 그 요청을 보지도, 가로채지도 못한 것이다.

Playwright가 볼 수 없는 경로로 나간 요청이다. 이 앱에는 `11`의 서비스 워커(`public/sw.js`)가 있고, 테스트는 `/login` → `/shop` → `/me/orders` → `/shop`으로 옮겨 다니는 동안 서비스 워커가 설치되고 페이지를 넘겨받는다(`clients.claim()`). Playwright 문서도 `page.route`는 서비스 워커가 가로챈 요청을 다루지 못하니, 요청을 가로채는 테스트에서는 `serviceWorkers: "block"`으로 서비스 워커를 끄라고 권한다. 그래서 이 파일에서만 서비스 워커를 막아 봤다.

```ts
// e2e/shop.spec.ts
// 맨 위 import 아래에 설명 주석과 함께 한 줄을 더한다
import { expect, test, type Page } from "@playwright/test";

// 이 파일은 page.route로 요청을 가로챈다. 서비스 워커가 페이지를 넘겨받는 순간에 나간 요청은 page.route를 거치지 않으므로 막는다
test.use({ serviceWorkers: "block" });
```

| | 전체 e2e 반복 | 결제 테스트가 깨진 횟수 |
|---|---|---|
| 막기 전 | 8번 | 2번 |
| 막은 뒤 | 12번(재고가 바닥나 다른 이유로 깨진 1번은 뺐다) | 0번 |

- `test.use`는 그 파일의 테스트에만 적용된다. 서비스 워커가 있어야 하는 `offline.spec.ts`는 그대로 서비스 워커를 쓴다. `shop.spec.ts`의 테스트는 장바구니, 재고, refresh, 결제 멱등성을 보는 것이라 서비스 워커가 없어도 확인하려는 것이 같다.

- 막기 전에도 대부분 통과했으므로 "한 번 돌려 통과"로는 이 문제를 알 수 없다. `page.route`로 가로채는 테스트가 가끔 이유 없이 실제 요청을 보낸 것처럼 굴면, 서비스 워커부터 의심한다.

- 원인 쪽 설명(서비스 워커가 넘겨받는 순간의 요청이 `page.route`를 건너뛴다)은 관찰과 Playwright 문서의 경고로 좁힌 것이다. 브라우저 안에서 정확히 어느 순간에 갈리는지까지는 확인하지 않았다.

> 같은 테스트를 여러 번 돌리면 마우스 재고가 매번 줄어든다(한 번에 3개 안팎). 재고가 0이 되면 `담기`가 안 되어 shop 테스트가 시간 초과(`Test timeout of 30000ms exceeded`)로 줄줄이 깨진다. 이건 다른 문제다. `npx prisma db seed`(1장 작업 2)로 처음 상태로 돌린다.

실제 GitHub 승인까지 가는 흐름은 자동 테스트로 돌리지 않는다. 사람의 GitHub 계정과 승인이 필요하기 때문이다.

> 5단계처럼 손으로 한 번 확인하고, 자동 테스트는 그 앞뒤(우리가 GitHub로 보내는 주소, Nest가 토큰을 다루는 규칙)를 지킨다.

### 남길 것

- **찾아보면 되는 것**: `createServer`, `server.listen(0)`, `page.route`, `page.waitForRequest`, `getByRole`의 `exact`, `test.use({ serviceWorkers: "block" })`, `--repeat-each`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 외부 서비스는 주소를 환경변수로 바꿀 수 있게 만들어 두면 테스트에서 가짜 서버로 갈아 끼울 수 있다. 가짜 서버는 "누구는 통과하고 누구는 막히는가"의 규칙만 흉내 낸다.

  - 사람이 필요한 흐름(승인)은 자동 테스트에서 빼고, 그 앞뒤의 우리 코드를 지킨다.

  - 가끔만 깨지는 테스트는 한 번 통과로 판단하지 않는다. 여러 번 돌려 재현하고, 요청을 기록해 "요청이 아예 안 보였는가, 보였는데 결과가 달랐는가"부터 가른다.

- **에러 신호**:

  - `strict mode violation: getByRole('button', { name: '로그인' }) resolved to 2 elements` → `shop`·`offline`·`trpc`·`upload` 네 파일 모두 로그인 버튼 찾기에 `exact: true`가 있는지

  - `결제 응답이 중간에 사라져...`가 가끔 `getByText(/결제 실패/)`를 못 찾고 화면엔 `결제 완료` → `shop.spec.ts`의 `test.use({ serviceWorkers: "block" })`(작업 4)

  - shop 테스트가 줄줄이 `Test timeout of 30000ms exceeded` → 마우스 재고가 0이다. `npx prisma db seed`

  - `git status`에 `test-results/`가 보인다 → `order-console-next/.gitignore`에 `/test-results`가 있는지

## 9. 디버깅

### 진단 1. 흐름 따라가기

| 확인할 곳 | 보는 것 |
|---|---|
| 브라우저 Network 탭(Keep log 켜기) | `/api/auth/signin/github` → `github.com/login/oauth/authorize` → `/api/auth/callback/github?code=...` → `/auth/github/complete` → `POST :4000/auth/exchange` |
| Next 서버 로그 | `[auth][error] ...` 한 줄. 오류 이름(`UntrustedHost`, `MissingSecret`, ...)과 설명 주소가 함께 나온다 |
| Nest 요청 로그 | `POST /auth/github`와 `POST /auth/exchange`의 상태 코드 |
| `curl localhost:3000/api/auth/session` | 브라우저가 볼 수 있는 Auth.js 세션 값(여기에 비밀이 있으면 안 된다) |
| `redis-cli --scan --pattern 'auth-code:*'` | 아직 쓰이지 않은 일회용 코드 |

Network 탭의 흐름에서 **마지막으로 성공한 요청**을 찾는다. 그다음 요청을 맡은 쪽(Auth.js, Nest, 브라우저 화면)이 막힌 곳이다.

### 진단 2. 증상으로 원인 가르기

메시지를 외우는 게 아니라, 보이는 것이 아래 어느 칸으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 |
|---|---|---|
| `The datasource.url property is required in your Prisma config file` | Prisma CLI가 DB 주소를 못 읽었다 | `order-api-nest/.env`가 있는지. `.env.local`은 `main.ts`만 읽는다(1장) |
| `Can't reach database server at localhost:5433` | DB 컨테이너가 안 떠 있다 | `docker compose ps`, `docker compose up -d db redis storage`(1장) |
| `createdb: error: ... database "order_api_test" already exists` | 정상. `12`에서 만든 테스트 DB가 남아 있다 | 그대로 넘어간다(1장 작업 2) |
| e2e에서 `The column users.github_id does not exist` | 테스트 DB에 새 마이그레이션이 없다 | `order_api_test`에 `migrate deploy`(1장, 1단계) |
| `GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET 환경변수가 없다`(응답은 500) | Nest가 GitHub 값을 못 읽었다 | `order-api-nest/.env.local`, 값을 고친 뒤 서버를 다시 띄웠는지(1장) |
| `git status`에 `order-api-nest/.env.local`이 보인다 | 비밀 파일이 커밋 대상이다 | `order-api-nest/.gitignore`(1장) |
| GitHub 화면에 `The redirect_uri is not associated with this application.` | 보낸 `redirect_uri`가 등록한 콜백 주소와 다르다 | OAuth 앱의 Authorization callback URL과 프론트 `AUTH_URL`의 호스트·포트(1장 작업 3) |
| `/auth/github`가 401 `GitHub 토큰을 확인할 수 없습니다` | 이 앱의 토큰이 아니다 | Nest의 `GITHUB_CLIENT_ID`와 프론트의 `AUTH_GITHUB_ID`가 같은 앱 것인지(1단계) |
| `/auth/github`가 500, `GitHub 토큰 확인 실패(<상태 코드>)` | GitHub 쪽 장애 | GitHub 상태. 우리 코드 문제가 아니다(1단계) |
| 테스트 `AssertionError: expected 200 to be 401` | 다른 앱의 토큰이 통과했다 | `github.ts`가 `GET /user`만 보는지(1단계) |
| 회원가입이 400 `github-로 시작하는 id는 사용할 수 없습니다` | 정상. GitHub 로그인 몫의 id다 | 다른 id로 가입한다(1단계) |
| `Nest can't resolve dependencies of the AuthService (PrismaService, JwtService, ?)` | `AuthCodeStore`를 넣어 줄 수 없다 | `auth.module.ts`의 `providers`(2단계) |
| `/auth/exchange`가 401 `코드가 없거나, 이미 썼거나, 만료됐습니다` | 코드가 Redis에 없다 | 60초가 지났는지, 두 번 냈는지(2단계) |
| 동시 교환 테스트 `expected [ 200, 200, ... ] to have a length of 1` | 코드 하나로 세션이 여러 개 생겼다 | `exchangeCode`가 읽기와 지우기를 따로 하는지(2단계) |
| `/api/auth/providers`·`/api/auth/session`이 `There was a problem with the server configuration`, 서버 로그에 `MissingSecret` | 세션 쿠키 암호화 키가 없다 | 프론트 `.env.local`의 `AUTH_SECRET`(1장) |
| 운영 빌드에서 `/api/auth/signin/github`에 멈춘다, `UntrustedHost: Host must be trusted` | Auth.js가 앱 주소를 모른다 | 프론트 `.env.local`의 `AUTH_URL`(3단계) |
| 서버 로그에 `UnknownAction: Unsupported action`(`at Object.signin`) | `/api/auth/signin/github`를 GET으로 열었다. POST만 받는 주소다 | 실패 뒤 그 주소에 멈춘 탭을 새로고침했는지. `/login`에서 다시 시작한다(3단계 작업 5) |
| `error TS2339: Property 'exchangeCode' does not exist on type 'Session'.` | 타입 보강이 없다 | `types/next-auth.d.ts`(3단계) |
| `error TS2339: Property 'expires' does not exist on type 'Session'.` | 보강이 아니라 모듈 선언을 새로 썼다 | `types/next-auth.d.ts` 맨 위 `import` 두 줄(3단계) |
| `curl localhost:3000/api/auth/providers`가 404 | Auth.js 경로가 없다 | `app/api/auth/[...nextauth]/route.ts`의 위치(3단계) |
| `/api/auth/session`의 JSON에 GitHub 토큰이 보인다 | 비밀이 브라우저로 샌다 | `session` 콜백(3단계) |
| `next build`가 ``You're importing a module that depends on `useEffect` into a React Server Component module`` | 클라이언트 기능을 쓰는 파일이 서버 컴포넌트로 취급됐다 | Import trace에 나온 파일 첫 줄의 `"use client"`(4단계 작업 2) |
| 운영 서버에서 `/auth/github/complete`가 404 | 화면을 만들기 전의 빌드로 떠 있다 | `npm run build`부터 다시(4단계 작업 5) |
| 운영 서버 로그에 ``encountered the unstable value `crypto.getRandomValues()` while prerendering`` | 미리 그리기 중에 `auth()`가 난수를 만들었다 | `page.tsx`의 `auth()` 앞 `await connection()`(4단계 작업 1) |
| "로그인을 마무리하지 못했습니다: 코드가 없거나, 이미 썼거나, 만료됐습니다" | 코드를 두 번 냈거나 늦게 냈다 | `useRef` 가드, 60초(4단계) |
| `/auth/github/complete`가 바로 `/login`으로 간다(`curl`로는 `200` + 본문의 `NEXT_REDIRECT`) | Auth.js 세션에 코드가 없다 | `jwt` 콜백이 코드를 받았는지, 이미 `signOut`됐는지(4단계) |
| 로그인은 되는데 새로고침하면 풀린다 | refresh 쿠키가 브라우저에 없다 | `/auth/exchange`를 브라우저가 `credentials: "include"`로 직접 불렀는지(4단계, 0장 개념 1) |
| GitHub 승인 뒤 다시 `/login`으로 돌아온다(주소에 `error` 쿼리) | `jwt` 콜백이 실패했다 | Next 로그의 `백엔드가 GitHub 로그인을 거절했습니다(<상태 코드>)`와 Nest 로그의 `/auth/github` 상태 코드(5단계) |
| GitHub 사용자로 비밀번호 로그인이 401 `id 또는 password가 틀렸다` | 정상. 비밀번호가 없는 계정이다 | GitHub로 로그인한다(5단계) |
| 컨테이너에서 `/auth/github`가 500, 로그에 `환경변수가 없다` | compose가 값을 안 넘겼다 | `docker compose`의 `--env-file .env.local`(6단계) |
| `strict mode violation: getByRole('button', { name: '로그인' }) resolved to 2 elements` | 버튼 이름이 둘에 걸린다 | 기존 테스트의 `exact: true`(7단계) |
| e2e `결제 응답이 중간에 사라져...`가 가끔 `getByText(/결제 실패/)` 못 찾음, 화면엔 `결제 완료` | `page.route`를 건너뛴 결제 요청(서비스 워커) | `shop.spec.ts`의 `test.use({ serviceWorkers: "block" })`(7단계) |
| e2e shop 테스트가 줄줄이 `Test timeout of 30000ms exceeded` | 마우스 재고가 0이다 | `npx prisma db seed`(1장 작업 2) |
| `git status`에 `order-console-next/test-results/`가 보인다 | Playwright 결과물이 커밋 대상이다 | `order-console-next/.gitignore`의 `/test-results`(7단계) |

### 시험해보기

```sh
# ./order-api-nest
docker compose up -d db redis storage # 처음이면 1장 작업 2를 모두 친다
cp .env.local.example .env.local # 값 채우기
npm run start:dev
npm run test:e2e # 22 passed

# ./order-console-next (.env.local에 AUTH_URL, AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET)
npm run test:e2e # 11 passed
npm run build && npm run start # 브라우저에서 GitHub로 로그인
```

### 도전 과제

#### 1. 기존 계정에 GitHub 연결하기

이미 있는 비밀번호 계정(kim)에 GitHub 계정을 연결하는 기능을 생각해 본다.

로그인한 상태에서만 연결할 수 있어야 하는 이유는? 연결 요청을 누가 시작했는지 어떻게 확인할까?

**답**

1. 연결은 "이 GitHub 계정을 어느 우리 계정에 붙일까"를 정하는 일이다. GitHub 토큰은 GitHub 계정만 알려 준다.

   붙일 계정을 요청 본문의 id로 받으면, 남의 id에 내 GitHub를 붙이고 GitHub로 로그인해 그 계정에 들어갈 수 있다. 그래서 붙일 계정은 "지금 로그인한 사람"이어야 한다.

2. 누가 시작했는지는 우리 액세스 토큰으로 정한다. 로그인한 브라우저가 `POST /auth/github/link-intent`(액세스 토큰 필요)를 부르면 Nest가 그 토큰의 `sub`(kim)를 묶은 연결 코드를 Redis에 60초 동안 둔다.

   로그인 코드와 같은 방식이고 키 앞부분만 다르다.

3. GitHub에서 돌아온 Next 서버가 연결 코드와 GitHub 토큰을 함께 `POST /auth/github/link`로 낸다. Nest는 연결 코드를 `GETDEL`로 꺼내 kim을 얻는다.

   GitHub 토큰은 1단계 작업 3과 같이 앱 토큰 확인 API로 확인한 뒤 kim의 `github_id`를 채운다.

4. 테스트로 확인한 규칙은 다음과 같다.

   - 액세스 토큰 없이 연결을 시작하면 401, 연결 코드 없이(또는 지어낸 코드로) 연결하면 401이다.

   - 연결 코드는 한 번만 쓸 수 있다(두 번째는 401). 로그인 코드를 연결 코드로 낼 수도 없다(401).

   - 다른 앱의 토큰이면 401이고 연결하지 않는다.

   - 이미 다른 사용자(kim)에게 연결된 GitHub 계정을 lee가 연결하려 하면 409다.

   - 연결한 뒤 GitHub로 로그인하면 `github-4242`를 새로 만들지 않고 kim의 토큰(`sub: "kim"`)을 받는다.

> 연결한 뒤의 GitHub 로그인에서 2단계 작업 2의 `upsert`를 그대로 쓰면 `update: { name: gh.login }` 때문에 kim의 이름 "김"이 GitHub 로그인 이름으로 덮인다. 연결된 기존 계정이면 이름을 건드리지 않고 그 계정으로 코드를 내줘야 한다.

#### 2. `/auth/github`에 요청 수 제한 걸기

`/auth/github`에 요청 수 제한을 건다.

이 엔드포인트가 부를 때마다 GitHub API를 부른다는 점을 생각한다. 제한을 넘은 요청은 어디서 막아야 하는가?

**답**

1. `/auth/github`는 로그인 없이 누구나 부를 수 있고, 한 번 부를 때마다 우리 앱의 Client ID·secret으로 GitHub API를 한 번 부른다.

   제한이 없으면 아무나 지어낸 토큰을 계속 보내 우리 앱 이름으로 GitHub API를 부르게 할 수 있다.

2. 그래서 GitHub에 묻기 전에, 컨트롤러에 닿기 전에 막는다. Nest 가드(`@UseGuards`)에서 IP마다 Redis 카운터를 `INCR`하고, 창의 첫 요청에서 `EXPIRE 키 60 NX`로 만료를 건다(두 명령을 `MULTI`로 묶는다).

   카운터가 10을 넘으면 429와 `Retry-After`를 돌려준다.

3. 지어낸 토큰으로 15번 연달아 보내면 앞의 10번은 401(GitHub가 "우리 앱 토큰 아님"이라 답했다), 뒤의 5번은 429다.

   가짜 GitHub 서버가 받은 요청은 10번뿐이다. `/auth/exchange`에는 제한이 걸리지 않는다.

> 정상 요청은 브라우저가 아니라 Next 서버가 보내므로(3단계 작업 1의 `jwt` 콜백), IP별 제한이라도 정상 사용자 전체가 Next 서버의 IP 하나를 나눠 쓴다는 점을 생각하고 한도를 정한다.

#### 3. GitHub 앱 승인 취소

GitHub 사용자가 Auth.js 앱 승인을 취소한다(GitHub 설정 → Applications).

우리 서비스의 세션은 어떻게 되는가? 지금 설계에서 GitHub 토큰을 버린 것과 연결해 설명한다.

**답**

1. 우리 세션은 그대로 남는다. GitHub로 로그인해 받은 refresh 쿠키로 승인 취소 뒤에도 `/auth/refresh`가 200이고, 새 액세스 토큰으로 `/me/orders`도 200이다(세 번 회전해도 같다).

2. Nest는 로그인할 때 한 번만 GitHub에 묻고, GitHub 토큰은 3단계 작업 1의 `jwt` 콜백에서 쓰고 버렸다.

   그 뒤로는 GitHub에 다시 묻지 않고, 물으려 해도 토큰이 없다. 로그인 상태는 `03`의 refresh 사슬 하나뿐이다.

3. 승인 취소가 막는 것은 새 GitHub 로그인뿐이다. 같은 GitHub 토큰으로 `/auth/github`를 부르면 앱 토큰 확인 API가 404라 401이다.

4. 우리 세션을 끝내려면 우리 쪽에서 회수해야 한다. 로그아웃(`/auth/logout`)하면 그 refresh 쿠키는 401이 된다.

> refresh token은 회전할 때마다 `expiresAt`이 새로 7일 뒤로 잡히므로, 계속 쓰는 한 세션이 이어진다.

## 10. 완성 확인

- [ ] GitHub로 로그인하면 Nest가 사용자(`github-<숫자 id>`, 비밀번호 없음)를 만들고, 우리 토큰으로 `/shop`까지 간다
- [ ] Auth.js 세션은 코드를 바꾼 뒤 지워지고, GitHub 액세스 토큰은 세션에 들어가지 않는다
- [ ] `GET /user`만 보는 확인이 다른 앱의 토큰을 통과시키는 것을 테스트로 재현했고, 앱 토큰 확인으로 막았다
- [ ] 발급 뒤에 지우는 방식이 코드 하나로 여러 세션을 만드는 것을 재현했고, `GETDEL`로 막았다
- [ ] 운영 빌드의 `UntrustedHost`를 `AUTH_URL`로 고쳤다
- [ ] 비밀 값은 커밋하지 않는 `.env.local`에만 있고, 컨테이너에는 실행할 때 넘긴다
- [ ] 백엔드 e2e 22개, 프론트 e2e 11개가 통과한다

## 11. 다음 단계

### 자가 점검

소리 내어 설명할 수 있으면 통과다.

1. OAuth 인가 코드 흐름에서 브라우저 주소창으로 지나가는 것은 무엇이고, 진짜 토큰은 어디서 주고받는가? PKCE는 무엇을 막는가?

2. 이 문서는 왜 Auth.js 세션을 로그인 상태로 쓰지 않고 Nest 토큰으로 갈아탔나?

3. `GET /user`로 확인하면 어떤 공격이 가능한가? `POST /applications/{client_id}/token`은 그걸 어떻게 막는가?

4. 일회용 코드 교환을 브라우저가 직접 하는 이유는?

5. "발급이 성공한 뒤에 코드를 지운다"가 왜 위험한가? `GETDEL`은 왜 안전한가?

6. `session` 콜백에 무엇을 넣으면 안 되는가? 일회용 코드는 왜 괜찮은가?

7. `UntrustedHost`는 왜 개발 서버에서는 안 보이고 운영 빌드에서만 보이는가?

8. PKCE 쿠키는 `SameSite=Lax`, `03`의 refresh 쿠키는 `Strict`다. 왜 다른가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 한 사용자에 여러 로그인 수단 연결하기(계정 연결), 같은 이메일의 계정 합치기

- Auth.js의 DB 어댑터(세션·계정을 DB에 저장하는 방식)와 이메일(매직 링크)·패스키 로그인

- GitHub 외의 공급자(Google 등)와 OpenID Connect(ID 토큰)

- GitHub의 앱 승인 취소·토큰 회수를 웹훅으로 받아 우리 세션도 회수하기

- 로그인 엔드포인트의 요청 수 제한
