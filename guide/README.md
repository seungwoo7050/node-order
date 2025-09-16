# PostgreSQL과 Prisma: 주문 API를 영구 저장소로 옮기기

## 목표

이 프로젝트는 `node-workspace`저장소의 [`foundation/05-ws-gateway`](https://github.com/seungwoo7050/node-workspace/tree/foundation/05-ws-gateway)브랜치로부터 시작한다.

시작점의 구현은 주문이 서비스 클래스의 배열 필드에 들어 있어서 서버를 껐다 켜면 전부 사라진다.

이 프로젝트에서는 그 배열을 PostgreSQL 데이터베이스로 옮기고, 사용자 테이블과 관계, 스키마 변경(마이그레이션), 제약 위반 처리, 인덱스까지 붙인다.

**HTTP API의 모양(`{ id, user, price, paid }`)은 그대로 유지한다**(화면이 보내는 요청도 바꿀 필요가 없다).

```sh
# 주문을 하나 만들고 서버를 껐다 켜도 그대로 남아 있다
curl localhost:4000/orders/6
{"id":6,"user":"choi","price":9000,"paid":true}

# 사용자별 주문 목록.
# 쿼리 개수가 사용자 수와 상관없이 2개다
curl localhost:4000/users
[{"id":"choi","name":"최","orders":[]},{"id":"kim","name":"김","orders":[{"id":1,"price":12000,"paid":true},...]},...]

# 존재하지 않는 사용자의 주문은 DB의 외래키가 거부하고 그걸 400으로 바꿔 돌려준다
curl -X POST localhost:4000/orders -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJ..." -d '{"user":"nobody","price":9000,"paid":true}'
{"message":"참조하는 대상이 존재하지 않는다","error":"Bad Request","statusCode":400}
```

### 시작 조건

- 완성된 [`foundation/05-ws-gateway`](https://github.com/seungwoo7050/node-workspace/tree/foundation/05-ws-gateway)를 복사해 `order-api-nest`가 `http://localhost:4000`에서 로그인·주문 생성·실시간 알림까지 동작하는 상태로부터 시작한다.

- PostgreSQL을 컨테이너로 띄우기 위한 Docker가 설치되어 있어야 한다. 

## 이 문서 읽는 법

`##`는 단계, `###`는 그 단계 안의 블록이다. **소제목 앞머리가 그 블록의 성격**이고, 그것만 보고 "쳐야 하는 것"과 "읽는 것"을 가를 수 있다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
| --- | --- | --- |
| **작업 N.** | 파일을 고치고 명령을 치는 순서. 번호대로 따라가면 완성된다 | 친다 |
| **개념 \|** | 방금 한 작업이 왜 그런지, 또는 자주 걸리는 지점의 설명 | 아니다. 코드가 있어도 보기 위한 예시다 |
| **용어 \|** | 그 단계에서 처음 나온 API·문법·SQL의 짧은 사전 | 아니다 |
| **실험 \|** | 일부러 깨뜨려 보는 것 | 친다(에러를 보려고) |
| **진단 N.** | 8단계의 "어느 층에서 틀어졌나"를 가르는 절차. 필요할 때 찾아 쓴다 | 필요할 때만 |

처음 통과할 때는 **`작업 N.`만 순서대로** 따라가도 완성된다. `개념`·`용어`는 막혔을 때나 궁금할 때 읽는다.

각 단계 끝의 **`남길 것`** 은 그 단계에서 무엇이 기억에 남아야 하는지를 세 줄로 가른다.

**찾아보면 되는 것**(문법·플래그)과 **감각으로 남겨야 할 것**(판단 기준), 그리고 **에러 신호**(이 메시지를 보면 어디를 보는가)다.

두 번째 줄만 남으면 이 문서는 제 역할을 한 것이다. 세 번째 줄은 8단계 진단 2의 표에 모여 있다.

소제목이 없는 단계(1단계)는 본문 전체가 작업이다.

0장에는 작업이 없다. 전부 용어와 사전지식이다.

| 단계 | 하는 일 |
| --- | --- |
| [0. 사전지식](#0-db에-대한-사전지식) | 테이블·컬럼·SQL·제약·스키마라는 말과, 배열에서 DB로 옮길 때 달라지는 네 가지 |
| [1. 준비](#1-준비) | DB 컨테이너 띄우기, 패키지 설치 |
| [2. 1단계](#2-1단계-psql로-db에-직접-말-걸기) | `psql`로 DB에 직접 말 걸어 보기 |
| [3. 2단계](#3-2단계-prisma-초기화와-첫-마이그레이션) | Prisma 초기화, `orders` 테이블과 첫 마이그레이션 |
| [4. 3단계](#4-3단계-인메모리-배열을-prismaservice로-교체하기) | 배열을 걷어 내고 `PrismaService`로 교체, 시드 |
| [5. 4단계](#5-4단계-사용자-테이블과-1n-관계-데이터가-든-테이블의-마이그레이션) | `users` 테이블과 외래키, 데이터가 든 테이블의 마이그레이션 |
| [6. 5단계](#6-5단계-관계-따라가기와-n1-문제) | 관계 따라가기와 N+1 문제 |
| [7. 6단계](#7-6단계-db가-거부한-요청을-4xx로-바꾸기) | 제약 위반(500)을 400/409로 바꾸기 |
| [8. 7단계](#8-7단계-외래키를-걸었다고-인덱스가-생기지는-않는다) | 인덱스와 실행 계획 |
| [9. 8단계](#9-8단계-앱-문제인가-db-문제인가-가르는-디버깅) | 앱/SQL/DB 가르는 디버깅, 시험해보기, 도전 과제 |
| [10. 완성 확인](#10-완성-확인) | 체크리스트 |
| [11. 다음 단계](#11-다음-단계) | 자가 점검과 다루지 않은 것 |

## 0. DB에 대한 사전지식

앞의 `용어` 네 개는 이 문서 내내 쓰는 말(테이블·컬럼·SQL·제약·스키마)을 정리한 것이고, 뒤의 `개념 1~4`는 배열을 DB로 바꿀 때 실제로 달라지는 것 네 가지다. 칠 것은 없다.

### 용어 | 테이블, 행, 컬럼

관계형 DB는 데이터를 테이블에 넣는다. C의 구조체 배열과 거의 그대로 겹친다.

```c
struct Order {
    int id;
    char user[16];
    int price;
    bool paid;
3};
struct Order orders[6]; // 이 배열 하나가 테이블 orders에 해당한다
```

- 테이블(table): 같은 모양의 데이터가 모인 곳이다. 구조체 배열 전체.

- 행(row): 테이블의 한 줄이다. 배열의 원소 하나, 즉 `struct Order` 하나에 해당한다. 주문 한 건이 한 행이다.

- 컬럼(column): 모든 행이 공통으로 갖는 칸이다. 구조체의 필드 멤버에 해당한다. `orders`의 컬럼은 `id`, `user_id`, `price`, `paid`, `created_at`이다.

차이는 **컬럼의 타입을 DB가 들고 있고, 넣을 때마다 검사한다**는 점이다.

컬럼마다 타입이 하나 정해져 있어서 정수 컬럼에는 정수만 들어간다. 그래서 이 문서에서 "정수 컬럼"이라고 하면 `price`처럼 `INTEGER`로 선언해 정수만 담는 칸을 말한다.

| Prisma 선언 | 실제 PostgreSQL 타입 | 뜻 |
| --- | --- | --- |
| `Int` | `INTEGER` | 4바이트 정수. C의 `int32_t` |
| `String` | `TEXT` | 길이 제한 없는 문자열 |
| `Boolean` | `BOOLEAN` | 참/거짓 |
| `DateTime` | `TIMESTAMP(3)` | 날짜와 시각(밀리초까지) |
| `Int @default(autoincrement())` | `SERIAL` | 값을 안 주면 DB가 1, 2, 3...을 채우는 정수 컬럼 |

여기에 타입과 별개로 `NULL`이 있다. 어떤 타입의 컬럼이든 "값이 아직 없음"이라는 상태를 가질 수 있고, 이것은 `0`이나 빈 문자열과 다르다.

C의 널 포인터처럼 "값이 없다"는 표시 그 자체다. 이 상태를 금지하는 것이 아래의 `NOT NULL`이다.

### 용어 | SQL: DB에 보내는 명령

SQL은 DB 서버에 보낼 명령을 적는 언어다.

앱이 소켓으로 보내는 건 결국 SQL 문자열이고, Prisma가 해 주는 일은 그 문자열을 대신 써 주는 것이다.

그래서 이 문서는 Prisma 코드를 쓸 때마다 그것이 어떤 SQL이 되는지를 같이 본다.

SQL 문장을 두 종류로 갈라 두면 이 문서에 나오는 것이 거의 전부 들어간다.

**데이터를 다루는 문장**(이미 있는 테이블에 행을 읽고 쓴다)

- `SELECT`: 조건에 맞는 행을 읽는다.

- `INSERT`: 새 행을 넣는다.

- `UPDATE`: 이미 있는 행의 값을 고친다.

- `DELETE`: 행을 지운다.

**구조를 다루는 문장**(테이블과 제약 자체를 만들고 바꾼다)

- `CREATE TABLE`: 테이블을 만든다.

- `ALTER TABLE`: 이미 있는 테이블에 컬럼이나 제약을 추가·삭제·변경한다.

- `CREATE INDEX`: 인덱스를 만든다.

마이그레이션 파일에 쌓이는 것이 이 두 번째 종류다.

| 이 문서에서 쓰는 것 | 만들어지는 SQL |
| --- | --- |
| `findMany`, `findUnique`, `groupBy` | `SELECT` |
| `create`, `createMany` | `INSERT` |
| `deleteMany` | `DELETE` |
| `prisma migrate dev` | `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX` |

### 용어 | 제약(constraint): 컬럼과 테이블에 붙이는 규칙

제약은 "이 컬럼에 어떤 값이 들어올 수 있는가"를 DB에 선언해 두는 것이다.

타입이 "정수냐 문자열이냐"를 정한다면, 제약은 그보다 한 겹 위의 규칙을 정한다.

| 제약 | 뜻 |
| --- | --- |
| `NOT NULL` | 이 컬럼은 비어 있을(`NULL`) 수 없다 |
| `UNIQUE` | 이 컬럼에 같은 값이 두 번 들어올 수 없다 |
| `PRIMARY KEY`(기본키) | 행을 유일하게 식별하는 컬럼. `NOT NULL`이면서 `UNIQUE`이고, 테이블에 하나뿐이다 |
| `FOREIGN KEY`(외래키) | 이 컬럼의 값이 다른 테이블의 어떤 행을 가리킨다. 가리킬 대상이 없는 값은 거부된다 |

외래키에는 "가리켜지고 있는 행을 지우거나 고치려 하면 어떻게 할지"를 함께 정한다.

- `ON DELETE RESTRICT`: 누군가 가리키고 있는 행은 지울 수 없다(기본값).

- `ON DELETE CASCADE`: 그 행을 지우면 가리키던 행들도 함께 지운다.

- `ON UPDATE CASCADE`: 가리켜지는 쪽의 값(여기서는 `users.id`)이 바뀌면 가리키는 쪽도 따라 바꾼다.

제약을 어기는 `INSERT`나 `UPDATE`는 DB가 에러로 거부한다. 선언하는 자리, 어겼을 때 실제로 무슨 일이 생기는지, 그 에러를 HTTP 4xx로 바꾸는 방법은 본문에서 다룬다.

### 용어 | "스키마"는 세 가지로 쓰인다

같은 단어가 세 자리에서 쓰이는데, 이 문서에는 셋이 모두 나온다.

- **DB의 구조 그 자체**: 어떤 테이블에 어떤 컬럼이 있고 타입과 제약이 무엇인가. "스키마 제약", "스키마를 바꾼다"가 이 뜻이다.

- **`prisma/schema.prisma` 파일**: 그 구조를 Prisma의 선언 언어로 적어 둔 것이다. 이 파일 하나에서 마이그레이션 SQL과 TS 코드가 나온다.

- **PostgreSQL의 이름공간**: 테이블을 담는 폴더에 해당한다. 따로 만들지 않으면 테이블은 전부 `public`에 들어간다. 나중에 쿼리 로그에 보이는 `"public"."orders"`와 자리표시자 주소의 `?schema=public`이 이것이다. 이 문서에서는 `public` 하나만 쓴다.

### 개념 1. DB는 내 프로세스 밖의 별도 서버다

지금의 `this.orders.find(...)`는 같은 프로세스 메모리 안의 배열을 훑는 일이라 실패할 일도, 기다릴 일도 없었다.

DB로 옮기면 배열 접근이 아니라 소켓 너머의 요청이 된다.

PostgreSQL은 별도의 서버 프로세스이고, 앱은 TCP 소켓으로 거기에 접속해 SQL 문자열을 `write()`하고 결과를 `read()`한다.

그래서 두 가지가 따라온다.

- 모든 DB 호출은 비동기(`await`)가 된다. 응답을 기다리는 동안 이벤트 루프가 다른 요청을 처리해야 하기 때문이다.

- 모든 DB 호출은 **실패할 수 있다**. DB가 꺼져 있을 수도, 네트워크가 끊길 수도 있다.

매번 접속을 새로 맺으면 느리기 때문에, 드라이버(`pg`)는 연결 몇 개를 미리 열어 두고 돌려 쓴다. 이것을 커넥션 풀이라고 한다. 마치 C에서 열어 둔 fd 배열을 재사용하는 것이다.

### 개념 2. 스키마 제약은 컴파일러가 아니라 DB가 런타임에 강제한다

TS에서 "타입은 컴파일 타임에만 존재하고, 실행 파일에는 남지 않는다"는 걸 봤다.

DB의 스키마는 정반대다. `NOT NULL`, `UNIQUE`, `FOREIGN KEY` 같은 제약은 DB 서버가 매 `INSERT`/`UPDATE`마다 실제로 검사한다.

우리 앱 코드든, 다른 서비스든, 사람이 `psql`로 직접 친 SQL이든, 어디서 들어온 요청이든 같다.

앱 코드에 검증이 빠져 있어도 DB가 거부한다. 그래서 DB 제약을 **데이터 무결성의 마지막 방어선**이라고 부른다.

### 개념 3. 외래키(Foreign Key)는 "dangling이 불가능한 포인터"다

주문이 사용자를 가리키게 만들면, C로는 대략 이런 모양이다.

```c
struct User { char id[16]; char name[32]; };
struct Order { int id; struct User *user; int price; bool paid; };

free(kim); // kim을 가리키던 주문들의 user 포인터는 이제 dangling이다
printf("%s", o->user->name); // 정의되지 않은 동작(use-after-free)
```

DB에서는 `orders.user_id`가 `users.id`를 가리키는 외래키가 이 포인터 역할을 한다.

차이는 **DB가 dangling을 원천적으로 허용하지 않는다**는 점이다.

- 주문이 참조하고 있는 사용자를 지우려 하면 DB가 거부한다(`RESTRICT`, 기본값). 또는 설정에 따라 참조하던 주문까지 같이 지운다(`CASCADE`).

- 존재하지 않는 사용자를 가리키는 주문을 넣으려 해도 거부한다.

### 개념 4. 마이그레이션은 "이미 디스크에 쓰인 파일 포맷"을 바꾸는 일이다

C에서 `struct Order` 배열을 `fwrite`로 파일에 저장해 뒀다고 해 보자.

나중에 `struct`에 필드를 하나 추가하고 다시 컴파일해도, 이미 저장된 파일은 옛날 레이아웃 그대로다.

새 프로그램으로 읽으려면 옛 포맷을 새 포맷으로 바꾸는 변환 프로그램을 한 번 돌려야 한다.

DB도 똑같다. 코드의 스키마 선언만 바꾼다고 이미 쌓인 테이블과 데이터가 바뀌지 않는다.

**마이그레이션은 이 변환 스크립트(SQL)를 순서대로 쌓아 둔 것이다.**

DB 안의 기록 테이블(`_prisma_migrations`)이 "어디까지 적용했는지"를 기억한다.

개발 PC든 운영 서버든 같은 스크립트를 같은 순서로 적용하면 같은 구조가 된다.

## 1. 준비

### 작업 1. DB 띄우기

`order-api-nest` 폴더 바로 아래(`package.json` 옆)에 `docker-compose.yml`을 만든다.

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:17
    # 학습용 값이다
    environment:
      POSTGRES_USER: order
      POSTGRES_PASSWORD: order
      POSTGRES_DB: order_api
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

```sh
docker compose up -d # up -d: compose 파일의 서비스를 백그라운드(-d, detached)로 띄운다
docker compose ps # ps: 지금 떠 있는 컨테이너와 상태를 보여 준다. STATUS가 Up이면 된다
# 출력
NAME                  IMAGE         COMMAND                   SERVICE   CREATED         STATUS         PORTS
order-api-nest-db-1   postgres:17   "docker-entrypoint.s…"   db        7 seconds ago   Up 6 seconds   0.0.0.0:5433->5432/tcp
```

### 용어 | Compose 파일 문법

- `services`: 띄울 컨테이너 목록이다. 여기서는 `db` 하나다.

- `image: postgres:17`: Docker Hub의 공식 PostgreSQL 17 이미지를 쓴다.

- `environment`: 컨테이너가 처음 뜰 때 이 값으로 사용자·비밀번호·DB를 만든다.

- `ports: "5433:5432"`: `PC의 포트:컨테이너의 포트`다. PC에 이미 PostgreSQL이 5432를 쓰고 있을 수 있어서, PC 쪽은 5433으로 피한다. 오른쪽 5432는 피할 수 없는 값이다.

- `volumes`: 데이터를 컨테이너 밖의 이름 붙은 볼륨(`pgdata`)에 저장한다.

### 개념 | 포트 매핑과 볼륨

컨테이너는 PC 안에서 따로 격리된 프로세스다.

자기만의 네트워크와 파일 시스템을 가지므로, 바깥에서 쓰려면 "어느 포트로 들어오게 할지"와 "데이터를 어디에 남길지"를 따로 정해 줘야 한다.

그 두 가지가 `ports`와 `volumes`다.

`ports: "5433:5432"`는 PC의 5433번으로 들어온 연결을 컨테이너 안의 5432번(PostgreSQL 기본 포트)으로 넘긴다는 뜻이다.

그래서 **어디서 접속하느냐에 따라 쓰는 포트가 다르다.**

```sh
# PC에서 도는 앱(Nest, Prisma CLI)은 PC 쪽 포트 5433으로 접속한다
DATABASE_URL=postgresql://order:order@localhost:5433/order_api

# docker compose exec는 컨테이너 안에서 psql을 실행하므로 포트 매핑을 거치지 않는다
docker compose exec db psql -U order -d order_api
```

두 숫자의 처지가 다르다.

- **왼쪽(PC 쪽)은 통로의 입구 번호일 뿐이다.** PC에서 이미 쓰고 있지 않은 번호면 아무 값이나 된다(`15432:5432`도 똑같이 동작한다). 바꿨으면 `DATABASE_URL`의 포트도 같이 바꾸기만 하면 된다.

- **오른쪽(컨테이너 쪽)은 아무 값이나 되지 않는다.** 컨테이너 안에서 PostgreSQL이 실제로 듣고 있는(`listen`) 번호여야 한다. 이 이미지는 5432에서 듣도록 만들어져 있으므로 5432다. `5433:5433`으로 적으면 컨테이너의 5433에는 아무도 듣고 있지 않아서, 접속하면 컨테이너 안에서 거부되어 `ECONNREFUSED`가 돌아온다.

C로 치면 오른쪽은 서버 프로세스가 `bind()`해 둔 포트 번호이고, 왼쪽은 그 앞에 세워 둔 포트 포워딩 규칙이다. 듣고 있지 않은 포트로 넘겨 주는 규칙은 아무 소용이 없다.

> 컨테이너 쪽 번호까지 바꾸고 싶다면 PostgreSQL이 다른 포트에서 듣게 설정(`-p` 옵션이나 `postgresql.conf`)해야 하는데, 포트를 피하는 목적이라면 PC 쪽 번호만 바꾸면 되므로 그럴 이유가 없다.

`volumes`의 `pgdata`는 컨테이너가 아니라 Docker가 따로 관리하는 저장 공간이다.

컨테이너를 프로세스, 볼륨을 그 프로세스가 쓰는 디스크 파일로 보면, 프로세스를 죽였다 다시 띄워도 파일은 남는 것과 같다.

**이름으로 부르는 저장소이지, PC의 경로가 아니다.** 실제로 어디에 있는지는 Docker에게 물어본다.

```sh
# 볼륨 목록. 이름 앞에 프로젝트 이름(기본값은 compose 파일이 있는 폴더 이름)이 붙는다
docker volume ls
# local     order-api-nest_pgdata

# 그 볼륨의 상세 정보
docker volume inspect order-api-nest_pgdata
# "Mountpoint": "/var/lib/docker/volumes/order-api-nest_pgdata/_data"
```

`Mountpoint`는 **PC의 경로가 아니라 Docker 엔진이 도는 리눅스 쪽 경로**다.

리눅스 PC라면 그 경로가 그대로 PC의 경로다. 

하지만 macOS나 Windows에서는 Docker Desktop이 리눅스 VM을 하나 띄워 그 안에서 컨테이너를 돌리기 때문에, 저 경로는 VM 안에 있고 Finder로는 열 수 없다.

PC에서 보이는 것은 그 VM의 디스크 전체를 담은 파일 하나다.

```sh
# macOS의 Docker Desktop. 희소 파일이라 ls가 보여 주는 크기는 실제 사용량이 아니다
~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw
```

그래서 볼륨 안을 들여다볼 때는 PC의 파일 탐색기가 아니라 컨테이너 안에서 본다.

`pgdata:/var/lib/postgresql/data`의 오른쪽이 컨테이너 안에서 이 볼륨이 보이는 경로다.

```sh
docker compose exec db ls /var/lib/postgresql/data
# base  pg_wal  postgresql.conf  ... (PostgreSQL이 실제로 쓰는 데이터 파일들)
```

PC의 폴더를 직접 쓰고 싶다면 `./pgdata:/var/lib/postgresql/data`처럼 경로를 적는 바인드 마운트도 있다.

다만 PC와 컨테이너의 파일 권한이 어긋나거나(macOS·Windows에서는) 파일 공유를 거쳐 느려지기 쉬워서, DB 데이터에는 이름 붙은 볼륨을 쓴다.

볼륨 이름은 프로젝트 이름에 묶여 있다.

폴더 이름을 바꾸거나 다른 폴더로 복사해서 `up -d`하면 **다른 볼륨**이 새로 만들어지고, DB는 빈 상태로 보인다(옛 볼륨은 그대로 남아 있다).

| 명령 | 컨테이너 | 볼륨(데이터) |
| --- | --- | --- |
| `docker compose stop` | 멈춤(남아 있음) | 남음 |
| `docker compose down` | 삭제 | 남음 |
| `docker compose down -v` | 삭제 | **삭제** |

`environment`의 사용자·비밀번호·DB는 **볼륨이 비어 있을 때 한 번만** 만들어진다. 

데이터가 든 볼륨이 있으면 PostgreSQL 이미지는 초기화를 건너뛰므로, 나중에 `POSTGRES_PASSWORD`를 바꿔도 실제 비밀번호는 바뀌지 않는다.

위 상황에서 `docker compose down -v`로 볼륨까지 지우고 다시 띄우면 새 값으로 초기화되지만, 그동안 쌓은 데이터도 함께 사라진다.

> `ECONNREFUSED`가 나면 컨테이너가 떠 있는지(`docker compose ps`)와 함께 `DATABASE_URL`의 포트가 PC 쪽 번호(5433)인지 먼저 본다.

### 작업 2. 패키지 설치

```sh
# @prisma/client: 앱 코드가 쓰는 Prisma 런타임
# @prisma/adapter-pg + pg: Prisma가 PostgreSQL에 접속할 때 쓰는 드라이버(pg)와 그 연결 어댑터
npm install @prisma/client@7 @prisma/adapter-pg@7 pg
# -D: 개발용 의존성.
# prisma는 스키마·마이그레이션·코드 생성을 하는 CLI, @types/pg는 pg의 타입 정의다
npm install -D prisma@7 @types/pg
```

`@7`을 붙이는 이유가 있다.

**CLI(`prisma`)와 런타임(`@prisma/client`)은 메이저 버전이 같아야 한다.**

버전을 안 적으면 npm은 `latest` 태그를 따라가는데, `prisma` 패키지의 이 태그가 다음 메이저의 RC(출시 후보) 버전을 가리킨 적이 있었다(그러면 CLI와 런타임버전이 어긋난다).

> 설치 후 `npx prisma --version`으로 `prisma`와 `@prisma/client`가 같은 버전인지 확인한다.

## 2. 1단계: psql로 DB에 직접 말 걸기

ORM을 붙이기 전에, DB가 정말 별도 서버로 떠 있다는 걸 손으로 확인한다.

`psql`은 PostgreSQL의 명령줄 클라이언트다. HTTP의 `curl`처럼 DB에 직접 요청을 보내 보는 도구라고 생각하면 된다.

```sh
# exec db psql ...: db 컨테이너 안에서 psql을 실행한다. -U 사용자, -d 접속할 DB
docker compose exec db psql -U order -d order_api
```

```sh
# 접속한 DB 서버의 버전을 묻는 SQL. 소켓 너머에 정말 PostgreSQL 17이 떠 있는지 확인한다
order_api=# SELECT version();
                   version                                                           
--------------------------------------------
 PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
(1 row)
# 이 DB에 있는 테이블 목록(describe tables). 아직 아무것도 만들지 않았다
order_api=# \dt
Did not find any relations.
# psql에서 빠져나온다(quit)
order_api=# \q
```

`\dt`(테이블 목록)는 아직 비어 있다. `\`로 시작하는 건 SQL이 아니라 psql 자체의 명령이다. `\q`로 나온다.

> 이 문서 내내 "앱이 아니라 DB에서 직접 확인"이 필요할 때마다 이 명령으로 들어온다.

## 3. 2단계: Prisma 초기화와 첫 마이그레이션

### 작업 1. `prisma init`으로 뼈대 만들기

```sh
# --datasource-provider postgresql: 쓸 DB 종류
# --output: generate가 만들어 둘 "클라이언트 코드"의 위치(schema.prisma 기준 상대경로 → src/generated/prisma)
# --no-skills: AI 에이전트용 설정 파일(.claude/skills 등)은 만들지 않는다
npx prisma init --datasource-provider postgresql --output ../src/generated/prisma --no-skills
```

세 가지가 생긴다.

- `prisma/schema.prisma`: 스키마 선언

- `prisma7.config.ts`: CLI 설정

- `.gitignore`: `.env`와 생성 코드를 git에서 제외

### 작업 2. `.env`와 `prisma7.config.ts` 고치기

그리고 `.env` 끝에 자리표시자 `DATABASE_URL="postgresql://johndoe:randompassword@localhost:5432/mydb?schema=public"`와 설명 주석이 붙는다.

자리표시자(placeholder)는 **형식만 보여 주는 가짜 값**이다.

`johndoe`, `randompassword`, `mydb`는 Prisma가 예시로 넣은 값이고 우리 DB와 아무 관계가 없다. "주소를 이런 모양(`사용자:비밀번호@호스트:포트/DB이름`)으로 적으라"는 견본일 뿐이라, 그대로 두면 존재하지 않는 DB를 가리킨다.

그 주석과 자리표시자를 지우고, compose 파일에 맞춘 값 한 줄로 바꾼다.

```sh
# .env에 추가. "postgresql://사용자:비밀번호@호스트:포트/DB이름"
DATABASE_URL=postgresql://order:order@localhost:5433/order_api
```

`prisma7.config.ts`는 `import "dotenv/config"`로 `.env`를 읽도록 만들어져 있다.

하지만 `dotenv`는 설치하지 않았다. 앞선 구현에서는 `--env-file`로 `.env`를 읽었고, Prisma CLI는 `.env`를 스스로 읽지 않는다.

그래서 Node 내장 함수로 바꾼다.

```ts
// prisma7.config.ts
import { defineConfig } from "prisma/config";

// Prisma CLI는 .env를 자동으로 읽지 않는다. dotenv 대신 Node 내장 함수로 읽는다(Node 20.12+)
process.loadEnvFile();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations", // 마이그레이션 SQL이 쌓일 폴더
  },
  datasource: {
    url: process.env["DATABASE_URL"], // CLI가 마이그레이션을 적용할 DB 주소
  },
});
```

`npm install -D dotenv`를 하고 생성된 줄을 그대로 두는 것도 **동작한다**. 그게 더 짧기도 하다.

그런데도 내장 함수를 쓴 이유는 두 가지다.

- `.env`를 읽는 방식이 앱과 CLI에서 갈라지지 않게 한다. 앱은 이미 `node --env-file=.env`(Node 기능)로 읽고 있다. 여기서 `dotenv`를 쓰면 같은 파일을 두 가지 다른 방법으로 읽게 되고, 한쪽에만 있는 동작(`dotenv`의 변수 치환, 따옴표 처리 같은 것)에 의존하기 시작하면 "앱에서는 되는데 CLI에서는 안 된다"가 생긴다.

- 런타임이 이미 하는 일에 의존성을 더하지 않는다. `process.loadEnvFile()`은 Node 20.12+에 들어 있는 기본 기능이라, `dotenv`는 설치·버전 관리할 패키지가 하나 늘어나는 것 이상을 해 주지 않는다.

> Node가 20.12보다 낮거나, `.env.local`을 겹쳐 읽는 식의 기능이 필요하면 `dotenv`를 쓰는 게 맞다. 여기서는 필요하지 않다.

### 작업 3. 주문 테이블 선언하기

이제 주문 테이블을 선언한다.

지금까지 `interface Order`로 적어 온 모양을 Prisma 스키마 언어로 옮긴다.

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

// 주소는 prisma7.config.ts에서 넘긴다
datasource db {
  provider = "postgresql"
}

model Order {
  id        Int      @id @default(autoincrement())
  user      String
  // 금액은 정수(원 단위)로 저장한다. 소수점 금액을 float로 다루면 0.1 + 0.2 같은 오차가 생긴다
  price     Int
  paid      Boolean
  createdAt DateTime @default(now()) @map("created_at")

  @@map("orders")
}
```

### 작업 4. 첫 마이그레이션과 `generate`

```sh
# migrate dev: 스키마와 DB의 차이를 SQL 마이그레이션 파일로 만들고, 그 파일을 개발 DB에 적용한다. 
# --name은 파일 이름에 붙는 설명
npx prisma migrate dev --name init
# Your database is now in sync with your schema 가 출력되면 성공이다

# generate: 스키마를 읽어 src/generated/prisma에 TS 클라이언트 코드를 만든다
npx prisma generate
✔ Generated Prisma Client (7.10.0) to ./src/generated/prisma in 18ms
```

`migrate dev`가 만든 파일을 열어 본다. Prisma가 하는 일은 결국 SQL을 대신 써 주는 것이다.

```sql
-- prisma/migrations/<날짜시각>_init/migration.sql
-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "user" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "paid" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
```

구조를 만드는 문장(`CREATE TABLE`) 하나다. 괄호 안은 한 줄이 컬럼 하나이고, **컬럼 이름 → 타입 → 제약** 순서로 적혀 있다.

`autoincrement()`는 `SERIAL`이 됐다.

`SERIAL`은 DB 안의 시퀀스(번호표 발급기)에서 다음 번호를 받아 채우는 정수 컬럼이다.

스키마에 `?`를 안 붙인 필드는 전부 `NOT NULL`이 됐다. 즉 이 컬럼들은 비워 둔 채로 행을 넣을 수 없다.

마지막 줄의 `CONSTRAINT "orders_pkey" PRIMARY KEY ("id")`가 기본키 제약이고, `orders_pkey`는 그 제약에 붙은 이름이다.

제약에 이름이 붙는 덕분에, 나중에 위반 에러가 났을 때 **어느 제약에 걸렸는지**가 에러 메시지에 그대로 나온다.

1단계의 `psql`로 다시 들어가 `\d orders`를 쳐 보면 이 테이블이 실제로 생긴 걸 확인할 수 있다.

```sh
docker compose exec db psql -U order -d order_api
psql (17.11 (Debian 17.11-1.pgdg13+2))
Type "help" for help.

order_api=# \d orders
                                          Table "public.orders"
   Column   |              Type              | Collation | Nullable |              Default               
------------+--------------------------------+-----------+----------+------------------------------------
 id         | integer                        |           | not null | nextval('orders_id_seq'::regclass)
 user       | text                           |           | not null | 
 price      | integer                        |           | not null | 
 paid       | boolean                        |           | not null | 
 created_at | timestamp(3) without time zone |           | not null | CURRENT_TIMESTAMP
Indexes:
    "orders_pkey" PRIMARY KEY, btree (id)
```

> `generate`를 따로 실행하는 이유:  
> Prisma 7부터 `migrate dev`는 클라이언트 코드를 자동으로 다시 만들지 않는다.  
> **스키마를 바꿨으면 `migrate dev` 다음에 `generate`를** 습관처럼 붙인다.  
> 이걸 빼먹으면 DB에는 새 컬럼이 있는데 TS 코드에서는 안 보이는 상태가 된다.

### 개념 | 생성된 클라이언트 코드는 무엇인가

`--output`과 `generate`가 말하는 "클라이언트 코드"는 **이 스키마 전용으로 자동 생성된 TypeScript 소스**다. 직접 열어 볼 수 있는 보통의 `.ts` 파일들이다.

```sh
ls src/generated/prisma
# client.ts  models.ts  models/  enums.ts  commonInputTypes.ts  internal/  browser.ts
ls src/generated/prisma/models
# Order.ts        ← 스키마의 model Order 하나에 파일 하나가 생겼다
```

여기 들어 있는 것은 세 종류다.

- **`PrismaClient` 클래스**(`client.ts`): 모델 이름이 그대로 속성으로 붙어 `prisma.order.findMany(...)`처럼 쓸 수 있는 객체다. 3단계에서 `PrismaService`가 상속할 그 클래스다.

- **모델의 타입**(`models/Order.ts`): 스키마의 `model Order`에서 뽑은 `Order` 타입과, 그 모델에만 맞는 인자 타입들(`OrderWhereInput`, `OrderSelect`, `OrderCreateInput` 등)이다. 그래서 `where: { paidd: true }`처럼 잘못 쓰면 컴파일 타임에 잡히고, `select`에 무엇을 골랐는지에 따라 반환 타입이 달라진다.

- **런타임을 이어 주는 코드**(`internal/`): 실제로 SQL을 만들고 드라이버로 보내는 일은 `node_modules`의 `@prisma/client`가 한다. 생성된 코드는 그 위에 얹는 **스키마에 맞춘 껍데기**다.

C로 치면 `.proto`나 IDL 파일에서 `protoc`가 스텁 코드를 뽑아 주는 것과 같다. 손으로 쓰지 않고, 선언(`schema.prisma`)을 고친 뒤 생성기를 다시 돌린다.

그래서 이 폴더는 빌드 산출물과 같은 취급이라 `.gitignore`에 들어가 있다. 다른 PC에서 받으면 `npx prisma generate`로 다시 만든다.

반대로 `prisma/migrations/`는 반드시 커밋한다. 이 SQL 파일들이 DB 구조의 이력 그 자체다.

### 개념 | 마이그레이션 폴더 이름과, 잘못 만든 마이그레이션

폴더 이름 `20251011084352_init`은 `연월일시분초(UTC)_이름`이다. Prisma는 이 이름을 두 가지로 쓴다.

- **적용 순서**: 폴더 이름을 사전순으로 정렬한 순서가 곧 적용 순서다. 앞의 숫자가 거기에 쓰인다.

- **식별자**: 적용할 때 DB의 `_prisma_migrations` 테이블에 이 이름을 그대로 기록해 둔다(0장 개념 4).

그래서 이름을 바꿔도 되는지는 **이미 적용했는지**로 갈린다.

- **아직 적용 전**(`--create-only`로 파일만 만든 상태)이면 폴더 이름을 바꿔도 된다. 과거 날짜로 시작하고 싶다면 `--create-only`로 만들고, 적용하기 전에 폴더 이름을 바꾸고, 그다음 `npx prisma migrate dev`로 적용한다. 단 **다른 마이그레이션과의 사전순 순서가 의도한 적용 순서와 같아야 한다.** 나중에 적용해야 할 것에 앞 번호를 주면, 빈 DB에서 처음부터 적용할 때 순서가 뒤집혀 실패한다.

- **이미 적용한 뒤**에는 바꾸지 않는다. DB에는 옛 이름이 기록돼 있으므로, 이름을 바꾸면 Prisma는 "기록에는 있는데 폴더에 없는 마이그레이션"과 "폴더에는 있는데 적용 안 된 마이그레이션"을 동시에 보고 어긋남으로 판단한다. 그러면 `migrate dev`가 DB를 리셋(데이터 전부 삭제)해야 한다고 요구한다. 적용된 파일의 **내용**을 고치지 않는 것도 같은 이유다(8단계 참고).

날짜 자체는 기록용일 뿐이다. DB가 그 시각에 맞춰 무엇을 하지는 않으므로, 과거 날짜로 바꿔도 동작은 달라지지 않는다.

**처음부터 1년 전 날짜로 만들고 싶다면**, 그런 옵션은 없다. 숫자는 Prisma가 파일을 만드는 순간의 시계(UTC)에서 가져온다. 방법은 "만들고, 적용 전에 이름을 바꾸고, 그다음 적용"뿐이다.

```sh
# 1. 파일만 만든다(적용하지 않는다)
npx prisma migrate dev --create-only --name init
# 2. 폴더 이름의 숫자만 원하는 값으로 바꾼다. 뒤의 _init은 그대로 둔다
mv prisma/migrations/20251011084352_init prisma/migrations/20251011084352_init
# 3. 이제 적용한다. Prisma는 이 이름으로 DB에 기록한다
npx prisma migrate dev
```

**날짜를 아예 없앨 수도 있다.** 숫자를 붙이지 않게 하는 CLI 옵션은 없지만, Prisma가 요구하는 것은 "사전순으로 정렬했을 때 적용 순서가 되는 폴더 이름"뿐이고 날짜 형식이어야 한다는 규칙은 없다. 적용 전에 이름을 바꾸면 `0001_init`처럼 둘 수 있다(Prisma 자신도 이미 존재하는 DB에 이력을 맞출 때 `0_init` 같은 이름을 쓴다).

- 번호를 직접 매길 거라면 **자리수를 채운다.** 사전순이므로 `10_x`는 `2_x`보다 앞으로 간다. `0001_`, `0002_`처럼 적어야 순서가 유지된다.

- 날짜 폴더와 섞으면 숫자 폴더가 늘 앞에 온다(`'0' < '2'`). 한 프로젝트 안에서는 한 가지 방식으로만 쓴다.

- 날짜가 붙어 있는 편이 "언제 생긴 변경인가"를 알려 주기 때문에 기본값이 그렇게 돼 있다. 바꿀 이유가 분명하지 않으면 그대로 두는 쪽이 낫다.

`0001_` 형식을 쓰려면 **마이그레이션을 만들 때마다** "파일만 만들기 → 이름 바꾸기 → 적용하기" 세 단계를 거친다. 적용과 동시에 이름이 DB에 기록되므로, 이름 바꾸기는 항상 적용 전에 끝나야 한다.

```sh
# 1) 파일만 만든다(--create-only). 날짜 이름으로 생긴다
npx prisma migrate dev --create-only --name init
# prisma/migrations/20251011084352_init/

# 2) 적용 전에 폴더 이름을 바꾼다. 뒤쪽 설명(_init)은 남겨 두면 나중에 읽기 좋다
mv prisma/migrations/20251011084352_init prisma/migrations/0001_init

# 3) 인자 없이 실행하면 아직 적용 안 된 마이그레이션(= 방금 이름 바꾼 것)을 적용한다
npx prisma migrate dev
npx prisma generate
```

다음 변경(4단계의 `add-users`)도 똑같다. 번호만 하나 올린다.

```sh
npx prisma migrate dev --create-only --name add-users
mv prisma/migrations/2025*_add_users prisma/migrations/0002_add_users
npx prisma migrate dev
```

```sh
# 결과
ls prisma/migrations
# 0001_init  0002_add_users  migration_lock.toml
```

- 대가는 `migrate dev --name x` 한 번으로 끝나던 것이 세 단계가 된다는 점이다. 이름을 바꾸기 전에 실수로 `migrate dev`를 쳐서 적용해 버리면, 그 폴더는 더 이상 이름을 바꿀 수 없다(위 "이름 대조").

- 이미 날짜 이름으로 적용해 둔 것들을 이 방식으로 바꾸고 싶다면, 아래 "오타로 마이그레이션을 두 번 만든 경우"와 같은 정리 절차(폴더 삭제 → `migrate reset` → 다시 만들기)를 거쳐야 한다. 개발 DB에서만 할 일이다.

**이미 적용한 뒤에 모든 폴더에서 1년씩 빼면 어떻게 되는가.** 순서는 유지되니 괜찮을 것 같지만, 깨지는 것은 순서가 아니라 **이름 대조**다.

Prisma는 "폴더 이름"과 "DB의 `_prisma_migrations.migration_name`"을 **문자열로 하나하나 맞춰 본다.** 이름을 전부 바꾸면 양쪽이 한 건도 일치하지 않는다.

- DB에만 있는 이름들 → "적용했는데 폴더에 없는 마이그레이션"

- 폴더에만 있는 이름들 → "아직 적용 안 된 마이그레이션"

`migrate status`는 이 둘을 모두 경고하고, `migrate dev`는 "DB를 리셋해야 한다"로 간다. 즉 **빈 DB에 처음부터 적용하는 데에는 순서만 맞으면 문제가 없지만, 이미 적용을 마친 DB와는 어긋난다.**

```text
order_api=# SELECT migration_name, checksum FROM _prisma_migrations;
-- migration_name: 폴더 이름이 그대로 들어 있다(이름을 바꾸면 안 맞는다)
-- checksum: migration.sql '내용'의 해시(파일 내용을 고치면 안 맞는다)
```

그래서 선택은 둘 중 하나다.

- 개발 DB뿐이고 데이터가 아깝지 않다 → 이름을 바꾸고 `npx prisma migrate reset`으로 기록을 처음부터 다시 쌓는다. 이게 정상 경로다.

- 지켜야 할 DB가 이미 있다 → **이름을 바꾸지 않는다.** 날짜를 예쁘게 맞추는 것과, 운영 DB의 적용 이력을 손으로 `UPDATE`하는 위험을 맞바꿀 이유가 없다.

**오타로 마이그레이션을 두 번 만든 경우.** 예를 들어 `@@map("orders")`를 `moders`로 잘못 적어 `migrate dev`를 한 뒤, 이름을 고쳐 다시 `migrate dev`를 하면 폴더가 두 개가 된다. 둘째 파일은 이렇게 생긴다.

```sql
-- DropTable
DROP TABLE "moders";

-- CreateTable
CREATE TABLE "orders" ( ... );
```

이 상태도 **틀린 것은 아니다.** 빈 DB에 순서대로 적용하면 결과는 똑같은 구조가 된다. 오타가 이력에 남는 것뿐이다.

하지만 **첫 폴더만 지우는 것은 안 된다.** 두 군데가 깨진다.

1. DB의 `_prisma_migrations`에는 지운 이름이 그대로 남아 있어서 Prisma가 어긋남을 감지한다.

2. 둘째 파일의 `DROP TABLE "moders"`는 첫 파일이 만들어 둔 테이블을 전제로 한다. 첫 파일을 지우면, 빈 DB에 처음부터 적용할 때 없는 테이블을 지우려다 실패한다.

개발 중이고 아직 지켜야 할 데이터가 없다면(지금이 그렇다) 이력을 깨끗하게 되감는 쪽이 낫다. **둘 다** 지우고 다시 한 번 만든다.

```sh
# migration_lock.toml은 남겨 둔다(어느 DB용 마이그레이션인지 기록하는 파일이다)
rm -rf prisma/migrations/20251011084352_init prisma/migrations/20251011085006_init
# 개발 DB를 비우고 _prisma_migrations 기록까지 초기화한다(데이터 전부 삭제)
npx prisma migrate reset
npx prisma migrate dev --name init
npx prisma generate
```

> 이미 다른 사람의 PC나 서버에 적용된 마이그레이션은 지우지 않는다. 그쪽 DB는 그 파일로 이미 적용을 마쳤기 때문에, 고칠 것이 있으면 새 마이그레이션을 하나 더 쌓는다.

### 용어 | Prisma 스키마 문법 (기본)

- `generator client`: 이 스키마로부터 무엇을 생성할지 정한다. `prisma-client`는 TS 클라이언트 코드다.

- `datasource db`: 어떤 DB를 쓰는지 정한다.

- `@id`: 기본키(행마다 유일한 식별자)다.

- `@default(autoincrement())`: 값을 안 주면 DB가 1, 2, 3... 순서로 채운다.

- `@map("created_at")`: 코드에서는 `createdAt`, 실제 DB 컬럼 이름은 `created_at`(SQL 관례인 snake_case)이다.

- `@@map("orders")`: 모델 이름은 `Order`(단수), 실제 테이블 이름은 `orders`(복수)다.

### 남길 것

- **찾아보면 되는 것**: `prisma init`의 플래그, `prisma7.config.ts`의 키 이름, 폴더 이름 규칙.

- **감각으로 남겨야 할 것**: 스키마를 고쳤으면 `migrate dev` **다음에 `generate`** 까지가 한 묶음이다. `prisma/migrations/`는 커밋하는 이력이고 `src/generated/`는 버리고 다시 만드는 산출물이다.

- **에러 신호**: "DB에는 컬럼이 있는데 코드에서는 안 보인다" → `generate`를 빼먹었다.

## 4. 3단계: 인메모리 배열을 PrismaService로 교체하기

### 작업 1. `PrismaService`와 `PrismaModule` 만들기

생성된 `PrismaClient`를 Nest의 Provider로 감싼다. NestJS의 DI가 그대로 적용된다.

앱 전체에 인스턴스 하나(싱글턴)만 두고, 필요한 서비스가 생성자로 주입받는다.

```ts
// src/prisma/prisma.service.ts
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
// 2단계에서 generate로 만든 클라이언트. ESM 설정이라 .js 확장자로 import한다
import { PrismaClient } from "../generated/prisma/client.js";

@Injectable()
// PrismaService 자체가 PrismaClient가 된다 → this.prisma.order.findMany()처럼 바로 쓴다
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const url = process.env.DATABASE_URL;
    // 04의 JWT_SECRET과 같은 원칙: 필수 환경변수가 없으면 서버가 아예 뜨지 않게 한다
    if (!url) throw new Error("DATABASE_URL 환경변수가 없습니다");
    // 어댑터가 내부에 커넥션 풀을 만든다. 실제 접속은 첫 쿼리 때 일어난다
    super({ adapter: new PrismaPg({ connectionString: url }) });
  }

  async onModuleDestroy() {
    await this.$disconnect(); // 앱이 꺼질 때 열린 연결을 정리한다
  }
}
```

```ts
// src/prisma/prisma.module.ts
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

`app.module.ts`의 `imports` 맨 앞에 `PrismaModule`을 추가한다.

```ts
// src/app.module.ts
import { PrismaModule } from './prisma/prisma.module.js'; // 추가

@Module({
  // PrismaModule을 맨 앞에 추가한다
  imports: [PrismaModule, OrdersModule, AuthModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

`@Global()`이 붙어 있어도 **앱 어딘가에서 한 번은 `imports`해야** 전역으로 등록된다. 이 줄을 빼면 서버가 뜨다가 멈춘다.

```sh
# PrismaModule을 imports에 넣지 않았을 때
Nest can't resolve dependencies of the OrdersService (?, NotificationsGateway).
Please make sure that the argument PrismaService at index [0] is available in the OrdersModule module.
```

`@Global()`은 "`imports`에 적은 모듈의 exports를 어디서나 쓸 수 있게" 해 주는 것이고, "적지 않아도 등록해 주는" 것이 아니다.

NestJS에서는 `OrdersModule`이 `NotificationsModule`을 직접 `imports`했다.

DB는 거의 모든 기능 모듈이 필요로 하기 때문에 매번 적는 대신 `@Global()`로 한 번만 등록한다.

> 남발하면 의존 관계가 코드에서 안 보이게 되므로, 이렇게 "앱 전체의 기반"인 것에만 쓴다.

### 개념 | `extends`, `implements`, `super`

`PrismaService` 한 줄에 셋이 다 들어 있다.

```ts
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() { /* ... */ super({ adapter: ... }); }
}
```

- **`extends`(상속)**: JS의 기능이고 **런타임에 실제로 존재한다.** 부모의 메서드와 필드를 그대로 물려받는다. `PrismaService`에 `order`나 `$disconnect` 같은 걸 한 줄도 안 썼는데 `this.prisma.order.findMany()`가 되는 이유가 이것이다. 부모는 **하나만** 지정할 수 있다.

- **`implements`(구현 약속)**: TypeScript만의 것이고 **컴파일 타임에만 존재한다.** "이 클래스는 `OnModuleDestroy`가 요구하는 모양(`onModuleDestroy()` 메서드)을 갖추겠다"는 선언이며, 지키지 않으면 컴파일 에러가 난다. 지워도 **동작은 같다.** Nest가 `onModuleDestroy()`를 부르는 건 메서드가 거기 있기 때문이지 `implements` 때문이 아니다. 즉 오타·누락을 컴파일 타임에 잡으려고 적는 것이다. 여러 개를 쉼표로 나열할 수 있다.

- **`super`**: 두 가지로 쓰인다.
  - 생성자 안의 `super(인자)`: **부모 생성자 호출**이다. 상속한 클래스는 `this`를 쓰기 전에 반드시 한 번 불러야 한다. 여기서 `super({ adapter: ... })`가 `PrismaClient`를 그 옵션으로 초기화하는 자리다.
  - 메서드 안의 `super.메서드(...)`: **부모의 같은 이름 메서드 호출**이다. 6단계의 `super.catch(err, host)`가 "내가 처리하지 않을 것은 부모(기본 예외 처리기)에게 그대로 넘긴다"로 읽히는 이유다.

C로 치면 `extends`는 구조체 앞부분에 부모 구조체를 그대로 끼워 넣어 필드와 함수 포인터를 물려받는 것이고, `super(...)`는 부모의 초기화 함수를 먼저 불러 주는 것이다. `implements`는 컴파일러만 보는 약속이라 실행 파일에는 아무 흔적도 남지 않는다(`interface`가 사라지는 것과 같다).

| 키워드 | 언제 존재하는가 | 개수 | 안 지키면 |
| --- | --- | --- | --- |
| `extends` | 런타임(실제 상속) | 1개 | 물려받은 메서드가 없다 |
| `implements` | 컴파일 타임만 | 여러 개 | 컴파일 에러(동작은 그대로) |
| `super(...)` | 런타임 | 생성자에서 1번 필수 | `this` 사용 전 호출 안 하면 에러 |

### 개념 | 데코레이터로 "이 클래스가 무엇인지" 읽기

Nest 코드를 읽을 때 데코레이터는 **등록표**로 읽으면 된다. 데코레이터 자체는 아무것도 실행하지 않고, "이 클래스를 이런 용도로 써 달라"는 메타데이터를 남긴다. 앱이 뜰 때 Nest가 그 표를 모아 **누가 이 클래스를 만들고 누가 호출할지**를 정한다.

그래서 클래스 하나를 봤을 때 알고 싶은 세 가지(무엇인가 / 누가 호출하는가 / 무엇을 담아야 하는가)가 데코레이터 하나로 거의 정해진다.

| 데코레이터 | 붙는 자리 | 무엇이라고 선언하는가 | 누가 호출하는가 | 담는 로직 |
| --- | --- | --- | --- | --- |
| `@Module({...})` | 클래스 | 묶음(배선표). `controllers`·`providers`·`imports`·`exports`만 적는다 | 아무도 호출하지 않는다. Nest가 부팅 때 읽는다 | 로직 없음. 연결만 |
| `@Global()` | 모듈 클래스 | 이 모듈의 `exports`를 어디서나 주입받을 수 있게 한다 | 같음(부팅 때 읽힌다) | 로직 없음 |
| `@Injectable()` | 클래스 | **DI 컨테이너가 만들어도 되는 클래스**(Provider). 이름만 적어 두면 생성자로 꽂아 준다 | 이 클래스를 생성자에서 주입받은 다른 클래스 | 실제 규칙과 일. 이 프로젝트의 서비스가 전부 여기 |
| `@Controller("orders")` | 클래스 | HTTP 요청의 입구. 경로 앞부분(`/orders`)을 맡는다 | **HTTP 요청**(Nest가 라우팅해 준다) | 요청을 풀어 서비스에 넘기고 결과를 돌려주기. 얇게 |
| `@Get()`, `@Post()` | 컨트롤러의 메서드 | 그 메서드가 맡을 HTTP 메서드와 경로 | 같음 | 같음 |
| `@Body()`, `@Param()`, `@Query()` | 메서드의 매개변수 | 요청의 어느 부분을 이 인자로 받을지 | 같음 | 없음(값을 꽂아 주는 표시) |
| `@Catch(에러 클래스)` | 클래스 | 예외 필터. 그 에러가 던져졌을 때 응답으로 바꾸는 자리 | Nest의 요청 처리 파이프라인(에러가 거슬러 올라올 때) | 에러 → HTTP 응답 번역. 6단계 |
| `@IsString()`, `@IsNotEmpty()` | DTO의 필드 | 그 필드가 만족해야 할 규칙(Nest가 아니라 `class-validator`의 것) | `ValidationPipe`가 요청마다 읽어 검사한다 | 없음(규칙 선언) |
| `@WebSocketGateway()` | 클래스 | WebSocket 쪽 입구(`05`의 `NotificationsGateway`) | 소켓 연결·메시지 | 컨트롤러와 같은 위치의 "입구" |

읽을 때 쓰는 규칙 셋이다.

- **`new`가 안 보이는 게 정상이다.** 데코레이터가 붙은 클래스는 거의 다 Nest가 만든다. 그래서 `PrismaExceptionFilter`처럼 `new`로 직접 만들어 등록하는 자리가 나오면, 그건 "DI를 거치지 않았다"는 신호이고 필요한 걸 손으로 넘겨 줘야 한다(6단계의 `HttpAdapterHost`가 그 예다).

- **호출자는 셋 중 하나다.** 경로가 붙어 있으면 요청이, `@Injectable`만 있으면 그걸 주입받은 다른 클래스가, 필터·파이프·가드는 Nest의 요청 파이프라인이 호출한다.

- **헷갈리면 "내가 이 메서드를 직접 부르는 코드가 어디 있나"를 찾는다.** 없으면 Nest가 부르는 것(컨트롤러 핸들러, 필터, `onModuleDestroy` 같은 생명주기 메서드)이고, 있으면 서비스다. `OnModuleDestroy`는 데코레이터가 아니라 인터페이스지만 같은 부류다. 구현해 두면 앱이 꺼질 때 Nest가 불러 준다.

`@Injectable()`을 빼먹으면 생기는 일이 이 구분을 잘 보여 준다. Nest는 생성자 인자의 타입 정보를 이 데코레이터가 남긴 메타데이터로 읽기 때문에, 없으면 주입할 것을 못 찾고 `Nest can't resolve dependencies of the ...`로 **부팅 자체가 실패한다.** 요청이 들어올 때가 아니라 앱이 뜰 때 터지는 에러다.

> 스키마 파일의 `@id`, `@default`, `@map`, `@@index`는 이름만 닮은 다른 것이다. TypeScript 데코레이터가 아니라 Prisma 스키마 언어의 문법이고, Prisma CLI가 읽는다(`@`는 필드에, `@@`는 모델 전체에 붙는다).

### 용어 | NestJS API (DI와 생명주기)

- `OnModuleDestroy`: 앱이 종료될 때 Nest가 `onModuleDestroy()`를 호출해 주는 생명주기 인터페이스다.

- `@Global()`: 이 모듈이 exports한 Provider를, 다른 모듈이 `imports`에 적지 않아도 주입받을 수 있게 한다. 단 이 모듈 자체는 `AppModule`의 `imports`에 한 번 들어가야 한다.

### 용어 | Prisma Client API (접속)

- `PrismaPg`: Prisma가 `pg` 드라이버로 PostgreSQL에 접속하게 해 주는 어댑터다. Prisma 7부터 어댑터가 필수다.

- `$disconnect()`: 클라이언트가 열어 둔 연결을 닫는다.

### 개념 | `$`는 키워드가 아니라 이름의 일부다

JS에서 `$`는 식별자에 쓸 수 있는 보통의 글자다. 문법적인 뜻은 전혀 없고, `$disconnect`는 그냥 **`$disconnect`라는 이름의 메서드**다.

Prisma가 이 접두사를 쓰는 이유는 이름이 부딪히는 것을 막기 위해서다. 생성된 클라이언트는 **모델 이름을 그대로 속성으로** 달아 준다(`prisma.order`, `prisma.user`). 그러니 클라이언트 자체의 기능에 평범한 이름을 쓰면, 같은 이름의 모델이 있는 스키마에서 충돌한다.

그래서 **모델이 차지하는 이름 공간과 클라이언트 기능을 `$`로 갈라 둔 것**이다.

```ts
prisma.order.findMany();  // $ 없는 것 = 스키마의 모델(model Order)
prisma.$disconnect();     // $ 붙은 것 = 클라이언트 자체의 기능
prisma.$transaction(...);  // 트랜잭션(다음 문서)
prisma.$queryRaw`...`;     // SQL 직접 실행(다음 문서)
```

`groupBy`의 결과에 나오는 `_sum`, `_count`도 같은 발상이다. 컬럼 이름과 집계 결과가 섞이지 않게 `_`를 붙여 둔 것이다.

> 그래서 `$`가 붙은 이름을 보면 "DB의 테이블이 아니라 클라이언트에게 직접 시키는 일"로 읽으면 된다.

### 작업 2. e2e 테스트도 `.env`를 읽게 한다

Nest 템플릿의 `test/app.e2e-spec.ts`는 `AppModule` 전체를 띄우므로, 이제 `PrismaService`의 생성자가 `DATABASE_URL`을 찾는다.

그런데 `npm run start:dev`와 달리 Vitest는 `.env`를 읽지 않는다.

그대로 `npm run test:e2e`를 돌리면 `DATABASE_URL 환경변수가 없다`로 앱이 만들어지지도 못하고, 이어서 `afterEach`의 `app.close()`가 `undefined`를 만나 에러가 하나 더 난다.

테스트 파일보다 먼저 실행되는 설정 파일에서 `.env`를 읽는다.

```ts
// test/setup-env.ts
// Vitest는 .env를 자동으로 읽지 않는다. PrismaService가 DATABASE_URL을 읽기 전에 불러 둔다
process.loadEnvFile();
```

```ts
// vitest.config.e2e.ts
// test 안에 한 줄 추가
    include: ['**/*.e2e-spec.ts'],
    // 테스트 파일보다 먼저 실행할 파일
    setupFiles: ['./test/setup-env.ts'],
```

```ts
// test/app.e2e-spec.ts
// afterEach를 이렇게 바꾼다
  afterEach(async () => {
    // beforeEach에서 앱 생성이 실패해 app이 없으면 close를 건너뛴다(원래 에러만 보이게)
    await app?.close();
  });
```

`GET /`는 DB를 쓰지 않고, 실제 접속은 첫 쿼리 때 일어나므로 이 테스트는 DB가 꺼져 있어도 통과한다.

### 작업 3. OrdersService 바꾸기

이제 `OrdersService`의 배열을 걷어 낸다.

```ts
// src/orders/orders.service.ts
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { NotificationsGateway } from "../notifications/notifications.gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";

export interface Order { id: number; user: string; price: number; paid: boolean; }

// createdAt은 API 응답에 넣지 않는다(지금까지의 응답 모양 유지)
// as const: 값을 리터럴 타입 그대로 고정한다. Prisma가 이걸 보고 반환 타입을 정확히 계산한다
const orderSelect = { id: true, user: true, price: true, paid: true } as const;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  // orders 배열과 nextId 필드가 사라지고, PrismaService를 주입받는다
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
  ) {}

  // 반환 타입이 Order[] → Promise<Order[]>로 바뀐다. DB 호출은 전부 비동기다(0장 개념 1)
  list(paid?: boolean): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { paid }, select: orderSelect, orderBy: { id: "asc" } });
  }
  async findOne(id: number): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id }, select: orderSelect });
    if (!order) throw new NotFoundException(`order ${id} not found`);
    return order;
  }
  async create(input: Omit<Order, "id">, creatorId: string): Promise<Order> {
    // id는 넣지 않는다. DB의 시퀀스가 채운다(nextId++의 역할을 DB가 가져갔다)
    const order = await this.prisma.order.create({ data: input, select: orderSelect });
    this.logger.log(`주문 생성: #${order.id} (${order.user})`);
    this.notifications.notifyUser(creatorId, "order.created", order);
    return order;
  }
  async totals(): Promise<Record<string, number>> {
    // 결제된 주문을 user별로 묶어 price를 합산한다. reduce가 하던 일을 DB가 한다
    const rows = await this.prisma.order.groupBy({
      by: ["user"], where: { paid: true }, _sum: { price: true }, orderBy: { user: "asc" },
    });
    // [{ user: "kim", _sum: { price: 17000 } }, ...] → { kim: 17000, ... }
    return Object.fromEntries(rows.map((r) => [r.user, r._sum.price ?? 0]));
  }
}
```

컨트롤러는 고치지 않는다. 서비스 메서드가 `Promise`를 반환하면, Nest가 그걸 `await`한 결과를 응답 본문으로 보낸다.

`totals`에서 합계를 JS의 `reduce` 대신 DB의 `GROUP BY`로 옮긴 것도 눈여겨본다.

주문이 100만 건이면 100만 행을 앱으로 끌어와 더하는 것보다, DB 안에서 더해 몇 줄만 받아 오는 쪽이 훨씬 싸다.

### 용어 | Prisma Client API (조회·생성·집계)

- `findMany({ where, select, orderBy })`: 조건에 맞는 행 목록을 조회한다. `where`에 `undefined`를 넣으면 그 조건이 무시되며, 아래 "`where`의 `undefined`는 조건 없음이다"에서 다룬다.

- `select`: 돌려받을 컬럼만 고른다.

- `findUnique({ where })`: 기본키(또는 UNIQUE 컬럼)로 한 건 조회한다. 없으면 `null`이다.

- `create({ data, select })`: 한 행을 넣고, 넣은 행을 돌려준다.

- `groupBy({ by, where, _sum })`: SQL의 `GROUP BY`다. `by`로 묶고 `_sum`으로 합산한다. 아래 "`groupBy`와 `_sum`"에서 다룬다.

### 개념 | `where`의 `undefined`는 조건 없음이다

`GET /orders?paid=true`처럼 쿼리 문자열이 있으면 컨트롤러가 `paid`에 `true`/`false`를 넘기고, 없으면 `undefined`를 넘긴다.

`list`는 이 값을 그대로 `where: { paid }`에 넣는다.

Prisma는 `where` 안의 `undefined`를 "**이 조건은 주어지지 않았다**"로 읽고 SQL의 `WHERE`에서 아예 뺀다.

그래서 `if (paid !== undefined)` 같은 분기 없이 한 줄로 "필터가 있으면 걸러 내고, 없으면 전체"가 된다.

```ts
let paid: boolean | undefined;
await prisma.order.findMany({ where: { paid } }); // 시드 5건 중 5건: WHERE paid 조건이 없다
await prisma.order.findMany({ where: { paid: true } }); // 5건 중 4건: WHERE paid = true
```

`null`은 다르다. `null`은 SQL의 `IS NULL` 조건을 뜻하고, `paid`처럼 `?`가 없는(`NOT NULL`) 컬럼에는 넣을 수조차 없다.

| `where`에 넣은 값 | 만들어지는 조건 |
| --- | --- |
| `{ paid: true }` | `WHERE paid = true` |
| `{ paid: undefined }` | 조건 없음(전체) |
| `{ paid: null }` | `WHERE paid IS NULL`. 이 스키마에서는 타입 에러(TS2322) |

- 편리한 만큼 위험하다. 값이 실수로 `undefined`가 되면 조건이 조용히 사라진다. `deleteMany({ where: { id } })`에서 `id`가 `undefined`면 `deleteMany()`와 같아져 **테이블 전체가 지워진다**(시드 데이터로 실행하면 `{ count: 5 }`가 돌아온다).

- `id`의 타입이 `number | undefined`여도 이 호출은 타입 검사를 통과한다. 그래서 지우거나 고치는 쿼리의 조건 값은 넣기 전에 비어 있지 않은지 코드로 확인한다.

> JS에서 `{ paid: undefined }`는 "키는 있는데 값이 없는" 객체다. Prisma는 이것을 키가 아예 없는 `{}`와 똑같이 다룬다.

### 개념 | `groupBy`와 `_sum`

`totals`의 `groupBy`는 아래 SQL과 같은 일을 한다. `by`가 `GROUP BY`, `_sum`이 `SUM(...)`에 해당한다.

```sql
SELECT "user", SUM(price) FROM orders WHERE paid = true GROUP BY "user" ORDER BY "user";
```

결과는 묶음 하나당 객체 하나이고, 합계는 `_sum` 안에 컬럼 이름으로 들어 있다.

```ts
const rows = await this.prisma.order.groupBy({
  by: ["user"], where: { paid: true }, _sum: { price: true }, orderBy: { user: "asc" },
});
// [{ _sum: { price: 17000 }, user: "kim" }, { _sum: { price: 30000 }, user: "lee" }, { _sum: { price: 7000 }, user: "park" }]
```

`r._sum.price`의 타입은 `number | null`이다.

SQL의 `SUM`은 더할 행이 하나도 없으면 0이 아니라 `NULL`을 돌려주기 때문이다(조건에 맞는 행이 없을 때 `aggregate({ _sum: { price: true } })`의 결과는 `{ _sum: { price: null } }`이다).

- `groupBy`의 묶음은 행이 하나 이상 있어야 생기고 `price`는 `NOT NULL`이라, 이 코드에서 실제로 `null`이 나오지는 않는다. 그래도 타입이 `number | null`이므로 `?? 0`으로 `number`를 맞춘다.

- 결제된 주문이 없는 사용자는 묶음 자체가 없어서 결과에 아예 나오지 않는다. 0원으로 나오지 않는다.

> C로 치면 `SUM`은 "원소가 0개인 배열의 합"을 0이 아니라 "값 없음"으로 돌려주는 함수다. `?? 0`이 그 "값 없음"을 0으로 바꾸는 자리다.

### 작업 4. 시드(seed)

빈 DB에 처음 데이터를 채우는 스크립트다. 지금까지 배열 초기값으로 적어 둔 그 데이터다.

```ts
// prisma/seed.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

// Nest 밖에서 단독으로 도는 스크립트라 PrismaService 대신 PrismaClient를 직접 만든다
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

// 먼저 비우고 다시 채운다 → 몇 번을 실행해도 결과가 같다
await prisma.order.deleteMany();
await prisma.order.createMany({
  data: [
    { user: "kim", price: 12000, paid: true },
    { user: "lee", price: 8000, paid: false },
    { user: "kim", price: 5000, paid: true },
    { user: "lee", price: 30000, paid: true },
    { user: "park", price: 7000, paid: true },
  ],
});
console.log("seed 완료:", await prisma.order.count(), "건");
await prisma.$disconnect();
```

`prisma7.config.ts`의 `migrations`에 실행 명령을 등록한다.

```ts
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts", // npx prisma db seed가 이 명령을 실행한다
  },
```

```sh
npx prisma db seed
# seed 완료: 5 건
npm run start:dev
```

```sh
curl localhost:4000/orders/totals
{"kim":17000,"lee":30000,"park":7000}%

curl localhost:4000/orders
[{"id":1,"user":"kim","price":12000,"paid":true},{"id":2,"user":"lee","price":8000,"paid":false},{"id":3,"user":"kim","price":5000,"paid":true},{"id":4,"user":"lee","price":30000,"paid":true},{"id":5,"user":"park","price":7000,"paid":true}]%
```

id가 `101`이 아니라 `1`부터 시작하는 건, 이제 번호를 DB의 시퀀스가 매기기 때문이다.

로그인해서 주문을 하나 만든다(`05`에서 만든 엔드포인트다. 비밀번호는 `.env`의 `DEMO_PASSWORD`).

```sh
# 1) 토큰 받기
curl -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}'
# {"accessToken":"eyJ..."}

# 2) 받은 토큰을 Authorization 헤더에 넣어 주문 생성
curl -X POST localhost:4000/orders -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJ...' \
  -d '{"user":"choi","price":9000,"paid":true}'
# {"id":6,"user":"choi","price":9000,"paid":true}
```

> 토큰을 복사해 붙이는 게 번거로우면 변수에 담아 둔다.  
> `TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')`  
> 그다음부터는 `-H "Authorization: Bearer $TOKEN"`으로 쓴다.

서버를 Ctrl+C로 껐다가 다시 켜고 방금 만든 주문을 다시 조회한다.

```sh
# 서버 터미널에서 Ctrl+C로 끈다
npm run start:dev

# 다른 터미널에서. 토큰도 필요 없다(GET /orders/:id는 인증이 없다)
curl localhost:4000/orders/6
# {"id":6,"user":"choi","price":9000,"paid":true}
```

 **그대로 남아 있다.** 이 문서에서 얻으려던 첫 번째 결과다.

> 프로세스 메모리에 있던 배열이라면 여기서 `{"statusCode":404}`가 돌아왔을 것이다. 지금 이 값은 앱이 아니라 컨테이너의 볼륨(`pgdata`)에 들어 있다.

### 용어 | Prisma Client API (대량 삽입·삭제)

- `deleteMany()`: 조건에 맞는 행을 전부 지운다. 조건이 없으면 테이블의 모든 행을 지운다(조건 값이 `undefined`일 때도 마찬가지다. 위 "`where`의 `undefined`는 조건 없음이다" 참고).

- `createMany({ data })`: 여러 행을 한 번에 넣는다. 넣은 행이 아니라 `{ count: 5 }`처럼 넣은 개수만 돌려준다.

- `count()`: 행 수를 센다.

### 실험 | DB를 꺼 본다

서버는 켜 둔 채로 다른 터미널에서 DB 컨테이너만 멈춘다.

```sh
docker compose stop db
curl localhost:4000/orders/totals
# {"statusCode":500,"message":"Internal server error"}
```

서버 콘솔에는 `PrismaClientKnownRequestError`와 함께 `code: 'ECONNREFUSED'`가 찍힌다.

소켓 너머의 서버가 연결을 거부했다는, C의 `connect()`가 돌려주는 바로 그 에러 이름이다.

`docker compose start db`로 다시 켜고 같은 요청을 보내면, 앱을 재시작하지 않아도 정상 응답이 돌아온다.

커넥션 풀이 끊긴 연결을 버리고 새로 접속하기 때문이다.

### 남길 것

- **찾아보면 되는 것**: 어댑터(`PrismaPg`) 생성자 모양, `findMany`/`groupBy`의 인자 이름.

- **감각으로 남겨야 할 것**: DB 호출은 **전부 비동기이고 전부 실패할 수 있다**(소켓 왕복이다). `@Global()` 모듈도 `AppModule`의 `imports`에 **한 번은** 들어가야 한다. 합계·필터는 앱으로 끌어와 계산하지 말고 DB에서 끝낸다.

- **에러 신호**: `Nest can't resolve dependencies of the X (?, ...)` → `app.module.ts`의 `imports`. / `ECONNREFUSED` → DB가 꺼져 있다.

## 5. 4단계: 사용자 테이블과 1:N 관계, 데이터가 든 테이블의 마이그레이션

### 작업 1. 스키마에 `User` 모델을 넣고 마이그레이션을 시도하기

지금 `orders.user`는 그냥 문자열이다.

`"kimm"`처럼 오타가 들어가도, 존재하지 않는 사용자 이름이 들어가도 막을 방법이 없다.

사용자를 별도 테이블로 만들고, 주문이 그 행을 외래키로 가리키게 바꾼다.

사용자 한 명이 주문 여러 개를 가지므로 1:N 관계다.

```prisma
// prisma/schema.prisma
// User 모델을 추가하고 Order를 고친다
model User {
  // 로그인 id("kim")를 그대로 기본키로 쓴다
  id        String   @id
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  orders    Order[]

  @@map("users")
}

model Order {
  id        Int      @id @default(autoincrement())
  // 실제 DB 컬럼(외래키 값). 0장 개념 3의 포인터에 해당한다
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id])
  price     Int
  paid      Boolean
  createdAt DateTime @default(now()) @map("created_at")

  @@map("orders")
}
```

```sh
npx prisma migrate dev --name add-users
```

```sh
Error:
⚠️ We found changes that cannot be executed:
  • Step 0 Added the required column `user_id` to the `orders` table without a default value. There are 6 rows in this table, it is not possible to execute this step.
You can use prisma migrate dev --create-only to create the migration file, and manually modify it to address the underlying issue(s).
```

"이미 저장된 파일" 문제를 실제로 만났다.

`user_id`는 `NOT NULL`인데, **이미 있는 6개 행은 이 칸에 무슨 값을 넣어야 하는가?** Prisma는 알 수 없으니 멈춘다.

### 작업 2. `--create-only`로 만든 SQL을 손으로 고쳐 적용하기

시키는 대로 파일만 만들고 적용은 하지 않는 `--create-only`로 다시 실행한다.

```sh
npx prisma migrate dev --create-only --name add-users
```

```sh
⚠️  Warnings for the current datasource:
  • You are about to drop the column `user` on the `orders` table, which still contains 6 non-null values.
? Are you sure you want to create this migration? › (y/N)
```

경고가 하나 더 붙었다.

> **`--name`을 잘못 적었다면** (`--name orders`처럼) 그냥 고치면 된다. `--create-only`는 **적용하지 않았으므로** DB에는 아무 기록도 없다. `npx prisma migrate status`가 그 폴더를 `not yet been applied`로 보여 주는지 확인하고, 폴더 이름만 바꾼다(`mv prisma/migrations/<날짜시각>_orders prisma/migrations/<날짜시각>_add_users`). 안에 생성된 SQL은 `--name`과 무관하게 스키마 차이로만 결정되므로 **다시 만들 필요가 없다.** 지우고 다시 만들어도 된다(`rm -rf`한 뒤 올바른 이름으로 `--create-only` 재실행). 위험한 것은 *적용한 뒤에* 이름을 바꾸거나 지우는 경우뿐이다. 위 "마이그레이션 폴더 이름과, 잘못 만든 마이그레이션" 참고.

`y`로 파일을 만들고 열어 본다(아직 적용된 게 아니라 파일만 생긴 것이니 안전하다).

```sql
-- prisma/migrations/<날짜시각>_add_users/migration.sql (Prisma가 만든 그대로)
-- AlterTable
ALTER TABLE "orders" DROP COLUMN "user",
ADD COLUMN     "user_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "users" ( ... );

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Prisma 눈에는 `user` 컬럼이 사라지고 `user_id` 컬럼이 새로 생긴 것으로 보인다.

그래서 `user` 컬럼을 지우고(데이터 소실) 빈 `user_id`를 추가하는 SQL을 썼다.

하지만 우리는 이게 사실 이름 변경이라는 걸 안다.

`user`에 들어 있던 `"kim"`, `"lee"`가 바로 새 `users.id`가 될 값이다.

스키마 비교 도구는 의도를 모른다.

그래서 **데이터가 든 테이블의 마이그레이션은 사람이 SQL을 읽고 고쳐야 한다.** 파일을 이렇게 바꾼다.

**언제 손으로 고쳐야 하는가.** 기준은 "**이미 쌓인 데이터를 어떻게 옮길지 도구가 알 수 없는가**"다. 폴더 이름이나 `--name`과는 아무 관계가 없다.

| 상황 | Prisma가 쓰는 SQL | 손으로 고쳐야 하는가 |
| --- | --- | --- |
| 테이블·컬럼 추가(`?`거나 기본값 있음) | 그대로 맞다 | 아니다 |
| 인덱스 추가(7단계) | 그대로 맞다 | 아니다 |
| 컬럼 이름 변경 | `DROP` + `ADD`(데이터 소실) | **그렇다** → `RENAME COLUMN` |
| 비어 있지 않은 테이블에 `NOT NULL` 컬럼 추가 | `ADD COLUMN ... NOT NULL`(적용 자체가 실패) | **그렇다** → 값을 채우는 문장을 먼저 |
| 컬럼 쪼개기·합치기(`name` → `first`/`last`) | 새 컬럼만 만들고 옛 값은 안 옮긴다 | **그렇다** → `UPDATE ... SET`로 옮기기 |
| 타입 변경(`TEXT` → `INTEGER` 등) | `ALTER TYPE`만 쓴다. 변환 못 하는 값에서 실패 | **그렇다** → `USING` 절이나 단계 분리 |

- 테이블이 비어 있으면 어느 쪽이든 결과가 같다. 그래서 2단계와 7단계에서는 `migrate dev --name x` 한 번으로 끝났다.

- 행이 있으면 "구조를 바꾸는 일"과 "값을 옮기는 일"이 둘 다 필요한데, Prisma는 앞의 것만 안다. 뒤의 것(`INSERT ... SELECT`, `UPDATE`, `RENAME`)이 사람이 끼워 넣는 부분이다.

> 0장 개념 4의 비유로 돌아가면, 생성된 SQL은 "새 구조를 만드는 코드"이고 손으로 넣는 문장은 "옛 포맷의 파일을 새 포맷으로 읽어 옮기는 변환 코드"다.

> **고치기 전에 `npx prisma migrate dev`를 치지 않는다.** 생성된 그대로 적용하면 아래 "실패한 마이그레이션에서 빠져나오기"의 에러로 멈춘다.

```sql
-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- 직접 추가: 주문에 이미 들어 있는 사용자 이름으로 users 행을 먼저 만든다(외래키가 가리킬 대상)
INSERT INTO "users" ("id", "name")
SELECT DISTINCT "user", "user" FROM "orders";

-- Prisma가 만든 DROP COLUMN "user" + ADD COLUMN "user_id" 대신, 값을 보존하는 이름 변경으로 바꿨다
ALTER TABLE "orders" RENAME COLUMN "user" TO "user_id";

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

위 `--` 주석은 설명용이다. 넣든 안 넣든 동작은 같다. 다만 **적용한 뒤에는 주석 한 줄도 고칠 수 없으니**(아래 "실패한 마이그레이션에서 빠져나오기"의 checksum) 넣을지 말지는 적용 전에 정한다.

순서가 중요하다. 외래키는 가리킬 대상이 먼저 있어야 걸 수 있다.

그래서 `users`를 만들고 채운 다음에 외래키를 추가한다.

> 반대 순서면 "가리키는 대상이 없는 행이 있다"며 `ADD CONSTRAINT`가 실패한다.

```sh
# 인자 없이 다시 실행하면, 아직 적용 안 된 마이그레이션 파일(방금 고친 것)을 적용한다
npx prisma migrate dev
npx prisma generate
```

`psql`로 들어가 결과를 확인한다.

```text
order_api=# SELECT id, user_id, price, paid FROM orders ORDER BY id;
 id | user_id | price | paid
----+---------+-------+------
  1 | kim     | 12000 | t
  ...
  6 | choi    |  9000 | t
order_api=# \d orders
 ...
Foreign-key constraints:
    "orders_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
```

6개 행이 하나도 빠지지 않고 넘어왔다. `users`에도 `kim`, `lee`, `park`, `choi`가 생겼다.

`\d orders`의 `Indexes:` 항목을 보면 `orders_pkey` 하나뿐이고, `user_id`에는 인덱스가 없다.

### 개념 | 실패한 마이그레이션에서 빠져나오기

생성된 SQL을 고치지 않고 `migrate dev`를 치면 이렇게 멈춘다. 고친 뒤에도 SQL에 오타가 있으면 같은 모양으로 멈춘다.

```sh
Applying migration `0002_add_users`
Error: P3018

A migration failed to apply. New migrations cannot be applied before the error is recovered from.
Database error code: 23502
Database error:
ERROR: column "user_id" of relation "orders" contains null values
```

- `23502`는 PostgreSQL의 not-null 위반이다. 비어 있지 않은 테이블에 **기본값 없는 `NOT NULL` 컬럼**을 추가하면 기존 행의 그 칸이 `NULL`이 되므로 거부된다.

- `P3018`은 Prisma의 "마이그레이션 하나가 실패했고, 그걸 수습하기 전에는 다음 것을 적용할 수 없다"는 신호다.

실패 기록이 남아 있는 동안은 **다른 마이그레이션 명령도 받지 않는다.** 파일을 다시 만들려고 `--create-only`를 쳐도 이렇게 거부된다.

```sh
The migration `0002_add_users` failed.
We need to reset the "public" schema at "localhost:5433"
You may use prisma migrate reset to drop the development database.
All data will be lost.
```

리셋하라고 권하지만, 아래 순서를 따르면 **데이터를 지우지 않고** 빠져나올 수 있다. 파일은 이미 디스크에 있으니 다시 만들 필요도 없다.

먼저 **무엇이 실제로 적용됐는지** 본다. PostgreSQL은 DDL도 트랜잭션에 묶이므로 보통 하나도 적용되지 않은 채 전부 롤백된다.

```sh
docker compose exec db psql -U order -d order_api -c "\d orders" -c "\dt"
# orders에 user 컬럼이 그대로 있고 users 테이블이 없으면, DB는 실패 전과 똑같은 상태다
```

남은 것은 `_prisma_migrations`의 "실패했다"는 기록뿐이고, 그 기록이 다음 적용을 막는다.

```sh
docker compose exec db psql -U order -d order_api \
  -c "SELECT migration_name, finished_at, applied_steps_count FROM _prisma_migrations;"
# finished_at이 비어 있고 applied_steps_count가 0인 행이 실패한 마이그레이션이다
```

그 기록을 "롤백됨"으로 표시하고, SQL을 고쳐 다시 적용한다. **데이터는 그대로 둔 채 복구된다.**

```sh
# 폴더 이름을 그대로 적는다
npx prisma migrate resolve --rolled-back 0002_add_users
# migration.sql을 고친 뒤
npx prisma migrate dev
npx prisma generate
```

- `migrate reset`으로도 빠져나올 수 있지만 **개발 DB의 데이터가 전부 사라진다.** 이 단계는 "데이터가 든 테이블을 옮기는 것"이 주제라 6건을 잃으면 실습의 의미가 줄어든다. 되도록 `resolve --rolled-back`을 쓴다.

- 반대로 **일부가 적용된 뒤 실패했다면**(DDL이 트랜잭션에 묶이지 않는 DB이거나, 마이그레이션을 여러 파일로 쪼갠 경우) `resolve --rolled-back`을 쓰기 전에 적용된 부분을 손으로 되돌려야 한다. 그래서 위에서 먼저 `\d`로 상태를 확인한다.

- 이미 적용이 **끝난** 마이그레이션은 이 경우가 아니다. 그때는 새 마이그레이션을 하나 더 만들어 고친다.

**적용한 뒤에 그 파일을 고치면** 다음 마이그레이션 명령이 이렇게 막힌다. 주석 한 줄을 지우거나 공백을 바꾼 것도 똑같이 걸린다.

```sh
The migration `0002_add_users` was modified after it was applied.
We need to reset the "public" schema at "localhost:5433"
```

Prisma는 적용할 때 `migration.sql`의 **내용 해시(checksum)** 를 `_prisma_migrations`에 함께 저장해 두고, 매번 파일과 비교한다. 이름이 아니라 내용이 달라져도 "같은 마이그레이션이 아니다"로 본다.

```sh
# DB에 저장된 해시
docker compose exec db psql -U order -d order_api -At \
  -c "SELECT migration_name, checksum FROM _prisma_migrations;"
# 지금 파일의 해시
shasum -a 256 prisma/migrations/0002_add_users/migration.sql
```

- 고친 내용을 **되돌리면** 해시가 다시 맞아 그대로 진행된다. SQL의 뜻이 같은지는 보지 않으므로, 글자까지 똑같이 되돌려야 한다.

- 되돌릴 수 없으면 개발 DB에서는 `migrate reset`(데이터 소실)이고, 운영 DB라면 손댈 수 없다. **그래서 적용된 파일은 고치지 않는다**(8단계의 같은 주의).

### 용어 | Prisma 스키마 문법 (관계)

- 관계 필드(`orders Order[]`, `user User`): DB 컬럼이 아니다. "이 사용자를 가리키는 주문들", "이 주문의 사용자"를 코드에서 따라가기 위한 가상의 필드다. 아래 "관계 필드와 외래키 컬럼"에서 다룬다.

- `@relation(fields: [userId], references: [id])`: `userId` 컬럼이 `User`의 `id`를 가리킨다고 선언한다.

### 개념 | 관계 필드와 외래키 컬럼

`Order` 모델에는 사용자에 관한 필드가 둘 있다. 이름이 비슷해서 헷갈리지만 하는 일이 전혀 다르다.

- `userId String`: **실제 DB 컬럼**(`user_id`)이다. 행에 저장되는 값은 이것뿐이다. 0장 개념 3의 C 코드로 치면 `struct Order` 안의 포인터 값에 해당한다.

- `user User`: DB에 없는 필드다. "`userId`를 따라가면 나오는 `User` 행"을 뜻하고, 코드에서 그 관계를 쓸 때만 Prisma가 쿼리를 더 보내 채운다. C로 치면 저장된 포인터 값이 아니라 `o->user->name`처럼 포인터를 따라가 읽는 동작이다.

`User`의 `orders Order[]`도 같은 종류의 가상 필드다. 반대 방향("이 사용자를 가리키는 주문들")으로 따라가는 길이며, `users` 테이블에는 이 컬럼이 없다. Prisma는 관계의 양쪽에 이 필드를 모두 선언하라고 요구한다(한쪽을 빼면 `missing an opposite relation field` 검증 에러가 난다).

```ts
// 실제 컬럼만 고르면 문자열이 온다
await prisma.order.findMany({ select: { id: true, userId: true } });
// [{ id: 1, userId: "kim" }, ...]

// 관계 필드를 고르면 가리키는 행 전체(객체)가 온다
await prisma.order.findMany({ select: { id: true, user: true } });
// [{ id: 1, user: { id: "kim", name: ..., createdAt: ... } }, ...]
```

| 필드 | DB 컬럼인가 | `select`로 받는 값 |
| --- | --- | --- |
| `userId` | 예(`user_id`) | `string` |
| `user` | 아니오 | `{ id, name, createdAt }` 객체 |
| `orders`(`User` 쪽) | 아니오 | 주문 객체의 배열 |

- 마이그레이션 SQL에 `user_id` 컬럼과 외래키만 생기고 `user`·`orders` 컬럼이 없는 이유가 이것이다.
- 4단계 전에는 `user`가 문자열 컬럼이었는데 이제 같은 이름이 관계 필드가 됐다. 아래 "코드 고치기"에서 이 차이가 타입 에러로 드러난다.

> 관계 필드를 따라가는 방법(`select`에 넣기)과 그 비용은 5단계에서 다룬다.

### 용어 | SQL (마이그레이션에 쓴 것)

- `INSERT INTO 테이블 (...) SELECT ...`: `SELECT` 결과를 그대로 새 행으로 넣는다. `DISTINCT`는 같은 값을 하나로 줄인다.

- `ALTER TABLE ... RENAME COLUMN a TO b`: 컬럼 이름만 바꾸고 값은 그대로 둔다.

- `ADD CONSTRAINT ... FOREIGN KEY (...) REFERENCES users(id)`: 외래키 제약을 건다. `ON DELETE RESTRICT`는 참조당하는 행의 삭제를 거부하고(0장 개념 3), `ON UPDATE CASCADE`는 참조당하는 id가 바뀌면 따라서 바꾼다.

### 작업 3. 코드 고치기

모델 필드가 `user`에서 `userId`로 바뀌었으니 서비스를 맞춘다. 단, **API 응답은 여전히 `user`로 내보낸다.**

DB 컬럼 이름과 API 필드 이름이 같아야 할 이유는 없다.

Next.js의 화면은 지금도 `{ user, price, paid }`를 보내고 있다.

DB 구조를 바꿀 때마다 API를 쓰는 쪽까지 같이 깨뜨리지 않으려면 둘 사이에 변환 함수를 하나 둔다.

```ts
// src/orders/orders.service.ts
// API 응답 모양.
// DB 컬럼(user_id)과 이름이 달라도 된다
export interface Order { id: number; user: string; price: number; paid: boolean; }

const orderSelect = { id: true, userId: true, price: true, paid: true } as const;
// DB에서 읽은 행 → API 응답 모양으로 바꾼다
const toOrder = (row: { id: number; userId: string; price: number; paid: boolean }): Order => (
  { id: row.id, user: row.userId, price: row.price, paid: row.paid }
);

// ...
  async list(paid?: boolean): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({ where: { paid }, select: orderSelect, orderBy: { id: "asc" } });
    return rows.map(toOrder);
  }
  async findOne(id: number): Promise<Order> {
    const row = await this.prisma.order.findUnique({ where: { id }, select: orderSelect });
    if (!row) throw new NotFoundException(`order ${id} not found`);
    return toOrder(row);
  }
  async create(input: Omit<Order, "id">, creatorId: string): Promise<Order> {
    // 요청의 user → DB의 userId. 나머지(price, paid)는 그대로 넘긴다
    const { user, ...rest } = input;
    const order = toOrder(await this.prisma.order.create({ data: { ...rest, userId: user }, select: orderSelect }));
    this.logger.log(`주문 생성: #${order.id} (${order.user})`);
    this.notifications.notifyUser(creatorId, "order.created", order);
    return order;
  }
  async totals(): Promise<Record<string, number>> {
    const rows = await this.prisma.order.groupBy({
      by: ["userId"], where: { paid: true }, _sum: { price: true }, orderBy: { userId: "asc" },
    });
    return Object.fromEntries(rows.map((r) => [r.userId, r._sum.price ?? 0]));
  }
```

`generate`를 다시 했기 때문에, 고치기 전의 코드는 `start:dev` 콘솔에 타입 에러로 바로 드러난다.

미묘한 점이 하나 있다.

`select: { user: true }`는 이제 문자열 컬럼이 아니라 관계 필드(User 객체 전체)를 뜻하게 되어 그 줄 자체는 통과한다.

대신 그 결과를 `user: string`인 `Order`로 돌려주는 자리에서 "`{ id, createdAt, name }` 객체는 `string`이 아니다"라는 에러가 난다.

> 스키마에서 생성된 타입이 DB 구조와 코드 사이의 어긋남을 컴파일 타임에 잡아 주는 것, 이것이 Prisma 같은 ORM을 쓰는 가장 큰 이유 중 하나다.

시드도 사용자를 먼저 만들도록 바꾼다.

```ts
// prisma/seed.ts
// deleteMany부터 바꾼다
// 지우는 순서: 주문(참조하는 쪽) → 사용자(참조당하는 쪽). 반대로 하면 외래키 때문에 거부된다
await prisma.order.deleteMany();
await prisma.user.deleteMany();

await prisma.user.createMany({
  data: [
    { id: "kim", name: "김" },
    { id: "lee", name: "이" },
    { id: "park", name: "박" },
    { id: "choi", name: "최" },
  ],
});
await prisma.order.createMany({
  data: [
    { userId: "kim", price: 12000, paid: true },
    { userId: "lee", price: 8000, paid: false },
    { userId: "kim", price: 5000, paid: true },
    { userId: "lee", price: 30000, paid: true },
    { userId: "park", price: 7000, paid: true },
  ],
});
console.log("seed 완료: 사용자", await prisma.user.count(), "명, 주문", await prisma.order.count(), "건");
```

```sh
npx prisma db seed
# seed 완료: 사용자 4 명, 주문 5 건
```

시드를 다시 돌린 뒤 `GET /orders`를 보면 id가 1부터가 아니라 7부터 시작한다.

`deleteMany`는 행을 지울 뿐 시퀀스(번호표 발급기)를 되감지 않는다.

한 번 나간 번호는 다시 쓰지 않는다.

**번호는 중간이 비기도 한다.** 행을 지우지 않았는데도 그렇다. 시퀀스는 트랜잭션을 따르지 않기 때문이다.

- 실패한 `INSERT`(제약 위반 등)나 롤백된 트랜잭션도 **번호는 이미 받아 간 상태**다. 그 번호는 버려진다.

- 행을 지우면 그 번호는 빈칸으로 남는다. 다음 주문은 그보다 큰 번호를 받는다.

```text
order_api=# SELECT id FROM orders ORDER BY id;
 6, 7, 8, 9, 10, 12, 13   -- 11이 없다. 11번 행이 있었다가 지워졌거나, 11을 받은 INSERT가 실패했다
```

`curl localhost:4000/orders/11`이 404인 것은 고장이 아니라 "그 번호의 행이 없다"는 정상 응답이다.

시퀀스가 어디까지 나갔는지는 직접 볼 수 있다.

```sh
docker compose exec db psql -U order -d order_api -c "SELECT last_value FROM orders_id_seq;"
```

> 그래서 id로 "주문이 몇 건인가"를 세면 안 된다. 개수는 `count()`로 센다.

> id는 "몇 번째"가 아니라 "식별자"일 뿐이라는 걸 보여 주는 장면이다. 번호가 연속이라는 보장도, 빈칸이 없다는 보장도 없다.

### 실험 | dangling 포인터 만들기

`psql`에서 주문이 있는 사용자를 지워 본다.

```text
order_api=# DELETE FROM users WHERE id = 'kim';
ERROR:  update or delete on table "users" violates foreign key constraint "orders_user_id_fkey" on table "orders"
DETAIL:  Key (id)=(kim) is still referenced from table "orders".
```

0장 개념 3의 `free(kim)`을 DB가 거부했다. 앱 코드를 거치지 않고 `psql`로 직접 쳐도 막힌다.

이번엔 반대 방향이다. 로그인해서 없는 사용자의 주문을 만들어 본다.

```sh
curl -X POST localhost:4000/orders -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJ...' -d '{"user":"nobody","price":9000,"paid":true}'
# {"statusCode":500,"message":"Internal server error"}
```

이번에도 DB가 막았다.

(서버 콘솔에 `code: 'P2003'`, `Foreign key constraint violated on the constraint: orders_user_id_fkey`).

하지만 응답이 **500**이다. 서버가 고장 난 게 아니라 요청이 잘못된 것이니 4xx여야 한다.

### 남길 것

이 문서에서 가장 실무에 가까운 단계다. 세 가지만 남으면 된다.

- **찾아보면 되는 것**: `INSERT ... SELECT DISTINCT`, `RENAME COLUMN`, `ADD CONSTRAINT`의 정확한 문법.

- **감각으로 남겨야 할 것**:
  - **데이터가 든 테이블의 변경은 "구조 바꾸기"와 "값 옮기기"가 별개 작업이다.** 도구는 앞의 것만 안다.
  - 기본값 없는 `NOT NULL` 컬럼을 비어 있지 않은 테이블에 추가하면 **터진다**. 외래키는 가리킬 대상이 **먼저** 있어야 걸린다.
  - **적용된 마이그레이션 파일은 불변이다.** 이름도 내용도(주석 한 줄도) 고치지 않는다. 고칠 일이 생기면 새 파일을 쌓는다.

- **에러 신호**: `23502 contains null values` → 값을 채우는 문장이 빠졌다. / `P3018` → 실패 기록이 남아 막힌 것, `migrate resolve --rolled-back`. / `was modified after it was applied` → 적용된 파일을 건드렸다(checksum). / `P2003` → 가리키는 행이 없다.

## 6. 5단계: 관계 따라가기와 N+1 문제

### 작업 1. 가장 직관적인 방법으로 `GET /users` 만들기

사용자 목록을 각자의 주문과 함께 돌려주는 `GET /users`를 만든다.

먼저 가장 직관적인 방법으로 짠다. 사용자를 가져오고, 한 명씩 돌면서 주문을 가져온다.

```ts
// src/users/users.service.ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listWithOrders() {
    const users = await this.prisma.user.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
    const result = [];
    // 사용자 한 명마다 주문 조회를 한 번씩 더 보낸다
    for (const u of users) {
      const orders = await this.prisma.order.findMany({
        where: { userId: u.id }, select: { id: true, price: true, paid: true }, orderBy: { id: "asc" },
      });
      result.push({ ...u, orders });
    }
    return result;
  }
}
```

```ts
// src/users/users.controller.ts
import { Controller, Get } from "@nestjs/common";
import { UsersService } from "./users.service.js";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list() {
    return this.usersService.listWithOrders();
  }
}
```

```ts
// src/users/users.module.ts
// PrismaModule이 @Global이라 imports에 적지 않아도 PrismaService를 주입받는다
import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
```

`app.module.ts`의 `imports`에 `UsersModule`을 추가한다.

```ts
// src/app.module.ts
import { UsersModule } from './users/users.module.js'; // 추가

@Module({
  imports: [PrismaModule, OrdersModule, UsersModule, AuthModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

이 줄을 빼면 서버는 정상적으로 뜨지만 경로가 등록되지 않는다. `UsersController`를 Nest가 아예 모르기 때문이다.

```sh
curl localhost:4000/users
# {"message":"Cannot GET /users","error":"Not Found","statusCode":404}
```

> 3단계의 `PrismaModule` 누락은 **부팅 실패**(`can't resolve dependencies`)로 드러났고, 이번 누락은 **404**로 드러난다.  
> 전자는 "주입받을 게 없다", 후자는 "그런 경로가 없다"다. 둘 다 `app.module.ts`의 `imports`를 먼저 본다.

결과는 잘 나온다.

### 개념 | 컨트롤러·서비스·모듈이 한 기능의 기본 단위다

방금 파일 세 개를 한 폴더(`src/users/`)에 만들었다. `orders`도 같은 모양이다. **NestJS에서 기능 하나는 이 세 가지 묶음이고, 거기에 입력 검증용 DTO가 붙는다.**

| 파일 | 담당 | 아는 것 | 몰라도 되는 것 |
| --- | --- | --- | --- |
| `*.controller.ts` | HTTP 입구. 경로·메서드를 맡고, 요청에서 값을 꺼내 서비스에 넘기고 결과를 돌려준다 | HTTP(경로, 상태 코드, 헤더, 본문) | DB, SQL, 업무 규칙 |
| `*.service.ts` | 실제로 일하는 곳. 업무 규칙과 DB 접근 | 데이터와 규칙 | HTTP(`req`/`res`를 받지 않는다) |
| `*.module.ts` | 배선표. 이 묶음에 속한 컨트롤러·프로바이더와, 밖에 내보낼 것(`exports`)·가져올 것(`imports`) | 무엇이 어디에 속하는지 | 로직(한 줄도 없다) |
| `dto/*.dto.ts` | 들어오는 값의 모양. `ValidationPipe`가 요청마다 검사한다 | 입력 형식 | 그 밖의 모든 것 |

규칙 세 줄로 요약된다.

- **HTTP를 아는 코드는 컨트롤러에만** 둔다. 그래서 4단계에서 DB 컬럼 이름이 바뀌어도 컨트롤러는 한 줄도 고치지 않았다.

- **DB를 아는 코드는 서비스에만** 둔다. 그래서 서비스를 테스트할 때 HTTP 서버를 띄울 필요가 없다.

- **모듈에는 로직을 쓰지 않는다.** 모듈이 하는 일은 "누가 누구를 쓸 수 있는가"를 적는 것뿐이다.

**이것이 기본 구조가 맞다.** `nest g resource`로 기능을 만들면 Nest CLI가 이 세 파일(+ DTO)을 한 폴더에 만들어 준다. 다만 이 이름들은 **Nest의 어휘**다. 다른 틀에서는 이름이 다를 뿐 분리의 아이디어는 같다(Express라면 라우터가 컨트롤러 자리, 모듈 대신 `app.use(...)`로 손수 배선).

이 프로젝트에 실제로 있는 조각들도 같은 분류에 들어간다.

| 조각 | 자리 |
| --- | --- |
| `orders.controller.ts`, `users.controller.ts` | HTTP 입구 |
| `notifications.gateway.ts`(`05`) | WebSocket 입구. 컨트롤러와 같은 층이다 |
| `orders.service.ts`, `users.service.ts`, `prisma.service.ts` | 일하는 곳(Provider) |
| `prisma-exception.filter.ts`(6단계), `ValidationPipe`, `AuthGuard` | 모든 요청에 공통으로 끼어드는 층 |
| `*.module.ts`, `app.module.ts` | 배선 |

- 규모가 커지면 서비스에서 DB 접근만 떼어 리포지토리로 두기도 한다. 이 프로젝트에서는 Prisma Client가 그 자리를 맡고 있어서 따로 만들지 않는다.

> 폴더 이름과 파일 이름은 Nest가 강제하지 않는다. 다만 `src/users/users.service.ts`처럼 **폴더=기능, 파일=역할**로 맞춰 두면 `import` 경로만 보고도 무엇인지 알 수 있다.

### 작업 2. 쿼리 로그를 켜고 쿼리 개수를 세기

문제는 결과가 아니라 **그 결과를 얻기 위해 DB에 몇 번 갔는가**다.

그걸 보려면 Prisma가 실행하는 SQL을 찍어야 한다. `PrismaService`의 `super(...)`에 로그 옵션을 넣는다.

```ts
// src/prisma/prisma.service.ts
// super(...) 부분
    super({
      adapter: new PrismaPg({ connectionString: url }),
      // PRISMA_LOG=query로 켜면 실행되는 SQL이 콘솔에 찍힌다
      log: process.env.PRISMA_LOG === "query" ? ["query"] : [],
    });
```

```sh
# 환경변수를 이 명령에만 붙여서 켠다(DEBUG=router와 같은 방식)
PRISMA_LOG=query npm run start:dev
curl localhost:4000/users # 다른 터미널에서
```

그러면 **서버를 띄운 터미널**에 아래가 찍힌다(서버 로그).

`prisma:query`는 Prisma가 붙이는 접두사이고 그 뒤가 실제로 DB에 보낸 SQL이며, `$1`·`$2`는 값이 들어갈 자리(바인드 파라미터)다.

```sh
prisma:query SELECT "public"."users"."id", "public"."users"."name" FROM "public"."users" WHERE 1=1 ORDER BY "public"."users"."id" ASC OFFSET $1
prisma:query SELECT ... FROM "public"."orders" WHERE "public"."orders"."user_id" = $1 ORDER BY "public"."orders"."id" ASC OFFSET $2
prisma:query SELECT ... FROM "public"."orders" WHERE "public"."orders"."user_id" = $1 ORDER BY "public"."orders"."id" ASC OFFSET $2
prisma:query SELECT ... FROM "public"."orders" WHERE "public"."orders"."user_id" = $1 ORDER BY "public"."orders"."id" ASC OFFSET $2
prisma:query SELECT ... FROM "public"."orders" WHERE "public"."orders"."user_id" = $1 ORDER BY "public"."orders"."id" ASC OFFSET $2
```

사용자 4명에 쿼리 5개다. 사용자 목록 1번 + 사용자마다 1번 = 1 + N번.

이것을 **N+1 문제**라고 부른다.

사용자가 1만 명이면 쿼리는 10,001번이고, 하나하나가 0장 개념 1의 "소켓에 쓰고 응답을 기다리는" 왕복이다.

로컬에서는 빨라서 티가 안 나다가, DB가 다른 서버에 있는 운영 환경에서 갑자기 느려지는 대표적인 원인이다.

C로 치면 파일을 4바이트씩 `read()` 시스템 콜 10,000번으로 읽는 것과 같다. 한 번에 큰 버퍼로 읽어야 한다.

### 작업 3. 관계 필드로 쿼리를 2개로 줄이기

관계 필드(`orders`)를 `select` 안에 넣어서, 관계를 따라가는 일을 Prisma에게 맡긴다.

```ts
// src/users/users.service.ts
// listWithOrders를 이렇게 바꾼다
  // 사용자마다 주문 목록을 붙여서 돌려준다. 관계 필드를 select에 넣으면 Prisma가 쿼리 2개로 끝낸다
  listWithOrders() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, orders: { select: { id: true, price: true, paid: true }, orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    });
  }
```

같은 요청을 다시 보내고 서버 로그를 본다.

```sh
prisma:query SELECT "public"."users"."id", "public"."users"."name" FROM "public"."users" WHERE 1=1 ORDER BY "public"."users"."id" ASC OFFSET $1
prisma:query SELECT "public"."orders"."id", "public"."orders"."price", "public"."orders"."paid", "public"."orders"."user_id" FROM "public"."orders" WHERE "public"."orders"."user_id" IN ($1,$2,$3,$4) ORDER BY "public"."orders"."id" ASC OFFSET $5
```

쿼리가 2개로 줄었다.

사용자를 먼저 가져오고, 그 id들을 `IN (...)`으로 묶어 주문을 한 번에 가져온 뒤, 앱 쪽에서 `user_id`로 짝을 지어 붙인다.

사용자가 4명이든 1만 명이든 쿼리는 2개다(응답 JSON은 바꾸기 전과 똑같다).

> `select` 대신 `include: { orders: true }`를 써도 같은 방식으로 동작한다.  
> `include`는 "기본 컬럼 전부 + 관계"이고, `select`는 "고른 것만"이다.

### 남길 것

- **찾아보면 되는 것**: `select`와 `include`의 차이, 중첩 `select` 작성법.

- **감각으로 남겨야 할 것**: **응답이 맞는지 말고 쿼리가 몇 개인지를 본다.** 반복문 안의 `await` DB 호출은 그 자체로 N+1 신호다. 로컬에서는 티가 안 나고 운영에서 터진다.

- **에러 신호**: 에러가 아니라 **로그 모양**이다. 같은 모양의 `SELECT`가 결과 개수만큼 반복되면 N+1이다. 그래서 `PRISMA_LOG=query`를 쓸 줄 아는 것이 이 단계의 도구다.

## 7. 6단계: DB가 거부한 요청을 4xx로 바꾸기

### 작업 1. `POST /users`를 만들어 UNIQUE 위반도 겪어 보기

4단계 마지막의 500을 고친다. 그 전에 같은 종류의 경우를 하나 더 만든다.

사용자를 추가하는 `POST /users`다. `users.id`는 기본키라 중복이 불가능하다(기본키는 자동으로 `UNIQUE`다).

```ts
// src/users/dto/create-user.dto.ts
import { IsNotEmpty, IsString } from "class-validator";

export class CreateUserDto {
  @IsString() @IsNotEmpty() id!: string;
  @IsString() @IsNotEmpty() name!: string;
}
```

```ts
// src/users/users.service.ts
// import 한 줄 추가
import { CreateUserDto } from "./dto/create-user.dto.js";

// 클래스 안에 메서드 추가
  create(dto: CreateUserDto) {
    return this.prisma.user.create({ data: dto, select: { id: true, name: true } });
  }
```

```ts
// src/users/users.controller.ts
// 맨 위 import 두 줄을 이렇게 바꾼다(Body, Post, CreateUserDto가 새로 필요하다)
import { Body, Controller, Get, Post } from "@nestjs/common";
import { CreateUserDto } from "./dto/create-user.dto.js";

// 클래스 안에 핸들러 추가
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }
```

> `import`를 빼먹으면 `start:dev` 콘솔에 바로 드러난다.  
> `Post`·`Body`는 `Cannot find name 'Post'`(TS2304), `CreateUserDto`는 같은 에러에 더해 데코레이터가 붙지 않아 경로도 등록되지 않는다.

같은 사용자를 두 번 만들면 두 번째는 500이 나고, 서버 콘솔에는 `code: 'P2002'`(UNIQUE 위반)가 찍힌다.

4단계의 외래키 위반은 `P2003`이었다.

Prisma는 DB가 거부한 이유를 `PrismaClientKnownRequestError`라는 에러 클래스의 `code` 필드에 담아 던진다.

Nest는 이 에러를 모르기 때문에 500으로 처리한다.

### 작업 2. 예외 필터를 만들어 전역에 등록하기

**에러 클래스를 HTTP 응답으로 바꿔 주는 자리가 Nest의 ExceptionFilter다.**

```ts
// src/prisma/prisma-exception.filter.ts
import { ArgumentsHost, Catch, ConflictException, BadRequestException, NotFoundException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
// 생성된 클라이언트가 내보내는 네임스페이스. 에러 클래스가 여기 들어 있다
import { Prisma } from "../generated/prisma/client.js";

// DB가 거부한 요청(제약 위반)을 500이 아니라 의미에 맞는 4xx로 바꾼다
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    switch (err.code) {
      case "P2002": // UNIQUE 위반
        return super.catch(new ConflictException("이미 존재하는 값이다"), host);
      case "P2003": // FOREIGN KEY 위반
        return super.catch(new BadRequestException("참조하는 대상이 존재하지 않는다"), host);
      case "P2025": // 대상 행 없음(update/delete/findUniqueOrThrow)
        return super.catch(new NotFoundException("대상을 찾을 수 없다"), host);
      default:
        return super.catch(err, host); // 나머지는 기본 처리(500)
    }
  }
}
```

```ts
// src/main.ts
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { PrismaExceptionFilter } from './prisma/prisma-exception.filter.js';
// ...
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  // BaseExceptionFilter를 상속한 필터는 기본 응답을 만들 때 HTTP 어댑터가 필요하다
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
```

```sh
# POST /orders는 인증이 필요하다. 토큰이 없거나 비어 있으면 제약과 무관하게 401이 돌아온다.
# 로그인을 그 자리에서 실행해 헤더에 끼워 넣으면 변수 상태에 영향받지 않는다
curl -s -X POST localhost:4000/orders -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(curl -s -X POST localhost:4000/auth/login \
       -H 'Content-Type: application/json' -d '{"id":"kim","password":"1234"}' \
       | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')" \
  -d '{"user":"nobody","price":9000,"paid":true}'
# 외래키 위반(P2003) → {"message":"참조하는 대상이 존재하지 않는다","error":"Bad Request","statusCode":400}

# POST /users는 인증이 없다. 처음 보내면 201
curl -s -X POST localhost:4000/users -H 'Content-Type: application/json' \
  -d '{"id":"jung","name":"정"}'
# {"id":"jung","name":"정"}

# 같은 id를 다시 → UNIQUE 위반(P2002) → 409
curl -s -X POST localhost:4000/users -H 'Content-Type: application/json' \
  -d '{"id":"jung","name":"정"}'
# {"message":"이미 존재하는 값이다","error":"Conflict","statusCode":409}
```

- 첫 번째 `POST /users`가 바로 409라면 그 id가 이미 있는 것이다. 아직 없는 id(`jung2` 등)로 바꿔 보거나 `DELETE FROM users WHERE id='jung';`로 지우고 다시 한다.

- `{"message":"Unauthorized","statusCode":401}`이 돌아오면 제약 위반이 아니라 **토큰 문제**다. 외래키까지 가지도 못하고 가드에서 끝난 것이다. 확인 순서는 이렇다.

```sh
# 1) 로그인 자체가 되는지. accessToken이 보여야 한다
curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}'
# 비밀번호는 .env의 DEMO_PASSWORD 값이다. 틀리면 {"message":"id 또는 password가 틀렸습니다.","statusCode":401}

# 2) 변수에 담아 쓰는 방식이라면 그 변수가 비어 있지 않은지
echo "$TOKEN"
```

- 변수를 쓰는 방식에서 401이 나는 가장 흔한 이유는 **`TOKEN=...` 줄을 실행하지 않은 채 `curl`만 복사한 것**이고, 그다음이 **다른 터미널 탭에서 실행한 것**(셸 변수는 탭마다 별개다)이다. 로그인이 실패했을 때는 변수에 토큰 대신 에러 JSON이 들어가므로 역시 401이 된다. 토큰 유효기간은 1시간이다(`05`).

### 용어 | NestJS API (예외 필터)

- `@Catch(에러 클래스)`: 이 클래스의 에러가 던져졌을 때만 이 필터가 불린다.

- `BaseExceptionFilter`: Nest의 기본 예외 처리기다. 상속해서 "내가 처리할 것만 바꾸고 나머지는 기본대로"를 만든다. `super.catch(에러, host)`가 기본 응답을 만든다. 아래 "예외 필터는 던져진 에러를 응답으로 바꾸는 마지막 단계다"에서 다룬다.

- `app.useGlobalFilters(...)`: 필터를 앱 전체에 등록한다.

- `HttpAdapterHost`: Nest가 쓰는 HTTP 어댑터(Express 등)를 꺼내 오는 Provider다. 필터에 넘기는 이유는 아래에서 다룬다.

### 개념 | 예외 필터는 던져진 에러를 응답으로 바꾸는 마지막 단계다

컨트롤러나 서비스에서 에러가 던져지면, 그 에러는 호출을 거슬러 올라가 Nest까지 도착한다.

Nest는 응답을 보내기 전에 등록된 예외 필터 가운데 그 에러를 받을 필터를 고르고, 필터가 만든 것을 응답으로 보낸다.

필터가 없으면 Nest의 기본 처리기(`BaseExceptionFilter`)가 맡는다.

기본 처리기의 규칙은 단순하다.

| 던져진 에러 | 기본 처리기의 응답 |
| --- | --- |
| `HttpException`과 그 하위 클래스(`NotFoundException` 등) | 그 클래스의 상태 코드와 메시지 |
| 그 밖의 모든 에러(`PrismaClientKnownRequestError` 포함) | 500 `Internal server error`, 서버 콘솔에 에러 출력 |

그래서 이 필터가 하는 일은 "Prisma 에러를 `HttpException` 하위 클래스로 **바꿔서** 기본 처리기에 다시 넘기는 것"이다. 응답 JSON을 직접 만들지 않으므로 `{"message", "error", "statusCode"}` 모양이 다른 4xx 응답과 똑같이 나온다.

```ts
// 서비스의 findOne이 던지는 것과, 이 필터가 만드는 것은 같은 종류다
throw new NotFoundException(`order ${id} not found`); // 서비스에서 직접 던진다 → 404
return super.catch(new ConflictException("이미 존재하는 값이다"), host); // P2002를 바꿔서 넘긴다 → 409
```

- `@Catch(Prisma.PrismaClientKnownRequestError)`는 `instanceof`로 고른다. 이 클래스가 아닌 에러는 이 필터를 거치지 않고 기본 처리기로 간다.

- 3단계에서 DB를 껐을 때의 `code: 'ECONNREFUSED'`도 같은 클래스라 이 필터로 들어오지만, `default`의 `super.catch(err, host)`가 기본 처리기에 그대로 넘겨 원래대로 500이 된다. 이 줄이 없으면 응답을 보내는 코드가 없어서 요청이 응답 없이 멈춘다.

- `BaseExceptionFilter`는 응답을 보낼 때 HTTP 어댑터(Express)가 필요하다. `new`로 직접 만들어 등록하면 Nest의 DI를 거치지 않으므로, `app.get(HttpAdapterHost).httpAdapter`로 꺼내 생성자에 넘긴다.

> C로 치면 `main` 근처에서 에러 코드를 받아 사용자에게 보여 줄 메시지로 바꾸는 `switch` 한 곳을 두는 것이다.  
> 서비스 코드는 에러를 "번역"할 필요 없이 그냥 던지면 된다.

### 개념 | 왜 미리 `SELECT`로 확인하지 않는가

"사용자를 만들기 전에 같은 id가 있는지 먼저 조회하고, 있으면 409"라고 짜는 게 더 자연스러워 보인다. 그런데 요청 두 개가 거의 동시에 들어오면 이렇게 된다.

1. A가 조회한다(없음).

2. B가 조회한다(없음).

3. A가 넣는다.

4. B가 넣는다.

두 요청 모두 검사를 통과한다. 검사와 삽입 사이에 틈이 있기 때문이다. C에서 두 스레드가 `if (count < MAX) count++;`을 동시에 실행할 때와 같은 경쟁 조건이다.

미리 조회하는 건 친절한 에러 메시지를 위해서는 좋지만, **정확성을 보장하는 건 DB의 제약뿐**이다.

> 이 "검사와 실행 사이의 틈"이 다음 문서의 주제다.

### 남길 것

- **찾아보면 되는 것**: `P2002`/`P2003`/`P2025`가 각각 무엇인지, `BaseExceptionFilter`에 넘길 인자.

- **감각으로 남겨야 할 것**: **500은 "내 코드가 처리하지 않은 에러"라는 뜻이다.** 사용자가 잘못 보낸 요청이 500으로 나가면 번역이 빠진 것이다. 그리고 **중복·참조 검사의 정확성을 보장하는 것은 DB의 제약뿐**이다. 미리 `SELECT`로 보는 것은 친절한 메시지용이고, 검사와 삽입 사이의 틈은 사라지지 않는다.

- **에러 신호**: 500 응답 + 서버 콘솔의 `code: 'P20xx'` → 그 코드를 필터에 매핑한다. 401이면 제약과 무관하게 가드에서 끝난 것이고, 404(`Cannot GET /x`)면 모듈을 `imports`에 안 넣은 것이다.

## 8. 7단계: 외래키를 걸었다고 인덱스가 생기지는 않는다

### 작업 1. 대량 데이터를 넣고 `Seq Scan`을 보기

4단계의 `\d orders`에서 `user_id`에 인덱스가 없다는 걸 봤다. 데이터가 적을 때는 차이가 없으니, 사용자 1만 명과 주문 20만 건을 넣는다.

아래 SQL은 **파일에 넣는 것이 아니라 `psql` 세션에서 직접 치는 것**이다.

1단계에서 쓴 명령으로 들어간다(이 단계의 `EXPLAIN ANALYZE`들도 모두 이 세션 안에서 실행한다).

```sh
docker compose exec db psql -U order -d order_api
# 프롬프트가 order_api=# 로 바뀌면 아래를 붙여 넣는다. 나올 때는 \q
```

```sql
INSERT INTO users (id, name)
SELECT 'u' || i, 'user' || i FROM generate_series(1, 10000) AS i;
-- 주문마다 무작위 사용자, 무작위 금액, 80% 확률로 결제 완료
INSERT INTO orders (user_id, price, paid)
SELECT 'u' || (1 + floor(random() * 10000)::int), (1 + floor(random() * 100))::int * 1000, random() < 0.8
FROM generate_series(1, 200000);
ANALYZE orders;
```

`EXPLAIN ANALYZE`를 붙이면 DB가 그 쿼리를 어떻게 실행했는지(실행 계획)와 걸린 시간을 보여 준다.

```sh
order_api=# EXPLAIN ANALYZE SELECT id, price, paid FROM orders WHERE user_id = 'u42';
                                              QUERY PLAN                                              
------------------------------------------------------------------------------------------------------
 Seq Scan on orders  (cost=0.00..3971.06 rows=20 width=9) (actual time=0.332..27.348 rows=14 loops=1)
   Filter: (user_id = 'u42'::text)
   Rows Removed by Filter: 199991
 Planning Time: 0.360 ms
 Execution Time: 27.385 ms
(5 rows)
```

`Seq Scan`(순차 스캔)은 테이블을 처음부터 끝까지 전부 읽었다는 뜻이다.

`user_id = 'u42'`인 몇 건을 돌려주려고 테이블의 모든 행을 읽었다. 위 출력에서는 14건을 찾기 위해 199,991건을 읽고 버렸다.

- `actual ... rows=14`: 실제로 돌려준 행 수.

- `Rows Removed by Filter: 199991`: 읽었지만 조건에 안 맞아 버린 행 수.

둘을 합치면 그때 테이블에 있던 전체 행 수다. `u42`에 몇 건이 몰리는지는 `random()`이 정하므로 **숫자는 실행할 때마다 다르다**(`SELECT count(*) FROM orders;`와 비교해 보면 맞는다). 중요한 것은 **돌려준 행보다 버린 행이 1만 배 많다**는 비율이다.

C로 치면 정렬 안 된 배열을 `for`로 전부 훑는 선형 탐색이다.

5단계의 `GET /users`도 내부적으로 `WHERE user_id IN (...)`이라 같은 일을 한다.

### 개념 | 인덱스와 B-tree

인덱스는 특정 컬럼 값으로 행을 빨리 찾기 위해, 테이블과 **별도로** 유지하는 자료구조다.

정렬된 배열에 `bsearch()`를 쓰는 것과 같은 발상이다. 값을 정렬해 두면 전부 훑지 않고 반씩 줄여 가며 찾을 수 있다.

PostgreSQL이 기본으로 만드는 인덱스의 자료구조는 B-tree다.

정렬된 배열 대신 트리를 쓰는 이유는 행이 계속 들어오고 지워지기 때문이다. 정렬된 배열은 가운데에 값 하나를 넣으려면 뒤를 전부 밀어야 한다.

B-tree는 이진 탐색 트리를 디스크에 맞게 넓적하게 만든 것이라고 보면 된다. 노드 하나가 디스크 블록(PostgreSQL에서는 8KB) 하나에 들어가도록 **자식을 수백 개씩** 두고, 각 노드 안에 "이 값보다 작은 건 이쪽, 큰 건 저쪽"의 경계값들이 정렬되어 들어 있다.

- 자식이 많으니 트리 높이가 낮다. 수백만 행이어도 뿌리에서 잎까지 보통 3~4단계다. 디스크를 읽는 횟수가 그만큼이면 끝난다는 뜻이다.

- 잎(leaf)에는 컬럼 값과 "그 행이 테이블의 어느 위치에 있는지"가 들어 있다. 그래서 인덱스로 위치를 찾고, 그 위치의 행을 다시 읽는 두 단계가 된다(아래 실행 계획이 `Bitmap Index Scan`(위치 찾기)과 `Bitmap Heap Scan`(그 위치의 행 읽기) 두 줄로 나뉘는 이유가 이것이다).

- 잎들이 서로 이어져 있어서 범위 조회(`price > 10000`)와 정렬(`ORDER BY`)에도 쓸 수 있다. 해시 테이블은 `=` 비교만 되고 이것이 안 된다.

> C로 치면 `bsearch()`용 정렬 배열이 아니라, 삽입·삭제가 잦은 데이터를 디스크에 두고 쓰기 위해 만든 다분기 트리다.

### 작업 2. 인덱스를 걸고 실행 계획을 다시 보기

PostgreSQL은 기본키와 `UNIQUE` 컬럼에는 인덱스를 자동으로 만든다(중복 검사에 필요하니까).

하지만 **외래키 컬럼에는 만들지 않는다.** 스키마에 직접 선언한다.

```prisma
// prisma/schema.prisma
// Order 모델 끝에 추가
  @@index([userId])
  @@map("orders")
```

```sh
npx prisma migrate dev --name index-orders-user-id
npx prisma generate
```

```sql
-- 생성된 마이그레이션
-- CreateIndex
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");
```

```sh
order_api=# EXPLAIN ANALYZE SELECT id, price, paid FROM orders WHERE user_id = 'u42';
                                                         QUERY PLAN                                                          
-----------------------------------------------------------------------------------------------------------------------------
 Bitmap Heap Scan on orders  (cost=4.45..77.70 rows=20 width=9) (actual time=0.121..0.309 rows=14 loops=1)
   Recheck Cond: (user_id = 'u42'::text)
   Heap Blocks: exact=14
   ->  Bitmap Index Scan on orders_user_id_idx  (cost=0.00..4.45 rows=20 width=0) (actual time=0.092..0.093 rows=14 loops=1)
         Index Cond: (user_id = 'u42'::text)
 Planning Time: 1.073 ms
 Execution Time: 0.469 ms
(7 rows)
```

인덱스(`orders_user_id_idx`)로 해당 행의 위치만 찾아 14건을 읽었다.

`25.4ms`에서 `0.47ms`로 줄었다(숫자는 PC마다 다르지만 차이의 크기는 비슷하게 나온다).

#### 실행 계획만 보고 인덱스가 쓰였는지 가르기

같은 쿼리의 두 출력을 나란히 놓으면, 달라지는 곳은 **노드 이름과 조건 줄**이다. 거기만 보면 인덱스가 실제로 쓰였는지 알 수 있다.

| 보는 곳 | 인덱스를 안 쓸 때 | 인덱스를 쓸 때 |
| --- | --- | --- |
| 첫 줄의 노드 | `Seq Scan on orders` | `Bitmap Heap Scan on orders`(또는 `Index Scan`) |
| 조건이 적힌 줄 | `Filter: (user_id = 'u42')` | `Recheck Cond:` + 자식의 `Index Cond:` |
| 자식 노드 | 없다 | `-> Bitmap Index Scan on orders_user_id_idx`(**인덱스 이름이 보인다**) |
| 버린 행 | `Rows Removed by Filter: 199991` | 그 줄이 없다 |
| 비용 추정 | `cost=0.00..3971.06` | `cost=4.45..77.70` |
| 읽은 양 | 테이블 전체 | `Heap Blocks: exact=14`처럼 필요한 블록만 |

- 가장 분명한 신호는 **`Rows Removed by Filter`가 사라지는 것**이다. `Filter`는 "읽고 나서 버렸다"는 뜻이고, `Index Cond`는 "읽기 전에 좁혔다"는 뜻이다.

- 돌려준 행 수(`rows=14`)는 양쪽이 같다. 결과는 같고 **가는 길만** 달라진 것이다.

**인덱스를 선언했는데도 `Seq Scan`이 나온다면** 두 가지 중 하나다.

1. **마이그레이션이 아직 적용되지 않았다.** 스키마에 `@@index`를 적고 폴더가 생겼더라도, 적용 전이면 DB에는 인덱스가 없다.

```sh
npx prisma migrate status
# "not yet been applied"가 보이면 → npx prisma migrate dev

docker compose exec db psql -U order -d order_api \
  -c "SELECT indexname FROM pg_indexes WHERE tablename='orders';"
# orders_pkey 만 나오면 아직 없는 것이고, orders_user_id_idx 가 함께 나와야 적용된 것이다
```

2. **적용됐지만 플래너가 안 쓰기로 했다.** 돌려줄 행이 테이블의 대부분이면 순차 스캔이 더 싸다고 판단한다. 아래 도전 과제 1에서 `paid` 컬럼으로 그 판단을 직접 본다.

공짜는 아니다. 인덱스는 디스크를 더 쓰고, 행을 넣고 고칠 때마다 함께 갱신해야 하므로 쓰기가 조금 느려진다.

> 그래서 모든 컬럼에 거는 게 아니라, 실제로 `WHERE`·`JOIN`에 자주 쓰이는 컬럼에 건다.  
> 외래키는 거의 항상 그런 컬럼이다.

확인이 끝났으면 시드로 대량 데이터를 지운다(`deleteMany`가 주문 → 사용자 순서로 전부 지운다).

```sh
npx prisma db seed
```

### 용어 | SQL (대량 데이터 만들기)

- `generate_series(1, N)`: 1부터 N까지의 정수를 행으로 만들어 내는 PostgreSQL 함수다. 반복문 없이 대량의 행을 만든다.

- `'u' || i`: `||`는 문자열을 이어 붙인다. `'u' || 42`는 `'u42'`다.

- `random()`: 0 이상 1 미만의 무작위 실수를 돌려준다. `::int`는 정수로 바꾸는 형 변환이다.

- `ANALYZE 테이블`: 테이블 통계를 갱신한다. DB는 이 통계를 보고 쿼리 실행 방법을 고른다. 이름이 비슷한 `EXPLAIN ANALYZE`와 함께 아래 "`ANALYZE`와 `EXPLAIN ANALYZE`"에서 다룬다.

### 개념 | `ANALYZE`와 `EXPLAIN ANALYZE`

둘은 이름이 겹치지만 하는 일이 다르다.

- `ANALYZE orders`: 쿼리가 아니라 **통계 수집**이다. 테이블에서 표본을 읽어 "행이 몇 개쯤인가", "`user_id` 값은 몇 종류이고 얼마나 고르게 퍼져 있나" 같은 정보를 저장해 둔다.

- `EXPLAIN 쿼리`: 쿼리를 실행하지 않고, DB가 **어떻게 실행할 계획인지**만 보여 준다. 숫자는 위 통계로 계산한 추정치다.

- `EXPLAIN ANALYZE 쿼리`: 쿼리를 **실제로 실행**하고, 계획과 함께 실제로 걸린 시간과 행 수를 보여 준다.

DB는 같은 쿼리라도 통계를 보고 순차 스캔과 인덱스 스캔 가운데 싼 쪽을 고른다(이것을 쿼리 플래너라고 한다). 20만 건을 막 넣은 직후에는 통계가 아직 옛 상태일 수 있어서, 넣자마자 `ANALYZE`로 통계를 새로 고친 것이다.

`EXPLAIN ANALYZE` 결과 한 줄에는 추정과 실제가 나란히 찍힌다.

```text
 Seq Scan on orders  (cost=0.00..3971.08 rows=20 width=9) (actual time=0.101..8.677 rows=17 loops=1)
```

| 부분 | 뜻 |
| --- | --- |
| `Seq Scan on orders` | 실행 방법(여기서는 순차 스캔) |
| `cost=0.00..3971.08` | 플래너가 계산한 비용 추정(첫 행까지..끝까지). 단위는 ms가 아닌 상대값이다 |
| `rows=20` | 추정 행 수(통계로 계산) |
| `actual time=0.101..8.677` | 실제 걸린 시간(ms) |
| `rows=17` | 실제 돌려준 행 수 |

- 추정 `rows`와 실제 `rows`가 크게 어긋나면 통계가 낡았다는 신호다. 그럴 때 `ANALYZE`를 다시 돌린다.

- `EXPLAIN ANALYZE`는 정말로 실행하므로, `DELETE`나 `UPDATE` 앞에 붙이면 데이터가 실제로 바뀐다. 계획만 보고 싶으면 `ANALYZE` 없이 `EXPLAIN`만 쓴다.

> 인덱스가 있다고 늘 쓰이는 게 아니라, 플래너가 통계를 보고 더 싼 쪽을 고른다. 도전 과제 1에서 그 판단을 직접 본다.

### 남길 것

- **찾아보면 되는 것**: `Bitmap Heap Scan`·`Index Scan` 같은 노드 종류, `@@index` 문법.

- **감각으로 남겨야 할 것**: **외래키 컬럼에는 인덱스가 자동으로 생기지 않는다**(기본키·`UNIQUE`에는 생긴다). 느리다고 느끼면 추측하지 말고 `EXPLAIN ANALYZE`로 본다. 인덱스는 공짜가 아니라 쓰기와 디스크를 더 쓰는 거래다.

- **에러 신호**: `Seq Scan` + 큰 `Rows Removed by Filter` → 인덱스가 없거나, 있어도 플래너가 안 쓴 것. 전자는 `migrate status`와 `pg_indexes`로, 후자는 "결과가 테이블의 대부분인가"로 가른다.

## 9. 8단계: 앱 문제인가, DB 문제인가 가르는 디버깅

DB를 붙이면 문제가 생길 수 있는 층이 하나 늘어난다.

앱 코드, Prisma가 만든 SQL, DB 자체 가운데 **어느 층에서 틀어졌는지부터 가른다.**

### 진단 1. 같은 SQL을 psql에서 직접 실행하면 어떻게 되는가

`PRISMA_LOG=query`로 문제의 SQL을 찍고, `$1` 같은 자리에 실제 값을 넣어 `psql`에서 그대로 실행해 본다.

- psql에서도 결과가 이상하면 데이터나 스키마 문제다.

- psql에서는 맞는데 API 응답이 다르면 앱 코드 문제(변환 함수, `select` 누락 등)다.

Express에서 "요청이 어디서 멈췄는가"로 미들웨어 체인을 가른 것과 같은 방법이다.

### 진단 2. 에러의 `code`와 `meta`부터 읽는다

Prisma 에러는 메시지보다 `code`가 정확하다. 6단계에서 다룬 것 말고도 자주 보는 것들이다.

이 표가 이 문서에서 만나는 신호 전부다. **메시지를 외우는 게 아니라, 어느 칸으로 가는지만 익히면 된다.**

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 |
|---|---|---|
| `P2002` | UNIQUE 위반 | 같은 값이 이미 있는가(6단계에서 409로 번역) |
| `P2003` | 외래키 위반 | 가리키는 행이 실제로 있는가 / 지우려는 행을 누가 참조하는가(6단계에서 400으로) |
| `P2025` | 대상 행 없음 | `update`/`delete`의 `where` 조건 |
| `code: 'ECONNREFUSED'` | DB에 접속 자체를 못 함 | `docker compose ps`, `DATABASE_URL`의 포트(5433) |
| `P3018` | 마이그레이션 하나가 실패해 멈춤 | 4단계 "실패한 마이그레이션에서 빠져나오기"(`migrate resolve --rolled-back`) |
| `ERROR: column ... contains null values`(`23502`) | 데이터가 있는 테이블에 기본값 없는 `NOT NULL` 추가 | 값을 채우는 문장을 마이그레이션에 먼저 넣었는가(4단계) |
| `was modified after it was applied` | 적용된 마이그레이션 파일을 고쳤다(checksum 불일치) | 파일을 원래대로 되돌린다. 바꿀 것은 새 마이그레이션으로 |
| `Nest can't resolve dependencies of X (?, ...)` | 주입받을 Provider를 못 찾음 → **부팅 실패** | `app.module.ts`의 `imports`, 그 모듈의 `exports`(3단계) |
| `{"message":"Cannot GET /x","statusCode":404}` | 그 경로가 등록되지 않음 | 해당 모듈이 `AppModule`의 `imports`에 있는가(5단계) |
| `{"message":"Unauthorized","statusCode":401}` | 가드에서 끝남. DB까지 가지 않았다 | 토큰이 비었는지·만료인지(6단계의 확인 순서) |
| `Cannot find name 'X'`(TS2304) | `import` 누락 | 그 파일 맨 위(6단계) |
| 응답은 맞는데 같은 `SELECT`가 N번 | N+1 | 반복문 안의 `await` DB 호출(5단계) |
| `Seq Scan` + 큰 `Rows Removed by Filter` | 인덱스가 없거나 플래너가 안 씀 | `migrate status`·`pg_indexes`, 결과가 전체의 몇 %인가(7단계) |

`meta.driverAdapterError`에는 드라이버가 받은 원래 에러(`ForeignKeyConstraintViolation` 등)가 들어 있다. 어느 제약에 걸렸는지 더 자세히 알고 싶을 때 펼쳐 본다.

### 진단 3. "DB에는 컬럼이 있는데 코드에서는 안 보인다"

거의 항상 `generate`를 빼먹은 것이다(2단계 참고). 순서는 언제나 스키마 수정 → `migrate dev` → `generate`다.

`start:dev`가 켜져 있었다면 `generate` 후에 타입 에러가 다시 계산된다.

### 진단 4. 마이그레이션 상태 확인하기

```sh
# 마이그레이션 폴더와 DB의 기록(_prisma_migrations)을 비교해서, 적용 안 된 것이 있는지 알려 준다
npx prisma migrate status
# 3 migrations found in prisma/migrations
# Database schema is up to date!
```

`psql`에서 `SELECT migration_name, finished_at FROM _prisma_migrations;`를 치면 DB가 기억하는 적용 이력을 직접 볼 수 있다. 0장 개념 4의 "어디까지 적용했는지"가 바로 이 테이블이다.

> 이미 적용된 마이그레이션 파일은 고치지 않는다. 다른 PC나 서버의 DB는 이미 옛 내용으로 적용을 마쳤기 때문이다. 바꿀 게 있으면 새 마이그레이션을 하나 더 만든다.

### 진단 5. Prisma Studio로 데이터 눈으로 보기

```sh
# 브라우저에서 테이블을 표 형태로 보고 고칠 수 있는 GUI를 띄운다
npx prisma studio
```

`psql`이 `curl`이라면 Studio는 브라우저 개발자 도구에 해당한다. 4단계의 백필(옛 데이터를 새 컬럼에 채워 넣기)이 제대로 됐는지처럼 "데이터가 지금 어떤 상태인가"를 훑어볼 때 편하다.

### 진단 6. 개발 DB를 처음 상태로 되돌리기

```sh
# 개발 DB의 모든 테이블과 데이터를 지우고, 마이그레이션을 처음부터 다시 적용한다
npx prisma migrate reset
npx prisma db seed
```

마이그레이션 파일을 잘못 고쳐서 개발 DB가 꼬였을 때 쓴다. 이름 그대로 **데이터를 전부 지우는 명령**이라, 개발용 DB에만 쓴다.

> 운영 서버에서는 `migrate dev`/`reset`을 쓰지 않는다. 이미 만들어진 마이그레이션 파일을 적용만 하는 `npx prisma migrate deploy`를 쓴다.

### 점검 | 시험해보기

```sh
PRISMA_LOG=query npm run start:dev
```

1. `GET /users`를 한 번 보내 쿼리가 2줄 찍히는지 확인한다.

2. `docker compose stop db`로 DB를 끈 상태에서 같은 요청을 보내 `ECONNREFUSED`를 확인한다.

3. `docker compose start db` 후 다시 보내 자동 복구를 확인한다.

### 도전 과제

#### 1. `paid` 컬럼에 인덱스 걸어 보기

7단계의 대량 데이터를 다시 넣고, `Order` 모델에 `@@index([paid])`를 추가해 마이그레이션한 뒤 아래를 실행한다.

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE paid = true;
```

DB가 그 인덱스를 쓰는가? 전체의 약 80%가 `true`라는 점과 연결해서 이유를 설명해 본다.

> 확인 후 `@@index([paid])`를 지우고 마이그레이션을 하나 더 만들어 원복한다.

**답**

1. 마이그레이션은 `CREATE INDEX "orders_paid_idx" ON "orders"("paid");` 한 줄이고, `\d orders`의 `Indexes:`에 `orders_paid_idx`가 생긴다.

2. 그래도 `paid = true`는 `Seq Scan on orders`다. 인덱스를 쓰지 않는다. 20만 건 가운데 약 16만 건(`rows=159677` 예상, 실제 159,972건)을 돌려줘야 하고, 걸러 낸 행은 약 4만 건뿐이다.

3. 인덱스를 쓰면 인덱스를 읽은 뒤 테이블의 행을 다시 찾아가야 한다. 어차피 거의 전부를 읽을 거라면 테이블을 처음부터 쭉 읽는 쪽이 싸다고 DB가 판단한다. `ANALYZE`로 모은 통계에 `true`가 약 80%라는 정보가 들어 있어서 이런 판단을 할 수 있다.

4. 반대로 약 20%인 `paid = false`를 조회하면 `Bitmap Index Scan on orders_paid_idx`로 인덱스를 쓴다.

> 인덱스는 결과가 전체의 일부일 때 효과가 있다. 값이 두 가지뿐이고 한쪽이 대부분인 컬럼은 흔한 값 쪽 조회에는 도움이 되지 않는다.

#### 2. `onDelete: Cascade` 마이그레이션 읽어 보기

`Order`의 관계에 `onDelete: Cascade`를 붙이고, 파일만 만든다.

```sh
npx prisma migrate dev --create-only --name cascade
```

생성된 SQL에서 `ON DELETE RESTRICT`가 무엇으로 바뀌는지 읽어 본다. 이 상태로 적용하면 4단계의 `DELETE FROM users WHERE id = 'kim'`이 어떻게 달라질지 말로 설명한다.

> 확인 후 생성된 마이그레이션 폴더를 지우고 스키마를 원복한다(적용 전이므로 폴더를 지워도 안전하다).

**답**

1. 생성된 SQL은 기존 외래키를 `DROP CONSTRAINT "orders_user_id_fkey"`로 지우고 같은 이름으로 다시 건다. 다시 걸 때 `ON DELETE RESTRICT`가 `ON DELETE CASCADE`로 바뀐다. `ON UPDATE CASCADE`는 그대로다.

2. 파일만 만든 상태에서는 DB가 바뀌지 않았으므로 `DELETE FROM users WHERE id = 'kim'`은 여전히 같은 외래키 에러로 거부된다.

3. 적용하면 같은 명령이 에러 없이 `DELETE 1`로 끝나고, `kim`의 주문(1번, 3번)도 함께 지워진다. `orders`에는 `lee`·`park`의 주문 3건만 남는다.

> `DELETE 1`은 지운 사용자 수만 알려 준다. 주문이 같이 지워졌다는 사실은 결과에 드러나지 않는다.

### 남길 것

- **찾아보면 되는 것**: `migrate status`·`studio`·`reset`의 플래그.

- **감각으로 남겨야 할 것**: **먼저 층을 가른다.** 같은 SQL을 `psql`에서 직접 실행해 보면 "앱 코드 문제"와 "데이터·스키마 문제"가 한 번에 갈린다. 그리고 에러는 메시지보다 `code`를 먼저 읽는다.

- **에러 신호**: 아래 진단 2의 표가 이 문서에서 만난 신호 전부다. 새 에러를 만나면 이 표에 한 줄 더 적어 두는 것이 가장 싼 학습이다.

## 10. 완성 확인

- [ ] 주문을 만들고 서버를 재시작해도 그대로 남아 있다

- [ ] DB를 끄면 500(`ECONNREFUSED`)이 나고, 다시 켜면 앱 재시작 없이 복구된다

- [ ] 4단계에서 데이터가 든 테이블의 마이그레이션을 직접 고쳐, 기존 주문 6건을 잃지 않고 `user_id` 외래키로 옮겼다

- [ ] `GET /users`가 사용자 수와 상관없이 쿼리 2개로 끝난다(`PRISMA_LOG=query`로 확인)

- [ ] 없는 사용자의 주문은 400, 중복 사용자는 409로 응답한다

- [ ] `EXPLAIN ANALYZE`로 인덱스 전후의 실행 계획(`Seq Scan` → `Bitmap Index Scan`)을 비교했다

## 11. 다음 단계

### 자가 점검

1. 인메모리 배열에서 DB로 옮기자 서비스 메서드가 전부 `async`가 된 이유는?

2. TS 타입 검사와 DB의 `NOT NULL`/외래키 제약은 각각 언제, 누가 검사하는가? 둘 다 있어야 하는 이유는?

3. 4단계에서 Prisma가 만든 마이그레이션을 그대로 적용했다면 어떤 일이 생겼는가? Prisma는 왜 그걸 스스로 알 수 없는가?

4. N+1 문제란 무엇이고, 관계 필드를 `select`/`include`에 넣으면 쿼리가 어떻게 바뀌는가?

5. "먼저 조회해 보고 없으면 넣는다"가 중복을 완전히 막지 못하는 이유는?

6. 외래키를 걸었는데도 `user_id`로 찾는 쿼리가 느렸던 이유는? 인덱스의 대가는 무엇인가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 여러 쿼리를 하나로 묶는 트랜잭션, 동시 요청이 같은 행을 고칠 때의 경쟁 조건과 잠금: 다음 문서에서 다룬다

- 다대다(N:M) 관계와 중간 테이블: 다음 문서에서 상품과 주문 품목을 만들며 다룬다

- 생성된 SQL로 표현하기 어려운 쿼리를 직접 쓰는 `$queryRaw`: 다음 문서에서 잠금을 걸 때 처음 쓴다

- 소프트 삭제(`deletedAt`), 자기 참조 관계(댓글의 답글 같은 트리 구조)

- 커넥션 풀 크기 조정, 읽기 전용 복제본(replica), 운영 DB 백업

- 무중단 마이그레이션(컬럼 이름 변경을 "추가 → 양쪽에 쓰기 → 옛 컬럼 제거"처럼 여러 배포에 나눠 하는 방법). 4단계의 `RENAME COLUMN`은 앱과 DB를 동시에 바꿀 수 있는 개발 환경이라 가능했다.
