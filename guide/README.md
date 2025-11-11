# 행 수준 보안(RLS): 남의 데이터를 DB가 직접 막기

## 목표

이 프로젝트는 [`09-category-tree`](https://github.com/seungwoo7050/node-order/tree/09-category-tree)로부터 시작한다.

[`03-auth-hardening`](https://github.com/seungwoo7050/node-order/tree/03-auth-hardening)의 IDOR(남의 주문 id를 넣어 읽기)를 다시 꺼낸다.

`03`에서는 앱 코드의 `WHERE`에 소유자 조건을 넣어 막았다. 그 조건은 개발자가 쿼리마다 기억해야 하고, 하나만 빠뜨려도 뚫린다.

이 문서는 같은 규칙을 PostgreSQL이 직접 지키게 한다. 앱이 조건을 빠뜨려도 DB가 남의 행을 돌려주지 않는다.

1. `orders`, `order_items`에 RLS를 켜고 "내 주문만"이라는 정책을 건다

2. 정책이 듣지 않는 경우(슈퍼유저)를 직접 겪고, 앱 전용 역할을 만든다

3. 요청마다 "누가 요청했는가"를 트랜잭션 안에서만 DB에 알려 준다

4. 그 설정을 연결(세션)에 걸면 다른 사용자의 요청으로 새는 것을 재현한다

```sh
# 앞에서 고친 IDOR 버그(소유자 조건 빠뜨리기)를 일부러 되살려도
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders/2 # kim이 lee의 주문을 요청
# {"message":"order 2 not found","error":"Not Found","statusCode":404}
```

DB가 lee의 행을 돌려주지 않았다.

> 시작 기준점:  
> `order-api-nest`가 `09`까지 완료된 상태다.  
> `01`의 제약, `02`의 트랜잭션과 커넥션 풀, `03`의 IDOR, `07`의 컨테이너 구성을 다시 쓴다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 SQL 문법·함수의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러이거나 새는 데이터다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 10장에서 "어디서 틀어졌나"를 가르는 절차 | 친다(`psql`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 10장만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지다. 섞이면 센 쪽 하나만 붙인다(`[커밋]` > `[원복]` > `[실행]` > `[확인]`).

  | 태그 | 무엇이 남는가 | 커밋 |
  |---|---|---|
  | `[커밋]` | 저장소의 파일: 코드, 설정(`.env` 포함), 마이그레이션, 테스트 | 한다 |
  | `[실행]` | 저장소 밖의 상태: 컨테이너, DB에 적용된 마이그레이션. 다음 작업이 이 상태에 기댄다 | 안 한다 |
  | `[확인]` | 남는 것이 없다: 조회, 요청 보내기, 결과 읽기 | 안 한다 |
  | `[원복]` | `실험 \|`에서 바꾼 것을 되돌린다. 이 문서는 실험 끝에서 바로 원복하므로 이 태그를 쓰는 작업이 없다 | 안 한다 |

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 10장 "진단 3"의 표에 모두 모았다.

- 0장(전제)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 확인 명령뿐이고 11·12장은 체크리스트라서 `남길 것`을 두지 않았다.

- 3장(2단계)과 7장(6단계)은 깨뜨려 보는 장이라 `작업` 없이 `실험`만 있다. 그래도 남길 것이 분명해서 `남길 것`을 두었다.

| 단계 | 하는 일 |
|---|---|
| [0. 전제](#0-전제) | RLS를 유닉스 파일 권한에, 요청자 설정을 thread-local 변수에 빗대 본다(작업 없음) |
| [1. 준비](#1-준비) | DB를 띄우고 지금 앱이 붙는 계정이 슈퍼유저인지 확인한다 |
| [2. 1단계: RLS 켜기와 정책](#2-1단계-rls-켜기와-정책) | `orders`·`order_items`에 RLS를 켜고 "내 주문만" 정책을 마이그레이션으로 건다 |
| [3. 2단계: 정책이 듣지 않는다(일부러 깨뜨려보기 ①)](#3-2단계-정책이-듣지-않는다일부러-깨뜨려보기-①) | 슈퍼유저로 붙은 앱에서는 정책이 아무것도 막지 못하는 것을 본다 |
| [4. 3단계: 앱 전용 역할](#4-3단계-앱-전용-역할) | RLS를 받는 일반 역할 `order_app`을 만들고 권한을 준다 |
| [5. 4단계: 연결을 둘로 나누고, 일부러 깨뜨려보기 ②](#5-4단계-연결을-둘로-나누고-일부러-깨뜨려보기-②) | 앱은 `order_app`, 마이그레이션·시드는 소유자로 붙이고, 아무 설정 없이 띄워 본다 |
| [6. 5단계: 요청마다 "누구인가"를 트랜잭션 안에서](#6-5단계-요청마다-누구인가를-트랜잭션-안에서) | `asUser`·`asAdmin`으로 요청자를 트랜잭션에만 설정하고 주문 경로에 적용한다 |
| [7. 6단계: 설정이 다음 요청으로 샌다(일부러 깨뜨려보기 ③)](#7-6단계-설정이-다음-요청으로-샌다일부러-깨뜨려보기-③) | 설정을 세션 범위로 바꾸면 다른 요청에 kim의 주문이 보이는 것을 재현한다 |
| [8. 7단계: 테스트](#8-7단계-테스트) | 테스트 준비·확인을 소유자 연결로 옮기고 RLS 회귀 테스트를 더한다 |
| [9. 8단계: 컨테이너 구성](#9-8단계-컨테이너-구성) | compose의 앱 연결만 `order_app`으로 바꾼다 |
| [10. 디버깅](#10-디버깅) | "지금 누구로 붙었나", "정책이 쿼리에 붙었나"를 `psql`로 가르고 신호 표로 원인을 찾는다 |
| [11. 완성 확인](#11-완성-확인) | 체크리스트 |
| [12. 다음 단계](#12-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 전제

### 개념 1 | RLS는 유닉스 파일 권한과 같은 자리에 있다.

C로 `open("/etc/shadow", O_RDONLY)`를 하면 프로그램이 권한을 확인하는 코드를 하나도 안 넣었어도 `EACCES`가 돌아온다.

권한 검사를 커널이 `open()`마다 하기 때문이다. 프로그램의 실수와 상관없이 규칙이 지켜진다.

단, root로 실행하면 이 검사를 건너뛴다.

RLS가 이 구조다. 테이블에 정책을 걸면 PostgreSQL이 모든 `SELECT`·`INSERT`·`UPDATE`·`DELETE`마다 정책 조건을 덧붙인다.

앱이 `WHERE`를 빠뜨려도 정책 조건이 남는다.

> root처럼, 슈퍼유저와 RLS 무시 권한(`BYPASSRLS`)을 가진 역할은 정책을 건너뛴다. 2단계에서 이 예외에 걸린다.

### 개념 2 | DB는 "누가 요청했는지" 모른다.

정책을 "주문의 `user_id`가 요청한 사람과 같을 때"로 쓰려면, DB가 요청한 사람을 알아야 한다.

그런데 DB에 붙는 것은 사용자가 아니라 앱 서버 하나다. 모든 요청이 같은 DB 계정, 같은 커넥션 풀로 들어온다.

그래서 앱이 요청마다 "이번엔 kim이다"를 DB에 알려 줘야 한다.

PostgreSQL은 이런 값을 설정 변수로 둘 수 있다(`set_config('app.user_id', 'kim', ...)`). 정책은 그 값을 `current_setting('app.user_id')`로 읽는다.

여기에 함정이 있다. `02`에서 본 대로 커넥션은 **풀에서 재사용된다.**

C로 치면 스레드 풀의 스레드에 thread-local 변수를 남겨 둔 채 다음 작업을 받는 것과 같다. 다음 작업이 그 값을 물려받는다.

6단계에서 이게 실제로 새는 것을 본다.

## 1. 준비

`09`의 `order-api-nest`에서 이어 간다. 새로 설치할 패키지는 없다.

### 작업 1. [실행] DB를 띄우고 지금 붙는 계정 확인

```sh
cd order-api-nest
docker compose up -d db redis storage
docker compose exec db psql -U order -d order_api -tAc "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'order'"
# order|t|t
```

지금까지 앱이 붙어 온 `order` 계정은 슈퍼유저(`t`)이고 RLS 무시 권한(`t`)도 있다.

`docker-compose.yml`의 `POSTGRES_USER`로 만든 첫 계정은 원래 그렇다. 지금까지 만든 테이블의 소유자도 이 계정이다.

## 2. 1단계: RLS 켜기와 정책

정책은 Prisma 스키마로 표현할 수 없으므로, 빈 마이그레이션을 만들어 SQL을 직접 쓴다.

Prisma를 버리는 것은 아니다. `schema.prisma`는 테이블의 모양(컬럼, 관계, 인덱스)을 적는 곳이고, Prisma는 그 모양이 바뀐 만큼을 비교해 마이그레이션 SQL을 만들어 준다.

"어떤 행을 누가 볼 수 있는가" 같은 규칙은 스키마에 적을 문법이 없다. 적을 수 없으니 비교해서 만들어 줄 것도 없다.

그래서 SQL을 쓰는 자리만 사람이 맡고, 나머지는 그대로 Prisma가 한다. 파일은 `prisma/migrations` 아래에 다른 마이그레이션과 나란히 생기고, `migrate dev`·`migrate deploy`가 같은 순서로 적용하고 기록한다.

테스트 DB(7단계)와 컨테이너의 `migrate` 서비스(8단계)에도 따로 할 일 없이 들어간다.

> 반대로 `schema.prisma`만 봐서는 정책이 있는지 알 수 없다. 지금 걸린 정책은 DB에서 확인한다(10장 진단 2의 `pg_policies`).

### 작업 1. [커밋] 빈 마이그레이션 만들기

```sh
npx prisma migrate dev --create-only --name enable-rls
```

`--create-only`는 마이그레이션 폴더와 빈 `migration.sql`만 만들고 적용은 하지 않는다. 스키마가 바뀌지 않았으니 파일은 비어 있다.

### 작업 2. [커밋] 정책 SQL 쓰고 적용하기

방금 생긴 파일을 이렇게 채운다.

```sql
-- prisma/migrations/<날짜시각>_enable_rls/migration.sql
-- 행 수준 보안(RLS): 이 테이블의 어떤 행을 볼 수 있고 쓸 수 있는지를 DB가 판단한다
-- 판단 기준은 "지금 트랜잭션에 설정된 값" - 앱이 요청마다 app.user_id(누구인가), app.role(관리자인가)을 설정한다

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;

-- USING : 읽기·고치기·지우기에서 보이는 행의 조건, WITH CHECK : 새로 넣거나 고친 결과가 만족해야 하는 조건
-- current_setting(이름, true) : 설정이 없으면 에러 대신 NULL → 어떤 user_id와도 같지 않다 → 아무것도 안 보인다(기본이 거부)
CREATE POLICY orders_owner ON "orders"
  USING ("user_id" = current_setting('app.user_id', true) OR current_setting('app.role', true) = 'admin')
  WITH CHECK ("user_id" = current_setting('app.user_id', true) OR current_setting('app.role', true) = 'admin');

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;

-- 주문 품목은 "그 주문이 보이면 보인다". 안쪽 SELECT에도 orders의 정책이 적용되므로 규칙을 한곳(orders)에만 둔다
CREATE POLICY order_items_via_order ON "order_items"
  USING (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = "order_id"));
```

```sh
npx prisma migrate dev
```

### 개념 | `USING`과 `WITH CHECK`

정책의 두 줄이 각자 하는 일이 다르다.

- `USING`: 읽기·고치기·지우기에서 보이는 행을 거른다.

- `WITH CHECK`: 새로 넣거나 고친 결과가 만족해야 하는 조건이다.

`USING`만 있으면 kim이 `user_id`를 `lee`로 적은 주문을 넣을 수 있다. 넣고 나면 자기도 못 보는 행이 될 뿐이다.

`UPDATE`에는 둘이 함께 걸린다. 고칠 대상 행을 고르는 데는 `USING`이, 고친 뒤의 행에는 `WITH CHECK`가 쓰인다.

그래서 kim은 자기 주문의 `user_id`를 `lee`로 바꿔 넘겨줄 수도 없다.

### 개념 | 정책은 쿼리에 붙는 숨은 `WHERE`다

정책이 걸린 테이블을 읽으면 PostgreSQL은 쿼리를 계획하는 단계에서 정책의 `USING` 식을 조건으로 끼워 넣는다.

앱이 보낸 SQL 문자열은 그대로지만, 실제로 실행되는 계획에는 조건이 하나 더 있다. 10장 "진단 2"의 `EXPLAIN`에서 `Filter:` 줄로 직접 보인다.

`order_items_via_order`의 안쪽 `SELECT 1 FROM "orders"`도 하나의 쿼리라서, 거기에도 `orders_owner`가 똑같이 끼워진다.

그래서 품목 정책은 "그 주문이 지금 사람에게 보이는가"만 묻고, 누가 주인인지는 `orders` 정책 한곳에서만 정한다.

### 개념 | 관리자 문(`app.role = 'admin'`)을 따로 둔 이유

`app.role = 'admin'`은 앞 과정부터 이어 온 "전체 주문 목록", "사용자별 합계" 같은 경로를 위한 것이다.

그 경로들은 원래 관리자 화면이어야 했다(`03`의 도전 과제 1).

`03`에서 RLS를 미룬 이유가 이 경로들이었다. 여기서는 "관리자로 읽는다"를 명시적으로 표시하는 쪽으로 푼다.

### 용어 | PostgreSQL 문법 (정책)

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`: 이 테이블의 어떤 행을 볼 수 있고 쓸 수 있는지를 DB가 판단하게 한다.

- `CREATE POLICY 이름 ON 테이블 USING (...) WITH CHECK (...)`: 테이블에 정책을 건다. `USING`과 `WITH CHECK`의 차이는 위 "`USING`과 `WITH CHECK`"에서 다뤘다.

- `EXISTS (SELECT 1 FROM ...)`: 안쪽 쿼리가 행을 하나라도 돌려주면 참이다. `SELECT 1`의 `1`은 아무 값이나 괜찮다는 뜻으로, 행이 있는지만 본다.

### 용어 | PostgreSQL 함수 (`current_setting`)

- `current_setting(이름, true)`: 설정 변수의 값을 읽는다. 두 번째 인자가 `true`면 설정이 없을 때 에러 대신 `NULL`을 돌려준다. 이 `NULL`이 왜 "아무것도 안 보임"이 되는지는 아래 "설정이 없으면 왜 0건인가"에서 다룬다.

- 이름의 `app.`처럼 점이 들어간 설정은 PostgreSQL이 미리 알지 못하는 사용자 정의 설정이다. 아무 이름이나 만들어 쓸 수 있고, 내장 설정과 겹치지 않게 접두어를 붙인다.

### 개념 | 설정이 없으면 왜 0건인가

정책 조건은 행마다 계산되는 식이고, 결과가 **참일 때만** 행이 보인다. 거짓도 `NULL`도 "안 보임"이다.

#### `NULL`과의 비교

SQL의 비교는 한쪽이 `NULL`이면 거짓이 아니라 `NULL`(모름)이 된다.

설정이 없을 때 `current_setting('app.user_id', true)`는 `NULL`이므로, `"user_id" = NULL`은 어떤 행에서도 참이 되지 않는다.

```sql
SELECT 'kim' = NULL; -- 결과: NULL (false가 아니다)
SELECT ('kim' = NULL) IS NULL; -- 결과: t
```

#### 두 번째 인자 `true`를 빼면

두 번째 인자 `true`를 빼면 이야기가 다르다. 설정이 없을 때 정책이 붙은 쿼리 자체가 에러로 끝난다.

```text
-- 정책을 USING ("user_id" = current_setting('app.user_id'))로 걸었을 때, 설정 없이 order_app으로
order_api=> SELECT count(*) FROM orders;
ERROR:  unrecognized configuration parameter "app.user_id"
```

#### 한 번 설정했던 연결에는 빈 문자열이 남는다

한 연결에서 한 번이라도 `app.user_id`를 설정했다면, 트랜잭션이 끝나 값이 사라진 뒤에는 `NULL`이 아니라 빈 문자열 `''`이 남는다.

10장 "진단 1"의 "(빈 값)"이 이것이다. `''`과 같은 `user_id`는 없으므로 결과는 똑같이 0건이다.

| 상황 | `current_setting('app.user_id', true)` | 정책 결과 |
|---|---|---|
| 이 연결에서 한 번도 설정한 적 없음 | `NULL` | 0건 |
| 트랜잭션 범위로 설정했다가 끝남 | `''` | 0건 |
| 지금 트랜잭션에서 `'kim'`으로 설정 | `'kim'` | kim의 행 |

- 정책을 "허용할 조건"으로 쓰면, 모르는 상태(`NULL`, `''`)는 저절로 거부 쪽에 떨어진다. 기본이 거부라서 안전하다.

- 정책의 `OR current_setting('app.role', true) = 'admin'`도 같은 원리다. `app.role`이 없으면 이쪽도 참이 되지 않아 관리자 문이 저절로 닫혀 있다.

> C의 `if (ptr == NULL)`처럼 값이 없음을 비교로 확인하는 습관은 SQL에서 통하지 않는다. `NULL`과의 비교는 늘 `NULL`이고, 확인은 `IS NULL`로 한다.

### 남길 것

- **찾아보면 되는 것**: `CREATE POLICY ... USING (...) WITH CHECK (...)`의 문법, `current_setting`의 두 번째 인자, `migrate dev --create-only`, 걸린 정책을 보는 `pg_policies`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - `USING`은 "보이는 행", `WITH CHECK`는 "만들어도 되는 행"이다. 둘 중 하나만 걸면 반대쪽 구멍이 남는다.
  - 정책을 "허용할 조건"으로 쓰면, 설정이 없는 상태(`NULL`, `''`)는 저절로 0건이 된다. 기본이 거부다.

- **에러 신호**:
  - `ERROR:  unrecognized configuration parameter "app.user_id"` → 정책의 `current_setting`에 두 번째 인자 `true`를 빠뜨렸는지

## 3. 2단계: 정책이 듣지 않는다(일부러 깨뜨려보기 ①)

정책을 걸었으니 막히는지 확인해 본다. 결과부터 말하면, 아무것도 막히지 않는다.

### 실험 | 설정 없이 `psql`로 세어 보기

```sh
docker compose exec db psql -U order -d order_api
```

```text
order_api=# SELECT count(*) FROM orders;
 5
```

설정이 없으니 0건이어야 하는데 5건이 다 보인다.

### 실험 | IDOR 버그를 되살려 kim으로 lee의 주문 읽기

앱도 같다. `03`의 7단계에서 고친 IDOR 버그를 잠깐 되살린다.

`findFirst`의 조건에서 `userId`를 뺀다.

```ts
// src/me/me.controller.ts
// myOrder의 findFirst에서 userId 조건만 뺀다(깨뜨려보기)
    const order = await this.prisma.order.findFirst({ where: { id }, select: orderSelect });
```

kim으로 로그인해 토큰을 `TOKEN`에 담고 lee의 주문(id 2)을 요청한다. 시드 사용자의 비밀번호는 `.env`의 `DEMO_PASSWORD`(`1234`)다.

```sh
npx prisma db seed
npm run start:dev
# 다른 터미널에서
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders/2
```

> 이 `TOKEN=...` 두 줄은 뒤의 단계에서도 그대로 다시 쓴다. 액세스 토큰은 15분 뒤 만료되므로(`.env`의 `ACCESS_TOKEN_TTL`), 요청이 `401`로 돌아오면 이 두 줄을 다시 친다.

```text
GET /me/orders/2 (kim) → {"id":2,"price":8000,"paid":false,...} → 200
```

여전히 뚫린다.

### 개념 | 슈퍼유저·`BYPASSRLS`·소유자는 정책을 건너뛴다

앱과 `psql`이 모두 슈퍼유저 `order`로 붙어 있기 때문이다. 0장 개념 1의 root처럼, 슈퍼유저와 `BYPASSRLS` 역할에는 정책이 아예 적용되지 않는다.

> 테이블의 소유자도 기본적으로 정책을 건너뛴다. `ALTER TABLE ... FORCE ROW LEVEL SECURITY`로 소유자에게도 강제할 수 있지만, 슈퍼유저는 그래도 건너뛴다.

여기서 흔히 하는 오해가 "RLS를 켰으니 이제 안전하다"다. RLS는 **누가 붙었느냐**에 따라 켜지기도 하고 꺼지기도 하는 검사라서, 켰다는 사실만으로는 아무것도 보장하지 않는다.

**RLS를 켜는 것만으로는 아무것도 바뀌지 않았다.** 되살린 버그는 원복한다(`where: { id, userId }`).

### 남길 것

- **찾아보면 되는 것**: `pg_roles`의 `rolsuper`·`rolbypassrls` 컬럼, `FORCE ROW LEVEL SECURITY`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 정책은 슈퍼유저·`BYPASSRLS`·테이블 소유자에게는 적용되지 않는다. RLS를 켰다면 "앱이 누구로 붙는가"부터 확인한다.

- **에러 신호**:
  - 정책을 걸었는데 설정 없이도 남의 행이 다 보인다(에러 없음) → `SELECT current_user`와 `pg_roles`로 앱 계정이 슈퍼유저·소유자인지
  - 토큰을 붙인 요청이 `{"message":"Unauthorized","statusCode":401}` → `TOKEN`이 만료됐는지(15분). 로그인 두 줄을 다시 친다

## 4. 3단계: 앱 전용 역할

앱은 슈퍼유저도, 테이블 소유자도 아닌 일반 역할로 붙어야 한다. 마이그레이션으로 만든다.

역할과 권한(`GRANT`)도 정책처럼 `schema.prisma`에 적을 문법이 없다. 1단계와 같은 방식으로 빈 마이그레이션에 SQL을 쓴다.

### 작업 1. [커밋] 역할 마이그레이션 만들기

```sh
npx prisma migrate dev --create-only --name app-role
```

```sql
-- prisma/migrations/<날짜시각>_app_role/migration.sql
-- 앱이 붙을 전용 역할. 슈퍼유저가 아니고 RLS를 무시하는 권한(BYPASSRLS)도 없다 → 정책이 적용된다
-- 역할은 DB 하나가 아니라 PostgreSQL 서버 전체에 하나다. Prisma가 검증용 임시 DB(shadow DB)에
-- 마이그레이션을 다시 돌릴 때도 실패하지 않도록 "없을 때만" 만든다
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'order_app') THEN
    CREATE ROLE order_app LOGIN PASSWORD 'order_app';   -- 학습용 비밀번호. 운영에서는 인프라 설정으로 만든다
  END IF;
END $$;

-- 테이블 구조는 못 바꾸고(마이그레이션은 소유자 order가 한다), 행 읽기·쓰기만 할 수 있다
GRANT USAGE ON SCHEMA public TO order_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO order_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO order_app;   -- SERIAL id의 번호표
-- 앞으로 소유자(order)가 만드는 테이블·시퀀스에도 같은 권한을 자동으로 준다
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO order_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO order_app;
```

```sh
npx prisma migrate dev
```

### 개념 | `DO $$ ... $$`로 감싸는 이유

`DO $$ ... $$`는 SQL 안에서 조건문을 쓰기 위한 익명 블록이다. `CREATE ROLE`에는 `IF NOT EXISTS`가 없어서 이렇게 감싼다.

`prisma migrate dev`는 마이그레이션이 처음부터 깨끗하게 적용되는지 확인하려고 임시 DB(shadow DB)에 한 번 더 돌린다.

테이블은 그 임시 DB 안에만 생기지만, 역할은 서버 전체에 하나라서 이미 있다. 감싸지 않으면 두 번째 실행에서 `role "order_app" already exists`로 실패한다.

C로 치면 테이블은 프로세스마다 따로 있는 전역 변수이고, 역할은 운영체제의 사용자 계정이다. 프로세스(DB)를 새로 만들어도 계정은 그대로 있다.

같은 이유로 테스트 DB(`order_api_test`)에 이 마이그레이션을 적용할 때도 역할을 새로 만들지 않고 권한만 준다.

### 작업 2. [확인] `order_app`으로 붙어 확인하기

`order_app`으로 붙어 같은 것을 해 본다(컨테이너 안이라 포트는 5432).

```text
$ docker compose exec db psql "postgresql://order_app:order_app@localhost:5432/order_api"
order_api=> SELECT count(*) FROM orders; -- 설정 없음
 0
order_api=> SELECT set_config('app.user_id', 'kim', false); SELECT id, user_id FROM orders;
 1|kim
 3|kim
order_api=> SELECT set_config('app.role', 'admin', false); SELECT count(*) FROM orders;
 5
order_api=> TRUNCATE orders;
ERROR:  permission denied for table orders
```

이번에는 정책이 일한다. 설정이 없으면 0건이다.

아무것도 모를 때는 아무것도 안 보이는 것이 RLS의 기본이다.

kim으로 설정하면 kim의 주문만, admin이면 전부 보인다. 테이블을 비우는 것 같은 구조 작업은 권한이 없다.

`TRUNCATE`는 행을 하나씩 지우는 `DELETE`와 달리 테이블 단위의 작업이라 따로 `TRUNCATE` 권한이 필요하고, 마이그레이션은 그 권한을 주지 않았다.

### 용어 | PostgreSQL 문법 (역할과 권한)

`DO $$ ... $$`는 위 "`DO $$ ... $$`로 감싸는 이유"에서 다뤘다.

- `CREATE ROLE 이름 LOGIN PASSWORD '...'`: 로그인할 수 있는 역할(DB 계정)을 만든다.

- `GRANT 권한 ON 대상 TO 역할`: 역할에 권한을 준다. `ON ALL TABLES IN SCHEMA public`은 지금 있는 모든 테이블이 대상이다.

- `ALTER DEFAULT PRIVILEGES ... GRANT ...`: 앞으로 만들어질 객체에 줄 권한을 미리 정해 둔다. `GRANT`와 무엇이 다른지는 아래 "`GRANT`와 `ALTER DEFAULT PRIVILEGES`"에서 다룬다.

### 개념 | `GRANT`와 `ALTER DEFAULT PRIVILEGES`

`GRANT ... ON ALL TABLES IN SCHEMA public`은 "모든 테이블"이라고 적혀 있지만 **실행하는 순간 있던 테이블**에만 권한을 준다.

그 뒤에 마이그레이션이 새 테이블을 만들면 `order_app`은 그 테이블을 읽지 못한다.

```sql
-- ALTER DEFAULT PRIVILEGES 없이 GRANT만 했다고 할 때
GRANT SELECT ON ALL TABLES IN SCHEMA public TO order_app;
CREATE TABLE t2 (id int); -- GRANT 뒤에 만든 테이블
SET ROLE order_app;
SELECT count(*) FROM t2; -- ERROR:  permission denied for table t2
```

`ALTER DEFAULT PRIVILEGES`는 이 빈틈을 메운다. 이미 있는 객체는 건드리지 않고, **앞으로 만들어질 객체**가 생기는 순간 줄 권한을 등록해 둔다.

그래서 마이그레이션은 둘을 함께 쓴다.

| | `GRANT ... ON ALL TABLES` | `ALTER DEFAULT PRIVILEGES ... GRANT` |
|---|---|---|
| 대상 | 지금 있는 테이블 | 앞으로 만들어질 테이블 |
| 누가 만든 것 | 상관없음 | 이 명령을 실행한 역할(`order`)이 만든 것만 |
| 확인 | `\dp 테이블` | `\ddp` |

- 기본 권한은 **이 명령을 실행한 역할이 만드는 객체**에만 붙는다. 이 문서에서는 마이그레이션을 늘 소유자 `order`로 돌리므로(4단계) 문제가 없지만, 다른 역할로 테이블을 만들면 권한이 붙지 않는다.

- 시퀀스는 테이블과 별개의 객체다. `SERIAL` id로 `INSERT`하려면 시퀀스의 `USAGE` 권한도 있어야 해서 시퀀스 줄이 따로 있다.

> 새 테이블을 만들었는데 앱에서 `permission denied for table`이 나면(10장 진단 3), 기본 권한이 그 테이블을 만든 역할에 걸려 있는지부터 본다.

### 남길 것

- **찾아보면 되는 것**: `CREATE ROLE`, `GRANT ... ON ALL TABLES IN SCHEMA`, `ALTER DEFAULT PRIVILEGES`, `\dp`·`\ddp`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 역할은 DB가 아니라 PostgreSQL 서버 전체에 하나다. 마이그레이션에서 역할을 만들면 shadow DB·테스트 DB에서 두 번째로 돌 때를 대비해 "없을 때만" 만든다.
  - `GRANT ... ON ALL TABLES`는 지금 있는 테이블에만 듣는다. 앞으로 생길 테이블은 `ALTER DEFAULT PRIVILEGES`가 맡는다.

- **에러 신호**:
  - `role "order_app" already exists` → 역할 생성을 `DO $$ ... IF NOT EXISTS`로 감쌌는지
  - `ERROR:  permission denied for table ...` → 앱 역할에 그 테이블 권한이 있는지(`\dp`), 새 테이블이면 기본 권한이 그 테이블을 만든 역할에 걸려 있는지(`\ddp`)

## 5. 4단계: 연결을 둘로 나누고, 일부러 깨뜨려보기 ②

앱은 `order_app`으로, 마이그레이션과 시드(테이블을 비우고 채운다)는 소유자 `order`로 붙어야 한다. 연결 주소를 둘로 나눈다.

### 개념 | 왜 연결이 둘인가

`order_app`은 행을 읽고 쓰는 것만 할 수 있고, 정책을 받는다. 테이블을 만들거나 비우는 일(`CREATE TABLE`, `TRUNCATE`)은 못 한다.

반대로 마이그레이션과 시드는 바로 그 일을 해야 하고, 모든 사용자의 행을 한꺼번에 넣어야 하므로 정책을 받으면 안 된다.

한 계정으로 둘 다 하려면 앱 계정에 구조 변경 권한과 정책 우회를 줘야 한다. 그러면 2단계로 돌아간다.

그래서 "평소 일하는 계정"과 "구조를 바꾸는 계정"을 나누고, 앱에는 앞의 것만 준다. 최소 권한 원칙이다.

### 작업 1. [커밋] `.env`에 연결 주소 둘

```sh
# .env
# DATABASE_URL·TEST_DATABASE_URL을 바꾸고, ADMIN_ 두 줄을 추가한다
# 앱이 쓰는 연결: RLS가 적용되는 일반 역할
DATABASE_URL=postgresql://order_app:order_app@localhost:5433/order_api
# 마이그레이션·시드·실험 스크립트가 쓰는 연결: 테이블 소유자(RLS를 받지 않는다)
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api
TEST_DATABASE_URL=postgresql://order_app:order_app@localhost:5433/order_api_test
TEST_ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test
```

### 작업 2. [커밋] 마이그레이션과 시드를 소유자 연결로

Prisma CLI 설정의 `datasource.url`을 바꾼다.

```ts
// prisma7.config.ts
// datasource의 url 한 줄만 바꾼다
  datasource: {
    // 마이그레이션은 테이블을 만들고 바꾸므로 소유자 연결로 한다. 없으면 DATABASE_URL
    url: process.env["ADMIN_DATABASE_URL"] ?? process.env["DATABASE_URL"],
  },
```

시드도 `TRUNCATE`를 하므로 소유자로 붙는다.

```ts
// prisma/seed.ts
// PrismaClient를 만드는 줄만 바꾼다
// TRUNCATE와 전체 쓰기는 RLS를 받지 않는 소유자 연결로 한다
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL! }) });
```

`?? process.env.DATABASE_URL`은 `ADMIN_DATABASE_URL`이 없는 환경(9단계의 컨테이너 `migrate` 서비스)에서도 그대로 돌게 하는 대비다.

### 작업 3. [커밋] 실험 스크립트도 소유자 연결로

DB를 직접 읽어 장부를 맞춰 보는 실험 스크립트(`stampede.mjs`, `refresh-race.mjs`, `list-objects.mjs`)도 `pg.Client`를 만드는 줄을 바꾼다. 세 파일 모두 같은 한 줄이다.

```js
// scripts/stampede.mjs (refresh-race.mjs, list-objects.mjs도 같다)
// pg.Client를 만드는 줄만 바꾼다
const db = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL });
```

> 앱 역할로 세면 RLS 때문에 "안 보이는 것"이 "없는 것"처럼 세어진다.

예를 들어 `stampede.mjs`가 `order_app`으로 `order_items`를 합산하면, 설정이 없으니 품목이 하나도 안 보여 "팔린 수량"이 0으로 나온다. 재고는 줄었는데 장부가 안 맞는 것처럼 보인다.

### 실험 | 코드는 그대로 두고 앱만 `order_app`으로 띄우기

`npm run start:dev`를 다시 띄우면 앱은 새 `DATABASE_URL`, 곧 `order_app`으로 붙는다. 주문 경로를 차례로 불러 본다.

`start:dev`는 `.env`를 시작할 때 한 번만 읽는다(`--env-file .env`). 소스가 바뀌면 다시 빌드하지만 `.env`가 바뀐 것은 모르므로, 떠 있던 서버는 `Ctrl+C`로 끄고 새로 띄운다.

```sh
npx prisma db seed # 소유자 연결로 데이터를 처음 상태로
npm run start:dev  # 이 터미널에 서버 로그가 찍힌다
```

다른 터미널에서 kim으로 로그인해 토큰을 받는다. 로그인은 `users`만 읽는데 `users`에는 RLS가 없으므로 그대로 된다.

```sh
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

curl -s localhost:4000/orders; # 전체 주문
curl -s localhost:4000/orders/totals; # 사용자별 합계
curl -s -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders; # kim의 주문
curl -s -X POST localhost:4000/orders/checkout \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":2,"quantity":1}]}'; # 마우스 1개 결제
```

결제의 `42501`·`P2039`는 응답에는 없고 `start:dev`를 띄운 터미널의 서버 로그에 찍힌다.

```sh
GET /orders                 → []  200
GET /orders/totals          → {}  200
GET /me/orders (kim)        → []  200
POST /orders/checkout (kim) → {"statusCode":500,"message":"Internal server error"}
  서버 로그: Database error. Code: `42501`. Message: `new row violates row-level security policy for table "orders"`
             code: 'P2039'
```

조회는 전부 조용히 빈 결과가 되고, 결제는 정책 위반으로 실패했다. 앱이 아직 아무 요청에도 "누구인가"를 알려 주지 않았기 때문이다.

결제가 만드는 주문의 `user_id`는 `kim`인데 `app.user_id`는 비어 있으니 `WITH CHECK`에 걸렸다.

SQLSTATE `42501`은 권한 부족이고, Prisma는 이를 `P2039`로 감쌌다. `PrismaExceptionFilter`는 `P2002`·`P2003`·`P2025`만 4xx로 바꾸므로 나머지인 이것은 500이 된다.

> 빈 결과가 에러보다 더 위험하다는 것도 눈여겨본다. 화면에는 "주문이 없습니다"가 뜰 뿐, 아무도 이상하다는 것을 모른다.

### 남길 것

- **찾아보면 되는 것**: `prisma7.config.ts`의 `datasource.url`, SQLSTATE `42501`과 Prisma `P2039`의 대응. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 앱 연결(정책을 받는 일반 역할)과 소유자 연결(마이그레이션·시드·장부 확인)은 처음부터 나눈다. 장부를 앱 역할로 세면 "안 보이는 것"이 "없는 것"으로 세어진다.
  - RLS에서 컨텍스트를 빠뜨리면 읽기는 에러 없이 빈 결과, 쓰기는 `42501`이다. 빈 결과는 아무도 눈치채지 못하므로 더 위험하다.

- **에러 신호**:
  - 조회가 전부 `[]`·`{}`로 200 → 그 경로에서 `asUser`/`asAdmin`(다음 단계)을 빠뜨렸는지
  - `new row violates row-level security policy for table "orders"`(`42501`, `P2039`, 응답은 500) → 넣는 행의 `user_id`와 `app.user_id`가 같은지
  - 시드에서 `permission denied for table ...` → `.env`에 `ADMIN_DATABASE_URL`이 있는지, `seed.ts`가 그것을 쓰는지
  - `stampede.mjs`의 "팔린 수량"이 0 → 스크립트가 `ADMIN_DATABASE_URL`로 붙는지
  - `.env`를 바꿨는데 조회가 전처럼 다 나오고 결제도 성공한다 → `start:dev`를 끄고 다시 띄웠는지(`.env`는 시작할 때만 읽는다)

## 6. 5단계: 요청마다 "누구인가"를 트랜잭션 안에서

### 작업 1. [커밋] `PrismaService`에 `asUser`·`asAdmin` 만들기

`PrismaService`에 도우미 둘을 만든다.

```ts
// src/prisma/prisma.service.ts
// import에 Prisma를 추가하고, 생성자와 onModuleDestroy 사이에 메서드 둘을 추가한다
import { Prisma, PrismaClient } from "../generated/prisma/client.js";
// ...
  // RLS: "누가 요청했는가"를 이 트랜잭션에만 설정하고 fn을 실행한다
  // set_config(이름, 값, true) : 세 번째 인자 true = 트랜잭션이 끝나면 사라진다(커넥션 풀의 다른 요청으로 새지 않는다)
  asUser<T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    });
  }

  // 관리자 화면처럼 모든 사용자의 행을 봐야 하는 곳. 이걸 부르는 경로는 관리자만 쓸 수 있어야 한다
  asAdmin<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.role', 'admin', true)`;
      return fn(tx);
    });
  }
```

`Prisma.TransactionClient`는 `$transaction` 콜백이 받는 `tx`의 타입이다. `asUser`를 부르는 쪽은 `tx`로만 쿼리를 보내야 설정이 적용된다.

`set_config` 한 줄만 `$executeRaw`로 SQL을 직접 보낸다. Prisma Client에는 설정 변수를 바꾸는 메서드가 없기 때문이다.

`fn` 안의 쿼리는 전처럼 `tx.order.findMany(...)` 같은 Prisma 호출이다. 트랜잭션을 열고 닫는 것도 Prisma의 `$transaction`이 한다.

### 개념 | 설정과 쿼리가 같은 트랜잭션에 있어야 하는 이유

설정과 쿼리가 같은 트랜잭션에 있어야 하는 이유는 `02`의 3단계와 같다. 트랜잭션은 커넥션 하나에 묶여 있다.

트랜잭션 밖에서 `set_config`를 하고 쿼리를 따로 보내면, 풀이 둘을 다른 커넥션에 보낼 수 있다.

#### 내부에서 일어나는 일

`this.$transaction(async (tx) => { ... })`이 불리면 Prisma는 풀에서 커넥션 하나를 꺼내 `BEGIN`을 보내고, 콜백이 끝날 때까지 그 커넥션을 붙잡아 둔다.

콜백 안에서 `tx.`로 보낸 쿼리는 모두 그 커넥션으로 간다. 콜백이 정상으로 끝나면 `COMMIT`, 예외가 나면 `ROLLBACK`을 보내고 커넥션을 풀에 돌려준다.

`set_config(..., true)`의 값은 그 `COMMIT`/`ROLLBACK`에서 사라진다. 그래서 커넥션이 풀로 돌아갈 때는 이미 깨끗하다.

C++로 치면 생성자에서 값을 넣고 소멸자에서 되돌리는 RAII 가드를 트랜잭션이 대신 해 주는 셈이다. 함수가 어떻게 끝나든(예외 포함) 정리가 빠지지 않는다.

#### 흔한 실수

- 콜백 안에서 `tx.order...` 대신 `this.prisma.order...`를 쓰면, 그 쿼리는 풀의 다른 커넥션으로 간다. 설정이 없으니 빈 결과가 된다.

- `asUser` 안에서 시간이 오래 걸리는 일을 하면 그동안 커넥션 하나가 묶인다. Prisma 트랜잭션의 시간 상한(기본 5초)도 그대로 적용된다.

### 작업 2. [커밋] 내 주문 경로를 `asUser`로

`/me/orders`의 두 메서드에서 쿼리를 `asUser`로 감싼다. 쿼리 자체(`where`, `select`)는 그대로다.

```ts
// src/me/me.controller.ts
// 두 메서드의 return/const 줄만 바꾼다
  @Get("orders")
  myOrders(@Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    return this.prisma.asUser(userId, (tx) => tx.order.findMany({ where: { userId }, select: orderSelect, orderBy: { id: "asc" } }));
  }

  @Get("orders/:id")
  async myOrder(@Param("id", ParseIntPipe) id: number, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId;
    // id와 userId를 함께 조건으로 건다 - 남의 주문 id를 넣으면 "없는 주문"과 똑같이 404가 된다
    const order = await this.prisma.asUser(userId, (tx) => tx.order.findFirst({ where: { id, userId }, select: orderSelect }));
    if (!order) throw new NotFoundException(`order ${id} not found`);
    return order;
  }
```

`where`의 `userId`는 지우지 않는다. 앱의 검사와 DB의 정책이 둘 다 같은 규칙을 지키는 이중 방어다.

### 작업 3. [커밋] 결제를 `asUser`로

`checkout`의 `$transaction`을 `asUser`로 바꾼다. 콜백 안은 그대로다.

```ts
// src/orders/orders.service.ts
// checkout의 this.prisma.$transaction( 을 this.prisma.asUser(userId, 로 바꾼다
    try {
      // 결제는 이 사용자로서 한다 - 만드는 주문의 user_id가 app.user_id와 같아야 정책(WITH CHECK)을 통과한다
      const result = await this.prisma.asUser(userId, async (tx) => {
        // ... 앞에서 만든 내용 그대로(멱등성 키, placeOrder, outbox)
      });
```

`asUser`가 안에서 `$transaction`을 열기 때문에, 콜백이 받는 `tx`와 트랜잭션의 성질(전부 아니면 전무, `FOR UPDATE` 잠금)은 전과 같다. 설정 한 줄이 맨 앞에 붙었을 뿐이다.

`catch`의 멱등 재응답 경로는 `this.prisma.idempotencyKey`를 그대로 쓴다. `idempotency_keys`에는 RLS가 없어서 바꿀 필요가 없다.

### 작업 4. [커밋] "전체" 경로를 `asAdmin`으로

앞 과정부터 이어 온 "전체" 경로들(`list`, `findOne`, `totals`)과 데모용 `create`(`POST /orders`)는 `asAdmin`으로 감싼다.

```ts
// src/orders/orders.service.ts
// list, findOne, totals는 this.prisma.order... 를 asAdmin((tx) => tx.order...)로 감싼다
  async list(paid?: boolean): Promise<Order[]> {
    // 앞에서 이어 온 "전체 주문" 경로는 관리자 화면으로 본다 - 실제 서비스라면 관리자 Guard를 건다
    const rows = await this.prisma.asAdmin((tx) => tx.order.findMany({ where: { paid }, select: orderSelect, orderBy: { id: "asc" } }));
    return rows.map(toOrder);
  }
  async findOne(id: number): Promise<Order> {
    const row = await this.prisma.asAdmin((tx) => tx.order.findUnique({ where: { id }, select: orderSelect }));
    if (!row) throw new NotFoundException(`order ${id} not found`);
    return toOrder(row);
  }
  async create(input: Omit<Order, "id">, creatorId: string): Promise<Order> {
    const { user, ...rest } = input;
    // 주문 저장과 알림 기록을 한 트랜잭션으로 - checkout과 같은 outbox 방식
    // 앞에서 만든 데모 경로: 본문의 user 이름으로 주문을 만든다(남의 주문을 만드는 것) → 관리자 동작으로 본다
    const order = await this.prisma.asAdmin(async (tx) => { // $transaction 대신 asAdmin
      const created = toOrder(await tx.order.create({ data: { ...rest, userId: user }, select: orderSelect }));
      await tx.outboxEvent.create({ data: { type: "order.created", userId: creatorId, payload: created } });
      return created;
    });
    this.logger.log(`주문 생성: #${order.id} (${order.user})`);
    return order;
  }
  async totals(): Promise<Record<string, number>> {
    const rows = await this.prisma.asAdmin((tx) => tx.order.groupBy({
      by: ["userId"], where: { paid: true }, _sum: { price: true }, orderBy: { userId: "asc" },
    }));
    return Object.fromEntries(rows.map((r) => [r.userId, r._sum.price ?? 0]));
  }
```

`create`는 본문의 `user`로 주문을 만든다.

토큰의 주인과 다른 사람의 주문을 만드는 것이라 `asUser(creatorId, ...)`로는 `WITH CHECK`를 통과하지 못한다. 그래서 관리자 동작으로 본다.

사용자 목록에 주문을 붙여 보여 주는 화면도 `asAdmin`으로 감싼다.

```ts
// src/users/users.service.ts
// listWithOrders의 this.prisma.user.findMany(...)를 asAdmin으로 감싼다
  listWithOrders() {
    // 사용자마다 주문을 붙여 보여 주는 관리자 화면 - orders에 RLS가 있으므로 관리자로 읽는다
    return this.prisma.asAdmin((tx) => tx.user.findMany({
      select: { id: true, name: true, orders: { select: { id: true, price: true, paid: true }, orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    }));
  }
```

`users` 테이블에는 RLS가 없지만, 여기서 붙이는 `orders`는 Prisma가 두 번째 쿼리로 따로 읽는다. 감싸지 않으면 사용자는 다 나오는데 `orders`만 모두 빈 배열이 된다.

RLS가 없는 테이블(`users`, `products`, `refresh_tokens`, `outbox_events` 등)만 쓰는 코드는 그대로 둔다.

outbox relay(`02`), 리더의 정리 작업(`04`, `06`)도 주문 테이블을 읽지 않으므로 바꿀 것이 없다.

### 작업 5. [확인] 다시 돌려 확인

`start:dev`가 다시 빌드한 뒤 같은 경로들을 불러 본다. 주문 번호와 재고가 아래 결과와 맞도록 시드부터 다시 넣는다.

```sh
npx prisma db seed
# TOKEN이 없거나 만료됐으면 3장의 로그인 두 줄로 다시 받는다
curl -s localhost:4000/orders/totals;
{"kim":17000,"lee":30000,"park":7000}

curl -s -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders;
[{"id":1,"price":12000,"paid":true,"createdAt":"2025-10-13T08:56:02.685Z"},{"id":3,"price":5000,"paid":true,"createdAt":"2025-10-13T08:56:02.685Z"}]

curl -s -X POST localhost:4000/orders/checkout \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":2,"quantity":1}]}'; # 마우스 1개
{"id":6,"user":"kim","price":30000,"paid":true,"items":[{"productId":2,"quantity":1,"unitPrice":30000}]}

curl -s localhost:4000/users;
[{"id":"choi","name":"최","orders":[]},{"id":"kim","name":"김","orders":[{"id":1,"price":12000,"paid":true},{"id":3,"price":5000,"paid":true},{"id":6,"price":30000,"paid":true}]},{"id":"lee","name":"이","orders":[{"id":2,"price":8000,"paid":false},{"id":4,"price":30000,"paid":true}]},{"id":"park","name":"박","orders":[{"id":5,"price":7000,"paid":true}]}]

node scripts/stampede.mjs 20 # 재고 10인 1번 상품(한정판 키보드)에 결제 20개를 동시에
응답 코드별 개수: { '201': 20 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 9         │ 1         │
│ 1       │ 2  │ '마우스'        │ 99        │ 1         │
│ 2       │ 3  │ '무선 헤드폰'   │ 30        │ 0         │
│ 3       │ 4  │ '전기 주전자'   │ 20        │ 0         │
└─────────┴────┴─────────────────┴───────────┴───────────┘
```

결제를 2번 상품으로 하는 것은 `stampede.mjs`가 기본으로 1번 상품을 사기 때문이다. 1번을 먼저 하나 사 두면 남은 재고가 9라서 성공이 9개로 나온다.

```text
GET /orders/totals     → {"kim":17000,"lee":30000,"park":7000}  200
GET /me/orders (kim)   → [{"id":1,...},{"id":3,...}]           200
POST /orders/checkout  → {"id":6,"user":"kim",...}             201
GET /users             → [{"id":"choi",...,"orders":[]},{"id":"kim",...,"orders":[...]},...]
stampede 20개          → { '201': 10, '409': 10 }, 남은 재고 0, 팔린 수량 10
```

모두 돌아왔다. `GET /users`에서 `choi`의 `orders`가 빈 것은 시드에 choi의 주문이 없어서다.

### 실험 | IDOR 버그를 다시 되살려도 404

이제 2단계의 IDOR 버그를 다시 되살린다. 이번에는 `asUser` 안에서 `userId` 조건만 뺀다.

```ts
// src/me/me.controller.ts
// myOrder의 where에서 userId만 뺀다(깨뜨려보기)
    const order = await this.prisma.asUser(userId, (tx) => tx.order.findFirst({ where: { id }, select: orderSelect }));
```

저장하면 `start:dev`가 다시 빌드한다. 2단계와 같은 요청을 보낸다.

```sh
curl -s -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders/2; echo
```

```text
GET /me/orders/2 (kim, 소유자 조건을 빠뜨린 코드) → {"message":"order 2 not found",...} → 404
```

앱의 `WHERE`에는 `userId`가 없지만, DB가 `app.user_id = 'kim'`인 트랜잭션에 lee의 행을 돌려주지 않았다.

**앱의 실수가 데이터 유출로 이어지지 않는다.** 이것이 이 문서의 목표다.

> 버그는 원복한다. RLS는 두 번째 방어선이지 앱의 검사를 대신하는 것이 아니다.

### 용어 | PostgreSQL 함수 (`set_config`)

- `set_config(이름, 값, true)`: 설정 변수에 값을 넣는다. 세 번째 인자가 `true`면 트랜잭션이 끝날 때 사라지고, `false`면 연결(세션)에 남는다. `true`여야 커넥션 풀의 다른 요청으로 새지 않는다. `SET LOCAL` 대신 이 함수를 쓰는 이유는 아래 "`SET LOCAL` 대신 `set_config`를 쓰는 이유"에서 다룬다.

### 개념 | `SET LOCAL` 대신 `set_config`를 쓰는 이유

설정 변수를 바꾸는 SQL 명령은 따로 있다. `SET LOCAL app.user_id = 'kim'`은 `set_config('app.user_id', 'kim', true)`와 같은 일을 한다.

트랜잭션 범위와 세션 범위의 차이는 0장 개념 2와 바로 다음 6단계에서 보므로, 여기서는 왜 명령 대신 함수를 쓰는지만 본다.

#### 바인드 파라미터

`asUser`는 `userId`를 SQL 문자열에 붙이지 않는다. `` tx.$executeRaw`...${userId}...` ``는 태그된 템플릿(tagged template)이라서, Prisma가 `${userId}` 자리를 `$1`로 바꾸고 값은 따로 보낸다(바인드 파라미터).

C에서 `printf(s)` 대신 `printf("%s", s)`로 써서 `s` 안의 `%`가 형식으로 해석되지 않게 하는 것과 같은 이유로, 값에 따옴표가 섞여도 SQL로 해석되지 않는다.

#### `SET`은 `$1`을 받지 못한다

그런데 `SET`은 바인드 파라미터를 받지 못한다. 값 자리에 `$1`을 쓰면 문법 에러다.

```text
order_api=*> SET LOCAL app.user_id = $1 \bind kim \g
ERROR:  syntax error at or near "$1"
order_api=*> SELECT set_config('app.user_id', $1, true) \bind kim \g
 kim
```

`set_config`는 평범한 함수라 인자 자리에 `$1`이 들어갈 수 있다. 그래서 값을 안전하게 넘기면서 트랜잭션 범위로 설정할 수 있는 방법이 이것이다.

| 방법 | 범위 | `$1`로 값 넘기기 |
|---|---|---|
| `SET app.user_id = 'kim'` | 세션 | 불가 |
| `SET LOCAL app.user_id = 'kim'` | 트랜잭션 | 불가 |
| `set_config('app.user_id', $1, false)` | 세션 | 가능 |
| `set_config('app.user_id', $1, true)` | 트랜잭션 | 가능 |

#### 피해야 할 우회

- `SET LOCAL`을 쓰려고 `` $executeRawUnsafe(`SET LOCAL app.user_id = '${userId}'`) ``처럼 문자열을 이어 붙이면, `userId`에 `'`가 섞였을 때 SQL이 바뀐다. 이 값은 토큰에서 나오지만 RLS의 열쇠가 되는 값이라 더욱 붙여 넣지 않는다.

- `SET LOCAL`이나 `set_config(..., true)`를 트랜잭션 밖에서 실행하면 경고만 내거나 그 문장 하나로 끝나 버려 효과가 없다. `asUser`가 `$transaction` 안에서 부르는 이유가 이것이기도 하다.

> `$executeRaw`의 템플릿은 겉보기엔 문자열 보간이지만 실제로는 파라미터 바인딩이다. 같은 줄을 `$executeRawUnsafe`와 일반 템플릿 문자열로 바꾸면 그 보호가 사라진다.

### 남길 것

- **찾아보면 되는 것**: `set_config`의 세 번째 인자, `Prisma.TransactionClient` 타입, `SET`/`SET LOCAL`/`set_config` 비교표. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - "누구인가" 설정과 그 설정을 읽는 쿼리는 같은 트랜잭션(같은 커넥션) 안에 있어야 한다. 콜백 안에서 `tx` 대신 `this.prisma`를 쓰면 다른 커넥션으로 간다.
  - 정책이 막아 주는 것은 "앱이 조건을 빠뜨린 실수"다. 앱의 `where`는 지우지 않고 둘 다 둔다.

- **에러 신호**:
  - `ERROR:  syntax error at or near "$1"` → `SET`/`SET LOCAL`에 바인드 파라미터를 넣었는지. `set_config`로 바꾼다
  - 사용자 목록은 나오는데 `orders`가 모두 빈 배열 → `listWithOrders`를 `asAdmin`으로 감쌌는지
  - `asUser` 안인데도 빈 결과 → 콜백 안에서 `tx.` 대신 `this.prisma.`로 쿼리를 보냈는지

## 7. 6단계: 설정이 다음 요청으로 샌다(일부러 깨뜨려보기 ③)

`asUser`의 `set_config(..., true)`를 `false`로 바꾸면 설정이 트랜잭션이 아니라 연결(세션)에 남는다.

"누구인가"를 설정하지 않고 주문을 읽는 경로가 하나 있다고 하자. 실수로 `list()`에서 `asAdmin`을 빠뜨린 상황이다.

### 실험 | `true`를 `false`로 바꾸고 `asAdmin`을 빠뜨리기

두 군데를 잠깐 바꾼다. 비교를 위해 `list()`를 먼저 바꿔 `true`일 때를 한 번 돌리고, 그다음 `prisma.service.ts`를 바꿔 `false`일 때를 돌린다. 저장할 때마다 `start:dev`가 다시 빌드하므로, 서버 로그에 다시 시작한 줄이 찍힌 뒤에 요청을 보낸다.

```ts
// src/prisma/prisma.service.ts
// asUser의 set_config 세 번째 인자만 true → false (깨뜨려보기)
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, false)`;
```

```ts
// src/orders/orders.service.ts
// list()에서 asAdmin을 빠뜨린 경로를 흉내 낸다(깨뜨려보기)
    const rows = await this.prisma.order.findMany({ where: { paid }, select: orderSelect, orderBy: { id: "asc" } });
```

kim이 `/me/orders`를 부른 직후에, 로그인하지 않은 누군가가 `GET /orders`를 부른다. 이것을 세 번 되풀이한다. `TOKEN`은 3장의 로그인 두 줄로 받은 것이다.

```sh
for i in 1 2 3; do
  curl -s -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders > /dev/null # kim의 요청
  curl -s localhost:4000/orders; # 토큰 없는 요청
done
```

`true`일 때와 `false`일 때를 각각 돌린 결과를 정리하면 이렇다.

```text
=== set_config(..., true) 트랜잭션 범위
  kim 요청 직후 GET /orders → []
  kim 요청 직후 GET /orders → []
  kim 요청 직후 GET /orders → []

=== set_config(..., false) 세션 범위
  kim 요청 직후 GET /orders → [{"id":1,"user":"kim","price":12000,"paid":true},{"id":3,"user":"kim",...},...]
  kim 요청 직후 GET /orders → [{"id":1,"user":"kim",...},...]
  kim 요청 직후 GET /orders → [{"id":1,"user":"kim",...},...]
```

### 개념 | 왜 예측할 수 없는 누수인가

세션 범위에서는 **로그인하지 않은 요청에 kim의 주문이 보였다.**

커넥션 풀이 kim이 쓰고 돌려준 연결을 다음 요청에 내줬고, 그 연결에는 `app.user_id = 'kim'`이 남아 있었다. 0장 개념 2의 thread-local 누수 그대로다.

실수한 경로(컨텍스트 설정 빠뜨리기)는 하나인데, 피해는 직전에 그 연결을 쓴 사람의 데이터다. 그래서 어떤 경로에서 일어날지, 누구의 데이터가 샐지 예측할 수 없다.

트랜잭션 범위(`true`)에서는 같은 실수가 빈 결과로 끝난다. 실수가 "남의 데이터"가 아니라 "아무 데이터도 없음"으로 떨어지는 것이 트랜잭션 범위를 쓰는 이유다.

두 군데 모두 원복한다.

### 남길 것

- **찾아보면 되는 것**: `set_config`의 세 번째 인자 `true`/`false`가 범위를 정한다는 것. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 커넥션 풀에서는 연결에 남긴 상태가 다음 요청으로 넘어간다. 요청마다 다른 값은 트랜잭션 범위로만 설정한다.
  - 세션 범위 누수는 실수한 경로가 아니라 직전에 그 연결을 쓴 사람의 데이터를 흘린다. 재현이 불규칙해서 테스트로 고정해 둬야 한다(다음 단계).

- **에러 신호**:
  - 로그인하지 않은 요청이나 다른 사용자의 요청에 남의 주문이 가끔 보인다 → `set_config`의 세 번째 인자가 `false`인지, 설정과 쿼리를 다른 트랜잭션에서 했는지

## 8. 7단계: 테스트

e2e 테스트도 앱은 `order_app`으로 붙는다. 그런데 테스트 준비(`TRUNCATE`)는 권한이 없고, 결과 확인(`order.count()`)은 RLS 때문에 0이 나온다.

그래서 준비와 확인은 소유자 연결로 한다.

### 작업 1. [커밋] 테스트 환경에 소유자 연결 넣기

```ts
// test/setup-env.ts
// 맨 아래에 세 줄을 추가한다
// 앱은 RLS가 적용되는 역할(TEST_DATABASE_URL)로, 테스트 준비·확인은 소유자(TEST_ADMIN_DATABASE_URL)로 한다
if (!process.env.TEST_ADMIN_DATABASE_URL) throw new Error("TEST_ADMIN_DATABASE_URL이 없습니다");
process.env.ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL;
```

`setup-env.ts`는 테스트 파일보다 먼저 돈다. 여기서 `ADMIN_DATABASE_URL`을 테스트 DB로 덮어써야, 다음 작업의 `adminDb`가 개발 DB가 아니라 테스트 DB에 붙는다.

### 작업 2. [커밋] 소유자 연결 `adminDb` 만들기

```ts
// test/admin-db.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

// 테스트 준비(TRUNCATE, 데이터 넣기)와 결과 확인용 연결. 소유자라서 RLS를 받지 않는다 -
// 앱(order_app)으로 확인하면 RLS 때문에 "안 보이는 것"과 "없는 것"을 구별할 수 없다
export const adminDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.ADMIN_DATABASE_URL! }) });
```

### 작업 3. [커밋] 기존 e2e 파일을 `adminDb`로

기존 e2e 파일(`checkout`, `auth`, `categories`)에서 `app.get(PrismaService)`로 받던 `prisma`를 `adminDb`로 바꾸고, `afterAll`에서 `adminDb.$disconnect()`를 부른다.

세 파일 모두 같은 다섯 군데가 바뀐다.

1. `import { PrismaService } ...` 줄을 지우고 `import { adminDb } from "./admin-db.js";`를 넣는다

2. `let prisma: PrismaService;`를 지운다

3. `beforeAll`의 `prisma = app.get(PrismaService);`를 지운다

4. 본문의 `await prisma.`를 모두 `await adminDb.`로 바꾼다

5. `afterAll`에 `await adminDb.$disconnect();`를 더한다

아래는 파일별 diff다. `-` 줄을 지우고 `+` 줄을 넣는다. 앞에 아무 표시가 없는 줄은 위치를 찾으라고 보여 주는 그대로인 줄이고, `@@ -3,12 +3,11 @@`의 앞 숫자(`-3`)가 원래 파일에서 그 덩어리가 시작하는 줄 번호다.

```diff
--- a/test/checkout.e2e-spec.ts
+++ b/test/checkout.e2e-spec.ts
@@ -3,12 +3,11 @@
 import { Test } from "@nestjs/testing";
 import { AppModule } from "../src/app.module.js";
 import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
-import { PrismaService } from "../src/prisma/prisma.service.js";
 import { hashPassword } from "../src/auth/password.js";
+import { adminDb } from "./admin-db.js";
 
 describe("POST /orders/checkout - 동시성 회귀 테스트", () => {
   let app: INestApplication;
-  let prisma: PrismaService;
   let baseUrl: string;
   let token: string;
 
@@ -19,13 +18,12 @@
     app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
     await app.listen(0);
     baseUrl = await app.getUrl();
-    prisma = app.get(PrismaService);
   });
 
   beforeEach(async () => {
-    await prisma.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
-    await prisma.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword(process.env.DEMO_PASSWORD!) } });
-    await prisma.product.create({ data: { name: "테스트 상품", price: 1000, stock: 5 } }); // id 1
+    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
+    await adminDb.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword(process.env.DEMO_PASSWORD!) } });
+    await adminDb.product.create({ data: { name: "테스트 상품", price: 1000, stock: 5 } }); // id 1
     const res = await fetch(`${baseUrl}/auth/login`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
@@ -36,6 +34,7 @@
 
   afterAll(async () => {
     await app.close();
+    await adminDb.$disconnect(); // 앱과 따로 만든 연결이라 직접 닫는다
   });
 
   const checkout = (headers: Record<string, string> = {}) =>
@@ -50,9 +49,9 @@
 
     expect(statuses.filter((s) => s === 201)).toHaveLength(5);
     expect(statuses.filter((s) => s === 409)).toHaveLength(15);
-    const product = await prisma.product.findUniqueOrThrow({ where: { id: 1 } });
+    const product = await adminDb.product.findUniqueOrThrow({ where: { id: 1 } });
     expect(product.stock).toBe(0);
-    const sold = await prisma.orderItem.aggregate({ where: { productId: 1 }, _sum: { quantity: true } });
+    const sold = await adminDb.orderItem.aggregate({ where: { productId: 1 }, _sum: { quantity: true } });
     expect(sold._sum.quantity).toBe(5);
   });
 
