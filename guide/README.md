# 인증: 비밀번호 해시, refresh token 회전, httpOnly 쿠키

## 목표

이 프로젝트는 [`02-transactions-and-concurrency`](https://github.com/seungwoo7050/node-order/tree/02-transactions-and-concurrency)로부터 시작한다.

지금까지 붙어 있던 로그인은 데모였다.

비밀번호는 `.env`의 `DEMO_PASSWORD` 하나와 비교했고, 액세스 토큰은 1시간짜리 하나가 전부였다.

데모 로그인에 남겨 둔 빈칸을, DB와 트랜잭션 위에서 채운다.

1. 사용자마다 비밀번호를 해시로 저장하고, 응답 시간으로도 가입 여부가 새지 않게 한다

2. 액세스 토큰을 짧게(15분) 줄이고, 그 대신 refresh token으로 다시 받게 한다

3. refresh token은 JS가 읽을 수 없는 httpOnly 쿠키로만 주고받는다

4. refresh token을 한 번 쓰면 바꿔 주고(회전), 버린 토큰이 다시 오면 탈취로 보고 세션 전체를 회수한다

5. 남의 주문을 id만 바꿔 읽는 IDOR을 막는다

```sh
# 로그인 응답: refresh token은 본문이 아니라 httpOnly 쿠키로 온다
curl -i -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}'
```

```sh
Set-Cookie: refresh_token=g-oMBX71...; Max-Age=604800; Path=/auth; Expires=...; HttpOnly; SameSite=Strict
{"accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."}
```

```sh
# 공격자가 refresh token을 훔쳐 먼저 썼다
# 진짜 사용자가 옛 토큰을 내미는 순간 탈취가 드러나고, 공격자의 세션까지 끊긴다
① 공격자 refresh(A→B) → 200
② 사용자 refresh(A)   → 401 {"message":"이미 사용된 refresh token입니다 - 이 로그인 세션 전체를 회수합니다"}
③ 공격자 refresh(B)   → 401
```

> 시작 기준점:  
> `order-api-nest`가 PostgreSQL(`docker compose up -d`) 위에서 결제·멱등성·outbox까지 동작한다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 확인한 뒤 원복하거나 다음 작업에서 고친다 |
| `진단 N.` | 9단계에서 "토큰과 쿠키가 어디서 사라졌나"를 가르는 절차 | 친다(`curl -v`, `psql`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 9단계만은 작업 대신 `진단 N.`을 따라간다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 9단계 "진단 4"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 설치와 설정뿐이고 11·12장은 체크리스트라서 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 인증에 대한 사전지식](#0-인증에-대한-사전지식) | 해시·솔트, 회수할 수 없는 JWT, 쿠키 속성, 회전을 `/etc/shadow`와 입장권에 빗대 본다(작업 없음) |
| [1. 준비](#1-준비) | `cookie-parser`를 설치하고 `ACCESS_TOKEN_TTL`을 `.env`에 넣는다 |
| [2. 1단계: 비밀번호를 해시로 저장하기](#2-1단계-비밀번호를-해시로-저장하기) | `scrypt` 해시로 저장하고, 응답 시간으로 가입 여부가 새는 것을 막는다 |
| [3. 2단계: 액세스 토큰을 짧게](#3-2단계-액세스-토큰을-짧게) | 만료 시간을 환경변수로 빼고 `GET /me/orders`로 만료를 눈으로 본다 |
| [4. 3단계: refresh token을 httpOnly 쿠키로](#4-3단계-refresh-token을-httponly-쿠키로) | refresh token을 DB 행과 httpOnly 쿠키로 주고받는다 |
| [5. 4단계: 회전과 재사용 감지](#5-4단계-회전과-재사용-감지) | 한 번 쓴 토큰을 버리고, 다시 오면 사슬 전체를 회수한다 |
| [6. 5단계: 같은 토큰으로 동시에 refresh하면](#6-5단계-같은-토큰으로-동시에-refresh하면) | 동시 refresh로 토큰이 불어나는 것을 조건부 `UPDATE`로 막는다 |
| [7. 6단계: 로그아웃](#7-6단계-로그아웃) | 이 세션만, 또는 모든 기기에서 로그아웃한다 |
| [8. 7단계: 남의 주문 들여다보기(IDOR) 막기](#8-7단계-남의-주문-들여다보기idor-막기) | `WHERE`에 `userId`를 함께 걸어 남의 주문을 404로 만든다 |
| [9. 8단계: 회귀 테스트](#9-8단계-회귀-테스트) | 회전과 재사용 감지를 실제 DB e2e 테스트로 고정한다 |
| [10. 9단계: 토큰과 쿠키가 어디서 사라졌는지 디버깅하기](#10-9단계-토큰과-쿠키가-어디서-사라졌는지-디버깅하기) | JWT payload, 쿠키 헤더, 토큰 사슬, 401 메시지로 원인을 가른다 |
| [11. 완성 확인](#11-완성-확인) | 체크리스트 |
| [12. 다음 단계](#12-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 인증에 대한 사전지식

### 개념 1 | 비밀번호는 "되돌릴 수 없게" 저장한다.

리눅스에서 `/etc/shadow`를 열어 본 적이 있다면 이런 줄을 봤을 것이다.

```sh
kim:$6$Xy7Qz...$k1Jd0...:19000:0:99999:7:::
```

`$6$`는 알고리즘(SHA-512 기반 `crypt(3)`), 그다음은 솔트(사용자마다 다른 무작위 값), 마지막이 해시다.

운영체제는 비밀번호 원문을 어디에도 저장하지 않는다. 로그인할 때 입력값을 같은 솔트로 다시 해시해서 저장된 해시와 비교할 뿐이다.

파일이 유출돼도 원문은 바로 나오지 않는다.

이 문서도 같은 형식(`scrypt$솔트$해시`)으로 저장하며, 세 가지를 지킨다.

- 해시: 한 방향으로만 계산된다. 해시에서 원문을 계산해 낼 수 없다.

- 솔트: 같은 비밀번호라도 사용자마다 해시가 달라진다. 흔한 비밀번호의 해시를 미리 계산해 둔 표(레인보우 테이블)로 한 번에 여러 계정을 깨는 공격이 막힌다.

- 느린 해시: SHA-256 같은 일반 해시는 너무 빨라서, 유출된 해시에 대해 초당 수십억 개의 후보를 시험해 볼 수 있다. `scrypt`는 일부러 느리고 메모리를 많이 쓰게 설계돼 있어서 그 비용을 크게 키운다. Node에 내장돼 있으므로 패키지를 설치할 필요도 없다.

### 개념 2 | JWT는 회수할 수 없다.

지금까지 쓴 JWT는 서버가 비밀 키로 서명한 문자열이다.

서버는 요청이 올 때마다 서명과 만료 시각만 검사하고, DB를 보지 않는다.

그래서 빠르고 서버가 상태를 들고 있을 필요가 없다.

대신 **한 번 발급한 토큰은 만료될 때까지 서버가 무효로 만들 방법이 없다.** 로그아웃해도, 토큰을 도둑맞아도 마찬가지다.

C로 비유하면, 서버가 들고 있는 세션 테이블에서 행을 지우는 방식이 아니라 위조 불가능한 도장이 찍힌 입장권을 나눠 준 셈이다. 입장권은 회수할 수 없다.

그래서 토큰을 둘로 나눈다.

| | 액세스 토큰 (JWT) | refresh token |
|---|---|---|
| 수명 | 짧게 (15분) | 길게 (7일) |
| 검사 | 서명만 검사한다. DB를 보지 않는다 | DB의 행과 대조한다 |
| 회수 | 불가능. 만료를 기다린다 | 가능. DB 행에 "회수됨"을 표시한다 |
| 쓰임 | API를 호출할 때마다 | 액세스 토큰이 만료됐을 때 새로 받는 데만 |

액세스 토큰을 도둑맞아도 피해는 15분으로 끝난다.

오래 가는 권한(refresh token)은 서버가 언제든 끊을 수 있게 DB에 둔다.

### 개념 3 | 쿠키는 브라우저가 알아서 붙여 보낸다.

지금까지 액세스 토큰은 클라이언트가 `Authorization` 헤더에 직접 붙였다. 쿠키는 다르다.

서버가 `Set-Cookie` 응답 헤더로 값을 주면, 브라우저가 저장해 두고 조건에 맞는 다음 요청마다 자동으로 `Cookie` 헤더에 실어 보낸다.

그 조건을 정하는 속성이 이 문서의 핵심이다.

| 속성 | 뜻 | 막는 것 |
|---|---|---|
| `HttpOnly` | 페이지의 JS(`document.cookie`)가 읽을 수 없다 | XSS. 페이지에 악성 스크립트가 끼어들어도 토큰을 훔쳐 갈 수 없다 |
| `SameSite=Strict` | 다른 사이트에서 시작된 요청에는 붙이지 않는다 | CSRF. 다른 사이트가 내 브라우저를 시켜 우리 API를 호출해도 쿠키가 실리지 않는다 |
| `Secure` | HTTPS 연결에서만 보낸다 | 네트워크 도청 |
| `Path=/auth` | `/auth/...` 요청에만 붙인다 | 토큰이 필요 없는 요청마다 실려 다니는 것 |

> refresh token을 `localStorage`에 두면 JS가 읽을 수 있어서, XSS 한 번에 7일짜리 권한이 통째로 넘어간다.  
> 그래서 오래 가는 토큰일수록 httpOnly 쿠키에 둔다.

### 개념 4 | refresh token은 한 번 쓰면 버린다(회전).

refresh token을 7일 동안 같은 값으로 쓰면, 그 사이 한 번이라도 복사당했을 때 공격자도 7일 내내 쓸 수 있다.

그래서 refresh token을 한 번 쓰면 버리고 새 것을 준다. 이것을 회전(rotation)이라고 한다.

은행의 일회용 비밀번호(OTP)와 같은 발상이다.

회전의 진짜 이점은 그다음이다. 정상적인 사용자는 버린 토큰을 다시 쓸 일이 없다.

그러니 **이미 쓴 토큰이 다시 오면 그 토큰은 누군가 복사해 둔 것**이다.

그 순간 진짜 사용자와 공격자 중 누가 누군지는 몰라도, 이 로그인에서 이어진 토큰 사슬을 전부 끊으면 공격자도 함께 끊긴다. 4단계에서 직접 만든다.

## 1. 준비

`02`의 `order-api-nest`에서 이어 간다.

### 작업 1. DB를 띄우고 cookie-parser 설치

```sh
cd order-api-nest
docker compose up -d
npm install cookie-parser
npm install -D @types/cookie-parser
```

`cookie-parser`는 요청의 `Cookie` 헤더를 읽어 `req.cookies` 객체로 만들어 주는 Express 미들웨어다.

설치만 해서는 아무 일도 하지 않는다. 3단계에서 `main.ts`에 등록한다.

### 작업 2. 액세스 토큰 수명을 .env에 추가

```sh
# .env
# 맨 아래에 한 줄 추가. 15m = 15분. "5s"(5초), "1h"(1시간)처럼 쓴다
ACCESS_TOKEN_TTL=15m
```

## 2. 1단계: 비밀번호를 해시로 저장하기

### 작업 1. passwordHash 컬럼 추가와 마이그레이션

`users`에 비밀번호 해시 컬럼을 추가한다. 이미 있는 사용자에게는 값이 없으므로 `NULL`을 허용한다.

이미 행이 든 테이블에 컬럼을 추가하면, DB는 기존 행마다 그 컬럼에 무언가를 채워 넣어야 한다.

`NOT NULL`이고 기본값도 없으면 채울 값이 없다. PostgreSQL은 `ALTER TABLE`을 거부하고, Prisma는 생성 단계에서 미리 "Added the required column ... without a default value. This is not possible if the table is not empty"라고 경고한다.

`NULL`을 허용하면 기존 행에는 `NULL`을 채우면 되니 문제가 없다.

`01`의 4단계(`users` 테이블 도입)에서는 `orders`에 `NOT NULL`인 `user_id`를 붙여야 해서 이 벽에 부딪혔다.

그래서 Prisma가 만든 SQL을 손으로 고쳐 `users` 행을 먼저 채우고 기존 컬럼의 이름을 바꿨다(`prisma/migrations/0002_add-user/migration.sql`).

이번에는 `password_hash`가 `NULL`을 허용하므로 그런 손질 없이, 생성된 마이그레이션이 그대로 통과한다.

```prisma
// prisma/schema.prisma
// User 모델에 한 줄 추가
model User {
  id           String   @id
  name         String
  // "scrypt$솔트$해시" 형식. NULL이면 비밀번호가 없는 계정 → 로그인할 수 없다
  passwordHash String?  @map("password_hash")
  // ... 나머지 그대로 ...
}
```

```sh
npx prisma migrate dev --name add-password-hash
npx prisma generate
```

생성된 SQL은 `ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;` 한 줄이다. `NOT NULL`이 없으니 기존 행에는 `NULL`이 들어간다.

### 작업 2. 해시를 만들고 비교하는 함수

해시를 만들고 비교하는 함수를 따로 둔다. 시드, 회원가입, 로그인 세 곳이 함께 쓴다.

```ts
// src/auth/password.ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  // 사용자마다 다른 무작위 솔트
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = stored.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  // 저장된 솔트로 입력값을 다시 해시한다
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

### 개념 | 해시 알고리즘은 Node가 하고, 이 파일은 포장만 한다

이 파일이 해시 알고리즘을 새로 만든 것은 아니다. 비밀번호를 섞어 되돌릴 수 없는 바이트로 만드는 계산은 전부 `scrypt` 한 번의 호출 안에서 일어나고, `scrypt`는 Node에 내장된 `node:crypto`(속은 OpenSSL)의 구현이다.

암호 알고리즘을 직접 짜는 것은 하지 말아야 할 일이다. 이 파일이 직접 하는 일은 그 앞뒤의 포장 세 가지뿐이다.

1. 솔트를 만든다(`randomBytes`)

2. 솔트와 해시를 한 문자열로 묶어 DB 한 칸에 넣는다(`scrypt$솔트$해시`)

3. 비교할 때 그 문자열을 다시 풀고, 시간이 새지 않게 비교한다(`timingSafeEqual`)

이 포장까지 해 주는 패키지도 있다. `bcrypt`(또는 순수 JS판 `bcryptjs`), `argon2`가 대표적이고, 둘 다 `hash(password)` / `verify(stored, password)` 두 함수만 내놓는다. 솔트 생성과 저장 형식은 패키지가 알아서 한다.

```ts
// argon2 패키지를 쓴다면 password.ts 전체가 이 정도로 줄어든다
import argon2 from "argon2";
export const hashPassword = (password: string) => argon2.hash(password);
export const verifyPassword = (password: string, stored: string) => argon2.verify(stored, password);
```

이 문서가 패키지 대신 내장 `scrypt`를 쓴 이유는 두 가지다.

- 설치할 것이 없다. `bcrypt`·`argon2`는 C/C++ 네이티브 모듈이라, 미리 빌드된 바이너리가 맞지 않는 환경(Node 버전, Alpine 이미지, CPU 종류)에서는 설치할 때 빌드 도구가 필요하다.

- 패키지가 감추는 솔트와 저장 형식을 직접 보게 된다. 0장 개념 1에서 본 `/etc/shadow`의 `$6$솔트$해시`와 같은 구조를 손으로 한 번 만들어 보는 것이 이 단계의 목적이다.

실무에서 새로 만든다면 `argon2` 패키지(Argon2id)를 쓰는 것이 가장 흔한 선택이다. OWASP의 비밀번호 저장 권고도 Argon2id를 1순위로, `scrypt`를 그다음으로 둔다. 어느 쪽이든 "느린 비밀번호 전용 해시 + 사용자별 솔트"라는 원리는 같다.

### 개념 | `password.ts`를 한 줄씩 읽기

먼저 결과물부터 보면 코드가 읽힌다. `hashPassword("1234")`가 돌려주는 문자열은 `$`로 나뉜 세 조각이다.

```text
scrypt$c3cab80025aa21c2d704bdc337138f12$e06e474e3121...(128자)
└─┬──┘ └──────────────┬───────────────┘ └───────┬──────────┘
알고리즘 이름     솔트 16바이트 → hex 32자      해시 64바이트 → hex 128자
```

`hashPassword`는 이 문자열을 만드는 함수이고, `verifyPassword`는 이 문자열을 다시 쪼개서 같은 계산을 한 번 더 하는 함수다.

#### 준비 두 줄

```ts
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
```

- `scryptAsync`: `scrypt`는 콜백 방식이라 `await`를 쓸 수 없다. `promisify`로 감싸 `await`할 수 있는 함수로 바꾼다. 뒤의 `as`는 타입만 알려 주는 부분이다. 둘 다 아래 "`promisify`: 콜백 함수를 `await`로 쓰기"에서 자세히 다룬다.

- `KEY_LENGTH = 64`: `scrypt`가 뱉을 해시의 길이(바이트)다. 길이를 정할 수 있다는 점이 SHA-256(항상 32바이트)과 다르다.

#### hashPassword: 비밀번호 → 저장할 문자열

```ts
const salt = randomBytes(16);                                    // ① 무작위 16바이트
const hash = await scryptAsync(password, salt, KEY_LENGTH);      // ② (비밀번호, 솔트) → 64바이트
return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`; // ③ 바이트를 글자로 바꿔 이어 붙인다
```

① 솔트는 호출할 때마다 새로 뽑는다. 그래서 같은 `"1234"`라도 사람마다 해시가 다르다(작업 3에서 직접 확인한다).

② 해시는 비밀번호만이 아니라 **비밀번호와 솔트의 조합**으로 계산된다. 솔트가 바뀌면 결과가 완전히 바뀐다.

③ `salt`와 `hash`는 `Buffer`(바이트 배열)라 DB의 `TEXT` 칸에 그대로 넣을 수 없다. `toString("hex")`로 1바이트를 16진수 두 글자로 바꾼다. 솔트도 함께 저장하는 이유는, 나중에 비교할 때 **같은 솔트로 다시 계산해야** 하기 때문이다. 솔트는 비밀이 아니다. 비밀은 비밀번호뿐이다.

맨 앞의 `scrypt`라는 이름표는 지금은 검사용일 뿐이지만, 나중에 알고리즘을 `argon2`로 바꾸면 옛 행과 새 행을 이 이름표로 구분할 수 있다.

#### verifyPassword: 입력값과 저장된 문자열이 맞는지

해시는 되돌릴 수 없으니 저장된 해시를 풀어서 비밀번호와 비교하는 방법은 없다. 대신 **입력값을 같은 솔트로 다시 해시해서, 두 해시가 같은지** 본다.

```ts
const [algorithm, saltHex, hashHex] = stored.split("$");          // ① 세 조각으로 쪼갠다
if (algorithm !== "scrypt" || !saltHex || !hashHex) return false; // ② 형식이 이상하면 바로 실패
const expected = Buffer.from(hashHex, "hex");                     // ③ 저장된 해시를 바이트로
const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length); // ④ 같은 솔트로 다시 계산
return actual.length === expected.length && timingSafeEqual(actual, expected);           // ⑤ 바이트 비교
```

① `"scrypt$c3ca...$e06e..."` → `["scrypt", "c3ca...", "e06e..."]`. 배열 구조 분해로 세 변수에 나눠 받는다.

② DB 값이 깨졌거나 다른 형식이면 예외 대신 `false`를 돌려준다. 로그인 실패와 똑같이 취급하려는 것이다.

③ `hashPassword` ③의 반대 방향이다. hex 글자를 다시 바이트로 되돌린다.

④ `hashPassword` ②와 같은 계산이다. 솔트는 저장해 둔 것을 쓰고, 길이도 저장된 해시의 길이를 따른다. 비밀번호가 맞으면 `actual`은 `expected`와 바이트 하나까지 같아진다.

⑤ 두 바이트 배열을 비교한다. `===`로 비교하지 않는 이유가 바로 아래 내용이다.

`timingSafeEqual`이 왜 필요한지는 C의 `memcmp`를 떠올리면 된다. 보통의 비교는 처음 다른 바이트에서 바로 멈춘다.

앞의 몇 바이트가 맞을수록 비교가 아주 조금 오래 걸리고, 그 차이를 수천 번 재면 정답을 앞에서부터 한 바이트씩 맞혀 갈 수 있다.

`timingSafeEqual`은 결과와 상관없이 항상 끝까지 비교한다.

길이가 다른 두 `Buffer`를 넘기면 `timingSafeEqual`은 비교 대신 예외를 던진다. 그래서 앞에 `actual.length === expected.length`를 먼저 검사한다.

### 작업 3. 시드가 사용자마다 해시를 만들게 하기

지금 시드는 `users`에 `id`와 `name`만 넣는다. 작업 1에서 `password_hash`를 `NULL` 허용으로 만들었으니 시드는 그대로 돌지만, 그렇게 만든 네 명은 비밀번호가 없어 로그인할 수 없다(작업 4부터는 `password_hash`가 `NULL`이면 거절한다).

그래서 시드가 사용자마다 비밀번호 해시를 만들어 함께 넣게 바꾼다. 지금까지 써 온 `{"id":"kim","password":"1234"}` 로그인이 그대로 통하도록, `.env`에 이미 있는 `DEMO_PASSWORD`(`1234`)를 네 명의 비밀번호로 쓴다.

`prisma/seed.ts`에서 바꾸는 곳은 두 군데다. 주문·상품 시드와 마지막 `console.log`는 건드리지 않는다.

```diff
 // prisma/seed.ts
 import { PrismaPg } from "@prisma/adapter-pg";
 import { PrismaClient } from "../src/generated/prisma/client.js";
+import { hashPassword } from "../src/auth/password.js";

 const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

 await prisma.$executeRaw`TRUNCATE outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;

+const users = [
+  { id: "kim", name: "김" },
+  { id: "lee", name: "이" },
+  { id: "park", name: "박" },
+  { id: "choi", name: "최" },
+];
 await prisma.user.createMany({
-  data: [
-    { id: "kim", name: "김" },
-    { id: "lee", name: "이" },
-    { id: "park", name: "박" },
-    { id: "choi", name: "최" },
-  ],
+  // 사용자마다 hashPassword를 따로 불러야 솔트가 각각 달라진다
+  data: await Promise.all(users.map(async (u) => ({ ...u, passwordHash: await hashPassword(process.env.DEMO_PASSWORD!) }))),
 });
 await prisma.order.createMany({
   // ... 주문·상품 시드와 console.log 그대로 ...
```

1. `hashPassword`를 가져온다. 작업 2의 `src/auth/password.ts`를 시드와 서버가 함께 쓴다. 경로 끝의 `.js`는 이 프로젝트가 ESM(`"type": "module"`)이라 붙이는 것으로, 기존 `client.js` import와 같은 규칙이다.

2. 사용자 목록을 `users` 상수로 빼고, `data`는 그 목록에 해시를 붙여 만든다. 목록을 `data` 안에 그대로 두면 네 객체마다 `passwordHash: ...`를 한 줄씩 복사해 붙여야 한다.

```sh
npx prisma db seed
docker compose exec db psql -U order -d order_api -c "SELECT id, left(password_hash, 60) AS password_hash FROM users ORDER BY id"
```

```sh
  id  |                        password_hash                         
------+--------------------------------------------------------------
 choi | scrypt$a589526205fbe8691ada45f90106a74a$4bed78d1c02cd6cc8068
 kim  | scrypt$b54e96d08119037a36d817bd72495060$c8748a13f0ec95349393
 lee  | scrypt$f9d846e4ae2c19656e30d9fb9c959856$73fc6fa3e61603a616e2
 park | scrypt$5b11f225e15aeaa259d62f57c86b534f$4be88b8d665547346a3e
(4 rows)
```

네 명 모두 비밀번호가 `1234`인데 해시가 전부 다르다. 솔트가 하는 일이 이것이다.

`seed 완료: 사용자 4 명, ...` 대신 `The "password" argument must be of type string ... Received undefined`가 나오면 `DEMO_PASSWORD`가 `.env`에 없는 것이다. `!`는 TS에게 "`undefined`가 아니다"라고 단언할 뿐, 값이 없으면 `scrypt`가 그대로 예외를 던진다.

### 개념 | `data:` 한 줄이 펼쳐지는 순서

```ts
data: await Promise.all(users.map(async (u) => ({ ...u, passwordHash: await hashPassword(process.env.DEMO_PASSWORD!) }))),
```

한 줄에 네 가지가 겹쳐 있어서 읽기 어렵다. 안쪽부터 바깥으로 풀면 이렇다.

```ts
// ① 사용자 하나를 받아, 해시를 붙인 새 객체를 돌려주는 async 함수
const withHash = async (u: { id: string; name: string }) => ({
  ...u,                                                       // id, name을 그대로 복사하고
  passwordHash: await hashPassword(process.env.DEMO_PASSWORD!), // passwordHash 필드를 하나 더한다
});

// ② 네 명에게 각각 ①을 부른다. async 함수의 결과는 Promise이므로 Promise 4개짜리 배열이 된다
const pending = users.map(withHash);   // [Promise, Promise, Promise, Promise]

// ③ 네 Promise가 모두 끝날 때까지 기다려, 결과만 담긴 배열로 바꾼다
const data = await Promise.all(pending);
// [{ id: "kim", name: "김", passwordHash: "scrypt$..." }, { id: "lee", ... }, ...]

// ④ 그 배열을 createMany에 넘긴다
await prisma.user.createMany({ data });
```

- `({ ... })`: 화살표 함수가 객체를 바로 돌려줄 때는 괄호로 감싼다. 괄호가 없으면 `{`를 함수 본문의 시작으로 읽는다.

- `...u`(스프레드): `u`의 필드를 새 객체에 펼쳐 복사한다. `{ id: u.id, name: u.name, passwordHash: ... }`를 줄여 쓴 것이다. 원래 `users` 배열의 객체는 바뀌지 않는다.

- `users.map(async ...)`의 결과는 객체 배열이 아니라 **Promise 배열**이다. 이것을 `createMany`에 바로 넘기면 Prisma가 Promise를 사용자 데이터로 받아 검증 에러를 낸다. `Promise.all`로 한 번 기다려 값으로 바꾸는 이유다.

- `Promise.all`은 네 해시 계산을 동시에 시작하고, 모두 끝나면 **원래 순서대로** 결과를 모은다. `for` 루프에서 하나씩 `await`해도 결과는 같다. 다만 `scrypt` 한 번이 수십 ms라, 사용자가 많아지면 동시에 돌리는 쪽이 빠르다.

### 개념 | 해시를 한 번만 만들어 나눠 넣으면 안 되는 이유

모든 사용자의 비밀번호가 같으니 해시도 한 번만 만들면 될 것 같다.

```ts
// 잘못된 예: 해시를 한 번 만들어 네 명에게 똑같이 넣는다
const passwordHash = await hashPassword(process.env.DEMO_PASSWORD!);
await prisma.user.createMany({ data: users.map((u) => ({ ...u, passwordHash })) });
```

이러면 `hashPassword` 안의 `randomBytes(16)`이 한 번만 불리고, 네 줄이 솔트까지 완전히 같은 문자열이 된다.

로그인은 여전히 된다. 하지만 DB가 유출되면 "이 네 계정은 비밀번호가 같다"는 사실이 바로 드러나고, 하나를 깨면 넷이 다 깨진다. 솔트를 쓰는 이유(0장 개념 1)가 사라진 것이다.

`map` 안에서 `hashPassword`를 사용자마다 부르는 위의 코드가 맞다. 비밀번호가 같아도 솔트는 사용자마다 새로 뽑힌다.

### 용어 | Node crypto API (비밀번호 해시)

- `randomBytes(n)`: 암호학적으로 안전한 무작위 바이트 `n`개를 담은 `Buffer`를 만든다.

- `buffer.toString("hex")` / `Buffer.from(문자열, "hex")`: 바이트와 16진수 문자열 사이를 오간다. DB에는 문자열로 저장하기 위해 쓴다.

### 개념 | `promisify`: 콜백 함수를 `await`로 쓰기

Node의 오래된 비동기 API는 마지막 인자로 콜백 함수를 받고, 일이 끝나면 그 함수를 `(err, 결과)` 순서로 부른다(에러 우선 콜백).

C 라이브러리에 함수 포인터를 넘겨 두고 완료되면 호출받는 것과 같은 모양이다. `scrypt`도 이 방식이다.

`promisify`는 이 규약을 믿고 함수를 감싼다. 마지막 콜백 자리를 빼고, `err`가 있으면 reject, 없으면 결과로 resolve하는 Promise를 돌려준다.

```js
import { scrypt } from "node:crypto";
import { promisify } from "node:util";

// 콜백 방식: 계산이 끝나면 Node가 (err, key)로 불러 준다
scrypt("1234", "salt", 8, (err, key) => console.log(err, key.toString("hex")));
// 출력: null 016ac1d2551495aa

// promisify한 함수: 같은 계산을 await로 받는다
const scryptAsync = promisify(scrypt);
console.log(await scryptAsync("1234", "salt", 8));
// 출력: <Buffer 01 6a c1 d2 55 14 95 aa>
```

이 문서의 `password.ts`는 그 결과에 `as (...) => Promise<Buffer>`를 붙였다.

붙이지 않으면 `@types/node`의 선언으로는 결과 타입이 `Promise<unknown>`으로 추론되어, 받은 값을 바로 쓸 수 없다.

```ts
const raw = promisify(scrypt);
const key = await raw("1234", salt, 64);
key.toString("hex"); // 컴파일 에러(TS18046): 'key' is of type 'unknown'.
```

`promisify`는 "마지막 인자가 `(err, 결과)` 콜백"인 함수에만 쓸 수 있다. 콜백 위치나 인자 순서가 다른 함수를 감싸면 엉뚱하게 동작한다.

`as`는 검사가 아니라 단언이다. 여기서는 `scrypt`의 결과가 `Buffer`라는 것을 Node 문서가 보장하므로, 그 사실을 TS에 알려 주는 용도로만 쓴다.

> 콜백을 Promise로 바꾸는 일은 모듈 맨 위에서 한 번만 하고(`scryptAsync`), 나머지 코드는 `await`로만 쓴다.

### 작업 4. 로그인을 DB와 대조하게 바꾸기

로직이 커지므로 컨트롤러에서 `AuthService`로 옮긴다.

#### AuthService 만들기

```ts
// src/auth/auth.service.ts
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service.js";
import { verifyPassword } from "./password.js";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(id: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
    // "없는 사용자"와 "틀린 비밀번호"를 같은 메시지로 돌려준다. 어떤 id가 가입돼 있는지 알려 주지 않는다
    if (!user || !ok) throw new UnauthorizedException("id 또는 password가 올바르지 않습니다");
    return { accessToken: this.jwtService.sign({ sub: user.id }) };
  }
}
```

`JwtService`는 `AuthModule`이 이미 `imports`한 `JwtModule`이 제공한다. `PrismaService`는 전역 모듈(`@Global()`)인 `PrismaModule`에서 온다.

#### 컨트롤러는 서비스에 넘기기만 한다

```ts
// src/auth/auth.controller.ts
// 파일 전체를 이렇게 바꾼다. JwtService 대신 AuthService를 주입받는다
import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { LoginDto } from "./login.dto.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.id, dto.password);
  }
}
```

#### AuthModule에 AuthService 등록

`auth.module.ts`의 `providers`에 `AuthService`를 추가한다.

```ts
// src/auth/auth.module.ts
// import 한 줄과 providers 배열의 AuthService만 추가한다
import { AuthService } from "./auth.service.js";
// ... 기존 import 그대로 ...

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: "1h" } }), // 2단계에서 바꾼다
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, AuthService],
})
export class AuthModule {}
```

위에서 `AuthController`의 생성자를 `constructor(private readonly authService: AuthService)`로 바꿨다. 이 객체를 `new`로 만드는 것은 우리가 아니라 Nest다.

Nest는 컨트롤러를 만들 때 생성자 인자의 타입(`AuthService`)을 보고, **그 컨트롤러가 속한 모듈의 `providers`** 에서 같은 클래스를 찾아 인스턴스를 만들어 넣어 준다.

`providers`는 "이 모듈 안에서 Nest가 대신 만들어 줄 클래스 목록"이다.

`import { AuthService } ...`는 TS 파일끼리 클래스를 가져다 쓰기 위한 것이다. 그 줄만으로는 Nest에 아무것도 등록되지 않는다.

그래서 `providers`에 `AuthService`를 넣지 않으면, `import`가 있어도 서버가 뜨기 전에 이렇게 멈춘다.

```sh
Nest can't resolve dependencies of the AuthController (?). Please make sure that the argument AuthService at index [0] is available in the AuthModule context.
```

괄호 안의 `?`는 생성자 인자 목록이다. 첫 번째(`index [0]`) 인자인 `AuthService`를 만들어 넣을 방법을 `AuthModule` 안에서 찾지 못했다는 뜻이다. 인자가 여럿이면 `(JwtService, ?)`처럼 찾은 것은 이름으로, 못 찾은 것만 `?`로 찍힌다.

### 작업 5. 회원가입이 비밀번호를 받게 하기

`POST /users`가 비밀번호를 받게 한다.

```ts
// src/users/dto/create-user.dto.ts
// import에 MinLength를 추가하고, 필드 한 줄을 추가한다
import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class CreateUserDto {
  @IsString() @IsNotEmpty() id!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @MinLength(8) password!: string;
}
```

```ts
// src/users/users.service.ts
// import에 hashPassword를 추가하고, create를 바꾼다
import { hashPassword } from "../auth/password.js";
// ...

  // 회원가입: 비밀번호는 해시로 바꿔서만 저장한다
  async create(dto: CreateUserDto) {
    return this.prisma.user.create({
      data: { id: dto.id, name: dto.name, passwordHash: await hashPassword(dto.password) },
      select: { id: true, name: true },
    });
  }
```

예전 `create`는 `data: dto`로 DTO를 통째로 넘겼다. 이제 DTO에 `password`가 있는데 `users` 테이블에는 그런 컬럼이 없으므로, 넣을 필드를 하나씩 골라 적는다.

`select`로 `password_hash`를 응답에서 뺀다. 해시도 응답에 실어 보내지 않는다.

```sh
curl -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"wrong"}'
{"message":"id 또는 password가 올바르지 않습니다","error":"Unauthorized","statusCode":401}

curl -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"nobody","password":"1234"}'
{"message":"id 또는 password가 올바르지 않습니다","error":"Unauthorized","statusCode":401}

curl -X POST localhost:4000/users -H 'Content-Type: application/json' -d '{"id":"jung","name":"정","password":"short"}'
{"message":["password must be longer than or equal to 8 characters"],"error":"Bad Request","statusCode":400}

curl -X POST localhost:4000/users -H 'Content-Type: application/json' -d '{"id":"jung","name":"정","password":"correct-horse"}'
{"id":"jung","name":"정"} # 201
```

### 실험 | 일부러 깨뜨려보기 ①: 응답 시간이 가입 여부를 말해 준다.

메시지는 같아졌다. 그런데 응답 시간을 재 보면 다르다.

```sh
# -w "%{time_total}": 응답에 걸린 전체 시간(초)을 출력한다. 5번 재서 가운데 값을 본다
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' -d '{"id":"kim","password":"wrong"}'; done | sort | sed -n 3p
0.035984  # 가입된 id + 틀린 비밀번호
# id를 nobody로 바꿔 같은 명령
0.002414  # 없는 id
```

없는 id는 15배 빠르다. `user`가 없으면 `verifyPassword`를 건너뛰니, 느린 `scrypt` 계산이 통째로 빠지기 때문이다.

공격자는 메시지를 볼 필요도 없이 시간만 재서 "이 id는 가입돼 있다"를 알아낸다. 이것을 타이밍 공격이라고 한다.

**고치려면 사용자가 없을 때도 같은 계산을 하게 만든다.**

### 작업 6. 고치기: 없는 사용자도 더미 해시와 비교한다

```ts
// src/auth/auth.service.ts
// import에 hashPassword를 추가하고, 필드 하나와 login을 바꾼다
import { hashPassword, verifyPassword } from "./password.js";
// ...

  // 없는 사용자일 때도 비교할 더미 해시. 서버가 뜰 때 한 번만 만든다
  private readonly dummyHash = hashPassword("never-matches-any-real-password");

  async login(id: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    // 사용자가 없어도 더미 해시로 같은 계산을 한다. 응답 시간으로 "가입된 id인지"가 새지 않게
    const ok = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user?.passwordHash || !ok) throw new UnauthorizedException("id 또는 password가 올바르지 않습니다");
    return { accessToken: this.jwtService.sign({ sub: user.id }) };
  }
```

`dummyHash`는 `Promise` 그대로 필드에 둔다. 서버가 뜰 때 한 번 계산을 시작하고, 필요할 때 `await`로 결과를 꺼낸다.

이미 끝난 Promise를 몇 번이고 `await`해도 같은 값이 바로 나온다. 계산은 처음 한 번뿐이다.

조건이 `!user?.passwordHash`인 것도 중요하다. 누가 더미 비밀번호 문자열을 알아내서 없는 id로 보내도, `user`가 없으니 통과하지 못한다.

`password_hash`가 `NULL`인 계정(비밀번호 없이 만든 옛 계정)도 같은 이유로 더미 해시와 비교한 뒤 거절된다.

실험 ①과 같은 명령으로 다시 잰다. 이번에는 맞는 비밀번호까지 세 경우를 잰다.

```sh
# kim(틀린 비번)
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' -d '{"id":"kim","password":"wrong"}'; done | sort | sed -n 3p

# nobody(없는 id)
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' -d '{"id":"nobody","password":"1234"}'; done | sort | sed -n 3p

# kim(맞는 비번)
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}\n" -X POST localhost:4000/auth/login \
  -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}'; done | sort | sed -n 3p
```

```sh
0.040914   # kim(틀린 비번)
0.035025   # nobody
0.037778   # kim(맞는 비번)
```

이제 셋 다 비슷하다.

### 남길 것

- **찾아보면 되는 것**: `scrypt`·`randomBytes`·`timingSafeEqual`의 인자, `promisify`의 동작, `Promise.all`과 스프레드(`...`), `@MinLength`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 해시 알고리즘은 직접 만들지 않는다. 검증된 구현(`scrypt`, `argon2`)을 부르고, 솔트와 함께 저장했다가 같은 솔트로 다시 계산해 비교한다.

  - 솔트는 사용자마다 따로 만들어야 한다. 해시를 한 번만 만들어 나눠 넣으면 같은 비밀번호의 해시가 전부 같아진다.

  - 메시지를 통일해도 처리 시간이 다르면 가입 여부가 샌다. 없는 사용자도 같은 계산(더미 해시 비교)을 거치게 한다.

- **에러 신호**:

  - 시드 사용자에 맞는 비밀번호인데 `id 또는 password가 올바르지 않습니다`(401) → `password_hash`가 `NULL`인지(시드를 다시 돌렸는지)

  - `Nest can't resolve dependencies of the AuthController (?)` → `auth.module.ts`의 `providers`에 `AuthService`가 있는지

  - `password must be longer than or equal to 8 characters`(400) → 회원가입 비밀번호가 8자 미만

  - `'key' is of type 'unknown'`(TS18046) → `promisify(scrypt)` 결과에 `as (...) => Promise<Buffer>` 단언이 있는지

  - 시드가 `The "password" argument must be of type string ... Received undefined`로 멈춘다 → `.env`에 `DEMO_PASSWORD`가 있는지

  - 시드 뒤 네 사용자의 `password_hash`가 한 글자도 다르지 않다 → `hashPassword`를 `map` 안에서 사용자마다 부르는지

## 3. 2단계: 액세스 토큰을 짧게

### 작업 1. 만료 시간을 환경변수로 빼기

처음 로그인을 붙일 때 `"1h"`로 박아 둔 만료 시간을 환경변수로 뺀다.

```ts
// src/auth/auth.module.ts
// JwtModule.register 부분만 바꾼다
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      // 액세스 토큰은 짧게. 한 번 발급하면 만료 전까지 회수할 방법이 없다(0장 개념 2)
      // as "15m": @nestjs/jwt의 타입은 "15m" 같은 정해진 모양의 문자열만 받으므로, 환경변수(string)를 그 모양이라고 단언한다
      signOptions: { expiresIn: (process.env.ACCESS_TOKEN_TTL ?? "15m") as "15m" },
    }),
```

### 작업 2. 토큰이 필요한 읽기 경로 `GET /me/orders`

만료를 눈으로 보려면 토큰이 필요한 읽기 경로가 하나 있으면 좋다. 지금까지 토큰을 요구하는 경로는 주문 생성(`POST`)과 결제뿐이었다.

로그인한 사용자 자신의 주문 목록을 돌려주는 `GET /me/orders`를 만든다. 누구의 주문인지는 URL이 아니라 토큰이 정한다.

#### MeController

```ts
// src/me/me.controller.ts
import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";

const orderSelect = { id: true, price: true, paid: true, createdAt: true } as const;

// "내" 데이터만 다루는 경로. 누구의 데이터인지는 URL이 아니라 토큰이 정한다
@Controller("me")
@UseGuards(AuthGuard("jwt")) // 클래스에 붙이면 모든 메서드에 적용된다
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("orders")
  myOrders(@Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    return this.prisma.order.findMany({ where: { userId }, select: orderSelect, orderBy: { id: "asc" } });
  }
}
```

#### MeModule 만들고 등록하기

```ts
// src/me/me.module.ts
import { Module } from "@nestjs/common";
import { MeController } from "./me.controller.js";

@Module({ controllers: [MeController] })
export class MeModule {}
```

`app.module.ts`의 `imports`에 `MeModule`을 추가한다.

```ts
// src/app.module.ts
// import 한 줄과 imports 배열의 MeModule만 추가한다
import { MeModule } from './me/me.module.js';
// ... 기존 import 그대로 ...

@Module({
  imports: [PrismaModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, AuthModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

여기에 빠지면 파일이 있어도 Nest가 모르는 모듈이라, 서버는 멀쩡히 뜨는데 `GET /me/orders`만 `{"message":"Cannot GET /me/orders","error":"Not Found","statusCode":404}`가 난다.

### 개념 | JWT 검사는 어디서 일어나나: `AuthGuard("jwt")`와 `JwtStrategy`

`MeController`에는 토큰을 검사하는 코드가 한 줄도 없다. 그런데 토큰 없이 부르면 401이고, 토큰이 있으면 `req.user.userId`가 채워져 있다.

그 사이에서 일어나는 일은 이렇다.

1. 요청이 오면 Nest는 핸들러(`myOrders`)보다 먼저 `@UseGuards`에 적힌 Guard를 실행한다. Guard가 통과시켜야 핸들러가 불린다.

2. `AuthGuard("jwt")`는 Passport에 "jwt"라는 이름으로 등록된 전략을 찾아 실행한다. 그 전략이 `src/auth/jwt.strategy.ts`의 `JwtStrategy`다. `passport-jwt`의 `Strategy`는 이름이 기본으로 `"jwt"`다.

3. `JwtStrategy`는 `ExtractJwt.fromAuthHeaderAsBearerToken()`으로 `Authorization: Bearer ...` 헤더에서 토큰을 꺼내고, `secretOrKey`(`JWT_SECRET`)로 서명을, payload의 `exp`로 만료를 검사한다.

4. 통과하면 Passport가 `validate(payload)`를 부르고, 그 반환값 `{ userId: payload.sub }`를 `req.user`에 넣는다. 컨트롤러가 `(req.user as { userId: string }).userId`로 꺼내는 값이 이것이다.

5. 헤더가 없거나, 서명이 틀리거나, 만료됐으면 Guard가 `UnauthorizedException`을 던진다. 응답은 셋 다 메시지 없는 `{"message":"Unauthorized","statusCode":401}`이다.

이 과정 어디에도 DB 조회가 없다. 0장 개념 2의 "서명만 검사한다"가 바로 이것이다.

사용자를 지워도, 로그아웃해도 이미 나간 토큰은 이 검사를 통과한다.

#### 흔한 오해

- `JwtModule.register`의 `expiresIn`은 **발급할 때** payload에 `exp`를 적는 설정이다. 검사 쪽은 토큰에 적힌 `exp`만 본다. 그래서 `ACCESS_TOKEN_TTL`을 바꿔도 이미 발급한 토큰의 수명은 그대로다.

- `MeModule`은 `AuthModule`을 `imports`하지 않는데도 `AuthGuard("jwt")`가 동작한다. `JwtStrategy`는 `AuthModule`의 프로바이더로 만들어지는 순간 Passport(프로세스 전체에 하나)에 자기 이름을 등록하고, `AuthGuard`는 Nest의 주입이 아니라 그 이름으로 찾기 때문이다.

- 401 메시지만으로는 "토큰이 없다 / 서명이 틀렸다 / 만료됐다"를 구별할 수 없다. 그래서 9단계 진단 1에서 payload를 직접 열어 본다.

### 작업 3. 5초짜리 토큰으로 만료 확인

#### 수명을 5초로 줄여 켜기

이제 액세스 토큰 수명을 5초로 줄여서 켠다.

```sh
# 명령 앞에 붙인 환경변수는 .env의 같은 이름보다 우선한다(--env-file은 이미 있는 환경변수를 덮어쓰지 않는다)
ACCESS_TOKEN_TTL=5s npm run start:dev
```

#### 만료 전과 후

```sh
# 로그인 토큰을 변수에 담는다
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders
[{"id":1,"price":12000,"paid":true,...},{"id":3,...}]  # 200
# 6초 기다렸다가 같은 요청
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders
{"message":"Unauthorized","statusCode":401}
```

#### payload 디코드

토큰의 가운데 부분(payload)을 디코드해 보면 만료 시각이 그대로 적혀 있다.

```sh
# JWT는 "헤더.payload.서명"을 점으로 이은 것이다. cut -d. -f2로 가운데만 꺼내 base64url을 디코드한다
echo "$TOKEN" | cut -d. -f2 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Buffer.from(s.trim(),"base64url").toString()))'
{"sub":"kim","iat":1791123241,"exp":1791123246}  # exp - iat = 5초
```

> payload는 암호화가 아니라 인코딩일 뿐이라 누구나 읽을 수 있다.  
> 서명은 "내용을 바꾸지 않았다"만 보장한다. 그러니 payload에 비밀 정보를 넣지 않는다.

#### 15분으로 되돌리기

확인했으면 서버를 끄고(Ctrl+C) 앞의 환경변수 없이 다시 켠다. 이후 단계는 `.env`의 `15m`으로 진행한다.

```sh
npm run start:dev
```

5초로 켜 둔 채 다음 단계로 가면, 6단계의 "로그아웃한 뒤에도 액세스 토큰이 통한다" 실험이 5초 안에 끝나지 않는 한 401로 보인다.

이렇게 짧게 하면 안전해지지만, 사용자는 15분마다 다시 로그인해야 한다. 이 불편을 refresh token이 해결한다.

### 남길 것

- **찾아보면 되는 것**: `expiresIn`의 문자열 형식(`"15m"`, `"5s"`), `cut -d. -f2`와 base64url 디코드 명령, `@UseGuards`를 클래스에 붙이는 법. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 액세스 토큰은 서명과 `exp`만 검사하고 DB를 보지 않는다. 그래서 발급한 뒤에는 끊을 수 없고, 수명이 곧 피해의 상한이다.

  - payload는 누구나 읽을 수 있다. 서명은 위조를 막을 뿐 내용을 숨기지 않는다.

- **에러 신호**:

  - 토큰을 넣었는데 `{"message":"Unauthorized","statusCode":401}` → payload의 `exp`가 지났는지(`ACCESS_TOKEN_TTL=5s`로 켜 둔 채인지)

  - 서버는 뜨는데 `Cannot GET /me/orders`(404) → `app.module.ts`의 `imports`에 `MeModule`이 있는지

## 4. 3단계: refresh token을 httpOnly 쿠키로

refresh token은 DB에 행으로 둔다. 0장 개념 2에서 본 "회수할 수 있다"가 바로 이 행에서 나온다.

### 작업 1. RefreshToken 모델과 마이그레이션

```prisma
// prisma/schema.prisma
// User 모델에 관계 필드 한 줄, 그리고 새 모델
model User {
  // ... 앞의 필드 그대로 ...
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id        Int       @id @default(autoincrement())
  userId    String    @map("user_id")
  user      User      @relation(fields: [userId], references: [id])
  // 토큰 원문이 아니라 SHA-256 해시만 저장한다. DB가 유출돼도 그대로 쓸 수 없다
  tokenHash String    @unique @map("token_hash")
  // 로그인 한 번에서 시작된 토큰 사슬의 id. 회전할 때마다 같은 값을 물려준다
  familyId  String    @map("family_id")
  expiresAt DateTime  @map("expires_at")
  // 쓰였거나(회전) 회수된 시각. NULL이면 아직 유효하다
  revokedAt DateTime? @map("revoked_at")
  createdAt DateTime  @default(now()) @map("created_at")

  @@index([userId])
  @@index([familyId])
  @@map("refresh_tokens")
}
```

```sh
npx prisma migrate dev --name add-refresh-tokens
npx prisma generate
```

생성된 SQL에서 `CREATE UNIQUE INDEX "refresh_tokens_token_hash_key"`와 `user_id`·`family_id`의 인덱스 두 개를 확인한다.

`token_hash`의 UNIQUE 인덱스는 refresh 요청마다 토큰을 찾는 데, `family_id` 인덱스는 사슬 전체를 회수할 때 쓴다.

시드의 `TRUNCATE` 목록 맨 앞에 `refresh_tokens`를 추가한다.

```ts
// prisma/seed.ts
// TRUNCATE 한 줄만 이렇게 바꾼다. 맨 앞에 refresh_tokens를 붙인다
await prisma.$executeRaw`TRUNCATE refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
```

`refresh_tokens`는 `users`를 외래키로 가리키므로 `CASCADE`만으로도 함께 비워진다. 그래도 목록에 적어 두면 시드가 무엇을 비우는지 한 줄에서 보인다.

### 개념 | refresh token은 무작위 문자열이고, SHA-256으로 해시한다

refresh token은 JWT가 아니라 그냥 추측할 수 없는 무작위 문자열이다. 내용(누구의 토큰인지, 언제 만료되는지)은 DB의 행이 들고 있기 때문이다.

비밀번호와 달리 SHA-256으로 해시하는 이유는 두 가지다.

- 토큰은 32바이트 무작위 값이라 사전 대입으로 맞힐 수 없으므로 느린 해시가 필요 없다.

- 매 요청마다 빠르게 찾아야 한다(`@unique` 인덱스로 찾는다).

비밀번호에는 솔트가 있어서 같은 입력이라도 해시가 매번 다르다. 그래서 "이 해시를 가진 행"으로 바로 찾을 수 없고, 사용자 id로 행을 찾은 뒤 비교한다.

refresh token은 솔트 없이 해시하므로 같은 토큰은 언제나 같은 해시다. 쿠키 값 하나만으로 `WHERE token_hash = ...`로 행을 찾을 수 있는 이유가 이것이다.

### 작업 2. AuthService에 토큰 발급과 refresh 추가

#### 파일 맨 위: import와 상수

```ts
// src/auth/auth.service.ts
// 파일 맨 위를 이렇게 만든다. node:crypto와 Prisma import를 추가하고, 클래스 위에 상수·타입·함수를 둔다
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashPassword, verifyPassword } from "./password.js";

// refresh token 수명(초). 기본 7일
export const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 7);

export type IssuedTokens = { accessToken: string; refreshToken: string };

// DB에는 토큰 원문 대신 이 해시만 저장한다
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
```

#### login이 토큰 두 개를 발급하게

```ts
// src/auth/auth.service.ts
// login의 반환 타입과 마지막 줄을 바꾼다
  async login(id: string, password: string): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    const ok = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user?.passwordHash || !ok) throw new UnauthorizedException("id 또는 password가 올바르지 않습니다");
    // familyId: 이 로그인에서 시작되는 refresh token 사슬의 이름표
    return this.issueTokens(this.prisma, user.id, randomUUID());
  }
```

#### refresh와 issueTokens

```ts
// src/auth/auth.service.ts
// 클래스 안, login 아래에 두 메서드를 추가한다
  // 3단계: refresh token이 유효하면 새 액세스 토큰만 준다(refresh token은 그대로)
  async refresh(rawToken: string | undefined): Promise<IssuedTokens> {
    if (!rawToken) throw new UnauthorizedException("refresh token이 없습니다");
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!token || token.revokedAt || token.expiresAt < new Date()) throw new UnauthorizedException("유효하지 않은 refresh token입니다");
    return { accessToken: this.jwtService.sign({ sub: token.userId }), refreshToken: rawToken };
  }

  // db 매개변수: 4단계에서 트랜잭션(tx) 안에서도 부를 수 있게 클라이언트를 밖에서 받는다
  private async issueTokens(db: Prisma.TransactionClient, userId: string, familyId: string): Promise<IssuedTokens> {
    const accessToken = this.jwtService.sign({ sub: userId });
    const refreshToken = randomBytes(32).toString("base64url");
    await db.refreshToken.create({
      data: {
        userId, familyId, tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return { accessToken, refreshToken };
  }
```

`PrismaService`(`this.prisma`)를 `Prisma.TransactionClient` 자리에 넘겨도 되는 이유는, 트랜잭션 클라이언트가 일반 클라이언트에서 `$transaction` 같은 몇몇 메서드만 뺀 모양이기 때문이다.

일반 클라이언트는 그보다 기능이 많으니 그 자리에 그대로 들어간다.

### 작업 3. 컨트롤러가 쿠키로 주고받게

컨트롤러는 refresh token을 본문이 아니라 쿠키로만 주고받는다.

```ts
// src/auth/auth.controller.ts
import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import { AuthService, REFRESH_TOKEN_TTL_SECONDS } from "./auth.service.js";
import { LoginDto } from "./login.dto.js";

const REFRESH_COOKIE = "refresh_token";
const refreshCookieOptions: CookieOptions = {
  httpOnly: true, // JS가 읽을 수 없다 → XSS로 훔쳐 갈 수 없다
  sameSite: "strict", // 다른 사이트에서 시작된 요청에는 붙지 않는다 → CSRF를 막는다
  secure: process.env.NODE_ENV === "production", // HTTPS에서만 보낸다(로컬 http 개발 중에는 끈다)
  path: "/auth", // /auth/... 요청에만 붙는다
};

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.login(dto.id, dto.password);
    res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 });
    return { accessToken }; // refresh token은 본문에 넣지 않는다. 쿠키로만 오간다
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.refresh(req.cookies?.[REFRESH_COOKIE]);
    res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 });
    return { accessToken };
  }
}
```

### 작업 4. main.ts에 cookie-parser 등록과 CORS credentials

```ts
// src/main.ts
// import 한 줄을 추가하고, bootstrap 안의 enableCors 줄을 아래 두 줄로 바꾼다
import cookieParser from 'cookie-parser';
// ...

  // 요청의 Cookie 헤더를 읽어 req.cookies 객체로 만들어 준다
  app.use(cookieParser());
  // credentials: true: 다른 출처(localhost:3000)에서 보낸 요청에도 쿠키를 싣고, 응답의 Set-Cookie를 받아들이게 허락한다
  app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true });
```

`cookieParser()`를 빠뜨려도 서버는 잘 뜬다. 쿠키는 `Cookie` 헤더로 도착하지만 `req.cookies`가 채워지지 않아서, refresh가 언제나 `refresh token이 없습니다`(401)로 끝난다.

### 개념 | CORS의 credentials와 SameSite: 출처와 사이트는 다르다

CORS에 `credentials: true`가 필요한 이유는 프론트(`localhost:3000`)에서 백엔드(`localhost:4000`)로 쿠키를 주고받으려면 양쪽이 모두 동의해야 하기 때문이다.

서버는 이 옵션으로, 브라우저 쪽 코드는 `fetch(..., { credentials: "include" })`로 동의한다.

> 이때 서버는 `Access-Control-Allow-Origin`에 `*`가 아니라 정확한 출처를 적어야 한다(`*`와 `credentials`는 함께 쓸 수 없다).

포트만 다른 `localhost:3000`과 `localhost:4000`은 출처(origin)는 다르지만 같은 사이트로 취급되므로 `SameSite=Strict` 쿠키도 오간다.

| 구분 | 무엇이 같아야 같은 것인가 | `localhost:3000` ↔ `localhost:4000` | 누가 쓰나 |
|---|---|---|---|
| 출처(origin) | 스킴 + 호스트 + 포트 | 다르다 | CORS. 그래서 `credentials: true`가 필요하다 |
| 사이트(site) | 스킴 + 등록 가능한 도메인. 포트는 보지 않는다 | 같다 | `SameSite`. 그래서 `Strict`여도 쿠키가 실린다 |

CORS는 브라우저가 지키는 규칙이다.

`curl`은 CORS를 모르므로 `credentials`가 없어도 쿠키를 주고받는다. 브라우저에서만 안 되는 증상은 이 칸부터 본다.

### 작업 5. curl로 쿠키 확인

#### Set-Cookie 헤더 보기

```sh
# -i: 응답 헤더를 함께 출력한다. Origin 헤더로 "프론트에서 온 요청"을 흉내 낸다
curl -i -X POST localhost:4000/auth/login -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}'

# 출력에서 이 단계와 관련된 헤더만 옮겼다
HTTP/1.1 200 OK
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Credentials: true
Set-Cookie: refresh_token=g-oMBX718xPRvWclWPmKFGR_HFiG8xVM70Ufypw0PLc; Max-Age=604800; Path=/auth; Expires=Sun, 11 Oct 2025 14:14:36 GMT; HttpOnly; SameSite=Strict
```

로컬이라 `Secure`는 빠져 있다.

#### 쿠키 저장소로 refresh 해 보기

이제 `curl`이 브라우저처럼 쿠키를 저장했다가 다시 보내게 한다.

```sh
# -c 파일: 응답의 Set-Cookie를 파일(쿠키 저장소)에 저장한다. -b 파일: 그 파일의 쿠키를 요청에 싣는다
curl -s -c jar.txt -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}'

grep refresh jar.txt
#HttpOnly_localhost	FALSE	/auth	FALSE	1791728631	refresh_token	1MZj8KeEqsSB...

curl -s -b jar.txt -c jar.txt -X POST localhost:4000/auth/refresh
{"accessToken":"eyJ..."}  # 200
```

쿠키 파일 한 줄은 도메인, 하위 도메인 포함 여부, 경로, Secure 여부, 만료 시각(초), 이름, 값 순서다. `curl`도 `#HttpOnly_` 표시를 남긴다.

브라우저라면 이 쿠키는 개발자 도구의 Application(저장소) 탭에서는 보이지만, 콘솔에서 `document.cookie`를 쳐도 나오지 않는다.

### 용어 | Node crypto API (토큰 해시·인코딩)

- `createHash("sha256").update(값).digest("hex")`: 값의 SHA-256 해시를 16진수 문자열로 만든다. 세 단계로 나뉜 이유는 아래 "`createHash`: 넣고(update) 끝낸다(digest)"에서 다룬다.

- `randomUUID()`: 무작위 UUID 문자열을 만든다. 여기서는 사슬 이름표(`familyId`)로 쓴다.

- `buffer.toString("base64url")`: URL과 쿠키에 그대로 넣어도 되는 문자(`+`, `/` 대신 `-`, `_`)만 쓰는 인코딩이다. hex·base64와의 차이는 아래 "바이트를 문자열로: hex, base64, base64url"에서 다룬다.

### 개념 | `createHash`: 넣고(update) 끝낸다(digest)

C에서 OpenSSL로 SHA-256을 계산해 봤다면 `SHA256_Init` → `SHA256_Update`(여러 번) → `SHA256_Final` 순서를 기억할 것이다.

`createHash`도 같은 구조다. 해시 상태를 담은 객체를 만들고, 데이터를 넣고, 마지막에 결과를 꺼낸다.

```js
import { createHash } from "node:crypto";

const h = createHash("sha256"); // SHA256_Init
h.update("a").update("bc"); // SHA256_Update. 나눠 넣어도 "abc"를 한 번에 넣은 것과 같다
console.log(h.digest("hex")); // SHA256_Final
// 출력: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad

h.digest("hex"); // 에러: Digest already called (ERR_CRYPTO_HASH_FINALIZED)
```

- `update`는 해시 객체 자신을 돌려주므로, 이 문서의 `sha256` 함수처럼 `createHash(...).update(...).digest(...)`를 한 줄로 이어 쓸 수 있다.

- `digest`를 부르면 그 객체는 끝난다. 다시 `update`나 `digest`를 부르면 에러가 난다. 그래서 `sha256` 함수는 부를 때마다 `createHash`부터 새로 만든다.

- 데이터를 나눠 넣을 수 있는 이유는 큰 파일을 조각마다 `update`해서 전부 메모리에 올리지 않고 해시하기 위해서다. 토큰처럼 짧은 값은 한 번에 넣는다.

> `digest`에 넘기는 `"hex"`는 결과 바이트를 어떤 글자로 적을지 고르는 것이고, 해시 알고리즘과는 상관없다.

### 개념 | 바이트를 문자열로: hex, base64, base64url

DB의 문자열 컬럼, 쿠키, URL에는 바이트를 그대로 넣을 수 없어서 글자로 바꿔 적는다. 같은 바이트라도 인코딩에 따라 길이와 쓰는 글자가 다르다.

```js
import { randomBytes } from "node:crypto";

const b = randomBytes(32); // refresh token과 같은 32바이트
console.log(b.toString("hex").length, b.toString("base64").length, b.toString("base64url").length);
// 출력: 64 44 43

const fixed = Buffer.from([0xfb, 0xff, 0xfe, 0x01]);
console.log(fixed.toString("hex"), fixed.toString("base64"), fixed.toString("base64url"));
// 출력: fbfffe01 +//+AQ== -__-AQ
```

| 인코딩 | 1바이트당 글자 수 | 쓰는 글자 | 이 문서에서 |
|---|---|---|---|
| hex | 2 | `0-9`, `a-f` | 솔트, 비밀번호 해시, `token_hash` |
| base64 | 약 1.33 | 영문 대소문자, 숫자, `+`, `/`, 끝을 채우는 `=` | 쓰지 않는다 |
| base64url | 약 1.33 | 영문 대소문자, 숫자, `-`, `_`(`=` 없음) | refresh token 원문(쿠키 값) |

- base64의 `+`, `/`, `=`는 URL과 쿠키에서 다른 뜻으로 읽힌다. 쿼리 문자열에서 `+`는 공백이 되고, Express의 `res.cookie`는 이런 글자를 `%2B`, `%2F`, `%3D`로 바꿔 싣는다. base64url은 처음부터 이 글자들을 쓰지 않는다.

- 되돌릴 때는 같은 이름을 넘긴다. 1단계의 `Buffer.from(hashHex, "hex")`가 그 예다.

- 2단계에서 디코드해 본 JWT의 세 부분도 base64url이다. 인코딩은 글자 바꾸기일 뿐이라 누구나 되돌릴 수 있다.

> hex는 사람이 읽고 비교하기 쉽고, base64url은 짧다. DB에서 눈으로 볼 값은 hex로, 쿠키처럼 매 요청 오가는 값은 base64url로 골랐다.

### 용어 | Express 쿠키 API

쿠키 속성(`httpOnly`, `sameSite`, `secure`, `path`)의 뜻은 0장 개념 3의 표에 있다.

- `CookieOptions`: `res.cookie()`에 넘기는 옵션의 타입이다.

- `res.cookie(이름, 값, 옵션)`: 응답에 `Set-Cookie` 헤더를 붙인다.

- `maxAge`: 쿠키 수명(밀리초)이다. 이 시간이 지나면 브라우저가 쿠키를 지운다. 헤더에는 초 단위로 적히며, 아래 "`maxAge`는 밀리초, `Max-Age`는 초"에서 다룬다.

- `req.cookies`: `cookie-parser`가 `Cookie` 헤더를 읽어 만들어 준 객체다. 미들웨어가 없으면 비어 있으므로 `?.`로 읽는다.

### 개념 | `maxAge`는 밀리초, `Max-Age`는 초

Express 옵션의 `maxAge`는 `Date.now()`와 같은 밀리초 단위다. Express는 헤더를 만들 때 이것을 초로 나눠 `Max-Age`에 적고, 같은 시각을 `Expires`(날짜)로도 적는다.

단위가 둘이라 헷갈리기 쉽다.

```ts
// 이 문서의 코드: 초 단위 상수에 1000을 곱해 넘긴다
res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 });
// Set-Cookie: refresh_token=...; Max-Age=604800; Path=/auth; Expires=...; HttpOnly; SameSite=Strict

// 잘못: 헤더처럼 초로 적었다
res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: 604800 });
// Set-Cookie: refresh_token=...; Max-Age=604; Path=/auth; Expires=...; HttpOnly; SameSite=Strict
```

두 번째는 7일이 아니라 604초(약 10분) 뒤에 브라우저가 쿠키를 지운다.

로그인과 refresh는 잘 되다가 마지막 refresh 뒤 10분이 지나면 refresh가 `refresh token이 없습니다`(진단 4)로 실패하는, 원인을 찾기 어려운 증상이 된다.

- `maxAge`를 아예 빼면 `Max-Age`와 `Expires`가 없는 쿠키가 되고, 브라우저는 이것을 브라우저를 닫을 때 지운다(세션 쿠키).

- 공통 옵션 `refreshCookieOptions`에는 수명을 넣지 않고, 발급할 때만 `{ ...refreshCookieOptions, maxAge }`로 펼쳐서 더한다. 같은 객체를 6단계의 `clearCookie`에도 넘기기 때문이다(Express 5의 `clearCookie`는 `maxAge`를 넣어도 무시하고 1970년 만료로 지운다).

> 수명을 초로 정해 두고(`REFRESH_TOKEN_TTL_SECONDS`) 넘기는 순간에만 `* 1000`을 붙이면, 단위를 바꾸는 곳이 한 군데로 모인다.

### 용어 | NestJS 데코레이터 (응답 객체)

- `@Res({ passthrough: true })`: Express의 응답 객체를 받는다. `passthrough: true`를 붙여야 `res`로 쿠키만 만지고, 응답 본문은 평소처럼 `return` 값으로 보낸다. 빼면 Nest가 "응답은 네가 직접 끝내라"로 이해해서, `res.json()`을 직접 부르지 않으면 요청이 끝나지 않는다. 아래 "`@Res()`를 받으면 응답은 누가 보내는가"에서 다룬다.

### 개념 | `@Res()`를 받으면 응답은 누가 보내는가

Nest는 평소 핸들러의 `return` 값을 받아 JSON으로 응답을 보낸다.

그런데 핸들러가 `@Res()`로 Express 응답 객체를 받으면, Nest는 "이 핸들러는 응답을 직접 보낸다"고 보고 `return` 값을 응답으로 쓰지 않는다.

```ts
// 잘못: passthrough 없이 @Res()만 받았다
@Post("login")
@HttpCode(200)
async login(@Body() dto: LoginDto, @Res() res: Response) {
  const { accessToken, refreshToken } = await this.authService.login(dto.id, dto.password);
  res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 });
  return { accessToken }; // 아무도 보내지 않는다. 클라이언트는 응답을 하염없이 기다린다
}
```

고치는 방법은 두 가지다.

| 방식 | 본문을 보내는 쪽 | 이 문서에서 |
|---|---|---|
| `@Res({ passthrough: true })` + `return 값` | Nest(평소와 같다) | 쓴다 |
| `@Res()` + `res.json(값)` | 핸들러가 직접 | 쓰지 않는다 |

- 이 문서의 `login`, `refresh`, `logout`, `logout-all`은 모두 "쿠키만 직접 만지고 본문은 Nest에 맡기는" 경우라 `passthrough: true`를 쓴다.

- 6단계의 `logout`처럼 아무것도 `return`하지 않아도, `passthrough: true`면 Nest가 `@HttpCode(204)`로 본문 없는 응답을 보내 준다.

- `@Req()`에는 이런 문제가 없다. 요청 객체는 읽기만 하므로 응답 책임이 바뀌지 않는다.

> `@Res()`를 받는 순간 응답을 끝낼 책임이 Nest에서 핸들러로 넘어간다. `passthrough: true`는 그 책임을 다시 Nest에 돌려주는 스위치다.

### 실험 | 일부러 깨뜨려보기 ②: 복사된 쿠키는 7일 내내 통한다.

쿠키 파일을 복사해서 "공격자"가 가져갔다고 치자.

```sh
cp jar.txt jar-attacker.txt
curl -s -o /dev/null -w "user refresh → %{http_code}\n" -b jar.txt -c jar.txt -X POST localhost:4000/auth/refresh
user refresh → 200

curl -s -o /dev/null -w "user refresh → %{http_code}\n" -b jar.txt -c jar.txt -X POST localhost:4000/auth/refresh
user refresh → 200

curl -s -o /dev/null -w "attacker refresh → %{http_code}\n" -b jar-attacker.txt -X POST localhost:4000/auth/refresh
attacker refresh → 200

curl -s -o /dev/null -w "attacker refresh → %{http_code}\n" -b jar-attacker.txt -X POST localhost:4000/auth/refresh
attacker refresh → 200
```

사용자와 공격자가 같은 refresh token으로 계속 새 액세스 토큰을 받는다.

httpOnly가 XSS로 훔쳐 가는 길은 막았지만, 다른 경로(감염된 PC, 유출된 로그, 프록시 등)로 한 번 복사되면 서버는 둘을 구별할 방법이 없다. 7일 동안 열려 있는 셈이다.

### 남길 것

- **찾아보면 되는 것**: 쿠키 옵션 이름, `curl`의 `-i`·`-c`·`-b`, 쿠키 파일의 열 순서, hex·base64·base64url 표. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 오래 가는 토큰일수록 JS가 읽을 수 없는 httpOnly 쿠키에 둔다. 다만 httpOnly는 훔쳐 가는 길 하나(XSS)를 막을 뿐, 이미 복사된 쿠키는 서버가 구별하지 못한다.

  - `@Res()`를 받으면 응답을 끝낼 책임이 핸들러로 넘어간다. 쿠키만 만질 때는 `passthrough: true`로 본문을 Nest에 맡긴다.

- **에러 신호**:

  - `refresh token이 없습니다`(401) → 쿠키가 안 왔다. `main.ts`의 `cookieParser()`, `curl`의 `-b`, 쿠키의 `Path`

  - 로그인 요청이 응답 없이 멈춘다 → `@Res()`에 `passthrough: true`가 있는지

  - 마지막 refresh 뒤 10분쯤 지나 `refresh token이 없습니다` → `maxAge`를 초로 적지 않았는지(밀리초다)

  - 브라우저에서 다른 출처로 보낼 때만 쿠키가 안 실린다 → 서버의 `credentials: true`와 정확한 `origin`, 클라이언트의 `credentials: "include"`

## 5. 4단계: 회전과 재사용 감지

refresh token을 한 번 쓰면 회수하고 새 것을 준다. 그리고 이미 회수된 토큰이 오면 사슬(`familyId`) 전체를 끊는다.

회수와 새 토큰 발급은 둘 다 일어나거나 둘 다 안 일어나야 하므로 트랜잭션으로 묶는다.

### 작업 1. refresh를 회전하게 바꾸기

먼저 이렇게 짠다.

```ts
// src/auth/auth.service.ts
// refresh를 통째로 바꾼다
  async refresh(rawToken: string | undefined): Promise<IssuedTokens> {
    if (!rawToken) throw new UnauthorizedException("refresh token이 없습니다");
    const result = await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
      if (!token || token.expiresAt < new Date()) return { kind: "invalid" as const };
      if (token.revokedAt) {
        // 이미 쓴(또는 회수된) 토큰이 또 왔다 → 누군가 복사해 간 것으로 보고, 이 사슬의 살아 있는 토큰을 전부 회수한다
        await tx.refreshToken.updateMany({
          where: { familyId: token.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        throw new UnauthorizedException("이미 사용된 refresh token입니다 - 이 로그인 세션 전체를 회수합니다");
      }
      // 쓴 토큰을 회수하고, 같은 사슬(familyId)로 새 토큰을 발급한다
      await tx.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
      return { kind: "ok" as const, tokens: await this.issueTokens(tx, token.userId, token.familyId) };
    });
    if (result.kind === "invalid") throw new UnauthorizedException("유효하지 않은 refresh token입니다");
    return result.tokens;
  }
```

`issueTokens`에 `this.prisma`가 아니라 `tx`를 넘긴다. 3단계에서 `db` 매개변수를 밖에서 받게 만든 이유가 이것이다.

`this.prisma`를 넘기면 새 토큰의 `INSERT`가 트랜잭션 밖에서 따로 커밋된다. 그러면 회수가 롤백돼도 새 토큰은 남는다.

### 개념 | 태그된 유니온: 결과를 `kind`로 나눠 돌려주기

트랜잭션 콜백은 세 가지 결과 중 하나를 돌려준다. "토큰이 무효", "재사용"(뒤에서 추가), "정상과 새 토큰"이다.

결과마다 딸린 데이터가 다르다. 정상일 때만 `tokens`가 있다.

C라면 이것을 태그 필드와 공용체(union)로 표현한다.

```c
struct refresh_result {
    enum { INVALID, OK } kind;          // 어느 경우인지 알려 주는 태그
    union {
        struct issued_tokens tokens;    // kind == OK일 때만 의미가 있다
    } u;
};
```

C에서는 `kind`가 `INVALID`인데 `u.tokens`를 읽어도 컴파일러가 막지 않는다. 쓰레기 값이 나올 뿐이다.

TypeScript의 태그된 유니온(tagged union)은 같은 모양을 타입으로 검사한다.

```ts
type Result = { kind: "invalid" } | { kind: "ok"; tokens: IssuedTokens };

result.tokens; // 컴파일 에러: 'invalid' 쪽에는 tokens가 없다
if (result.kind === "invalid") throw new UnauthorizedException("...");
result.tokens; // 통과: 위의 if를 지나왔으니 여기서 result는 { kind: "ok"; tokens } 뿐이다
```

`kind`를 비교한 뒤에는 TS가 나머지 경우만 남기고 타입을 좁힌다. 이것을 좁히기(narrowing)라고 한다.

`as const`를 붙여야 `kind`의 타입이 그냥 `string`이 아니라 `"invalid"`, `"ok"` 같은 리터럴로 남는다. `string`이면 `result.kind === "invalid"`가 어느 쪽인지 가려 주지 못해서, `result.tokens`가 있다는 걸 TS가 알 수 없다.

> 콜백 안에서 예외로 빠져나가지 않고 결과를 값으로 돌려주는 이 모양이, 바로 아래 실험 ③을 고치는 열쇠가 된다.

### 실험 | 일부러 깨뜨려보기 ③: 공격자가 먼저 쓰면.

이번에는 공격자가 훔친 토큰 A를 먼저 쓰는 순서다.

```sh
npx prisma db seed

curl -s -o /dev/null -c u.txt -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}'

cp u.txt a.txt # 공격자가 토큰 A를 복사

curl -s -o /dev/null -w "① 공격자 refresh(A→B) → %{http_code}\n" -b a.txt -c a.txt -X POST localhost:4000/auth/refresh
# ① 공격자 refresh(A→B) → 200

curl -s -w " → %{http_code}\n" -b u.txt -X POST localhost:4000/auth/refresh # ② 사용자가 A를 냄
# {"message":"이미 사용된 refresh token입니다 - 이 로그인 세션 전체를 회수합니다","error":"Unauthorized","statusCode":401} → 401

curl -s -o /dev/null -w "③ 공격자 refresh(B) → %{http_code}\n" -b a.txt -c a.txt -X POST localhost:4000/auth/refresh
# ③ 공격자 refresh(B) → 200
```

②에서 재사용을 감지했고 메시지도 "전체를 회수합니다"고 말한다. 그런데 ③에서 공격자의 B는 여전히 통한다.

공격자는 계속 회전하며 세션을 유지하고, 진짜 사용자만 쫓겨났다. 최악의 결과다.

#### 원인: 콜백 안의 throw는 롤백이다

원인은 "**`$transaction` 콜백 안에서 예외를 던지면 트랜잭션 전체가 롤백된다.**"는 것이다

바로 앞 줄의 "사슬 전체 회수" `UPDATE`까지 함께 취소됐다.

`02`에서는 롤백이 반쪽 상태를 막아 주는 고마운 동작이었다. 이번에는 롤백이 해를 끼쳤다.

회수는 요청이 실패하더라도 반드시 커밋돼야 하는 쓰기다.

그래서 콜백 안에서는 결과만 돌려주고, 커밋이 끝난 뒤 밖에서 던진다.

### 작업 2. 고치기: 결과만 돌려주고, 커밋된 뒤 밖에서 던진다

```ts
// src/auth/auth.service.ts
// refresh 안에서 if (token.revokedAt) 블록의 throw를 return으로 바꾸고, 트랜잭션 밖에 throw 한 줄을 추가한다
      if (token.revokedAt) {
        await tx.refreshToken.updateMany({ /* 위와 같다 */ });
        // 여기서 예외를 던지면 위의 회수까지 롤백된다 → 결과만 돌려주고, 커밋된 뒤 밖에서 던진다
        return { kind: "reused" as const };
      }
      // ...
    });
    if (result.kind === "invalid") throw new UnauthorizedException("유효하지 않은 refresh token입니다");
    if (result.kind === "reused") throw new UnauthorizedException("이미 사용된 refresh token입니다 - 이 로그인 세션 전체를 회수합니다");
    return result.tokens;
```

#### 다시 돌려 확인

실험 ③의 명령을 시드부터 그대로 다시 실행한다.

```sh
npx prisma db seed

curl -s -o /dev/null -c u.txt -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}'

cp u.txt a.txt # 공격자가 토큰 A를 복사

curl -s -o /dev/null -w "① 공격자 refresh(A→B) → %{http_code}\n" -b a.txt -c a.txt -X POST localhost:4000/auth/refresh
# ① 공격자 refresh(A→B) → 200

curl -s -w " → %{http_code}\n" -b u.txt -X POST localhost:4000/auth/refresh # ② 사용자가 A를 냄
# {"message":"이미 사용된 refresh token입니다 - 이 로그인 세션 전체를 회수합니다","error":"Unauthorized","statusCode":401} → 401

curl -s -o /dev/null -w "③ 공격자 refresh(B) → %{http_code}\n" -b a.txt -c a.txt -X POST localhost:4000/auth/refresh
# ③ 공격자 refresh(B) → 401
```

이제 공격자도 끊겼다. 진짜 사용자는 다시 로그인하면 되지만, 공격자는 비밀번호를 모르니 돌아올 수 없다.

`psql`로 사슬을 보면 같은 `family_id`의 토큰이 모두 `revoked_at`을 갖고 있다.

```sh
docker compose exec db psql -U order -d order_api -c "SELECT id, left(family_id, 8) AS family, revoked_at IS NOT NULL AS revoked FROM refresh_tokens ORDER BY id"

# 출력
 id |  family  | revoked 
----+----------+---------
  1 | 56b55eed | t
  2 | 56b55eed | t
(2 rows)
```

### 남길 것

- **찾아보면 되는 것**: `as const`, `updateMany`의 `where`, `$transaction` 콜백의 반환값. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - `$transaction` 콜백 안에서 던지면 바로 앞의 쓰기까지 롤백된다. 요청이 실패해도 꼭 남아야 하는 쓰기(회수)가 있으면, 결과를 값으로 돌려주고 커밋된 뒤 밖에서 던진다.

  - 이미 쓴 토큰이 다시 오면 누가 공격자인지 몰라도 사슬 전체를 끊는다. 진짜 사용자는 비밀번호로 돌아올 수 있고 공격자는 못 돌아온다.

- **에러 신호**:

  - `이미 사용된 refresh token입니다`(401)가 났는데 같은 사슬의 다른 토큰이 여전히 200 → 회수 뒤의 `throw`가 트랜잭션 콜백 안에 있는지

## 6. 5단계: 같은 토큰으로 동시에 refresh하면

`02`를 마쳤다면 지금 코드에서 냄새가 날 것이다. `if (token.revokedAt)`로 읽고 판단한 뒤 `update`로 쓴다.

`02`의 4단계와 같은 "읽고 → 판단하고 → 쓰기"다.

### 작업 1. 동시 refresh 스크립트 만들기

같은 쿠키로 동시에 refresh를 보내는 스크립트를 만든다. 브라우저 탭 여러 개가 동시에 액세스 토큰 만료를 겪으면 실제로 일어나는 상황이다.

```js
// scripts/refresh-race.mjs
// 같은 refresh token 쿠키로 /auth/refresh를 동시에 N번 보내고, 살아남은 토큰이 몇 개인지 DB에서 센다
// 사용법: node scripts/refresh-race.mjs [요청 수]
import pg from "pg";

process.loadEnvFile();
const API = "http://localhost:4000";
const N = Number(process.argv[2] ?? 10);

// 준비 운동: 없는 토큰으로 N번 동시에 refresh해서 서버의 DB 연결 N개를 미리 열어 둔다(아래 "실험" 참고)
await Promise.all(
  Array.from({ length: N }, () => fetch(`${API}/auth/refresh`, { method: "POST", headers: { Cookie: "refresh_token=warmup" } })),
);

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
// Set-Cookie 헤더에서 "refresh_token=값" 부분만 떼어 낸다(브라우저가 하는 일을 손으로 한다)
// getSetCookie(): Set-Cookie는 여러 개가 올 수 있는 헤더라서 배열로 돌려준다
const cookie = login.headers.getSetCookie()[0].split(";")[0];

const statuses = await Promise.all(
  Array.from({ length: N }, () =>
    fetch(`${API}/auth/refresh`, { method: "POST", headers: { Cookie: cookie } }).then((r) => r.status),
  ),
);
const tally = statuses.reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
console.log("응답 코드별 개수:", tally);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query(`
  SELECT count(*)::int AS "발급된 토큰", count(*) FILTER (WHERE revoked_at IS NULL)::int AS "아직 유효한 토큰"
  FROM refresh_tokens WHERE user_id = 'kim'`);
console.table(rows);
await db.end();
```

`process.loadEnvFile()`은 `.env`를 읽어 `process.env`에 넣는다. `DEMO_PASSWORD`와 `DATABASE_URL`을 여기서 얻는다.

### 실험 | 같은 쿠키로 동시에 refresh 10번

```sh
npx prisma db seed && node scripts/refresh-race.mjs 10

응답 코드별 개수: { '200': 10 }
┌─────────┬─────────────┬──────────────────┐
│ (index) │ 발급된 토큰 │ 아직 유효한 토큰 │
├─────────┼─────────────┼──────────────────┤
│ 0       │ 11          │ 10               │
└─────────┴─────────────┴──────────────────┘
```

**토큰 하나가 열 개가 됐다.** 10개의 트랜잭션이 모두 `revokedAt`이 `NULL`인 같은 행을 읽고, 모두 "처음 쓰는 토큰"이라고 판단해 각자 새 토큰을 발급했다.

이 상태로는 회전의 의미가 없다. 공격자가 훔친 토큰을 사용자와 거의 동시에 쓰면 둘 다 살아남고, 재사용 감지도 일어나지 않는다.

#### 준비 운동이 없으면 버그가 숨는다

스크립트 맨 앞의 준비 운동 블록을 지우고 돌리면, 고치기 전 코드인데도 거의 매번 이렇게 나온다.

```sh
응답 코드별 개수: { '200': 1, '401': 9 }
┌─────────┬─────────────┬──────────────────┐
│ (index) │ 발급된 토큰 │ 아직 유효한 토큰 │
├─────────┼─────────────┼──────────────────┤
│ 0       │ 2           │ 0                │
└─────────┴─────────────┴──────────────────┘
```

아래 작업 2에서 고친 뒤의 결과와 똑같다. 버그가 고쳐진 것이 아니라 요청 10개가 우연히 한 줄로 선 것이다.

서버의 Prisma는 `pg` 연결 풀로 DB에 붙는다(`PrismaPg` 어댑터, 기본 최대 10개). 풀은 **10초 동안 놀고 있는 연결을 닫는다**(`pg`의 `idleTimeoutMillis` 기본값). `npx prisma db seed`는 10초 남짓 걸리므로, 시드가 끝나고 스크립트가 돌 때쯤이면 서버의 연결이 거의 다 닫혀 있다.

1. 로그인 요청이 연결 하나를 열어 쓰고 풀에 돌려놓는다.

2. refresh 10개가 동시에 들어온다. 그 하나 남은 연결을 받은 요청은 바로 트랜잭션을 시작한다.

3. 나머지 9개는 새 연결을 여는 중이다(TCP 연결 + 인증). 그 몇 ms 사이에 첫 트랜잭션이 읽고, 쓰고, 새 토큰을 넣고 커밋까지 끝낸다.

4. 늦게 연결된 9개가 `findUnique`를 할 때는 이미 `revokedAt`이 채워져 있다. 그래서 정상적으로 "재사용"으로 판정되고, 사슬 전체를 회수한다(그래서 유효한 토큰이 0이다).

요청은 동시에 보냈지만 DB에 닿은 시점이 어긋나서 경쟁이 일어나지 않은 것이다. 준비 운동 블록이 연결 10개를 미리 열어 두면 10개가 정말 같은 순간에 DB에 닿고, 버그가 드러난다.

> 동시성 버그는 "가끔은 괜찮아 보인다"는 게 가장 위험하다. 실험에서 결과가 기대와 다르면 코드보다 먼저 **요청들이 정말 동시에 DB에 닿았는지**를 의심한다. 운영에서는 트래픽이 많아 연결이 늘 데워져 있으니, 이 버그는 그대로 드러난다.

### 작업 2. 고치기: `02`의 5단계와 같은 처방

"아직 안 쓴 토큰이면 쓴 것으로 표시"를 `UPDATE` 한 문장에 넣고, 고친 행 수로 판단한다.

```ts
// src/auth/auth.service.ts
// refresh의 트랜잭션 콜백 안을 이렇게 바꾼다. if (token.revokedAt) 검사와 따로 있던 update를 지운다
      const token = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
      if (!token || token.expiresAt < new Date()) return { kind: "invalid" as const };

      // "아직 안 쓴 토큰이면 쓴 것으로 표시"를 UPDATE 한 문장으로. 조건부 UPDATE와 같은 방식
      const { count } = await tx.refreshToken.updateMany({
        where: { id: token.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) {
        // 이미 쓴(또는 회수된) 토큰이 또 왔다 → 누군가 복사해 간 것으로 보고, 이 사슬의 살아 있는 토큰을 전부 회수한다
        await tx.refreshToken.updateMany({
          where: { familyId: token.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // 여기서 예외를 던지면 위의 회수까지 롤백된다 → 결과만 돌려주고, 커밋된 뒤 밖에서 던진다
        return { kind: "reused" as const };
      }
      return { kind: "ok" as const, tokens: await this.issueTokens(tx, token.userId, token.familyId) };
```

`if (token.revokedAt)` 검사와 따로 있던 `update`가 사라지고, 조건부 `updateMany` 하나가 둘을 대신한다.

`update`가 아니라 `updateMany`인 이유는 `02`의 5단계와 같다. `update`는 `WHERE`에 맞는 행이 없으면 `P2025` 예외를 던지고, `updateMany`는 고친 행 수(`count`)를 돌려준다.

트랜잭션 밖의 `invalid`·`reused` 두 줄의 `throw`는 4단계 작업 2 그대로 둔다.

#### 다시 돌려 확인

```sh
npx prisma db seed && node scripts/refresh-race.mjs 10

응답 코드별 개수: { '200': 1, '401': 9 }
┌─────────┬─────────────┬──────────────────┐
│ (index) │ 발급된 토큰 │ 아직 유효한 토큰 │
├─────────┼─────────────┼──────────────────┤
│ 0       │ 2           │ 0                │
└─────────┴─────────────┴──────────────────┘
```

몇 번을 돌려도 새 토큰은 하나만 발급된다. 그런데 "아직 유효한 토큰"이 0이다.

이 이유는 아래 "사용자가 로그아웃되는 것은 버그가 아니라 선택이다"에서 다룬다.

### 개념 | 조건부 `updateMany`가 동시 요청을 한 줄로 세우는 과정

요청 10개가 같은 쿠키로 동시에 들어왔을 때, 고친 코드에서는 이런 순서로 일이 일어난다.

1. 10개 요청이 각자 트랜잭션을 연다. `findUnique`는 잠그지 않는 평범한 읽기라서 10개 모두 `revokedAt`이 `NULL`인 행을 본다. 여기까지는 고치기 전과 같다.

2. 가장 먼저 `UPDATE ... WHERE id = $1 AND revoked_at IS NULL`에 도달한 트랜잭션이 그 행의 잠금을 얻고 `revoked_at`을 채운다. 잠금은 이 트랜잭션이 새 토큰을 `INSERT`하고 커밋할 때까지 유지된다.

3. 나머지 9개는 같은 행을 고치려다 잠금에서 기다린다.

4. 첫 트랜잭션이 커밋하면, PostgreSQL(기본 `READ COMMITTED`)은 기다리던 `UPDATE`마다 그 행의 최신 버전으로 `WHERE`를 다시 검사한다. `revoked_at`이 채워져 있으니 조건에 안 맞고, 고친 행은 0개다.

5. `count === 0`이 된 9개는 "재사용"으로 판정된다.

고치기 전 코드가 실패한 이유는 판단의 근거가 1번의 `findUnique` 결과(이미 지난 값)였기 때문이다. 뒤따르는 `update`는 `id`만으로 고치니, 4번처럼 다시 검사할 조건이 없었다.

판단을 `UPDATE`의 `WHERE`로 옮기면, 잠금을 기다린 뒤의 재검사가 곧 판단이 된다. `02`의 재고 차감(`WHERE stock >= 수량`)과 똑같은 구조다.

### 개념 | 사용자가 로그아웃되는 것은 버그가 아니라 선택이다

"아직 유효한 토큰"이 0인 이유는 나머지 9개 요청이 "이미 쓴 토큰"으로 판정되어 사슬 전체를 회수했기 때문이다.

그 사슬에는 방금 성공한 요청이 받은 새 토큰도 들어 있다. 결과적으로 사용자는 로그아웃된다.

**이것은 버그가 아니라 선택이다.** 서버 입장에서 "같은 토큰이 동시에 두 번 왔다"는 상황은, 탭 두 개가 동시에 refresh한 것인지 공격자와 사용자가 동시에 쓴 것인지 구별할 수 없다.

이 코드는 의심스러우면 끊는 안전한 쪽으로 실패를 고른 것이다. 대가는 정상 사용자가 가끔 다시 로그인해야 한다는 점이다.

> 그래서 실무에서는 클라이언트가 refresh 요청을 한 번에 하나만 보내도록(이미 진행 중인 refresh가 있으면 그 결과를 같이 기다리도록) 짜서 이 상황 자체를 줄인다. 프론트엔드 쪽의 이 처리는 서버만 다루는 이 문서의 범위 밖이다.

### 남길 것

- **찾아보면 되는 것**: `getSetCookie()`, `count(*) FILTER (WHERE ...)`, `console.table`, `process.loadEnvFile()`, `pg` 풀의 `idleTimeoutMillis`(기본 10초). 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - "읽고 → 판단하고 → 쓰기"는 트랜잭션 안에서도 끼어든다. 조건을 `UPDATE`의 `WHERE`에 넣고 고친 행 수로 판단하면, 잠금을 기다린 뒤의 재검사가 판단이 된다.

  - 서버가 구별할 수 없는 상황(동시 refresh)은 안전한 쪽으로 실패를 고른다. 그 대가가 무엇인지까지 알고 고른다.

  - 요청을 동시에 보냈다고 DB에 동시에 닿는 것은 아니다. 동시성 실험이 "괜찮다"고 나오면, 고쳐졌다고 믿기 전에 정말 경쟁이 일어났는지부터 의심한다.

- **에러 신호**:

  - `{ '200': 10 }`에 "아직 유효한 토큰"이 여러 개 → 회수가 조건부 `updateMany`(`revokedAt: null` 조건)인지

  - 고치기 전인데 `{ '200': 1, '401': 9 }`라서 괜찮아 보인다 → 스크립트에 준비 운동 블록이 있는지. 서버의 DB 연결이 식어 있으면 요청이 우연히 한 줄로 선다

## 7. 6단계: 로그아웃

### 작업 1. AuthService에 logout·logoutAll 추가

```ts
// src/auth/auth.service.ts
// 클래스 안, refresh 아래에 두 메서드를 추가한다
  // 지금 이 로그인(사슬) 하나만 끝낸다
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!token) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: token.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // 이 사용자의 모든 기기에서 로그아웃
  async logoutAll(userId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }
```

`logout`은 쿠키가 없거나 모르는 토큰이어도 에러 없이 끝난다. 로그아웃하려는 사람에게 "이미 로그아웃돼 있다"를 에러로 돌려줄 이유가 없다.

### 작업 2. 컨트롤러에 logout·logout-all 경로 추가

```ts
// src/auth/auth.controller.ts
// import 두 줄을 이렇게 바꾸고(UseGuards, AuthGuard 추가), 클래스 안 refresh 아래에 메서드 두 개를 추가한다
import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
// ...

  @Post("logout")
  @HttpCode(204) // 204 No Content: 성공했지만 돌려줄 본문이 없다
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions); // 지울 때도 path가 같아야 지워진다
  }

  @Post("logout-all")
  @HttpCode(200)
  @UseGuards(AuthGuard("jwt"))
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const revoked = await this.authService.logoutAll((req.user as { userId: string }).userId);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
    return { revoked };
  }
```

`logout`에는 Guard를 걸지 않는다. 액세스 토큰이 이미 만료된 상태에서도 로그아웃은 돼야 하기 때문이다.

쿠키의 refresh token이 곧 "누구의 어느 세션인지"를 알려 준다.

반대로 `logout-all`은 모든 기기를 끊는 강한 동작이라 유효한 액세스 토큰을 요구한다.

### 작업 3. 로그아웃 확인

```sh
curl -i -b jar.txt -c jar.txt -X POST localhost:4000/auth/logout
HTTP/1.1 204 No Content
X-Powered-By: Express
Access-Control-Allow-Origin: http://localhost:3000
Vary: Origin
Access-Control-Allow-Credentials: true
Set-Cookie: refresh_token=; Path=/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict
Date: Mon, 12 Oct 2025 07:49:41 GMT
Connection: keep-alive
Keep-Alive: timeout=5

curl -s -o /dev/null -w "%{http_code}\n" -b jar.txt -X POST localhost:4000/auth/refresh
401
```

쿠키를 "지우는" 방법은 따로 없다. 같은 이름, 같은 `Path`로 이미 지난 만료 시각(1970년)을 보내면 브라우저가 지운다.

> `Path`가 다르면 다른 쿠키로 취급되어 지워지지 않는다. 그래서 `clearCookie`에도 같은 옵션을 넘긴다.

`-c jar.txt`로 응답을 저장했으니 `curl`의 쿠키 저장소에서도 쿠키가 지워졌다. 그래서 두 번째 요청은 쿠키 없이 가서 `refresh token이 없습니다`(401)가 된다.

로그아웃 전 쿠키를 따로 복사해 두었다가 보내면 `이미 사용된 refresh token입니다`(401)가 돌아온다. 로그아웃이 회수한 토큰도 "이미 쓴 토큰"과 똑같이 `revoked_at`이 채워져 있기 때문이다.

### 실험 | 일부러 깨뜨려보기 ④: 로그아웃했는데 액세스 토큰은 살아 있다.

로그인할 때 받은 액세스 토큰을 `TOKEN_BEFORE_LOGOUT`에 담아 두고, 로그아웃한 뒤 그 토큰으로 API를 호출한다.

```sh
# 로그인: 쿠키는 jar.txt에, 액세스 토큰은 변수에
TOKEN_BEFORE_LOGOUT=$(curl -s -c jar.txt -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

curl -s -o /dev/null -w "%{http_code}\n" -b jar.txt -c jar.txt -X POST localhost:4000/auth/logout
204

curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN_BEFORE_LOGOUT" localhost:4000/me/orders
200
```

로그아웃은 refresh token(DB의 행)만 끊는다.

이미 나간 액세스 토큰은 서명이 유효한 한 만료될 때까지 통한다.

2단계에서 수명을 15분으로 줄인 이유가 이것이다. 로그아웃이나 계정 정지가 최대 15분 늦게 반영되는 것을 받아들이는 설계다.

> 즉시 끊어야 한다면 매 요청마다 DB나 캐시를 확인해야 하는데, 그러면 JWT의 장점(DB를 안 봄)이 사라진다.

### 작업 4. 모든 기기에서 로그아웃

같은 사용자로 두 번 로그인해서(두 기기) `logout-all`을 부른다.

```sh
npx prisma db seed

# 기기 1: 쿠키는 device1.txt에, 액세스 토큰은 변수에
TOKEN=$(curl -s -c device1.txt -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

# 기기 2
curl -s -o /dev/null -c device2.txt -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}'

curl -s -w " → %{http_code}\n" -H "Authorization: Bearer $TOKEN" -X POST localhost:4000/auth/logout-all
# {"revoked":2} → 200

curl -s -o /dev/null -w "device2 refresh → %{http_code}\n" -b device2.txt -X POST localhost:4000/auth/refresh
# device2 refresh → 401
```

시드로 `refresh_tokens`를 비운 뒤 두 번 로그인했으니, 살아 있는 토큰은 사슬마다 하나씩 두 개다. `revoked`가 2인 이유다.

### 남길 것

- **찾아보면 되는 것**: `res.clearCookie`, `@HttpCode(204)`, `curl -i`로 `Set-Cookie` 보기. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 로그아웃은 refresh token(DB 행)만 끊는다. 이미 나간 액세스 토큰은 만료까지 통하므로, 액세스 토큰의 수명이 곧 로그아웃이 늦게 반영되는 최대 시간이다.

  - 쿠키 삭제는 같은 이름·같은 `Path`로 지난 만료 시각을 보내는 것이다. 옵션이 다르면 다른 쿠키다.

- **에러 신호**:

  - 로그아웃했는데 브라우저에 쿠키가 남아 있다 → `clearCookie`에 설정할 때와 같은 `path`를 넘겼는지

  - 로그아웃 뒤에도 같은 액세스 토큰으로 `/me/orders`가 200 → 정상이다. 액세스 토큰은 만료까지 통한다

  - `logout-all`이 `{"message":"Unauthorized","statusCode":401}` → `Authorization: Bearer` 헤더(이 경로에만 Guard가 걸려 있다)

## 8. 7단계: 남의 주문 들여다보기(IDOR) 막기

지금까지의 주문 API(`GET /orders/:id`)는 앞에서부터 이어 온 공개 데모 경로라 누구의 주문이든 보여 준다. 실제 서비스에서는 로그인한 사용자가 자기 주문만 봐야 한다.

### 작업 1. `GET /me/orders/:id` 추가

2단계에서 만든 `MeController`에 주문 하나를 보는 경로를 추가한다.

```ts
// src/me/me.controller.ts
// "@nestjs/common" import를 이렇게 바꾸고(NotFoundException, Param, ParseIntPipe 추가), 메서드를 하나 추가한다
import { Controller, Get, NotFoundException, Param, ParseIntPipe, Req, UseGuards } from "@nestjs/common";
// ...

  @Get("orders/:id")
  async myOrder(@Param("id", ParseIntPipe) id: number, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    const order = await this.prisma.order.findFirst({ where: { id }, select: orderSelect });
    if (!order) throw new NotFoundException(`order ${id} not found`);
    return order;
  }
```

### 실험 | 일부러 깨뜨려보기 ⑤: 남의 주문 id를 넣어 본다.

시드에서 주문 2번은 `lee`의 것이다. `kim`으로 로그인해서 요청한다.

`$TOKEN`이 비어 있거나 만료됐으면 2단계 작업 3의 `TOKEN=...` 줄로 다시 받는다.

```sh
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders/2
{"id":2,"price":8000,"paid":false,"createdAt":"..."}  # 200
```

`kim`이 `lee`의 주문을 읽었다. 경로가 `/me/...`이고 로그인도 요구하지만, `myOrder`는 `userId`를 꺼내 놓고 쿼리 조건에 쓰지 않았다.

### 개념 | 인증과 인가: IDOR은 WHERE 조건 하나다

이것이 **IDOR**(Insecure Direct Object Reference, 안전하지 않은 직접 객체 참조)다. URL의 id만 바꿔서 남의 데이터에 접근하는 공격이다.

인증과 인가는 서로 다른 질문이다.

| 질문 | 이름 | 이 문서에서 답하는 곳 |
|---|---|---|
| 이 요청을 보낸 사람이 누구인가 | 인증(authentication) | `AuthGuard("jwt")`와 `JwtStrategy`가 `req.user`를 채운다 |
| 그 사람이 이 데이터에 권한이 있는가 | 인가(authorization) | 쿼리의 `WHERE userId = ...` |

Guard는 첫 번째 질문에만 답한다. `@UseGuards`를 붙였다고 두 번째 질문까지 해결되지 않는다.

이름은 거창하지만, 실제로는 `WHERE` 조건 하나를 빼먹은 것이다.

### 작업 2. 고치기: id와 userId를 함께 건다

```ts
// src/me/me.controller.ts
// myOrder의 findFirst 한 줄을 바꾼다
    // id와 userId를 함께 조건으로 건다. 남의 주문 id를 넣으면 "없는 주문"과 똑같이 404가 된다
    const order = await this.prisma.order.findFirst({ where: { id, userId }, select: orderSelect });
```

`findUnique`가 아니라 `findFirst`인 이유는 `findUnique`의 `where`에는 기본키나 `@unique` 컬럼만 쓸 수 있어서다. `id`와 `userId`를 함께 거는 조건은 `findFirst`로 쓴다.

```sh
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders/2 # lee의 주문
{"message":"order 2 not found","error":"Not Found","statusCode":404}

curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders/999 # 없는 주문
{"message":"order 999 not found","error":"Not Found","statusCode":404}
```

남의 주문과 없는 주문이 똑같이 404다. 403(권한 없음)을 돌려주면 "그 id의 주문은 존재한다"는 사실이 새어 나간다.

1단계에서 로그인 메시지를 통일한 것과 같은 이유다.

### 남길 것

- **찾아보면 되는 것**: `findFirst`와 `findUnique`의 `where` 차이, `ParseIntPipe`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 인증(누구인가)과 인가(이 데이터에 권한이 있나)는 따로 확인한다. Guard는 인증만 하고, 인가는 쿼리의 `WHERE`가 한다.

  - 남의 것과 없는 것은 같은 응답(404)으로 돌려준다. 다른 응답은 존재 여부를 알려 준다.

- **에러 신호**:

  - 남의 주문 id(`/me/orders/2`)가 200 → 쿼리 `where`에 `userId`가 있는지

  - `Validation failed (numeric string is expected)`(400) → `:id` 자리에 숫자가 아닌 값이 왔다(`ParseIntPipe`)

## 9. 8단계: 회귀 테스트

`02`의 10단계처럼 실제 DB를 쓰는 e2e 테스트로 회전과 재사용 감지를 고정한다.

### 작업 1. 테스트 DB에 마이그레이션 적용

새 마이그레이션이 생겼으니 테스트 DB에도 적용한다.

```sh
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

빠뜨리면 테스트의 `TRUNCATE refresh_tokens, ...`가 `relation "refresh_tokens" does not exist`로 실패한다.

### 작업 2. 기존 checkout 테스트 고치기

`02`의 `test/checkout.e2e-spec.ts`는 사용자를 비밀번호 없이 만들어서, 이제 로그인 단계에서 실패한다. 비밀번호 해시를 넣도록 고친다.

```ts
// test/checkout.e2e-spec.ts
// import에 hashPassword를 추가하고, beforeEach의 TRUNCATE 목록에 refresh_tokens를, 사용자 생성에 passwordHash를 넣는다
import { hashPassword } from "../src/auth/password.js";
// ...
    await prisma.$executeRaw`TRUNCATE refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await prisma.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword(process.env.DEMO_PASSWORD!) } });
```

### 작업 3. refresh 회전 테스트 작성·실행

#### 테스트 파일

```ts
// test/auth.e2e-spec.ts
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

describe("refresh token 회전 - 회귀 테스트", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // main.ts와 같은 전역 설정. cookieParser가 빠지면 req.cookies가 비어 refresh가 전부 401이 된다
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0);
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await prisma.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw-for-test") } });
  });

  afterAll(async () => {
    await app.close();
  });

  // 로그인해서 "refresh_token=값" 쿠키를 받아 온다
  const login = async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kim", password: "pw-for-test" }),
    });
    return res.headers.getSetCookie()[0].split(";")[0];
  };
  const refresh = (cookie: string) => fetch(`${baseUrl}/auth/refresh`, { method: "POST", headers: { Cookie: cookie } });

  it("한 번 쓴 refresh token을 다시 쓰면 401이고, 그 사이 발급된 토큰까지 회수된다", async () => {
    const a = await login();
    const first = await refresh(a);
    expect(first.status).toBe(200);
    const b = first.headers.getSetCookie()[0].split(";")[0];
    expect(b).not.toBe(a); // 회전: 새 토큰을 받았다

    expect((await refresh(a)).status).toBe(401); // 재사용 감지
    expect((await refresh(b)).status).toBe(401); // 사슬 전체 회수
  });

  it("같은 토큰으로 동시에 10번 refresh해도 성공은 1번뿐이다", async () => {
    const a = await login();
    const statuses = await Promise.all(Array.from({ length: 10 }, () => refresh(a).then((r) => r.status)));

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0); // 재사용으로 판정되어 사슬이 회수됐다
  });
});
```

테스트 앱은 `main.ts`를 거치지 않는다. `Test.createTestingModule`로 `AppModule`만 띄우므로, `main.ts`의 `app.use(cookieParser())` 같은 전역 설정을 여기서 다시 걸어야 한다.

`checkout.e2e-spec.ts`는 쿠키를 쓰지 않아서 `cookieParser`가 없어도 됐다. 이 파일은 refresh가 쿠키에 기대므로 반드시 필요하다.

#### 실행

```sh
npm run test:e2e
npm notice run order-api-nest@0.0.1 test:e2e
npm notice run vitest run --config ./vitest.config.e2e.ts
The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option. You can remove the plugin and set resolve.tsconfigPaths: true in your Vite config instead.

 RUN  v4.1.11 /Users/woopinbell/Desktop/ongoing/nodejs/order3/order-api-nest

 ✓ test/checkout.e2e-spec.ts (2 tests) 547ms
 ✓ test/auth.e2e-spec.ts (2 tests) 557ms
 ✓ test/app.e2e-spec.ts (1 test) 129ms

 Test Files  3 passed (3)
      Tests  5 passed (5)
   Start at  16:59:28
   Duration  2.50s (transform 102ms, setup 17ms, import 983ms, tests 1.23s, environment 0ms)
```

### 실험 | 테스트가 4단계의 버그를 잡는지 확인한다

4단계의 "트랜잭션 안에서 throw" 버전으로 되돌려 보면 두 테스트가 모두 실패한다.

- 첫 번째는 `refresh(b)`가 401이 아니라 200이다(`expected 200 to be 401`).

- 두 번째는 살아 있는 토큰이 0개가 아니라 1개다(`expected 1 to be +0`). 회수가 롤백되면 동시 refresh에서 이긴 요청의 새 토큰도 살아남기 때문이다.

> 직접 확인하고 원복한다.

### 남길 것

- **찾아보면 되는 것**: `getSetCookie()`, vitest의 `toBe`·`toHaveLength`, `prisma migrate deploy`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 동시성과 보안 동작(회전, 재사용 감지)은 실제 DB에 대고 테스트로 고정한다. 코드를 되돌렸을 때 실패하는지까지 봐야 그 테스트를 믿을 수 있다.

  - 테스트 앱은 `main.ts`를 거치지 않는다. 전역 미들웨어·파이프·필터를 테스트 쪽에도 같이 건다.

- **에러 신호**:

  - e2e에서 refresh가 전부 401 → 테스트 앱에 `app.use(cookieParser())`가 있는지

  - `relation "refresh_tokens" does not exist` → 테스트 DB에 `migrate deploy`를 했는지

  - checkout 테스트가 로그인 단계에서 실패한다 → 테스트 사용자에 `passwordHash`를 넣었는지

  - `expected 200 to be 401` / `expected 1 to be +0` → 회수 뒤의 `throw`가 트랜잭션 콜백 안으로 돌아갔는지

## 10. 9단계: 토큰과 쿠키가 어디서 사라졌는지 디버깅하기

인증 문제는 대부분 "**보냈다고 생각한 값이 실제로는 안 갔다**"이다. 눈에 보이지 않는 헤더와 쿠키를 먼저 드러낸다.

### 진단 1. JWT 안을 들여다보기

2단계 작업 3의 디코드 명령으로 payload의 `sub`(누구), `iat`(발급 시각), `exp`(만료 시각)를 본다.

401이 날 때 `exp`가 현재 시각(`date +%s`)보다 작으면 만료다.

> 서버 시계와 발급한 쪽 시계가 어긋나도 같은 증상이 난다(컨테이너나 VM의 시계가 틀린 경우).

### 진단 2. 쿠키가 실리지 않을 때 확인할 것

```sh
# -v: 요청과 응답의 헤더를 모두 보여 준다. ">" 줄이 보낸 것, "<" 줄이 받은 것
curl -v -b jar.txt -X POST localhost:4000/auth/refresh 2>&1 | grep -iE "^> cookie|^< set-cookie"
```

`> Cookie:` 줄이 없으면 쿠키가 아예 안 간 것이다. 대표적인 원인은 다음과 같다.

| 증상 | 원인 |
|---|---|
| `/auth/refresh`에는 가는데 `/orders`에는 안 간다 | 정상이다. `Path=/auth`라서 그렇다 |
| 로그아웃했는데 브라우저에 쿠키가 남아 있다 | `clearCookie`의 `path`가 설정할 때와 다르다 |
| 운영(HTTPS)에서는 되는데 로컬에서 안 된다 / 그 반대 | `Secure`. `Secure` 쿠키는 http에서는 보내지 않는다 |
| 브라우저에서 다른 출처로 보낼 때만 안 된다 | 서버의 `credentials: true`와 정확한 `origin`, 클라이언트의 `credentials: "include"` 중 하나가 빠졌다 |
| 서버에 쿠키는 왔는데 `req.cookies`가 비어 있다 | `cookieParser()`를 등록하지 않았다(e2e 테스트 앱에서 자주 빠뜨린다) |

### 진단 3. refresh token 사슬 들여다보기

```sql
-- 한 사용자의 로그인 세션(사슬)별로 토큰 수와 살아 있는 토큰 수
SELECT left(family_id, 8) AS family, count(*) AS tokens,
       count(*) FILTER (WHERE revoked_at IS NULL) AS alive, max(created_at) AS last_rotated
FROM refresh_tokens WHERE user_id = 'kim'
GROUP BY family_id ORDER BY last_rotated DESC;
```

`docker compose exec db psql -U order -d order_api`로 들어가서 실행한다.

정상적인 사슬은 `alive`가 1(로그인 중)이거나 0(로그아웃했거나 회수됨)이다.

> `alive`가 2 이상이면 회전이 깨진 것이다. 5단계의 경쟁 조건이 다시 생겼다는 신호다.

### 진단 4. 에러 메시지·증상으로 원인 가르기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| 시드 사용자에 맞는 비밀번호인데 `id 또는 password가 올바르지 않습니다`(401) | 그 계정의 `password_hash`가 `NULL`이다 | 시드를 다시 돌렸는지 | 1단계 |
| `Nest can't resolve dependencies of the AuthController (?)` | 컨트롤러가 받을 `AuthService`를 Nest가 모른다 | `auth.module.ts`의 `providers` | 1단계 |
| 시드가 `The "password" argument must be of type string ... Received undefined`로 멈춘다 | `hashPassword`에 `undefined`가 넘어갔다 | `.env`의 `DEMO_PASSWORD` | 1단계 |
| 시드 뒤 네 사용자의 `password_hash`가 완전히 같다 | 해시를 한 번만 만들어 나눠 넣었다 | `map` 안에서 사용자마다 `hashPassword`를 부르는지 | 1단계 |
| `password must be longer than or equal to 8 characters`(400) | 회원가입 비밀번호가 `@MinLength(8)`에 걸렸다 | 요청 본문의 `password` | 1단계 |
| `'key' is of type 'unknown'`(TS18046) | `promisify(scrypt)`의 결과 타입이 `unknown`으로 추론됐다 | `as (...) => Promise<Buffer>` 단언 | 1단계 |
| `{"message":"Unauthorized","statusCode":401}` (메시지 없음) | 액세스 토큰 검증 실패(없음, 서명 틀림, 만료) | 진단 1의 `exp`, `Authorization: Bearer ` 형식 | 2단계 |
| 서버는 뜨는데 `Cannot GET /me/orders`(404) | `MeModule`이 `AppModule`의 `imports` 사슬에 없다 | `app.module.ts`의 `imports` | 2단계 |
| `refresh token이 없습니다`(401) | 쿠키가 안 왔다 | 진단 2, `main.ts`의 `cookieParser()` | 3단계 |
| 로그인 요청이 응답 없이 멈춘다 | `@Res()`를 받아 응답 책임이 핸들러로 넘어갔다 | `@Res({ passthrough: true })` | 3단계 |
| 마지막 refresh 뒤 10분쯤 지나 `refresh token이 없습니다` | 쿠키 수명이 초로 적혀 1000분의 1이 됐다 | `maxAge`(밀리초) | 3단계 |
| 브라우저에서 다른 출처로 보낼 때만 쿠키가 안 실린다 | CORS에서 쿠키를 허락하지 않았다 | `credentials: true`와 정확한 `origin`, 클라이언트의 `credentials: "include"` | 3단계 |
| `유효하지 않은 refresh token입니다`(401) | DB에 없는 토큰이거나 만료됐다 | 시드를 다시 돌려 `refresh_tokens`가 비워졌는가, `expires_at` | 3·4단계 |
| `이미 사용된 refresh token입니다`(401) | 재사용 감지(로그아웃으로 회수된 토큰을 다시 보내도 이 메시지다) | 5단계의 동시 refresh(정상 사용자)인지, 진단 3에서 같은 사슬에 낯선 회전이 있는지(탈취), 로그아웃한 뒤의 낡은 쿠키인지 | 4단계 |
| `이미 사용된 refresh token입니다`가 났는데 같은 사슬의 다른 토큰이 여전히 200 | 사슬 회수가 롤백됐다 | 회수 뒤의 `throw`가 트랜잭션 콜백 안에 있는지 | 4단계 |
| `{ '200': 10 }`에 "아직 유효한 토큰"이 여러 개, 또는 진단 3의 `alive`가 2 이상 | 동시 refresh가 같은 토큰을 각자 회전시켰다 | 조건부 `updateMany`(`revokedAt: null`) | 5단계 |
| 고치기 전인데 `{ '200': 1, '401': 9 }`라서 괜찮아 보인다 | 서버의 DB 연결이 10초 넘게 놀아 닫혀 있어서, 요청이 DB에 닿는 시점이 어긋났다 | `refresh-race.mjs`의 준비 운동 블록 | 5단계 |
| 로그아웃했는데 브라우저에 쿠키가 남아 있다 | 지우는 쿠키의 `Path`가 다르다 | `clearCookie`의 `path` | 6단계 |
| 로그아웃 뒤에도 같은 액세스 토큰으로 `/me/orders`가 200 | 정상이다. 액세스 토큰은 만료까지 통한다 | 액세스 토큰 수명(`ACCESS_TOKEN_TTL`) | 6단계 |
| `logout-all`이 401 | 이 경로는 유효한 액세스 토큰을 요구한다 | `Authorization: Bearer` 헤더 | 6단계 |
| 남의 주문 id(`/me/orders/2`)가 200 | 인가 누락(IDOR) | 쿼리 `where`의 `userId` | 7단계 |
| `Validation failed (numeric string is expected)`(400) | `:id`가 숫자가 아니다 | `ParseIntPipe`가 받은 값 | 7단계 |
| e2e에서 refresh가 전부 401 | 테스트 앱의 `req.cookies`가 비어 있다 | 테스트의 `app.use(cookieParser())` | 8단계 |
| `relation "refresh_tokens" does not exist` | 테스트 DB에 새 마이그레이션이 없다 | `DATABASE_URL=...order_api_test npx prisma migrate deploy` | 8단계 |
| checkout 테스트가 로그인 단계에서 실패한다 | 테스트 사용자에 비밀번호가 없다 | 테스트의 `passwordHash` | 8단계 |
| `expected 200 to be 401` / `expected 1 to be +0` | 사슬 회수가 롤백됐다 | 회수 뒤의 `throw` 위치 | 8단계 |

> 401 메시지 네 가지(`refresh token이 없습니다`, `유효하지 않은`, `이미 사용된`, 메시지 없음)는 각각 쿠키, DB 행, 회전 사슬, 액세스 토큰으로 가는 갈림길이다. 먼저 어느 메시지인지부터 본다.

### 시험해보기

```sh
npx prisma db seed && node scripts/refresh-race.mjs 10
```

`{ '200': 1, '401': 9 }`와 "아직 유효한 토큰 0"이 나오는지 확인한다. 이어서 4단계의 "공격자가 먼저 쓰는" 세 줄을 다시 실행해 ③이 401인지 확인한다.

### 도전 과제

#### 1. 관리자만 통과시키는 Guard 만들기

앞에서부터 이어 온 공개 경로(`GET /orders`, `GET /orders/:id`, `GET /orders/totals`)는 지금도 누구에게나 모든 주문을 보여 준다.

`users`에 `role` 컬럼(`"user"` / `"admin"`)을 추가하고, 관리자만 통과시키는 Guard를 만들어 이 경로들에 건다.

JWT payload에 `role`을 넣을지, 매 요청마다 DB에서 읽을지 장단점을 생각해 본다.

**답**

1. `users`에 `role` 컬럼(`String @default("user")`)을 추가하고 마이그레이션한다. 기존 사용자는 모두 `"user"`가 되고, 시드에서 `choi`만 `"admin"`으로 둔다.

2. `CanActivate`를 구현한 `AdminGuard`를 만든다. `req.user.userId`로 DB에서 `role`을 읽어 `"admin"`일 때만 `true`를 돌려준다. `false`를 돌려주면 Nest가 403으로 응답한다.

3. 세 경로에 `@UseGuards(AuthGuard("jwt"), AdminGuard)`를 건다. 적힌 순서대로 실행되므로, JWT 검사가 먼저 `req.user`를 채운다.

4. 토큰 없이 부르면 401, `kim` 토큰이면 `{"message":"Forbidden resource","error":"Forbidden","statusCode":403}`, `choi` 토큰이면 200이다. `kim`의 `GET /me/orders`는 그대로 200이다.

5. `psql`로 `choi`의 `role`을 `"user"`로 바꾸면, 다시 로그인하지 않은 같은 토큰으로도 바로 403이 된다. 매 요청마다 DB에서 읽기 때문이다.

> `role`을 JWT payload에 넣으면 이 DB 조회가 없어진다. 대신 0장 개념 2와 깨뜨려보기 ④에서 본 대로 이미 나간 토큰은 만료 전까지 그대로 통하므로, 관리자 권한을 빼앗아도 최대 15분 동안은 관리자로 남는다. 관리자 경로는 호출이 적으니 쿼리 하나를 더 내고 즉시 반영되는 쪽을 골랐다.

#### 2. 오래된 refresh token 정리하기

오래된 `refresh_tokens` 행은 계속 쌓인다. 만료된 지 하루가 지난 행을 지우는 정리 작업을 `02`의 `OutboxRelay`처럼 주기적으로 실행되게 만든다.

> 지울 때 `02`의 교훈(한 번에 너무 많이 지우면 잠금이 길어진다)을 떠올려 `LIMIT`을 건다.

회수됐지만 아직 만료되지 않은 행은 왜 지우면 안 되는가?

**답**

1. `OutboxRelay`와 같은 모양으로 `RefreshTokenCleaner`를 만들어 `AuthModule`의 `providers`에 넣는다. `onApplicationBootstrap`에서 `setInterval`을 걸고(기본 1시간), 이전 회차가 덜 끝났으면 건너뛰며, `onModuleDestroy`에서 `clearInterval`한다.

2. 한 회차에서는 `DELETE FROM refresh_tokens WHERE id IN (SELECT id FROM refresh_tokens WHERE expires_at < (now() AT TIME ZONE 'UTC') - interval '1 day' ORDER BY id LIMIT 1000)`을 지운 행이 1000개보다 적을 때까지 반복한다. 문장 하나가 곧 트랜잭션 하나라 잠금도 1000행씩 잡았다가 놓는다.

3. `expires_at`은 Prisma가 UTC로 넣은 시간대 없는 값이라 `now()`도 `AT TIME ZONE 'UTC'`로 맞춰 비교한다.

4. 2일 전에 만료된 행 2500개, 1시간 전에 만료된 행 3개, 유효한 행 1개를 넣고 주기를 2초로 줄여 켜면 `만료된 refresh token 2500건 삭제`가 한 번 찍힌다. `DELETE`는 세 번(1000, 1000, 500) 나가고, 남은 4행은 그대로다.

5. 질문의 답: 회수된 행은 재사용 감지의 근거다. 공격자가 A를 B로 회전한 뒤 회수된 A의 행을 지우면, 사용자가 A를 냈을 때 `이미 사용된`이 아니라 `유효하지 않은 refresh token입니다`(401)가 되고 사슬 회수가 일어나지 않아 공격자의 B가 계속 200이다. 그래서 만료 시각만 기준으로 지운다.

### 남길 것

- **찾아보면 되는 것**: `curl -v`의 `>`·`<` 줄, `date +%s`, `count(*) FILTER (WHERE ...)`와 `GROUP BY family_id`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 인증 문제는 대부분 "보냈다고 생각한 값이 안 갔다"이다. 코드를 의심하기 전에 헤더와 쿠키가 실제로 오갔는지부터 드러낸다.

  - 401 메시지 네 가지가 각각 쿠키, DB 행, 회전 사슬, 액세스 토큰으로 가는 갈림길이다.

- **에러 신호**:

  - 메시지 없는 401 → 진단 1의 `exp`, `Authorization: Bearer ` 형식

  - `> Cookie:` 줄이 없다 → 진단 2의 표(`Path`, `Secure`, CORS, `cookieParser`)

  - 진단 3의 `alive`가 2 이상 → 5단계의 조건부 `updateMany`

## 11. 완성 확인

### 체크리스트

- [ ] 비밀번호가 사용자마다 다른 솔트의 `scrypt$...` 해시로 저장된다

- [ ] 없는 id와 틀린 비밀번호가 메시지도, 응답 시간도 구별되지 않는다

- [ ] 로그인 응답의 `Set-Cookie`에 `HttpOnly; SameSite=Strict; Path=/auth`가 붙는다

- [ ] 공격자가 먼저 쓴 refresh token도, 진짜 사용자가 옛 토큰을 내미는 순간 끊긴다(4단계 ③이 401)

- [ ] 같은 토큰으로 동시에 10번 refresh해도 새 토큰은 하나만 발급된다

- [ ] 로그아웃 후 refresh는 401이고, 액세스 토큰은 만료 전까지 통한다는 것을 설명할 수 있다

- [ ] `/me/orders/:id`에 남의 주문 id를 넣으면 404다

- [ ] `npm run test:e2e`가 통과한다

## 12. 다음 단계

### 자가 점검

1. 비밀번호에는 `scrypt`를, refresh token에는 SHA-256을 쓴 이유는?

2. 메시지를 통일했는데도 가입 여부가 샌 이유와, 더미 해시가 그걸 어떻게 막는가?

3. 액세스 토큰을 짧게 하면 무엇을 얻고, 무엇을 refresh token에 떠넘기는가?

4. httpOnly는 무엇을 막고, 무엇을 못 막는가(3단계의 깨뜨려보기 ②)?

5. 4단계에서 재사용을 감지하고도 공격자가 살아남은 이유는? `02`의 어느 규칙과 같은 이야기인가?

6. 동시 refresh에서 결국 사용자가 로그아웃되는 것을 왜 "버그가 아니라 선택"이라고 하는가?

7. IDOR에 403 대신 404를 돌려주는 이유는?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 행 수준 보안(RLS): IDOR을 앱의 `WHERE`가 아니라 DB가 막게 하기. 기존 공개 경로와 관리자 역할 설계가 함께 필요하다

- 동시 refresh를 덜 엄격하게 처리하는 유예 시간(grace period). 방금 회전된 토큰은 몇 초 동안 같은 응답을 돌려주는 방식

- 클라이언트에서 refresh를 한 번에 하나만 보내기(single-flight)

- WebSocket 연결의 토큰 만료. 알림 게이트웨이는 연결할 때 한 번만 검사하므로, 액세스 토큰이 만료돼도 연결은 유지된다

- 로그인 시도 횟수 제한(무차별 대입 방어), 비밀번호 재설정, 이메일 인증, 다단계 인증(MFA)

- 외부 계정으로 로그인(OAuth, 소셜 로그인)