@@ -62,7 +61,7 @@
     );
 
     expect(new Set(bodies.map((b) => b.id)).size).toBe(1);
-    expect(await prisma.order.count()).toBe(1);
-    expect(await prisma.outboxEvent.count()).toBe(1);
+    expect(await adminDb.order.count()).toBe(1);
+    expect(await adminDb.outboxEvent.count()).toBe(1);
   });
 });
```

```diff
--- a/test/auth.e2e-spec.ts
+++ b/test/auth.e2e-spec.ts
@@ -5,11 +5,10 @@
 import { AppModule } from "../src/app.module.js";
 import { hashPassword } from "../src/auth/password.js";
 import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
-import { PrismaService } from "../src/prisma/prisma.service.js";
+import { adminDb } from "./admin-db.js";
 
 describe("refresh token 회전 - 회귀 테스트", () => {
   let app: INestApplication;
-  let prisma: PrismaService;
   let baseUrl: string;
 
   beforeAll(async () => {
@@ -21,16 +20,16 @@
     app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
     await app.listen(0);
     baseUrl = await app.getUrl();
-    prisma = app.get(PrismaService);
   });
 
   beforeEach(async () => {
-    await prisma.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
-    await prisma.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw-for-test") } });
+    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
+    await adminDb.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw-for-test") } });
   });
 
   afterAll(async () => {
     await app.close();
+    await adminDb.$disconnect(); // 앱과 따로 만든 연결이라 직접 닫는다
   });
 
   const login = async () => {
@@ -59,6 +58,6 @@
     const statuses = await Promise.all(Array.from({ length: 10 }, () => refresh(a).then((r) => r.status)));
 
     expect(statuses.filter((s) => s === 200)).toHaveLength(1);
-    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
+    expect(await adminDb.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
   });
 });
```

```diff
--- a/test/categories.e2e-spec.ts
+++ b/test/categories.e2e-spec.ts
@@ -5,11 +5,10 @@
 import { AppModule } from "../src/app.module.js";
 import { hashPassword } from "../src/auth/password.js";
 import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
-import { PrismaService } from "../src/prisma/prisma.service.js";
+import { adminDb } from "./admin-db.js";
 
 describe("카테고리 트리 - 회귀 테스트", () => {
   let app: INestApplication;
-  let prisma: PrismaService;
   let baseUrl: string;
   let token: string;
 
@@ -21,13 +20,12 @@
     app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
     await app.listen(0);
     baseUrl = await app.getUrl();
-    prisma = app.get(PrismaService);
   });
 
   beforeEach(async () => {
-    await prisma.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
-    await prisma.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw-for-test") } });
-    for (const [name, parentId] of [["가", null], ["나", 1], ["다", 2]] as const) await prisma.category.create({ data: { name, parentId } });
+    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
+    await adminDb.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw-for-test") } });
+    for (const [name, parentId] of [["가", null], ["나", 1], ["다", 2]] as const) await adminDb.category.create({ data: { name, parentId } });
     const res = await fetch(`${baseUrl}/auth/login`, {
       method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "kim", password: "pw-for-test" }),
     });
@@ -36,6 +34,7 @@
 
   afterAll(async () => {
     await app.close();
+    await adminDb.$disconnect(); // 앱과 따로 만든 연결이라 직접 닫는다
   });
 
   const move = (id: number, parentId: number | null) =>
@@ -52,7 +51,7 @@
   });
 
   it("이미 순환이 생긴 데이터에서도 경로 조회가 끝난다(CYCLE 절)", async () => {
-    await prisma.$executeRaw`UPDATE categories SET parent_id = 3 WHERE id = 1`;
+    await adminDb.$executeRaw`UPDATE categories SET parent_id = 3 WHERE id = 1`;
     const res = await fetch(`${baseUrl}/categories/3/path`, { signal: AbortSignal.timeout(3000) });
     expect(res.status).toBe(200);
     expect(((await res.json()) as unknown[]).length).toBe(3);
```

다 바꿨으면 남은 곳이 없는지 확인한다. 아무것도 나오지 않으면 끝이다.

```sh
grep -n 'prisma\.\|PrismaService' test/checkout.e2e-spec.ts test/auth.e2e-spec.ts test/categories.e2e-spec.ts
```

### 작업 4. [커밋] RLS 회귀 테스트

정책 자체를 지키는 테스트를 더한다.

```ts
// test/rls.e2e-spec.ts
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { adminDb } from "./admin-db.js";

// 앱의 PrismaService는 RLS가 적용되는 역할(order_app)로 붙는다. 이 테스트는 정책 자체를 확인한다
describe("RLS - 회귀 테스트", () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    close = () => app.close();
  });

  beforeEach(async () => {
    await adminDb.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await adminDb.user.createMany({ data: [{ id: "kim", name: "김" }, { id: "lee", name: "이" }] });
    await adminDb.order.createMany({ data: [{ userId: "kim", price: 1000, paid: true }, { userId: "lee", price: 2000, paid: true }] });
  });

  afterAll(async () => {
    await close();
    await adminDb.$disconnect();
  });

  it("누구인지 설정하지 않으면 아무 주문도 안 보인다", async () => {
    expect(await prisma.order.count()).toBe(0);
  });

  it("kim으로 설정하면 kim의 주문만 보인다", async () => {
    const rows = await prisma.asUser("kim", (tx) => tx.order.findMany());
    expect(rows.map((r) => r.userId)).toEqual(["kim"]);
  });

  it("kim으로 설정한 채 lee 명의의 주문을 넣으면 DB가 거부한다", async () => {
    await expect(prisma.asUser("kim", (tx) => tx.order.create({ data: { userId: "lee", price: 1, paid: true } })))
      // 메시지는 DB 로캘에 따라 번역되므로(예: 한국어) 문구 대신 SQLSTATE 42501(권한 부족 - RLS 위반)로 판정한다
      .rejects.toMatchObject({ meta: { driverAdapterError: { cause: { originalCode: "42501" } } } });
  });

  it("트랜잭션이 끝나면 설정이 남지 않는다", async () => {
    await prisma.asUser("kim", (tx) => tx.order.findMany());
    expect(await prisma.order.count()).toBe(0); // 같은 연결을 다시 써도 kim으로 남아 있지 않다
  });
});
```

이 테스트는 HTTP를 거치지 않는다. `app.get(PrismaService)`로 앱이 쓰는 바로 그 `PrismaService`(`order_app` 연결)를 꺼내 정책을 직접 두드린다.

### 개념 | 에러 문구가 아니라 SQLSTATE로 판정하는 이유

세 번째 테스트는 에러 문구가 아니라 SQLSTATE로 판정한다.

PostgreSQL은 서버 로캘에 따라 메시지를 번역하므로(`new row violates row-level security policy`가 한국어로 나오기도 한다) 문구에 맞추면 환경에 따라 실패한다.

Prisma는 이 오류를 `P2039`로 감싸고, 원래 코드는 `meta.driverAdapterError.cause.originalCode`에 남긴다.

`toMatchObject`는 객체의 일부만 맞으면 통과하는 매처라서, 깊이 묻힌 `originalCode` 하나만 골라 비교할 수 있다.

### 작업 5. [실행] 테스트 DB에 마이그레이션 적용하고 돌리기

테스트 DB에도 새 마이그레이션을 소유자로 적용한다. 이제 `prisma7.config.ts`는 `ADMIN_DATABASE_URL`을 먼저 보므로, 앞에 붙이는 변수도 `ADMIN_DATABASE_URL`이어야 한다.

> `DATABASE_URL=...`을 붙이면 `.env`의 `ADMIN_DATABASE_URL`이 이겨서 개발 DB에 적용되고 끝난다.

```sh
ADMIN_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
npm run test:e2e

# 출력
 Test Files  5 passed (5)
      Tests  12 passed (12)
   Start at  18:23:28
   Duration  5.02s (transform 162ms, setup 24ms, import 2.07s, tests 2.47s, environment 0ms)
```

`process.loadEnvFile()`은 이미 있는 환경변수를 덮어쓰지 않는다. 그래서 명령 앞에 붙인 `ADMIN_DATABASE_URL`이 `.env`의 값보다 우선한다.

### 실험 | 6단계의 버그를 넣고 RLS 테스트만 돌리기

6단계의 버그(`true` → `false`)를 넣고 RLS 테스트만 돌리면 마지막 테스트가 잡는다.

```sh
npx vitest run --config ./vitest.config.e2e.ts test/rls.e2e-spec.ts
```

```text
× 트랜잭션이 끝나면 설정이 남지 않는다
AssertionError: expected 1 to be +0
```

`asUser("kim", ...)`가 연결에 `kim`을 남겼고, 같은 연결을 받은 다음 `count()`가 kim의 주문 1건을 셌다. 확인한 뒤 원복한다.

### 남길 것

- **찾아보면 되는 것**: `toMatchObject`, `meta.driverAdapterError.cause.originalCode` 경로, `vitest run --config ... <파일>`로 파일 하나만 돌리기. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - RLS가 있는 앱의 테스트는 연결이 둘이다. 준비·확인은 소유자로, 검증 대상은 앱 역할로 한다. 앱 역할로 확인하면 "안 보이는 것"과 "없는 것"을 구별할 수 없다.
  - DB 에러는 번역되는 문구가 아니라 SQLSTATE(`42501`)로 판정한다.

- **에러 신호**:
  - `TEST_ADMIN_DATABASE_URL이 없습니다` → `.env`에 `TEST_ADMIN_DATABASE_URL`을 넣었는지
  - `× 트랜잭션이 끝나면 설정이 남지 않는다` / `AssertionError: expected 1 to be +0` → `asUser`의 `set_config`가 `false`(세션 범위)로 바뀌었는지
  - `DATABASE_URL=...`을 앞에 붙여 `migrate deploy`를 했는데 테스트 DB에 반영되지 않는다 → 앞에 붙일 변수는 `ADMIN_DATABASE_URL`

## 9. 8단계: 컨테이너 구성

`07`의 compose에서 `api`의 `DATABASE_URL`만 바꾼다.

`migrate` 서비스는 소유자 그대로 둔다. 컨테이너에는 `ADMIN_DATABASE_URL`이 없으니 설정 파일이 `DATABASE_URL`(소유자 주소)을 쓴다.

### 작업 1. [커밋] compose의 앱 연결만 바꾸기

```yaml
# docker-compose.yml
# services.api.environment의 DATABASE_URL 한 줄만 바꾼다
      DATABASE_URL: postgresql://order_app:order_app@db:5432/order_api   # 앱은 RLS가 적용되는 역할로 붙는다. migrate는 소유자 그대로
```

### 작업 2. [실행] 띄워서 확인

컨테이너의 `api`도 4000번 포트를 쓴다. `npm run start:dev`가 떠 있으면 `Ctrl+C`로 먼저 끈다.

```sh
docker compose --profile app up -d --build
docker compose ps -a
```

`api`가 `Up (healthy)`가 되면 같은 요청을 컨테이너로 보낸다. 주소가 같은 `localhost:4000`이라 명령도 같다.

```sh
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -s -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders;
curl -s -X POST localhost:4000/orders/checkout \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":2,"quantity":1}]}';
```

> 끝나면 `docker compose --profile app down`으로 `api`·`migrate`를 내린다.  
> `db`도 같이 내려가므로 이어서 개발 서버를 띄울 때는 1장의 `docker compose up -d db redis storage`부터 다시 한다.

```text
order-api-nest-migrate-1   Exited (0)
order-api-nest-api-1       Up (healthy)
GET /me/orders (kim) → [{"id":1,...},{"id":3,...}]
POST /orders/checkout → {"id":16,"user":"kim",...}
```

`migrate`는 소유자로 마이그레이션을 끝내고 내려갔고(`Exited (0)`), `api`는 `order_app`으로 떠 있다.

### 남길 것

- **찾아보면 되는 것**: compose의 `profiles`, `depends_on`의 `service_completed_successfully`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 배포 환경에서도 "마이그레이션하는 계정"과 "앱이 붙는 계정"은 다르다. 컨테이너 하나하나에 필요한 권한만 준다.

- **에러 신호**:
  - 컨테이너로 띄운 앱에서는 정책이 듣지 않는다 → compose `api`의 `DATABASE_URL`이 아직 `order`(소유자)인지
  - `up`이 `Bind for 0.0.0.0:4000 failed: port is already allocated`로 실패 → `npm run start:dev`가 4000번을 잡고 있는지

## 10. 디버깅

### 진단 1. "지금 누구로, 무엇이 설정돼 있는가"

```sql
SELECT current_user, current_setting('app.user_id', true) AS app_user_id, current_setting('app.role', true) AS app_role;
```

슈퍼유저로 붙은 `psql`에서도 `SET ROLE order_app;`으로 앱 역할을 흉내 낼 수 있다. 앱이 하는 일을 그대로 재현해 본다.

```sh
docker compose exec db psql -U order -d order_api
```

```text
order_api=# SET ROLE order_app;
order_api=> SELECT current_user, count(*) FROM orders;
 order_app | 0
order_api=> BEGIN;
order_api=*> SELECT set_config('app.user_id', 'kim', true);
order_api=*> SELECT count(*) FROM orders;
 13
order_api=*> COMMIT;
order_api=> SELECT current_setting('app.user_id', true) AS after_commit;
 (빈 값)
order_api=> RESET ROLE;
```

프롬프트의 `#`은 슈퍼유저, `>`는 일반 역할, `*`는 트랜잭션 안이라는 표시다. 커밋 뒤의 "(빈 값)"이 1단계 "설정이 없으면 왜 0건인가"의 `''`이다.

### 진단 2. 정책이 쿼리에 붙었는가

진단 1과 같은 `psql`에서 `SET ROLE order_app;`, `BEGIN;`, `SELECT set_config('app.user_id', 'kim', true);`까지 친 상태에서 이어서 본다. 다 봤으면 `ROLLBACK;`과 `RESET ROLE;`로 돌아온다.

```text
order_api=*> EXPLAIN SELECT * FROM orders WHERE id = 1;
 Index Scan using orders_pkey on orders
   Index Cond: (id = 1)
   Filter: ((user_id = current_setting('app.user_id'::text, true)) OR (current_setting('app.role'::text, true) = 'admin'::text))
```

`Filter`에 정책 조건이 붙어 있으면 정책이 적용되고 있다. 슈퍼유저로 같은 `EXPLAIN`을 하면 이 줄이 없다.

2단계에서 정책이 안 들었던 이유가 여기서 보인다.

> 정책 목록은 `SELECT tablename, policyname, cmd, qual FROM pg_policies;`로 본다.

### 진단 3. 증상으로 원인 가르기

메시지를 외우는 게 아니라, 보이는 것에서 어느 칸으로 가는지만 익히면 된다. 단계마다 `남길 것`의 "에러 신호"를 모두 모았다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 |
|---|---|---|
| `ERROR:  unrecognized configuration parameter "app.user_id"` | 설정이 없는데 `current_setting`이 에러를 냈다 | 정책의 `current_setting`에 두 번째 인자 `true`가 있는지 (1단계) |
| 정책을 걸었는데 설정 없이도 남의 행이 다 보인다(에러 없음) | 붙은 계정이 슈퍼유저·`BYPASSRLS`·테이블 소유자다 | `SELECT current_user`, `pg_roles`, 진단 2의 `Filter` 줄 (2단계) |
| `{"message":"Unauthorized","statusCode":401}` | 액세스 토큰이 만료됐다(15분) | 3장의 로그인 두 줄로 `TOKEN`을 다시 받는다 (2단계) |
| `role "order_app" already exists` | shadow DB나 테스트 DB에서 역할을 두 번 만들려 했다 | 역할 생성이 `DO $$ ... IF NOT EXISTS`로 감싸졌는지 (3단계) |
| `ERROR:  permission denied for table ...` | 앱 역할에 그 테이블 권한이 없거나, 앱 역할로 `TRUNCATE` 같은 구조 작업을 했다 | 마이그레이션의 `GRANT`(`\dp`), 새 테이블이면 `ALTER DEFAULT PRIVILEGES`(`\ddp`) (3단계) |
| 조회가 전부 `[]`·`{}`로 200 | 그 경로가 "누구인가"를 설정하지 않았다 | 그 경로의 `asUser`/`asAdmin`. 에러가 나지 않으니 테스트로 잡는다 (4단계) |
| `new row violates row-level security policy for table "orders"` (`42501`, `P2039`, 응답 500) | 넣는 행이 `WITH CHECK`에 맞지 않는다 | 다른 사용자의 `user_id`로 쓰고 있지 않은지, `asUser`로 감쌌는지 (4단계) |
| 시드에서 `permission denied for table ...` | 시드가 앱 역할로 붙었다 | `.env`의 `ADMIN_DATABASE_URL`, `seed.ts`의 연결 (4단계) |
| `stampede.mjs`의 "팔린 수량"이 0 | 스크립트가 앱 역할로 세어 품목이 안 보인다 | 스크립트의 `ADMIN_DATABASE_URL` (4단계) |
| `.env`를 바꿨는데 조회가 전처럼 다 나오고 결제도 성공한다 | 떠 있던 서버가 예전 `DATABASE_URL`(소유자)로 붙어 있다 | `start:dev`를 끄고 다시 띄운다 (4단계) |
| `ERROR:  syntax error at or near "$1"` | `SET`/`SET LOCAL`은 바인드 파라미터를 받지 못한다 | `set_config(이름, $1, true)`로 바꾼다 (5단계) |
| 사용자 목록은 나오는데 `orders`가 모두 빈 배열 | `include`로 붙는 `orders` 쿼리가 설정 없이 돌았다 | `listWithOrders`의 `asAdmin` (5단계) |
| `asUser` 안인데도 빈 결과 | 쿼리가 트랜잭션 밖의 다른 커넥션으로 갔다 | 콜백 안에서 `tx.` 대신 `this.prisma.`를 쓰지 않았는지 (5단계) |
| 가끔 다른 사람의 데이터가 보인다 | 이전 요청의 설정이 연결에 남았다 | `set_config`의 세 번째 인자가 `false`인지, 설정과 쿼리를 다른 트랜잭션에서 했는지 (6단계) |
| `TEST_ADMIN_DATABASE_URL이 없습니다` | 테스트용 소유자 연결이 없다 | `.env`의 `TEST_ADMIN_DATABASE_URL` (7단계) |
| `× 트랜잭션이 끝나면 설정이 남지 않는다` / `AssertionError: expected 1 to be +0` | `asUser`가 연결에 설정을 남겼다 | `asUser`의 `set_config`가 `true`인지 (7단계) |
| `migrate deploy`를 했는데 테스트 DB에 반영되지 않는다 | 앞에 붙인 `DATABASE_URL`보다 `.env`의 `ADMIN_DATABASE_URL`이 먼저 쓰였다 | 앞에 `ADMIN_DATABASE_URL=...`을 붙인다 (7단계) |
| 컨테이너로 띄운 앱에서는 정책이 듣지 않는다 | `api`가 소유자로 붙어 있다 | compose `api`의 `DATABASE_URL` (8단계) |
| `Bind for 0.0.0.0:4000 failed: port is already allocated` | 개발 서버가 4000번을 쓰고 있다 | `start:dev`를 `Ctrl+C`로 끈다 (8단계) |

### 시험해보기

```sh
npx prisma db seed
npm run start:dev
# 다른 터미널에서 kim으로 로그인해서
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders # kim의 주문만
curl -H "Authorization: Bearer $TOKEN" localhost:4000/me/orders/2 # 404
npm run test:e2e # 12 passed
```

### 도전 과제

#### 1. 관리자 경로와 `asAdmin` 묶기

`asAdmin`을 쓰는 경로들(`GET /orders`, `/orders/totals`, `/users`, `POST /orders`)에 `03`의 도전 과제 1처럼 관리자 Guard를 건다.

그 Guard를 통과한 요청만 `asAdmin`을 쓸 수 있게, 두 가지를 한 군데에서 묶는 방법을 생각해 본다.

어떻게 묶으면 Guard를 빠뜨린 경로가 관리자로 읽을 수 없게 되는가?

**답**

1. `03`의 도전 과제 1처럼 `users`에 `role` 컬럼(`String @default("user")`)을 추가하고, 시드에서 `choi`만 `"admin"`으로 둔다.

2. `PrismaService`에서 `asAdmin`을 지우고, 같은 내용(`set_config('app.role', 'admin', true)` 후 `fn` 실행)을 `AdminGuard` 안으로 옮긴다. Guard는 `req.user.userId`로 DB에서 `role`을 읽어 `"admin"`이 아니면 `false`(403)를 돌려주고, 통과하면 그 함수(`runAsAdmin`)를 요청 객체에 붙인다. 붙이는 자리는 내보내지 않은 `Symbol`이라 다른 파일에서는 넣을 수 없다.

3. 같은 파일에 데코레이터 둘을 둔다. `@AdminOnly()`는 `applyDecorators(UseGuards(AuthGuard("jwt"), AdminGuard))`이고, `@AdminTx()`는 요청에 붙은 `runAsAdmin`을 핸들러 인자로 꺼내 준다. 서비스의 `list`, `findOne`, `totals`, `create`, `listWithOrders`는 `runAsAdmin`을 인자로 받으므로, 컨트롤러가 `@AdminTx()`로 받아 넘기지 않으면 관리자로 읽을 방법이 없다.

4. 다섯 경로에 `@AdminOnly()`를 건다. 토큰 없이는 401, `kim` 토큰이면 `{"message":"Forbidden resource","error":"Forbidden","statusCode":403}`, `choi` 토큰이면 `GET /orders`가 다섯 건 모두, `/orders/totals`가 `{"kim":17000,"lee":30000,"park":7000}`, `POST /orders`가 201이다. `kim`의 `/me/orders`와 결제는 그대로 200, 201이다.

5. `@AdminOnly()`를 빼고 `@AdminTx()`만 남긴 경로를 부르면 `@AdminTx()는 @AdminOnly()가 붙은 경로에서만 쓸 수 있다` 에러로 500이 된다. 4단계처럼 빈 결과로 조용히 넘어가지 않는다.

> `POST /orders`가 관리자 경로가 되므로, 이 경로로 주문을 만드는 실험 스크립트(`notify-check.mjs`, `order-burst.mjs`)도 `choi`로 로그인해야 한다. 요청이 아닌 곳(정리 작업 등)에서 관리자로 읽어야 하면 이 방식과 따로 경로를 둬야 한다.

#### 2. `refresh_tokens`에 RLS 걸어 보기

`refresh_tokens`에도 RLS를 걸어 본다. `03`의 refresh 흐름은 토큰 값으로 행을 찾는데, 그 시점에는 아직 누구인지 모른다.

어떤 정책이면 되는지, 아니면 이 테이블은 RLS 대상이 아닌지 판단해 본다.

**답**

1. `orders`와 같은 정책(`user_id = app.user_id` 또는 `app.role = 'admin'`)을 마이그레이션으로 걸고 코드는 그대로 두면, 로그인부터 500이다. 서버 로그는 `new row violates row-level security policy for table "refresh_tokens"`(`42501`)다. 토큰 행을 넣을 때 아무도 설정되어 있지 않기 때문이다.

2. 로그인은 비밀번호를 확인한 뒤라 누구인지 안다. 토큰 발급을 `asUser(user.id, ...)`로 감싸면 된다. `logout-all`도 액세스 토큰으로 누구인지 아니까 `asUser`로 감싼다.

3. refresh와 logout은 막힌다. `order_app`으로 `SELECT count(*) FROM refresh_tokens WHERE token_hash = ...`를 하면 설정이 없으니 0건이다. 토큰이 있어도 "유효하지 않은 refresh token"과 구별되지 않는다.

4. 그래서 "토큰 해시 → 주인 id"만 돌려주는 함수를 `SECURITY DEFINER`로 만든다. 함수를 만든 소유자 `order`의 권한으로 돌아 RLS를 받지 않는다. `REVOKE ALL ... FROM PUBLIC` 후 `order_app`에만 `EXECUTE`를 준다. refresh·logout은 이 함수로 주인을 먼저 알아내고(없으면 401), 나머지를 `asUser(주인, ...)` 안에서 한다.

5. 리더의 토큰 정리 작업도 바뀌어야 한다. 그대로 두면 만료된 지 이틀 된 행 3개가 지워지지 않고 남는다. 에러도 로그도 없다. `asAdmin`으로 감싸면 `토큰 정리: 3건 삭제`가 찍힌다.

6. 이렇게 고치면 회전(200), 재사용 감지(401 `이미 사용된 refresh token이다`), 모르는 토큰(401), logout·logout-all 뒤 refresh(401)가 모두 그대로이고, e2e 12개도 통과한다.

> 판단: 정책은 걸 수 있지만, 정작 refresh·logout 경로는 `SECURITY DEFINER` 함수로 RLS를 돌아가야만 동작한다. 이 테이블에서 행을 찾는 열쇠는 소유자가 아니라 토큰 값 자체이고, 추측할 수 없는 토큰이 곧 권한이다. 그래서 RLS가 실제로 지켜 주는 곳은 누구인지 이미 아는 경로(발급, logout-all)뿐이고, 대가로 정리 작업처럼 조용히 0건이 되는 곳이 생긴다. `refresh_tokens`는 RLS 대상으로 두지 않는 편이 낫다.

## 11. 완성 확인

- [ ] RLS를 켜도 슈퍼유저로 붙으면 정책이 무시되는 것을 확인했다

- [ ] 앱 전용 역할로 붙으면 설정 없이는 0건, kim으로는 kim의 주문만, admin으로는 전부 보인다

- [ ] 마이그레이션·시드는 소유자로, 앱은 앱 역할로 붙는다

- [ ] 소유자 조건을 빠뜨린 IDOR 버그를 되살려도 404다

- [ ] `set_config`를 세션 범위로 하면 다른 요청에 데이터가 새는 것을 재현했고, 테스트가 그걸 잡는다

- [ ] `npm run test:e2e` 12개가 통과하고, 컨테이너 구성도 앱 역할로 정상 동작한다

## 12. 다음 단계

### 자가 점검

소리 내어 설명할 수 있으면 통과다.

1. RLS를 켰는데도 처음에 남의 주문이 보인 이유는? 유닉스 파일 권한의 어떤 예외와 같은가?

2. `USING`과 `WITH CHECK`는 각각 무엇을 막는가? `WITH CHECK`가 없으면 무엇이 가능한가?

3. DB는 어떻게 "누가 요청했는지" 아는가? 설정과 쿼리를 같은 트랜잭션에서 해야 하는 이유는?

4. 앱이 컨텍스트 설정을 빠뜨렸을 때, 트랜잭션 범위와 세션 범위에서 결과가 어떻게 다른가?

5. 역할 생성 마이그레이션을 "없을 때만"으로 감싼 이유는?

6. 테스트의 준비·확인을 왜 소유자 연결로 하는가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 정책을 명령별(`FOR SELECT`, `FOR INSERT` 등)로 나누기, 여러 정책의 조합(`PERMISSIVE`/`RESTRICTIVE`)

- 테넌트(회사)마다 데이터를 나누는 멀티테넌시를 RLS로 구현하기

- 정책 조건이 복잡할 때의 성능(정책 조건에 맞는 인덱스, `security_barrier`)

- 운영에서 역할과 비밀번호를 인프라 도구로 관리하기
