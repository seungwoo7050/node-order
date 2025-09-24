# 트랜잭션과 동시성: 재고를 지키는 결제 API

## 목표

이 프로젝트는 [`01-postgres-prisma`](https://github.com/seungwoo7050/node-order/tree/01-postgres-prisma)으로부터 시작한다.

DB로 옮긴 `order-api-nest`에 상품 재고를 줄이며 주문을 만드는 결제 API(`POST /orders/checkout`)를 붙인다.

그리고 실제 서비스에서 결제가 깨지는 네 가지 방식을 하나씩 직접 일으키고 고친다.

1. 중간에 실패하면 재고만 줄고 주문은 없는 반쪽 상태가 남는다 → 트랜잭션

2. 동시에 몰리면 재고 10개짜리 상품이 50개 팔린다 → 조건부 UPDATE, 행 잠금(`FOR UPDATE`)

3. 같은 결제 요청이 두 번 오면 두 번 결제된다 → 멱등성 키(`Idempotency-Key`)

4. DB에는 주문이 있는데 알림이 안 가거나, 없는 주문의 알림이 간다 → outbox

```sh
# 재고 10개짜리 상품에 동시 결제 요청 50개 → 정확히 10건만 성공하고, 장부가 맞는다
node scripts/stampede.mjs 50
```

```text
응답 코드별 개수: { '201': 10, '409': 40 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 0         │ 10        │
│ 1       │ 2  │ '마우스'        │ 100       │ 0         │
└─────────┴────┴─────────────────┴───────────┴───────────┘
```

```sh
# 같은 Idempotency-Key로 동시에 20번 보내도 주문은 1건
node scripts/stampede.mjs 20 '[{"productId":1,"quantity":1}]' same-key-1
```

```text
응답 코드별 개수: { '201': 20 } # 20개 응답이 모두 같은 주문 하나를 가리킨다
```

> 시작 기준점:  
> `order-api-nest`가 PostgreSQL(`docker compose up -d`)에 붙어 있고, `users`·`orders` 테이블과 `PrismaExceptionFilter`가 있다.  
> `scratch-client.mjs`도 그대로 사용한다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러다 | 친다. 확인한 뒤 원복한다 |
| `진단 N.` | 11단계에서 "어느 층에서 틀어졌나"를 가르는 절차 | 친다(`psql`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. 11단계만은 작업 대신 `진단 N.`을 따라간다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 11단계 "진단 4"의 표에 모두 모았다.

- 0장(사전지식)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 확인 명령뿐이고 13·14장은 체크리스트라서 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 사전지식](#0-사전지식) | 경쟁 조건·트랜잭션·행 잠금·멱등성을 C의 스레드·mutex에 빗대 본다(작업 없음) |
| [1. 준비](#1-준비) | DB가 떠 있는지 확인하고 `scripts/`를 만든다 |
| [2. 1단계: 상품과 주문 품목의 다대다(N:M) 관계](#2-1단계-상품과-주문-품목의-다대다nm-관계) | `products`·`order_items`를 만들고 `GET /products`로 재고를 본다 |
| [3. 2단계: 트랜잭션 없이 결제 만들기](#3-2단계-트랜잭션-없이-결제-만들기) | 트랜잭션 없이 결제를 만들고, 중간 실패로 반쪽 상태를 만든다 |
| [4. 3단계: 트랜잭션으로 묶기](#4-3단계-트랜잭션으로-묶기) | `$transaction`으로 묶어 반쪽 상태를 없앤다 |
| [5. 4단계: 일부러 깨뜨려보기 ②, 동시에 50명이 산다](#5-4단계-일부러-깨뜨려보기-②-동시에-50명이-산다) | 동시 결제 50건으로 재고 10개짜리가 50개 팔리는 갱신 손실을 본다 |
| [6. 5단계: 고치기 1, 판단과 쓰기를 UPDATE 한 문장으로](#6-5단계-고치기-1-판단과-쓰기를-update-한-문장으로) | 조건부 `UPDATE`로 정확히 10건만 팔리게 고친다 |
| [7. 6단계: 일부러 깨뜨려보기 ③, 교착 상태](#7-6단계-일부러-깨뜨려보기-③-교착-상태) | 반대 순서 동시 결제로 교착 상태를 만들고, 잠그는 순서를 통일해 없앤다 |
| [8. 7단계: 고치기 2, `SELECT ... FOR UPDATE`로 먼저 잠그고 읽기](#8-7단계-고치기-2-select--for-update로-먼저-잠그고-읽기) | `SELECT ... FOR UPDATE`로 읽는 순간 잠근다 |
| [9. 8단계: 멱등성, 같은 요청이 두 번 와도 한 번만](#9-8단계-멱등성-같은-요청이-두-번-와도-한-번만) | `Idempotency-Key`로 같은 요청을 한 번만 처리한다 |
| [10. 9단계: outbox로 DB와 알림이 어긋나지 않게](#10-9단계-outbox로-db와-알림이-어긋나지-않게) | outbox로 주문과 알림이 어긋나지 않게 한다 |
| [11. 10단계: 동시성 회귀 테스트](#11-10단계-동시성-회귀-테스트) | 테스트 전용 DB에서 동시성 회귀 테스트를 돌린다 |
| [12. 11단계: 누가 누구를 기다리는지 디버깅하기](#12-11단계-누가-누구를-기다리는지-디버깅하기) | `pg_stat_activity`·쿼리 로그·DB 로그로 막힌 곳을 찾는다 |
| [13. 완성 확인](#13-완성-확인) | 체크리스트 |
| [14. 다음 단계](#14-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 사전지식

### 개념 1 | 경쟁 조건: 두 스레드의 `count++`와 똑같은 일이 DB에서도 일어난다.

C로 스레드를 써 봤다면 이 버그를 안다.

```c
// 스레드 두 개가 동시에 실행한다
if (stock >= 1) { // 둘 다 stock == 1을 읽는다
    stock = stock - 1; // 둘 다 0을 쓴다 → 두 개 팔렸는데 재고는 하나만 줄었다
}
```

"읽고 → 판단하고 → 쓰기"가 세 단계로 나뉘어 있고, 그 사이에 다른 스레드가 끼어들 수 있어서 생기는 문제다.

웹 서버도 똑같다.

Node는 스레드가 하나지만, `await`로 DB 응답을 기다리는 동안 이벤트 루프는 다른 요청을 처리한다.

요청 A가 재고를 읽고 기다리는 사이에 요청 B도 같은 재고를 읽는다.

DB 쪽에서는 아예 여러 커넥션이 진짜로 동시에 돈다.

### 개념 2 | 트랜잭션: "전부 아니면 전무"를 DB가 보장한다.

C로 설정 파일을 안전하게 바꾸는 정석은 이렇다.

임시 파일에 다 쓰고, 다 써졌으면 `rename()`으로 한 번에 바꿔치기한다.

중간에 프로그램이 죽어도 원래 파일은 멀쩡하다. `rename()`이 원자적(atomic, 쪼개지지 않음)이기 때문이다.

DB의 트랜잭션이 같은 일을 한다.

`BEGIN`으로 시작해서 여러 `UPDATE`/`INSERT`를 하고, `COMMIT`하는 순간 전부가 한꺼번에 반영된다.

중간에 에러가 나서 `ROLLBACK`하면 하나도 반영되지 않는다. 커밋 전까지는 다른 커넥션에서도 그 변경이 안 보인다.

중요한 함정이 하나 있다. **트랜잭션은 "전부 아니면 전무"를 보장할 뿐, 개념 1의 경쟁 조건을 막아 주지는 않는다.**

PostgreSQL의 기본 설정(`READ COMMITTED`)에서 두 트랜잭션은 같은 재고를 동시에 읽을 수 있다.

### 개념 3 | 행 잠금: 행마다 하나씩 달린 mutex다.

경쟁 조건의 C식 해법은 `pthread_mutex_lock()`으로 "읽고 → 판단하고 → 쓰기"를 감싸는 것이다.

DB에서는 행 잠금이 그 mutex다.

- `UPDATE`는 고치는 행에 자동으로 잠금을 건다.

- `SELECT ... FOR UPDATE`는 읽는 행에 미리 잠금을 건다.

- 잠금은 트랜잭션이 끝날 때(커밋/롤백) 풀린다. 같은 행을 잠그려는 다른 트랜잭션은 그때까지 기다린다.

mutex를 써 봤다면 그 대가도 안다.

스레드 A가 `m1` → `m2` 순서로, 스레드 B가 `m2` → `m1` 순서로 잠그면 서로 상대가 쥔 걸 기다리며 영원히 멈춘다. 교착 상태(deadlock)다.

해법도 C와 같다. 모두가 같은 순서로 잠근다.

### 개념 4 | 네트워크는 "정확히 한 번"을 보장하지 않는다.

클라이언트가 결제 요청을 보냈는데 응답 대신 타임아웃이 왔다.

서버가 요청을 못 받은 걸까, 처리하고 응답만 잃어버린 걸까? 클라이언트는 구별할 방법이 없다.

안전하게 하려면 다시 보내야 하고, 다시 보내면 두 번 처리될 수 있다.

그래서 "같은 요청이 여러 번 와도 결과는 한 번 처리한 것과 같게" 만드는 성질, 멱등성(idempotency)이 필요하다.

같은 문제가 서버 안에서도 생긴다.

"DB에 주문 저장"과 "WebSocket으로 알림 전송"은 서로 다른 시스템에 쓰는 일이라, 하나의 트랜잭션으로 묶을 수 없다.

둘 사이에 프로세스가 죽으면 한쪽만 일어난다.

## 1. 준비

새로 설치할 패키지는 없다. `01`의 `order-api-nest`에서 이어 간다.

DB가 떠 있는지 확인한다.

### 작업 1. DB가 떠 있는지 확인

```sh
cd order-api-nest
docker compose up -d
npx prisma migrate status # Database schema is up to date!
```

### 작업 2. scripts 폴더 만들기

실험 스크립트를 둘 `scripts/` 폴더를 만들어 둔다.

```sh
mkdir scripts
```

## 2. 1단계: 상품과 주문 품목의 다대다(N:M) 관계

주문 하나에는 상품이 여러 개 들어가고, 상품 하나는 여러 주문에 들어가는 다대다(N:M) 관계다.

관계형 DB는 다대다를 직접 표현하지 못하므로, 사이에 중간 테이블을 하나 둬서 1:N 두 개로 쪼갠다.

우리의 중간 테이블(`order_items`)에는 "몇 개를 얼마에 샀는가"라는 자기 데이터도 있다.

### 작업 1. Product·OrderItem 모델 추가와 마이그레이션

```prisma
// prisma/schema.prisma
// Order 모델에 items 한 줄을 추가하고, 아래 두 모델을 새로 만든다
model Order {
  // ... 01의 필드 그대로 ...
  items     OrderItem[]   // 이 주문의 품목들

  @@index([userId])
  @@map("orders")
}

model Product {
  id    Int         @id @default(autoincrement())
  name  String
  price Int
  // 남은 재고. 이 숫자를 지키는 것이 이 문서의 목표다
  stock Int
  items OrderItem[]

  @@map("products")
}

// 중간 테이블: 주문 하나 ↔ 상품 하나를 잇는 한 줄
model OrderItem {
  orderId   Int     @map("order_id")
  order     Order   @relation(fields: [orderId], references: [id])
  productId Int     @map("product_id")
  product   Product @relation(fields: [productId], references: [id])
  quantity  Int
  // 산 시점의 가격. 나중에 상품 가격이 바뀌어도 이 주문의 금액은 변하면 안 되므로 복사해 둔다
  unitPrice Int     @map("unit_price")

  // (주문, 상품) 쌍이 행을 식별한다 → 한 주문에 같은 상품 줄이 두 번 들어갈 수 없다
  @@id([orderId, productId])
  // 복합키 (order_id, product_id)의 인덱스는 order_id로 시작하는 검색에만 쓰인다 → product_id로 찾을 인덱스를 따로 건다
  @@index([productId])
  @@map("order_items")
}
```

```sh
npx prisma migrate dev --name add-products
npx prisma generate
```

새 테이블만 생기는 마이그레이션이라 데이터 문제는 없다.

생성된 SQL에서 `CONSTRAINT "order_items_pkey" PRIMARY KEY ("order_id","product_id")`와 외래키 두 개를 확인한다.

### 용어 | Prisma 스키마 문법 (관계·복합키)

- 관계 필드(`items OrderItem[]`): 다른 모델과의 관계를 나타내는 필드다. DB 컬럼이 아니다.

- `@relation(fields: [orderId], references: [id])`: 이 모델의 `orderId` 컬럼이 `Order`의 `id`를 가리키는 외래키라는 뜻이다.

- `@@id([orderId, productId])`: 두 컬럼을 묶은 복합 기본키다.

### 작업 2. 시드 다시 쓰기

이 문서는 같은 실험을 여러 번 반복한다. 그때마다 상품 id가 1, 2로 고정돼 있어야 스크립트가 편하다.

`01`에서 본 것처럼 `deleteMany`는 시퀀스를 되감지 않으므로, 이번에는 SQL의 `TRUNCATE ... RESTART IDENTITY`를 쓴다.

```ts
// prisma/seed.ts
// deleteMany 두 줄을 이 한 줄로 바꾸고, 맨 아래에 상품을 추가한다
// 실험을 반복해도 상품 id가 항상 1, 2가 되도록 시퀀스까지 되감는다
await prisma.$executeRaw`TRUNCATE order_items, orders, products, users RESTART IDENTITY CASCADE`;

// ... users, orders의 createMany는 그대로 ...

await prisma.product.createMany({
  data: [
    { name: "한정판 키보드", price: 150000, stock: 10 }, // id 1. 선착순 재고 10개
    { name: "마우스", price: 30000, stock: 100 }, // id 2
  ],
});

console.log("seed 완료: 사용자", await prisma.user.count(), "명, 주문", await prisma.order.count(), "건, 상품", await prisma.product.count(), "개");
```

`$executeRaw`는 Prisma의 메서드 대신 SQL 문자열을 직접 실행하는 탈출구다.

백틱(`` ` ``)으로 감싼 태그드 템플릿 문법이라 이후에 `${값}`을 넣으면 Prisma가 SQL 인젝션이 안 되도록 매개변수로 바꿔 넣는다.

### 용어 | SQL (시드 초기화)

- `TRUNCATE ... RESTART IDENTITY`: 테이블을 비우고 시퀀스(id 번호표)도 1로 되감는다.
- `CASCADE`: 외래키로 엮인 테이블을 순서 신경 쓰지 않고 한 번에 비운다.

### 작업 3. 재고 조회 API

재고를 볼 수 있게 `GET /products`를 만든다. 로직이 없으니 컨트롤러가 `PrismaService`를 직접 쓴다.

```ts
// src/products/products.controller.ts
import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("products") // 이 클래스의 모든 경로 앞에 /products가 붙는다
export class ProductsController {
  // 상속이 아니라 주입이다. Nest가 만들어 둔 PrismaService 하나를 받아 this.prisma 필드에 넣는다
  constructor(private readonly prisma: PrismaService) {}

  @Get() // GET /products 를 바로 아래 메서드에 연결한다. 메서드 이름 list는 아무거나 써도 된다
  list() {
    return this.prisma.product.findMany({ orderBy: { id: "asc" } });
  }
}
```

```ts
// src/products/products.module.ts
import { Module } from "@nestjs/common";
import { ProductsController } from "./products.controller.js";

@Module({ controllers: [ProductsController] })
export class ProductsModule {}
```

`app.module.ts`의 `imports`에 `ProductsModule`을 추가한다.

```ts
// src/app.module.ts
// import 한 줄과 imports 배열의 ProductsModule만 추가한다
import { ProductsModule } from "./products/products.module.js";
// ... 기존 import 그대로 ...

@Module({
  imports: [PrismaModule, OrdersModule, UsersModule, AuthModule, NotificationsModule, ProductsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

Nest는 `main.ts`가 넘긴 `AppModule`에서 출발해 `imports`를 따라가며 모듈을 찾는다.

여기에 빠진 모듈은 파일이 있어도 없는 것과 같아서, 서버는 멀쩡히 뜨는데 `GET /products`만 404가 난다.

확인한다.

```sh
npx prisma db seed
npm run start:dev
curl localhost:4000/products
[{"id":1,"name":"한정판 키보드","price":150000,"stock":10},{"id":2,"name":"마우스","price":30000,"stock":100}]
```

### 개념 | Nest의 세 부품(모듈·컨트롤러·프로바이더)과 이를 엮는 데코레이터

Nest 코드는 세 종류의 클래스로 이뤄지고, 서로를 직접 `new` 하지 않는다.

각 클래스에 붙은 데코레이터를 Nest가 시작할 때 읽고 대신 엮어 준다.

| 부품 | 데코레이터 | 하는 일 | 이 프로젝트의 예 |
|---|---|---|---|
| 모듈 | `@Module({...})` | 어떤 컨트롤러·프로바이더가 한 묶음인지, 다른 모듈에서 무엇을 가져오는지 적는 목록 | `ProductsModule`, `OrdersModule` |
| 컨트롤러 | `@Controller("경로")` + `@Get()`·`@Post()` … | HTTP 요청을 받아 메서드에 연결하고, 반환값을 응답으로 보낸다 | `ProductsController` |
| 프로바이더 | `@Injectable()` + 모듈의 `providers`에 등록 | Nest가 서버 시작 때 (기본적으로) 하나만 만들어 두고, 필요로 하는 곳에 넣어 주는 객체. 서비스(비즈니스 로직)가 대표적이다 | `OrdersService`, `PrismaService` |

데코레이터(`@이름(...)`)는 클래스나 메서드에 "이건 컨트롤러다, 이 메서드는 `GET`이다" 같은 표식을 붙이는 문법이다.

코드를 실행하는 게 아니라 메타데이터를 남길 뿐이고, 실제 연결은 Nest가 그 표식을 모아서 한다.

C로 치면 함수 포인터를 등록 테이블에 직접 넣는 대신, 함수 옆에 표식만 달아 두면 프레임워크가 테이블을 만들어 주는 셈이다.

**의존성 주입(DI)**: 컨트롤러가 `PrismaService`를 쓰려고 직접 `new PrismaService()`를 하지 않는다. 생성자 매개변수에 타입만 적어 두면 Nest가 서버 시작 때 하나만 만들어 둔 인스턴스를 넣어 준다. 내가 꺼내 오는 게 아니라 Nest가 넣어 주는 것이다. 그래서 커넥션 풀도 앱 전체에서 하나다.

- `ProductsController`는 `PrismaService`의 자식 클래스가 아니다. 상속(`extends`)이면 "컨트롤러는 일종의 PrismaService다"가 되지만, 여기서는 "컨트롤러가 PrismaService를 하나 갖고 있다"(합성)다. C++로 쓰면 이렇다.

  ```cpp
  class ProductsController {
      PrismaService& prisma;  // 갖고 있다(has-a). 상속(is-a)이 아니다
  public:
      // 이 생성자를 부르는 쪽이 내가 아니라 Nest다
      explicit ProductsController(PrismaService& p) : prisma(p) {}
  };
  ```

- `constructor(private readonly prisma: PrismaService) {}`는 TypeScript의 축약 문법이다. 매개변수 앞에 `private readonly`를 붙이면 "같은 이름의 필드를 선언하고, 받은 값을 넣어라"까지 한 번에 된다. 그래서 본문이 비어 있어도 `this.prisma`를 쓸 수 있다.

- `@Injectable()`이 붙으면 "주입된다"는 뜻인가, "주입받는다"는 뜻인가? 정확히는 둘 다 아니고, "이 클래스는 Nest가 만들고 관리한다"는 표식이다. 그 결과 두 가지가 다 가능해진다.
  
  - **주입받는다**: 생성자 매개변수의 타입(`PrismaService`)은 원래 컴파일하면 사라진다. 데코레이터가 붙은 클래스에만 TypeScript가 그 타입 정보를 남기고(`tsconfig.json`의 `emitDecoratorMetadata`), Nest는 그걸 읽어 무엇을 넣어 줄지 안다. `@Controller()`·`@WebSocketGateway()`도 같은 역할을 하기 때문에 컨트롤러와 게이트웨이도 주입받을 수 있다.
  
  - **주입된다**: 이건 데코레이터 덕분이 아니라 모듈의 `providers`에 적었기 때문이다. 다른 모듈에 줄 때는 `exports`에도 적는다. 받는 쪽도 컨트롤러만이 아니다. `OrdersService`는 `PrismaService`와 `NotificationsGateway`를 받는다. 서비스가 서비스를 받는 것이다.
  
  - **하나만 만들어 두는 것도 데코레이터가 아니다**: Nest가 객체를 만드는 대상은 `providers`에 적힌 클래스다. `@Injectable()`을 붙여도 `providers`에 없으면 끝까지 만들어지지 않는다. 하나만 만드는 것은 기본 스코프가 싱글턴이라서이고, 아래 스코프 항목처럼 같은 데코레이터로 바꿀 수도 있다.
  
  - 정리하면 컨트롤러는 받기만 하고 남에게 주입되지 않는다. 프로바이더는 받기도 하고 주입되기도 한다.

    ```text
    PrismaService ────────┬─▶ ProductsController
                          └─▶ OrdersService ─▶ OrdersController
    NotificationsGateway ─────┘
    ```

  참고로 `PrismaService` 자신은 `extends PrismaClient`로 상속을 쓴다. "PrismaService는 일종의 PrismaClient다"(is-a)이므로 `this.prisma.product.findMany()`처럼 PrismaClient의 메서드를 그대로 쓸 수 있다. 이 코드에서 상속은 이 한 곳뿐이고, 컨트롤러·서비스 사이의 관계는 전부 주입이다.

- `@Injectable()`은 보통 어떤 클래스에 붙이나? 기준은 "앱 전체에서 하나만 있으면 되고, 여러 곳이 같이 쓰는 객체"다. 요청마다 새로 만들 이유가 없고, 각자 `new` 하면 오히려 곤란한 것들이다.

  | 종류 | 왜 Nest에 맡기나 | 이 프로젝트의 예 |
  |---|---|---|
  | 서비스(비즈니스 로직) | 컨트롤러는 HTTP만, 판단과 DB 작업은 여기에. 여러 컨트롤러가 같은 로직을 쓴다 | `OrdersService`, `UsersService` |
  | DB·외부 시스템 연결 | 커넥션 풀이 각자 `new` 하는 곳마다 생기면 DB 연결이 금방 바닥난다 | `PrismaService` |
  | 인증 전략·가드·인터셉터 | 요청 처리 중간에 Nest가 꺼내 쓰는 부품이라 Nest가 알고 있어야 한다 | `JwtStrategy` (`@UseGuards(AuthGuard("jwt"))`가 찾아 쓴다) |

  반대로 DTO(`CheckoutItemDto` 같은 것)에는 붙이지 않는다. DTO는 요청마다 새로 생기는 데이터 껍데기라서 Nest가 하나만 만들어 나눠 줄 대상이 아니다.

- 내부에서는 어떻게 쓰이나? `main.ts`의 `NestFactory.create(AppModule)` 한 줄 안에서 다음이 일어난다.
  
  1. `AppModule`부터 `imports`를 따라가며 모듈을 모두 찾고, 각 모듈의 `providers`·`controllers`를 모은다.
  
  2. 각 클래스의 생성자 매개변수 타입을 읽어 "누가 누구를 필요로 하나" 그래프를 만든다.
  
  3. 의존이 없는 것부터 만든다. `PrismaService` → `OrdersService` → `OrdersController` 순서다. 만든 인스턴스는 컨테이너에 보관해 두고, 같은 타입을 요구하는 곳에는 모두 그 하나를 넣는다(기본이 싱글턴).
  
  4. 다 만들고 나면 인스턴스들의 생명주기 훅(`onModuleInit` 등)을 부르고, 끌 때는 `onModuleDestroy` 등을 부른다. `PrismaService`가 `onModuleDestroy`에서 DB 연결을 닫는 것이 그 예다.

  2단계에서 넣어 줄 것을 못 찾으면, 서버가 뜨기 전에 `Nest can't resolve dependencies of the OrdersService (PrismaService, ?)` 같은 에러로 멈춘다. `?` 자리에 있는 것이 `providers`에 없거나, 그걸 가진 모듈을 `imports`하지 않은 것이다. 컨테이너에 보관된 인스턴스는 `app.get(타입)`으로 직접 꺼낼 수도 있다. 10단계 테스트에서 `app.get(HttpAdapterHost)`가 그렇게 쓴다.

- 싱글턴이 아닌 스코프도 있다. `@Injectable({ scope: Scope.REQUEST })`처럼 지정한다.

  | 스코프 | 인스턴스가 생기는 때 | 쓰는 곳 |
  |---|---|---|
  | `DEFAULT`(싱글턴) | 앱이 켜질 때 한 번 | 거의 전부. 이 프로젝트도 전부 이것이다 |
  | `REQUEST` | 요청이 들어올 때마다 새로 | 요청마다 다른 것을 필드로 들고 있어야 할 때. 예: 테넌트(고객사)마다 다른 DB에 붙는 멀티테넌트 서버에서, 요청 헤더를 보고 그 요청 동안 쓸 연결을 고른다 |
  | `TRANSIENT` | 주입받는 곳마다 따로 하나씩 | 공유하면 안 되는 작은 상태를 가진 도우미. 예: "어느 클래스의 로그인지"를 필드로 들고 있는 로거 |

  `REQUEST`는 비싸다. 요청 스코프 프로바이더를 주입받는 쪽도 덩달아 요청 스코프가 된다. `OrdersService`가 요청 스코프면 그걸 받는 `OrdersController`도 요청마다 새로 만들어진다. 게다가 요청이 없는 곳(9단계의 outbox relay 타이머, WebSocket 게이트웨이)에서는 쓸 수 없다. 그래서 요청마다 다른 값은 보통 스코프 대신 메서드 인자로 넘긴다. 이 문서의 결제도 컨트롤러가 토큰에서 `userId`를 꺼내 `ordersService.checkout(userId, ...)`로 넘긴다. `TRANSIENT`는 이렇게 번지지 않고 받는 쪽은 싱글턴으로 남는다. 다만 로거 정도는 `OrdersService`처럼 `new Logger(OrdersService.name)`로 직접 만드는 쪽이 더 흔하다.

  싱글턴이라는 사실에서 꼭 챙길 것이 하나 있다. **동시에 들어온 요청들이 같은 `OrdersService` 인스턴스 하나를 같이 쓴다.** `this.currentUserId = userId`처럼 요청마다 다른 값을 필드에 넣으면, `await` 사이에 다른 요청이 그 필드를 덮어쓴다. 0장 개념 1의 경쟁 조건이 DB가 아니라 서버 메모리에서 일어나는 것이다. 요청마다 다른 값은 지역 변수와 매개변수로만 다룬다.

- 프로바이더끼리 서로를 주입받으면(순환 의존) 서버가 뜨지 않는다. `A`의 생성자에는 `B`가, `B`의 생성자에는 `A`가 필요하니 위 3번 "의존이 없는 것부터 만든다"에서 어느 쪽도 먼저 만들 수 없다. 서버가 켜지는 단계에서 `Nest can't resolve dependencies of the AService (?)` 같은 에러로 멈추고, 모듈끼리 서로 `imports`할 때는 메시지에 `A circular dependency between modules`가 나온다. C에서 `struct A { struct B b; }`와 `struct B { struct A a; }`를 동시에 선언할 수 없는 것과 같다.
  
  - 탈출구로 `forwardRef()`가 있다. 양쪽 생성자에 `@Inject(forwardRef(() => BService))`를, 모듈이라면 `imports: [forwardRef(() => BModule)]`을 쓴다. C에서 전방 선언 `struct B;`과 포인터로 순환을 끊는 것과 비슷하고, 대가도 비슷하다. 상대가 생성자 안에서는 아직 준비돼 있지 않을 수 있다.
  
  - 하지만 순환은 보통 책임을 잘못 나눴다는 신호다. 두 클래스가 서로에게서 필요로 하는 부분을 세 번째 프로바이더로 빼면 화살표가 한 방향이 된다. 예를 들어 지금은 `OrdersService → NotificationsGateway`인데, 게이트웨이가 WebSocket 메시지를 받아 주문을 조회하려고 `OrdersService`를 주입받으면 순환이 생긴다. 그럴 때는 `forwardRef`보다 조회 부분을 따로 빼는 쪽을 먼저 생각한다.

- "주입 가능하다"가 "어디서든 가져다 쓸 수 있다"는 뜻은 아니다. 두 가지 제한이 있다.
  
  - **받는 쪽은 Nest가 만드는 클래스뿐이다**: 컨트롤러·프로바이더·게이트웨이처럼 Nest가 `new` 하는 클래스여야 생성자에 무언가를 넣어 준다. 내가 직접 `new` 한 클래스나 파일 최상단의 함수에는 아무도 넣어 주지 않는다. 그런 곳에서 꼭 필요하면 위의 `app.get(타입)`으로 꺼낸다.
  
  - **그 모듈에서 보이는 것만 받는다**: 같은 모듈의 `providers`, `imports`한 모듈이 `exports`한 것, `@Global()` 모듈이 `exports`한 것 셋이다. `ProductsModule`의 `imports`에 `PrismaModule`이 없는데도 주입이 되는 것은 `src/prisma/prisma.module.ts`에 `@Global()`이 붙어 있어서다. 전역 모듈이 아닌 것(예: `OrdersModule`이 쓰는 `NotificationsModule`)은 쓰는 쪽 모듈의 `imports`에 적어야 한다.

  한 문단으로 줄이면 이렇다.

  > `providers`에 등록된 클래스는 서버가 시작할 때 Nest가 (기본적으로) 하나만 만들어 둔다.  
  > "주입 가능하다"는 것은, 그 모듈에서 보이는 범위 안의 다른 Nest 관리 클래스가 생성자에 타입만 적으면 그 하나를 넘겨받는다는 뜻이다.  
  > `@Injectable()`은 그 클래스가 Nest의 관리 대상이라는 표식이고, 덕분에 자기 생성자로도 다른 것을 주입받을 수 있다.

**`@Get()`과 `list()`**: `@Controller("products")`의 경로와 `@Get()`의 경로(비어 있음)가 합쳐져 `GET /products`가 되고, 그 요청이 오면 바로 아래 메서드가 불린다.  
`@Get(":id")`였다면 `GET /products/1` 같은 요청을 받는다. 메서드 이름은 Nest가 보지 않으므로 `list`든 `findAll`이든 상관없다.  
메서드가 Promise를 반환하면 Nest가 기다렸다가 결과를 JSON으로 바꿔 `200`으로 응답한다(`@Post()`는 기본이 `201`이다).

**`src/` 아래 폴더**: 서비스(마이크로서비스) 단위가 아니라 한 서버 안의 기능 단위다.  
폴더 하나가 모듈 하나이고, 모두 같은 프로세스에서 돈다. 흔한 구성은 `*.module.ts`·`*.controller.ts`·`*.service.ts`·`dto/` 넷이지만 필수는 아니다. 필요한 것만 둔다.

| 폴더 | module | controller | service | dto | 이유 |
|---|---|---|---|---|---|
| `orders/`, `users/` | ○ | ○ | ○ | ○ | 요청 본문을 받고 로직이 있다 |
| `products/` | ○ | ○ | | | 조회 하나뿐이라 로직도 요청 본문도 없다 |
| `prisma/` | ○ | | ○ | | 남에게 주입될 뿐 HTTP 경로가 없다 |
| `notifications/` | ○ | | | | 컨트롤러 대신 WebSocket `gateway`가 있다 |

로직이 생기면 그때 `products.service.ts`로 옮기면 된다. 다음 단계의 결제가 바로 그 경우라 `OrdersService`에 넣는다.

### 남길 것

- **찾아보면 되는 것**: `@relation(fields: [...], references: [...])`, `@@id([...])`, `TRUNCATE ... RESTART IDENTITY CASCADE`의 문법. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  - 다대다는 중간 테이블 하나로 1:N 두 개로 쪼개고, 그 테이블에는 "산 시점의 가격"처럼 자기 데이터가 들어갈 수 있다.
  - 복합키 `(order_id, product_id)`의 인덱스는 `order_id`로 시작하는 검색에만 쓰인다. 반대 방향으로 찾을 일이 있으면 인덱스를 따로 건다.

- **에러 신호**: 이 단계에서는 에러를 만나지 않았다. 생성된 마이그레이션 SQL에 `PRIMARY KEY ("order_id","product_id")`와 외래키 두 개가 있는지만 본다.

## 3. 2단계: 트랜잭션 없이 결제 만들기

### 작업 1. 결제 요청 DTO 만들기

요청 본문은 `{ "items": [{ "productId": 1, "quantity": 1 }, ...] }`이다.

주문자는 본문이 아니라 로그인 토큰에서 꺼낸다. 남의 이름으로 결제할 수 없게 하기 위해서다.

```ts
// src/orders/dto/checkout.dto.ts
import { Type } from "class-transformer";
import { ArrayMinSize, ArrayUnique, IsArray, IsInt, IsPositive, ValidateNested } from "class-validator";

export class CheckoutItemDto {
  @IsInt() @IsPositive() productId!: number;
  @IsInt() @IsPositive() quantity!: number;
}

export class CheckoutDto {
  // 배열 안의 객체까지 검증하려면 ValidateNested + Type이 함께 필요하다
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CheckoutItemDto)
  @ArrayUnique((i: CheckoutItemDto) => i.productId, { message: "같은 상품은 한 줄로 합쳐 수량으로 보냅니다" })
  items!: CheckoutItemDto[];
}
```

`@ArrayUnique`가 없으면 같은 상품이 두 줄로 들어온 요청이 `order_items`의 복합 기본키(주문, 상품)에 걸려, 400이 아니라 "이미 존재하는 값이다"라는 엉뚱한 409로 끝난다.

입력 단계에서 400으로 막는다.

`@ValidateNested`만 붙이면 `items` 배열 안의 원소는 평범한 객체로 남아 있어서, `CheckoutItemDto`의 데코레이터가 하나도 실행되지 않는다.

`@Type(() => CheckoutItemDto)`가 원소를 그 클래스 인스턴스로 바꿔 줘야 안쪽 검증까지 돈다.

### 작업 2. 트랜잭션 없이 checkout 짜기

먼저 가장 직관적인 방법으로 짠다. 상품을 읽고, 재고를 확인하고, 줄이고, 주문을 만든다.

```ts
// src/orders/orders.service.ts
// import에 ConflictException과 CheckoutItemDto 타입을 추가하고, 메서드를 하나 추가한다
import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { CheckoutItemDto } from "./dto/checkout.dto.js";
// ...
  // 2단계: 트랜잭션 없이 짠 결제
  async checkout(userId: string, items: CheckoutItemDto[]) {
    // 필요한 상품을 한 번에 가져온다(08의 N+1을 기억하자)
    const products = await this.prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
    let total = 0;
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw new NotFoundException(`product ${item.productId} not found`);
      // 읽고 → 판단하고 → (앱에서 계산한 값을) 쓴다
      if (product.stock < item.quantity) throw new ConflictException(`재고 부족: ${product.name}`);
      await this.prisma.product.update({ where: { id: product.id }, data: { stock: product.stock - item.quantity } });
      total += product.price * item.quantity;
    }
    // 주문과 품목을 한 번에 만든다
    const order = await this.prisma.order.create({
      data: {
        userId, price: total, paid: true, // 결제 대행사 연동은 범위 밖이라, 결제는 항상 성공한 것으로 친다
        items: { create: items.map((i) => ({
          productId: i.productId, quantity: i.quantity, unitPrice: products.find((p) => p.id === i.productId)!.price,
        })) },
      },
      select: { ...orderSelect, items: { select: { productId: true, quantity: true, unitPrice: true } } },
    });
    const result = { ...toOrder(order), items: order.items };
    this.logger.log(`결제 완료: #${result.id} (${result.user}) ${result.price}원`);
    this.notifications.notifyUser(userId, "order.created", result);
    return result;
  }
```

### 작업 3. 컨트롤러에 checkout 엔드포인트 연결

```ts
// src/orders/orders.controller.ts
// import에 CheckoutDto를 추가하고, @Get(":id")보다 위에 넣는다
  @Post("checkout")
  @UseGuards(AuthGuard("jwt"))
  checkout(@Body() dto: CheckoutDto, @Req() req: Request) {
    const userId = (req.user as { userId: string }).userId; // 주문자는 토큰의 주인이다
    return this.ordersService.checkout(userId, dto.items);
  }
```

`@Get(":id")`보다 위에 두는 것은 이번에는 습관일 뿐이다. Nest(Express)는 경로를 등록한 순서대로 맞춰 보지만, HTTP 메서드가 같은 것끼리만 경쟁한다.

`checkout`은 `POST`라서 `GET`인 `:id`와 겹치지 않는다. 경로가 빈 `@Post()`도 정확히 `/orders`에만 맞으므로 충돌하지 않는다.

순서가 진짜 의미를 갖는 것은 같은 메서드끼리일 때다.

이미 있는 `@Get("totals")`를 `@Get(":id")` 아래로 옮기면, `GET /orders/totals`를 `:id`가 먼저 잡아 `"totals"`를 숫자로 바꾸려다 400 `Validation failed (numeric string is expected)`로 끝난다.

그래서 고정 경로는 `:id` 같은 변수 경로보다 위에 두는 습관을 들인다.

### 작업 4. 로그인 토큰으로 결제해 보기

`TOKEN`에 로그인 토큰을 담아 두고 요청한다.

```sh
# 로그인 응답에서 accessToken만 꺼내 TOKEN에 담는다
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"items":[{"productId":1,"quantity":1}]}'
{"id":6,"user":"kim","price":150000,"paid":true,"items":[{"productId":1,"quantity":1,"unitPrice":150000}]}% # 201

curl localhost:4000/products
[{"id":1,"name":"한정판 키보드","price":150000,"stock":9},{"id":2,"name":"마우스","price":30000,"stock":100}]%
```

### 용어 | class-validator 데코레이터

- `@ArrayUnique(기준 함수)`: 기준 함수가 돌려준 값(`productId`)이 겹치는 원소가 있으면 거부한다.

- `@ValidateNested({ each: true })`: 배열의 각 원소에도 그 클래스의 검증을 실행한다.

- `@Type(() => 클래스)`(class-transformer): 들어온 JSON의 중첩 객체를 어떤 클래스로 바꿀지 알려 준다.

### 용어 | Prisma Client API (조회 조건·중첩 쓰기)

- `where: { id: { in: [...] } }`: SQL의 `WHERE id IN (...)`이다.

- 중첩 쓰기(`items: { create: [...] }`): 주문을 만들면서 관계된 `order_items` 행도 함께 INSERT한다.

### 실험 | 일부러 깨뜨려보기 ①: 반쪽 상태

키보드 1개와 마우스 1000개(재고 100)를 한 번에 결제한다.

```sh
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"items":[{"productId":1,"quantity":1},{"productId":2,"quantity":1000}]}'
{"message":"재고 부족: 마우스","error":"Conflict","statusCode":409}
```

```sh
curl localhost:4000/products
[{"id":1,"name":"한정판 키보드","price":150000,"stock":8},{"id":2,"name":"마우스","price":30000,"stock":100}]% # 9에서 8로 줄었다
```

결제는 실패했는데 키보드 재고는 줄었다. 반복문이 키보드를 먼저 처리해서 `UPDATE`를 이미 DB에 반영한 뒤에 마우스에서 예외가 났기 때문이다.

팔린 키보드는 1개(첫 주문)인데 재고는 2개가 줄었다. 재고 장부가 깨졌다.

> 쿼리 하나하나는 각자 성공하고 바로 반영되므로, "여기까지 한 일을 없던 걸로"라는 개념 자체가 없다.

### 남길 것

- **찾아보면 되는 것**: `@ArrayUnique`, `@ValidateNested({ each: true })`, `@Type(() => 클래스)`, `{ in: [...] }`, 중첩 쓰기(`items: { create: [...] }`)의 모양. 외울 필요 없다.

- **감각으로 남겨야 할 것**:

  - 트랜잭션 없이 쿼리를 여러 개 쓰면 쿼리마다 바로 반영된다. 중간에 예외가 나도 앞의 `UPDATE`는 되돌아가지 않는다.

  - 배열 안 객체의 검증은 `@ValidateNested`만으로는 돌지 않는다. `@Type`이 원소를 클래스 인스턴스로 바꿔야 안쪽 데코레이터가 실행된다.

- **에러 신호**:

  - `409 재고 부족: 마우스`인데 키보드 재고가 줄어 있다 → 쿼리들이 한 트랜잭션에 묶여 있는지

  - 같은 상품 두 줄짜리 요청이 400이 아니라 409 "이미 존재하는 값이다" → DTO의 `@ArrayUnique`

## 4. 3단계: 트랜잭션으로 묶기

`this.prisma.$transaction(async (tx) => { ... })`에 넘긴 함수 안의 쿼리는 전부 하나의 트랜잭션(`BEGIN` ... `COMMIT`)으로 실행된다. 함수가 정상적으로 끝나면 커밋되고, 예외를 던지면 롤백된다.

이렇게 함수를 넘기는 방식을 대화형(interactive) 트랜잭션이라고 부른다. 앞에서 읽은 값을 보고 다음 쿼리를 정할 수 있기 때문이다.

### 작업 1. checkout을 $transaction으로 감싸기

```ts
// src/orders/orders.service.ts
// checkout을 이렇게 바꾼다
  async checkout(userId: string, items: CheckoutItemDto[]) {
    // tx : 이 트랜잭션 전용 클라이언트. 안에서는 this.prisma 대신 반드시 tx로 쿼리한다
    const result = await this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
      let total = 0;
      for (const item of items) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) throw new NotFoundException(`product ${item.productId} not found`);
        if (product.stock < item.quantity) throw new ConflictException(`재고 부족: ${product.name}`); // → 롤백
        await tx.product.update({ where: { id: product.id }, data: { stock: product.stock - item.quantity } });
        total += product.price * item.quantity;
      }
      const order = await tx.order.create({ /* 2단계와 같다 */ });
      return { ...toOrder(order), items: order.items }; // 함수가 정상 종료 → 커밋. 반환값이 result가 된다
    });
    // 알림은 커밋이 끝난 "다음에" 보낸다
    // 커밋 전에 보내면 롤백된 주문의 알림이 나갈 수 있다
    this.logger.log(`결제 완료: #${result.id} (${result.user}) ${result.price}원`);
    this.notifications.notifyUser(userId, "order.created", result);
    return result;
  }
```

**`tx` 대신 `this.prisma`를 쓰면 안 된다.**

`this.prisma`는 커넥션 풀의 다른 커넥션을 쓰기 때문에, 그 쿼리는 이 트랜잭션 밖에서 따로 실행되고 따로 커밋된다.

롤백해도 안 돌아간다.

> 트랜잭션은 커넥션 하나에 묶여 있다는 걸 기억한다.

### 작업 2. 깨뜨려보기 ①을 다시 보내 롤백 확인

```sh
npx prisma db seed # 재고를 10/100으로 되돌린다
# (서버 재시작 없이) 깨뜨려보기 ①의 요청을 다시 보낸다
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"items":[{"productId":1,"quantity":1},{"productId":2,"quantity":1000}]}'
{"message":"재고 부족: 마우스","error":"Conflict","statusCode":409}%
```
```sh
curl localhost:4000/products
[{"id":1,"name":"한정판 키보드","price":150000,"stock":10},{"id":2,"name":"마우스","price":30000,"stock":100}]%
# 키보드 stock 10. 마우스에서 실패하자 키보드의 UPDATE도 함께 롤백됐다
```

### 남길 것

- **찾아보면 되는 것**: `this.prisma.$transaction(async (tx) => { ... })`의 모양. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 트랜잭션은 커넥션 하나에 묶여 있다. 콜백 안에서 `tx` 대신 `this.prisma`로 쓴 쿼리는 다른 커넥션에서 따로 커밋되고, 롤백해도 돌아가지 않는다.
  
  - DB 밖으로 나가는 일(알림)은 커밋이 끝난 다음에 둔다.

- **에러 신호**:
  
  - 409로 롤백됐는데 일부 변경이 남아 있다 → 콜백 안에서 `tx` 대신 `this.prisma`를 쓴 쿼리

## 5. 4단계: 일부러 깨뜨려보기 ②, 동시에 50명이 산다

한 번에 하나씩 보내는 `curl`로는 경쟁 조건이 안 보인다.

동시 요청을 쏘고, API를 거치지 않고 DB에서 직접 장부를 맞춰 보는 스크립트를 만든다.

### 작업 1. 동시 요청 스크립트 만들기

```js
// scripts/stampede.mjs
// 같은 결제 요청을 동시에 N개 보내고, 결과와 재고 장부가 맞는지 확인한다
// 사용법: node scripts/stampede.mjs [요청 수] [items JSON]
//   node scripts/stampede.mjs 50
//   node scripts/stampede.mjs 50 '[{"productId":1,"quantity":1},{"productId":2,"quantity":1}]'
// pg : Prisma가 내부에서 쓰는 PostgreSQL 드라이버. 여기서는 SQL을 직접 보내려고 쓴다
import pg from "pg";

process.loadEnvFile(); // .env의 DATABASE_URL, DEMO_PASSWORD를 읽는다
const API = "http://localhost:4000";
const N = Number(process.argv[2] ?? 50);
const items = JSON.parse(process.argv[3] ?? '[{"productId":1,"quantity":1}]');

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const { accessToken } = await login.json();

// N개의 요청을 한꺼번에 출발시킨 뒤, 전부 끝날 때까지 기다린다
const statuses = await Promise.all(
  Array.from({ length: N }, () =>
    fetch(`${API}/orders/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ items }),
    }).then((r) => r.status),
  ),
);
const tally = statuses.reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
console.log("응답 코드별 개수:", tally);

// API를 거치지 않고 DB에서 직접 장부를 맞춰 본다: 남은 재고 + 팔린 수량 = 처음 재고여야 한다
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query(`
  SELECT p.id, p.name, p.stock AS "남은 재고", COALESCE(SUM(oi.quantity), 0)::int AS "팔린 수량"
  FROM products p LEFT JOIN order_items oi ON oi.product_id = p.id
  GROUP BY p.id ORDER BY p.id`);
console.table(rows);
await db.end();
```

### 실험 | 재고 10개에 동시 결제 50건

```sh
npx prisma db seed

node scripts/stampede.mjs 50
응답 코드별 개수: { '201': 50 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 6         │ 50        │
│ 1       │ 2  │ '마우스'        │ 100       │ 0         │
└─────────┴────┴─────────────────┴───────────┴───────────┘

node scripts/stampede.mjs 50
응답 코드별 개수: { '201': 46, '409': 4 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 3         │ 96        │
│ 1       │ 2  │ '마우스'        │ 100       │ 0         │
└─────────┴────┴─────────────────┴───────────┴───────────┘

node scripts/stampede.mjs 50
응답 코드별 개수: { '201': 29, '409': 21 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 0         │ 125       │
│ 1       │ 2  │ '마우스'        │ 100       │ 0         │
└─────────┴────┴─────────────────┴───────────┴───────────┘
```

재고 10개짜리 키보드가 50개 팔렸다. 그런데 재고는 0도 아니고 5다(돌릴 때마다 3, 5, 6처럼 달라진다). 트랜잭션이 있는데도 그렇다.

### 개념 | 트랜잭션 안에서도 갱신 손실이 나는 이유

무슨 일이 있었는지 두 요청만 떼어 보면 이렇다.

| 시점 | 요청 A의 트랜잭션 | 요청 B의 트랜잭션 |
|---|---|---|
| 1 | `SELECT` → stock = 10 | |
| 2 | | `SELECT` → stock = 10 (A가 아직 커밋 전이라 옛 값이 보인다) |
| 3 | 10 ≥ 1 → `UPDATE stock = 9` | |
| 4 | `COMMIT` | |
| 5 | | 10 ≥ 1 → `UPDATE stock = 9` (A의 결과를 덮어쓴다) |
| 6 | | `COMMIT` → 둘 다 팔렸는데 재고는 1만 줄었다 |

0장 개념 1의 C 코드와 똑같다.

**앱이 읽은 값으로 계산해서 덮어쓰는 한, 트랜잭션은 이걸 막지 못한다.**

트랜잭션은 "A 안의 쿼리들이 전부 반영되거나 전부 취소된다"만 보장할 뿐, "A와 B가 줄을 서서 차례로 실행된다"를 보장하지는 않는다.

이것을 갱신 손실(lost update)이라고 부른다.

> 트랜잭션 없는 2단계 코드로 돌려도 결과는 비슷하다.  
> 대개 50개가 다 팔리고, 남는 재고는 돌릴 때마다 0~6 사이에서 달라진다(가끔은 40여 개만 팔리고 재고가 0이 된다).

### 남길 것

- **찾아보면 되는 것**: `Promise.all`로 요청을 한꺼번에 출발시키는 법, `pg.Client`로 SQL을 직접 보내는 법, `process.loadEnvFile()`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 트랜잭션은 "전부 아니면 전무"만 보장하고 "차례로 실행"은 보장하지 않는다. 앱이 읽은 값으로 계산해서 덮어쓰면 트랜잭션 안에서도 갱신 손실이 난다.
  
  - 동시성 버그는 응답 코드가 아니라 장부(남은 재고 + 팔린 수량 = 처음 재고)로 확인한다.

- **에러 신호**:
  
  - 응답은 `{ '201': 50 }`으로 전부 성공인데, 남은 재고 + 팔린 수량 ≠ 처음 재고 → 앱이 읽은 값으로 계산해서 덮어쓰는 곳

## 6. 5단계: 고치기 1, 판단과 쓰기를 UPDATE 한 문장으로

문제의 핵심은 "읽기"와 "쓰기" 사이의 틈이다. 

그러니 판단과 쓰기를 SQL 한 문장에 넣어 버린다. "재고가 충분하면 줄여라"를 DB에게 직접 시키는 것이다.

### 작업 1. 판단과 차감을 updateMany 한 문장으로

```ts
// src/orders/orders.service.ts
// checkout의 for 문 안
// if (product.stock < ...)와 tx.product.update(...) 두 줄을 이렇게 바꾼다
        // "재고가 충분하면 줄여라"를 UPDATE 한 문장으로 DB에 맡긴다
        const { count } = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } }, // 앱이 계산한 값이 아니다
        });
        if (count === 0) throw new ConflictException(`재고 부족: ${product.name}`);
```

### 작업 2. 실행된 SQL과 장부 확인

서버를 쿼리 로그가 켜진 상태로 다시 켠다. `PRISMA_LOG=query`는 쿼리가 실행될 때마다 그 SQL을 서버 터미널에 한 줄씩 찍게 한다. 켠 직후에는 아직 쿼리가 없으니 아무것도 찍히지 않는다.

```sh
# 터미널 1: 서버
PRISMA_LOG=query npm run start:dev
```

다른 터미널에서 재고를 되돌리고 동시 결제를 보낸다.

```sh
# 터미널 2
npx prisma db seed && node scripts/stampede.mjs 50
# 출력
🌱  The seed command has been executed.
응답 코드별 개수: { '201': 10, '409': 40 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 0         │ 10        │
│ 1       │ 2  │ '마우스'        │ 100       │ 0         │
└─────────┴────┴─────────────────┴───────────┴───────────┘
```

이때 터미널 1(서버)에는 결제 요청마다 이런 줄이 찍힌다. 시드는 서버와 별도 프로세스라 그 쿼리는 여기에 찍히지 않는다.

```text
prisma:query UPDATE "public"."products" SET "stock" = ("public"."products"."stock" - $1) WHERE ("public"."products"."id" = $2 AND "public"."products"."stock" >= $3)
```

상품 조회 `SELECT`와 주문 `INSERT`도 섞여 찍히지만, 볼 것은 이 줄이다. 재고 판단(`stock >= $3`)과 차감(`stock - $1`)이 한 문장 안에 들어 있다.

### 개념 | 조건부 UPDATE가 동시 요청에도 정확한 이유

몇 번을 돌려도 정확히 10건이다. 이유는 두 가지다.

1. `SET stock = stock - 1`은 앱이 들고 있던 옛 값이 아니라 그 순간 DB에 있는 값을 기준으로 계산한다.

2. `UPDATE`는 고치는 행에 잠금을 건다(0장 개념 3). B의 `UPDATE`가 같은 행에 오면 A가 커밋할 때까지 기다린다.

그리고 **기다림이 끝나면 PostgreSQL은 A가 커밋한 최신 행으로 `WHERE stock >= 1`을 다시 검사한다.**

재고가 0이 되는 순간부터 `WHERE`에 걸리는 행이 없어 `count`가 0이 되고, 409로 롤백된다.

### 용어 | Prisma Client API (조건부 갱신)

- `updateMany`: 조건에 맞는 행을 전부 고치고, 고친 행 수(`count`)를 돌려준다. 맞는 행이 없으면 0을 돌려준다. `update`가 아니라 이것을 쓴 이유는 아래 "`update`와 `updateMany`: 맞는 행이 없을 때"에서 다룬다.

- `{ gte: 값 }`: 크거나 같다(`>=`).

- `{ decrement: 값 }`: `stock = stock - 값`이다. 앱이 들고 있던 값이 아니라 DB의 현재 값을 기준으로 계산한다.

### 개념 | `update`와 `updateMany`: 맞는 행이 없을 때

고치는 행은 어차피 하나인데 왜 `updateMany`일까. 둘 다 같은 `UPDATE ... WHERE` 한 문장을 만들지만, **`WHERE`에 걸리는 행이 없을 때의 반응**이 다르다.

```ts
// update: 행을 못 찾으면 예외(P2025)를 던진다
await tx.product.update({
  where: { id: product.id, stock: { gte: item.quantity } },
  data: { stock: { decrement: item.quantity } },
});

// updateMany: 예외 없이 { count: 0 }을 돌려준다
const { count } = await tx.product.updateMany({
  where: { id: product.id, stock: { gte: item.quantity } },
  data: { stock: { decrement: item.quantity } },
});
```

`update`로 써도 재고는 지켜진다. 하지만 재고 부족이 `P2025`라는 "대상 행 없음" 에러로 올라오고, `08`에서 만든 `PrismaExceptionFilter`가 이것을 404 "대상을 찾을 수 없다"로 바꾼다. 상품은 있는데 404가 나가는 셈이다.

| | `update` | `updateMany` |
|---|---|---|
| `where` | 고유한 필드(`id`)가 반드시 있어야 한다 | 아무 조건이나 된다 |
| 맞는 행이 없을 때 | `P2025` 예외 | `{ count: 0 }` |
| 돌려주는 값 | 고친 행 | 고친 행 수 |

- 이 문서에서는 "조건에 안 맞음"이 정상적인 결과(재고 부족)라서 예외가 아닌 값으로 받고, 409를 직접 던진다.

- `count`를 확인하지 않으면 재고가 부족해도 아무 일 없이 다음 줄로 넘어간다. `updateMany`를 쓸 때는 `count` 검사가 짝으로 따라와야 한다.

> C의 `write()`가 실패를 예외가 아니라 반환값으로 알려 주는 것과 같다. 반환값을 무시하면 실패도 조용히 지나간다.

### 남길 것

- **찾아보면 되는 것**: `updateMany`, `{ gte: 값 }`, `{ decrement: 값 }`, `update`와 `updateMany`의 차이 표. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 판단을 `WHERE`에, 계산을 `SET stock = stock - n`으로 DB에 맡기면, 행 잠금을 기다린 뒤 최신 행으로 다시 검사하므로 동시 요청에도 정확하다.
  
  - `updateMany`는 실패를 예외가 아니라 `count: 0`으로 알려 준다. `count` 검사를 빼면 재고 부족이 조용히 지나간다.

- **에러 신호**:
  
  - 상품은 있는데 재고 부족이 404 "대상을 찾을 수 없다"(`P2025`) → `updateMany` + `count` 검사로 바꿨는지

## 7. 6단계: 일부러 깨뜨려보기 ③, 교착 상태

이번엔 상품 두 개를 같이 사는 요청을 동시에 보낸다.

단, 절반은 `[키보드, 마우스]` 순서로, 나머지 절반은 `[마우스, 키보드]` 순서로 보낸다.

재고 부족이 끼어들지 않게 재고를 넉넉히 채워 둔다.

### 실험 | 상품 두 개를 반대 순서로 동시에 결제

```sh
npx prisma db seed
# psql을 열지 않고 SQL 한 줄만 실행한다(-c)
docker compose exec db psql -U order -d order_api -c "UPDATE products SET stock = 1000"
# 끝의 &로 두 스크립트를 동시에 돌리고, wait로 둘 다 끝날 때까지 기다린다
node scripts/stampede.mjs 30 '[{"productId":1,"quantity":1},{"productId":2,"quantity":1}]' &
node scripts/stampede.mjs 30 '[{"productId":2,"quantity":1},{"productId":1,"quantity":1}]'; wait
```

```text
[1] 94279
응답 코드별 개수: { '500': 30 }
응답 코드별 개수: { '201': 3, '500': 27 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 997       │ 3         │
│ 1       │ 2  │ '마우스'        │ 997       │ 3         │
└─────────┴────┴─────────────────┴───────────┴───────────┘
[1]  + 94279 done       node scripts/stampede.mjs 30 
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 997       │ 3         │
│ 1       │ 2  │ '마우스'        │ 997       │ 3         │
└─────────┴────┴─────────────────┴───────────┴───────────┘
```

출력은 두 스크립트의 것과 셸의 것이 섞여 있다. 하나씩 읽으면 이렇다.

- `[1] 94279`: 스크립트가 아니라 셸이 찍은 줄이다. 첫 줄 끝의 `&`로 스크립트를 뒤에서(백그라운드) 돌리기 시작하면서 "1번 작업, 프로세스 ID(PID) 94279"라고 알려 준다. PID는 돌릴 때마다 다르다.

- `[1]  + 94279 done ...`: 역시 셸의 줄이다. 1번 작업(`&`로 띄운 첫 스크립트)이 끝났다는 알림이다.

- `응답 코드별 개수` 두 줄: 두 스크립트가 30건씩 보낸 결과다. 먼저 끝난 쪽이 먼저 찍히므로, 어느 줄이 어느 스크립트인지는 출력만으로 구분되지 않는다.

- 표 두 개: 스크립트마다 끝날 때 DB의 장부를 한 번씩 찍는다. 여기서는 둘 다 끝난 뒤의 모습이라 같다. 한쪽이 아직 돌고 있을 때 찍히면 다를 수 있고, 마지막 표가 최종 장부다.

읽을 것은 두 가지다.

1. **60건 중 3건만 성공하고 57건이 `500`이다.** 재고는 1000개로 넉넉하니 재고 부족 때문이 아니다. 몇 건이 살아남는지는 요청이 도착한 타이밍과 PC 속도에 따라 돌릴 때마다 다르다. 대부분이 `500`이고, 아래처럼 DB 로그에 `deadlock detected`가 찍혀 있으면 실험은 제대로 된 것이다.

2. **장부는 맞다.** 성공한 3건이 키보드와 마우스를 하나씩 샀으니 둘 다 남은 재고 997 + 팔린 수량 3 = 1000이다. 실패한 57건은 전부 롤백됐다. 교착은 장부를 깨뜨리지는 않지만, 멀쩡한 요청을 대부분 실패시킨다.

DB 로그를 본다. `docker compose logs db`만 치면 DB가 켜진 뒤의 로그가 전부 쏟아져서, 교착 기록이 체크포인트 같은 다른 로그 사이에 묻힌다.

화면 끝에는 마지막 교착의 꼬리(`HINT`·`CONTEXT`·`STATEMENT`)만 남아 있어 못 찾기 쉽다. `grep`으로 교착 기록만 골라 본다.

```sh
# 교착 기록마다 그 줄과 뒤 8줄을 보여 준다
docker compose logs db | grep -A8 "deadlock detected"

# 출력(교착 하나분)
db-1  | 2025-10-11 16:11:05.965 UTC [584] ERROR:  deadlock detected
db-1  | 2025-10-11 16:11:05.965 UTC [584] DETAIL:  Process 584 waits for ShareLock on transaction 1328; blocked by process 582.
db-1  | 	Process 582 waits for ShareLock on transaction 1339; blocked by process 584.
db-1  | 	Process 584: UPDATE "public"."products" SET "stock" = ("public"."products"."stock" - $1) WHERE ("public"."products"."id" = $2 AND "public"."products"."stock" >= $3)
db-1  | 	Process 582: UPDATE "public"."products" SET "stock" = ("public"."products"."stock" - $1) WHERE ("public"."products"."id" = $2 AND "public"."products"."stock" >= $3)
db-1  | 2025-10-11 16:11:05.965 UTC [584] HINT:  See server log for query details.
db-1  | 2025-10-11 16:11:05.965 UTC [584] CONTEXT:  while updating tuple (0,7) in relation "products"
db-1  | 2025-10-11 16:11:05.965 UTC [584] STATEMENT:  UPDATE "public"."products" SET "stock" = ("public"."products"."stock" - $1) WHERE ("public"."products"."id" = $2 AND "public"."products"."stock" >= $3)
```

교착 하나가 이렇게 여러 줄로 찍힌다. 교착이 여러 번 났으면 이런 묶음이 그 수만큼 이어진다.

- `ERROR`: 교착을 찾아냈다. 대괄호 안의 `[584]`는 DB 쪽 프로세스 번호이고, 이 프로세스(트랜잭션)가 희생돼 실패했다.

- `DETAIL`: 고리의 모양이다. 584는 582를, 582는 584를 기다린다. 그 아래 두 줄은 각 프로세스가 기다리던 문장이고, 둘 다 5단계의 조건부 `UPDATE`다. 고리에 끼는 프로세스 수는 그때그때 달라서 세 개 이상이 엮인 고리가 찍히기도 한다.

- `HINT`·`CONTEXT`·`STATEMENT`: 덧붙인 정보다. `STATEMENT`는 희생된 쪽이 실행하던 문장이다.

교착이 몇 번 났는지만 알고 싶으면 `docker compose logs db | grep -c "deadlock detected"`로 센다. 이전 실험의 기록도 함께 세어지니, 이번 실험만 세려면 실험 직후에 "최근 1분" 같은 시간 제한을 붙인다(`docker compose logs db --since 1m | grep -c "deadlock detected"`).

서버 콘솔에는 `500`마다 에러가 스택과 함께 찍힌다. 에러 코드는 두 종류다.

```sh
code: 'P2034'   Transaction failed due to a write conflict or a deadlock. Please retry your transaction
code: 'P2028'   Unable to start a transaction in the given time.  (가끔 ... expired transaction ... 5000 ms)
```

눈으로 세기 어려우니, 세어 보고 싶다면 서버를 켤 때 출력을 파일에도 남겨 두고 실험 뒤에 에러 코드만 뽑아 센다.

```sh
# 터미널 1: 출력을 화면에 보여 주면서 server.log에도 쓴다
npm run start:dev 2>&1 | tee server.log
# 터미널 2: 실험 뒤에
grep -o "code: 'P20[0-9]*'" server.log | sort | uniq -c
```

두 코드의 개수를 더하면 응답의 `500` 개수(위 출력이라면 57)와 맞아야 한다. 남는 `500`이 있으면 교착과 상관없는 다른 에러가 섞인 것이다.

### 개념 | 교착 상태가 커넥션 풀까지 무너뜨리는 과정

요청 A는 키보드 행을 잠그고 마우스 행을 기다린다. 요청 B는 마우스 행을 잠그고 키보드 행을 기다린다. 0장 개념 3의 mutex 두 개를 반대 순서로 잡은 바로 그 상황이다.

PostgreSQL은 기다림이 일정 시간(`deadlock_timeout`, 기본 1초) 이어지면 고리를 찾아내고, 그중 하나를 강제로 실패시켜 고리를 끊는다. 그게 `P2034`다.

피해는 거기서 끝나지 않는다. 교착을 감지하기까지 1초 동안, 기다리는 트랜잭션들이 커넥션을 쥔 채 멈춰 있다.

- 드라이버의 커넥션 풀은 크기가 정해져 있다(`pg` 기본 10개). 풀이 꽉 차면 새 요청은 트랜잭션을 시작할 커넥션을 못 얻는다.

- Prisma는 커넥션을 기다리는 시간(`maxWait`, 기본 2초)과 트랜잭션 전체 시간(`timeout`, 기본 5초)에 상한을 둔다. 이 상한을 넘긴 요청이 `P2028`이다.

그래서 `500`에는 교착에 직접 걸린 `P2034`뿐 아니라, 교착 때문에 커넥션을 못 얻은 `P2028`도 섞인다. 교착 자체는 몇 번 안 되는데 실패가 수십 건인 이유다.

> 교착 몇 번이 처리량 전체를 무너뜨렸다.

### 작업 1. 고치기: 잠그는 순서를 통일한다

어떤 순서로 주문하든 **상품 id 오름차순으로 처리하면 고리가 생길 수 없다.** 모두가 키보드(1)를 먼저 잠그고, 그다음 마우스(2)를 잠근다.

```ts
// src/orders/orders.service.ts
// checkout - for 문을 이렇게 바꾼다
      let total = 0;
      // 잠그는 순서를 항상 상품 id 오름차순으로 통일한다 → 서로 반대 순서로 기다리는 일이 생기지 않는다
      // 원본 items는 그대로 두고 복사본을 정렬한다
      const sorted = [...items].sort((a, b) => a.productId - b.productId);
      for (const item of sorted) {
```

`(a, b) => a.productId - b.productId`는 오름차순이다. 결과가 음수면 `a`가 앞에 온다. 내림차순(`b.productId - a.productId`)으로 바꿔도 교착은 똑같이 사라진다. 

중요한 것은 방향이 아니라 **모든 트랜잭션이 같은 순서를 쓰는 것**이다.

그래도 오름차순으로 정해 두는 이유는, 상품 행을 잠그는 다른 코드도 이 순서를 따라야 하기 때문이다.

SQL의 `ORDER BY id`는 기본이 오름차순이고, `SELECT ... ORDER BY id FOR UPDATE`도 이 순서로 잠근다.

한 곳만 내림차순이면 그 코드와 이 코드 사이에서 다시 고리가 생긴다.

실험을 다시 돌린다. 재고를 1000으로 되돌리는 것부터 같다.

```sh
npx prisma db seed
docker compose exec db psql -U order -d order_api -c "UPDATE products SET stock = 1000"
node scripts/stampede.mjs 30 '[{"productId":1,"quantity":1},{"productId":2,"quantity":1}]' &
node scripts/stampede.mjs 30 '[{"productId":2,"quantity":1},{"productId":1,"quantity":1}]'; wait
```

```text
[1] 95102
응답 코드별 개수: { '201': 30 }
응답 코드별 개수: { '201': 30 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 940       │ 60        │
│ 1       │ 2  │ '마우스'        │ 940       │ 60        │
└─────────┴────┴─────────────────┴───────────┴───────────┘
[1]  + 95102 done       node scripts/stampede.mjs 30 
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 940       │ 60        │
│ 1       │ 2  │ '마우스'        │ 940       │ 60        │
└─────────┴────┴─────────────────┴───────────┴───────────┘
```

60건 모두 성공했다. 60건이 각각 키보드와 마우스를 하나씩 샀으니 둘 다 남은 재고 940 + 팔린 수량 60 = 1000이다.

서버 콘솔에 에러가 하나도 없고, DB 로그에도 새 교착이 없다.

```sh
docker compose logs db --since 1m | grep -c "deadlock detected"
# 0
```

### 남길 것

- **찾아보면 되는 것**: `deadlock_timeout`(기본 1초), Prisma의 `maxWait`(2초)·`timeout`(5초), `pg` 풀 크기(기본 10). 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 여러 행을 잠그는 트랜잭션은 모두 같은 순서(상품 id 오름차순)로 잠가야 고리가 생기지 않는다.
  
  - 교착 몇 건이 커넥션을 쥔 채 멈추면 풀이 바닥나 나머지 요청까지 실패한다. 실패 대부분은 교착 자체가 아니라 그 여파(`P2028`)다.

- **에러 신호**:
  
  - `P2034` `Transaction failed due to a write conflict or a deadlock` → DB 로그의 `deadlock detected`, 잠그는 순서
  
  - `ERROR:  deadlock detected` (DB 로그) → `DETAIL`의 누가 누구를 기다렸는지(진단 5)
  
  - `P2028` `Unable to start a transaction in the given time.` → 커넥션 풀 고갈, 잠금 대기(진단 1), 오래 열린 트랜잭션(진단 2)

## 8. 7단계: 고치기 2, `SELECT ... FOR UPDATE`로 먼저 잠그고 읽기

5단계의 조건부 `UPDATE`는 판단이 "재고 ≥ 수량" 하나라서 `WHERE`에 넣을 수 있었다. 판단이 복잡해지면 어떨까.

예를 들어 "가격을 읽어 합계를 내고, 합계가 한도를 넘으면 거절한다"처럼 읽은 값으로 여러 가지를 판단해야 하면 `WHERE` 하나에 다 담을 수 없다.

그럴 때는 **읽는 순간에 미리 잠근다.** 다른 트랜잭션은 그 행을 잠그거나 고칠 수 없으니, 읽은 값이 커밋할 때까지 그대로임이 보장된다(0장 개념 3에서 mutex로 "읽고 → 판단하고 → 쓰기" 전체를 감싸던 것과 같다).

Prisma의 메서드에는 `FOR UPDATE` 옵션이 없다. 

그래서 `$queryRaw`로 SQL을 직접 쓴다. 최종 코드에서는 이 방식을 쓴다.

가격과 재고를 같은 잠금 아래에서 읽으니, 합계 계산에 쓴 가격도 결제 도중에 바뀌지 않는다.

### 작업 1. 상품을 FOR UPDATE로 잠그고 읽기

```ts
// src/orders/orders.service.ts
// checkout의 트랜잭션 안쪽을 이렇게 바꾼다
    const result = await this.prisma.$transaction(async (tx) => {
      // 중복 id를 없앤다
      const ids = [...new Set(items.map((i) => i.productId))];
      // 읽는 행을 id 순서대로 잠근다(6단계의 교착 상태 방지)
      const products = await tx.$queryRaw<{ id: number; name: string; price: number; stock: number }[]>`
        SELECT id, name, price, stock FROM products WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`;
      let total = 0;
      for (const item of items) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) throw new NotFoundException(`product ${item.productId} not found`);
        // 잠금을 쥐고 읽은 값이라, 커밋할 때까지 아무도 이 stock을 바꿀 수 없다 → 읽은 값으로 판단해도 안전하다
        if (product.stock < item.quantity) throw new ConflictException(`재고 부족: ${product.name}`);
        await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: item.quantity } } });
        total += product.price * item.quantity;
      }
      const order = await tx.order.create({ /* 2단계와 같다 */ });
      return { ...toOrder(order), items: order.items };
    });
```

잠금은 `SELECT` 한 문장이 `ORDER BY id` 순서대로 모두 건다. 그래서 반복문을 정렬할 필요가 없어졌다. 6단계의 교훈이 SQL 쪽으로 옮겨 간 것이다.

### 작업 2. 앞 단계의 실험 세 개를 다시 돌리기

잠그는 방식을 바꿨으니, 지금까지 고친 세 가지 문제가 여전히 고쳐져 있는지 확인한다. 실험마다 시드로 재고를 되돌리고 시작한다.

**① 동시 50건 (4단계의 갱신 손실)**: 재고 10개짜리에 정확히 10건만 팔려야 한다.

```sh
npx prisma db seed && node scripts/stampede.mjs 50
```

```sh
응답 코드별 개수: { '201': 10, '409': 40 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 0         │ 10        │
│ 1       │ 2  │ '마우스'        │ 100       │ 0         │
└─────────┴────┴─────────────────┴───────────┴───────────┘
```

5단계와 결과는 같지만 지켜지는 이유가 다르다. 

5단계에서는 `UPDATE`의 `WHERE`가 최신 재고로 다시 검사했다.

이번에는 `FOR UPDATE`로 먼저 잠근 요청이 끝날 때까지 다른 요청이 같은 행을 읽지도 못하고 기다린다.

**② 반대 순서 동시 실행 (6단계의 교착 상태)**: `ORDER BY id`가 잠금 순서를 맞춰 주므로 반복문을 정렬하지 않아도 교착이 없어야 한다.

```sh
npx prisma db seed
docker compose exec db psql -U order -d order_api -c "UPDATE products SET stock = 1000"
node scripts/stampede.mjs 30 '[{"productId":1,"quantity":1},{"productId":2,"quantity":1}]' &
node scripts/stampede.mjs 30 '[{"productId":2,"quantity":1},{"productId":1,"quantity":1}]'; wait
docker compose logs db --since 1m | grep -c "deadlock detected"
```

```sh
응답 코드별 개수: { '201': 30 }
응답 코드별 개수: { '201': 30 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 940       │ 60        │
│ 1       │ 2  │ '마우스'        │ 940       │ 60        │
└─────────┴────┴─────────────────┴───────────┴───────────┘
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 940       │ 60        │
│ 1       │ 2  │ '마우스'        │ 940       │ 60        │
└─────────┴────┴─────────────────┴───────────┴───────────┘
# docker compose logs db --since 1m | grep -c "deadlock detected" 출력
0 # 최근 1분 동안 DB 로그의 교착 기록 수다.
```

**③ 중간 실패 (2단계의 반쪽 상태)**: 마우스에서 실패하면 키보드의 차감도 함께 롤백돼야 한다. 토큰은 1시간 뒤 만료되니, 401이 나면 2단계 작업 4의 `TOKEN=...` 줄로 다시 받는다.

```sh
npx prisma db seed
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"items":[{"productId":1,"quantity":1},{"productId":2,"quantity":1000}]}'
{"message":"재고 부족: 마우스","error":"Conflict","statusCode":409}

```sh
curl localhost:4000/products
[{"id":1,"name":"한정판 키보드","price":150000,"stock":10},{"id":2,"name":"마우스","price":30000,"stock":100}]%
```

409인데 키보드 재고가 10 그대로면 된다.

### 용어 | SQL (행 잠금·배열 매개변수)

- `FOR UPDATE`: 읽은 행에 쓰기 잠금을 건다(0장 개념 3의 행 잠금). 이 트랜잭션이 끝날 때까지 다른 트랜잭션은 이 행을 잠그거나 고칠 수 없다.

- `WHERE id = ANY($1)`: 배열 매개변수를 받는 PostgreSQL식 `IN`이다. `IN`을 쓰면 안 되는 이유는 아래 "태그드 템플릿: 값이 SQL 문자열에 섞이지 않는 이유"에서 다룬다.

### 용어 | Prisma Client API (원시 SQL)

- `$queryRaw<타입>`: SQL을 직접 실행하고 결과 행을 돌려준다. Prisma가 SQL을 해석하지 않으므로 결과 행의 모양을 타입으로 직접 알려 준다. `${ids}`가 어떻게 안전하게 들어가는지는 아래에서 다룬다.

### 개념 | 태그드 템플릿: 값이 SQL 문자열에 섞이지 않는 이유

`` tx.$queryRaw`...` ``는 함수 호출이다. 템플릿 문자열 앞에 함수 이름을 붙이면(태그드 템플릿), JS는 문자열을 완성하지 않고 **고정된 글자 조각들과 `${}` 안의 값들을 따로따로** 그 함수에 넘긴다.

```js
function sql(strings, ...values) {
  console.log(strings);
  console.log(values);
}
const ids = [1, 2];
sql`SELECT id FROM products WHERE id = ANY(${ids}) ORDER BY id`;
// 출력:
// [ 'SELECT id FROM products WHERE id = ANY(', ') ORDER BY id' ]
// [ [ 1, 2 ] ]
```

`$queryRaw`도 이렇게 받은 조각들을 `$1`, `$2`로 이어 붙여 SQL을 만들고, 값은 SQL 문자열과 별도로 DB에 보낸다.

11단계 진단 3의 쿼리 로그에 `WHERE id = ANY($1)`로 찍히는 이유다.

값이 `1; DROP TABLE products` 같은 문자열이어도 DB는 그것을 SQL로 해석하지 않고 값 하나로만 다룬다.

| 쓰는 법 | 값이 들어가는 방식 | 안전한가 |
|---|---|---|
| `` $queryRaw`... ${id}` `` | `$1` 매개변수로 따로 보낸다 | 안전 |
| `$queryRawUnsafe("... " + id)` | SQL 문자열에 그대로 이어 붙인다 | 인젝션 위험 |

- `${ids}` 하나는 매개변수 하나다. `WHERE id IN (${ids})`로 쓰면 `IN ($1)`에 배열 하나가 통째로 들어가서, PostgreSQL이 그 배열을 정수 하나로 읽으려다 에러를 낸다. 배열은 `= ANY(${ids})`로 받는다.

- `<{ id: number; ... }[]>`는 Prisma에게 "결과가 이 모양일 것"이라고 알려 주는 선언일 뿐, 실제 결과를 검사하지 않는다. `SELECT`의 컬럼과 어긋나지 않게 직접 맞춰야 한다.

> C로 치면 `sprintf`로 SQL을 만들지 않고, `?` 자리표시자와 값을 따로 넘기는 prepared statement를 쓰는 것과 같다.

### 개념 | 세 가지 방법 비교

| | 조건부 `UPDATE` (5단계) | `SELECT ... FOR UPDATE` (7단계) | 낙관적 잠금 |
|---|---|---|---|
| 방식 | 판단을 `WHERE`에 넣는다 | 읽을 때 잠그고, 앱에서 판단한다 | 잠그지 않고, 쓸 때 `version` 컬럼이 그대로인지 확인한다. 바뀌었으면 처음부터 재시도 |
| 맞는 경우 | 판단이 단순할 때(재고 차감) | 읽은 값으로 여러 가지를 판단해야 할 때 | 충돌이 드물고, 잠금 대기를 피하고 싶을 때 |
| 대가 | `WHERE`로 표현 못 하는 판단은 불가 | 잠금 대기, 순서를 잘못 잡으면 교착 | 충돌이 잦으면 재시도가 폭주한다 |

선착순 특가처럼 같은 행에 충돌이 몰리는 상황에는 비관적 방식(잠금)이 맞다.

> 낙관적 잠금은 이 문서에서 구현하지 않는다. 5단계의 조건부 `UPDATE`가 사실상 "쓸 때 조건을 확인한다"는 같은 발상이라는 것만 짚어 둔다.

### 남길 것

- **찾아보면 되는 것**: `$queryRaw<타입>`의 모양, `= ANY(${ids})`, `$queryRawUnsafe`와의 차이. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 읽은 값으로 여러 가지를 판단해야 하면 `SELECT ... FOR UPDATE`로 읽는 순간 잠근다. `ORDER BY id`가 6단계의 잠금 순서를 SQL로 옮긴다.
  
  - `$queryRaw`의 `${}`는 매개변수로 따로 가서 인젝션이 안 되지만, `<타입>`은 결과를 검사하지 않는 선언일 뿐이다.

- **에러 신호**:
  
  - `WHERE id IN (${ids})`로 쓴 쿼리가 에러로 실패한다 → `= ANY(${ids})`로 바꿨는지

## 9. 8단계: 멱등성, 같은 요청이 두 번 와도 한 번만

### 실험 | 일부러 깨뜨려보기 ④: 같은 요청 두 번

0장 개념 4의 "타임아웃 후 재시도"를 흉내 내, 같은 요청을 두 번 보낸다.

요청에는 2단계 작업 4에서 받은 `$TOKEN`이 필요하다. 토큰은 1시간이면 만료되고(`auth.module.ts`의 `expiresIn: "1h"`), 셸 변수라서 터미널 창마다 따로다.

시간이 지났거나 새 터미널이면 `{"message":"Unauthorized","statusCode":401}`가 나므로, 먼저 다시 받아 둔다.

```sh
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
```

```sh
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"items":[{"productId":2,"quantity":1}]}'

# {"id":6,...} → 201
# 같은 명령을 한 번 더
# {"id":7,...} → 201   ← 주문이 두 개, 결제도 두 번
```

서버 입장에서 두 요청은 완전히 같다. "이건 아까 그 요청의 재시도다"라는 정보가 요청 안에 없으면 구별할 수 없다.

그 정보를 클라이언트가 붙여 보내게 하는 것이 `Idempotency-Key` 헤더다.

- 클라이언트는 결제 버튼을 누를 때 고유한 키(보통 UUID)를 하나 만들고, 재시도할 때도 같은 키를 쓴다.

- 서버는 키별로 "이미 처리했으면 그때의 응답"을 돌려준다.

### 작업 1. IdempotencyKey 모델 추가

```prisma
// prisma/schema.prisma에 추가
model IdempotencyKey {
  userId      String   @map("user_id")
  key         String
  // 요청 본문의 지문(해시). 같은 키로 다른 요청을 보낸 실수를 잡는다
  requestHash String   @map("request_hash")
  // 처음 처리했을 때의 응답
  response    Json?
  createdAt   DateTime @default(now()) @map("created_at")

  // 키는 "사용자별로" 유일하다 → 다른 사용자가 우연히(또는 일부러) 같은 키를 보내도 남의 응답을 받지 못한다
  @@id([userId, key])
  @@map("idempotency_keys")
}
```

```sh
npx prisma migrate dev --name add-idempotency-keys
npx prisma generate
```

시드의 `TRUNCATE` 목록 맨 앞에 `idempotency_keys`를 추가한다.

```ts
// prisma/seed.ts
// TRUNCATE 한 줄만 이렇게 바꾼다
await prisma.$executeRaw`TRUNCATE idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
```

`CASCADE`는 외래키로 엮인 테이블만 따라가서 비운다.

`IdempotencyKey`에는 다른 모델과의 관계(`@relation`)가 없으므로 `users`를 비워도 함께 비워지지 않는다. 목록에 직접 적어야 한다.

빼먹으면 시드를 다시 돌려도 지난 실험의 키가 남는다.

같은 키로 요청하면 이미 지워진 주문의 옛 응답(`"id":6` 같은 것)이 그대로 돌아와, 새로 만든 주문과 번호가 엇갈린다.

반대로 `outbox_events`는 아직 넣지 않는다. 그 테이블은 9단계에서 만든다.

없는 테이블을 목록에 넣으면 시드가 `relation "outbox_events" does not exist`로 실패한다.

### 개념 | 이름은 두 벌이다: Prisma 쪽 이름과 DB 쪽 이름

스키마의 이름 중 어떤 것은 DB에 그대로 가고, 어떤 것은 Prisma 안에서만 쓰인다.

오타를 고칠 때 마이그레이션이 필요한지는 이것으로 갈린다.

| 스키마에 쓴 것 | 어디의 이름인가 | 고치면 |
|---|---|---|
| `model IdempotencyKey` | Prisma Client의 이름(`tx.idempotencyKey`, 타입 `IdempotencyKey`) | `npx prisma generate`만 다시 한다. DB는 그대로다 |
| `@@map("idempotency_keys")` | DB의 테이블 이름 | 마이그레이션이 필요하다 |
| 필드 `requestHash` | Prisma Client의 필드 이름 | `generate`만 다시 한다 |
| `@map("request_hash")` | DB의 컬럼 이름 | 마이그레이션이 필요하다 |

예를 들어 모델 이름을 `IdempotencKey`로 잘못 쳤다면, 고친 뒤 `generate`만 하면 된다.

`@@map`이 있어서 DB 테이블 이름은 처음부터 `idempotency_keys`였기 때문이다.

반대로 `@map("uint_price")`처럼 `@map` 안의 글자가 틀렸다면 DB 컬럼 이름 자체가 틀린 것이라, 고친 뒤 마이그레이션으로 `RENAME COLUMN`을 해야 한다.

주의할 것이 하나 있다. **`@@map`·`@map`이 없으면 모델·필드 이름이 곧 DB 이름이다.**

그때 모델 이름을 바꾸면 Prisma는 "이름이 바뀌었다"가 아니라 "옛 테이블이 사라지고 새 테이블이 생겼다"로 읽어, 옛 테이블을 지우고 새로 만드는 마이그레이션을 만든다. 데이터가 날아간다.

고친 뒤 DB와 달라진 것이 있는지는 마이그레이션을 만들기 전에 확인할 수 있다.

```sh
# 지금 DB와 schema.prisma를 비교해, 맞추려면 필요한 SQL을 보여 준다(실행하지는 않는다)
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# -- This is an empty migration.   ← DB는 바꿀 것이 없다. generate만 하면 된다
```

모델 이름을 고쳤다면 `generate` 뒤에 그 이름을 쓰는 코드(`tx.idempotencKey` → `tx.idempotencyKey`)도 함께 바뀌어야 한다.

옛 이름이 남아 있으면 TypeScript가 컴파일 에러로 알려 준다.

### 용어 | Prisma 스키마 문법 (Json)

- `Json`: PostgreSQL의 JSONB 컬럼이다. `?`를 붙이면 NULL을 허용한다.

### 개념 | 키를 트랜잭션 맨 앞에서 기록한다

**설계의 핵심은 키를 "트랜잭션 맨 앞에서" 기록하는 것이다.** 같은 키로 두 요청이 동시에 오면 어떻게 될까.

1. A가 키 행을 `INSERT`한다(아직 커밋 전).

2. B도 같은 기본키로 `INSERT`하려 하면, PostgreSQL은 B를 A가 끝날 때까지 기다리게 한다.

3. A가 커밋하면 B는 UNIQUE 위반(`P2002`)으로 실패하고, A가 롤백하면 B는 그대로 진행한다.

6단계에서 다룬 잠금이 여기서도 일한다. 별도의 "처리 중" 상태를 만들지 않아도 DB가 줄을 세워 준다.

### 작업 2. checkout에 멱등성 키 처리 넣기

```ts
// src/orders/orders.service.ts
import { createHash } from "node:crypto";
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
// ...

// interface였던 Order를 type으로 바꾼다(아래 설명)
export type Order = { id: number; user: string; price: number; paid: boolean };
export type CheckoutResult = Order & { items: { productId: number; quantity: number; unitPrice: number }[] };

// ...
  // 8단계: Idempotency-Key가 있으면 "같은 키의 두 번째 요청"에는 처음 응답을 그대로 돌려준다
  async checkout(userId: string, items: CheckoutItemDto[], idempotencyKey?: string): Promise<CheckoutResult> {
    // 요청 본문의 지문. 같은 키로 "다른" 요청을 보낸 실수를 잡아내는 데 쓴다
    const requestHash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // 키를 "맨 먼저" 기록한다. (user_id, key)가 기본키라, 같은 키의 두 번째 INSERT는
        // 첫 번째 트랜잭션이 끝날 때까지 기다렸다가 → 첫 번째가 커밋했으면 UNIQUE 위반(P2002)으로 실패한다
        if (idempotencyKey) {
          await tx.idempotencyKey.create({ data: { userId, key: idempotencyKey, requestHash } });
        }
        const placed = await this.placeOrder(tx, userId, items);
        if (idempotencyKey) {
          // 주문과 "그 주문에 대한 응답"을 같은 트랜잭션에서 저장한다 → 둘 중 하나만 남는 일이 없다
          await tx.idempotencyKey.update({
            where: { userId_key: { userId, key: idempotencyKey } }, data: { response: placed },
          });
        }
        return placed;
      });
      this.logger.log(`결제 완료: #${result.id} (${result.user}) ${result.price}원`);
      this.notifications.notifyUser(userId, "order.created", result);
      return result;
    } catch (err) {
      // 같은 키가 이미 커밋돼 있다 → 처음 응답을 찾아 돌려준다
      if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const saved = await this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key: idempotencyKey } } });
        if (saved) {
          if (saved.requestHash !== requestHash) {
            throw new UnprocessableEntityException("같은 Idempotency-Key로 다른 내용의 요청을 보냈다");
          }
          this.logger.log(`멱등 재응답: key=${idempotencyKey}`);
          return saved.response as CheckoutResult; // 주문을 다시 만들지 않고, 처음 응답을 그대로 돌려준다
        }
      }
      throw err; // 그 밖의 에러는 원래대로(PrismaExceptionFilter가 처리)
    }
  }

  // 7단계의 결제 로직을 그대로 옮긴 메서드. 바깥에서 받은 트랜잭션(tx) 안에서만 실행된다
  private async placeOrder(tx: Prisma.TransactionClient, userId: string, items: CheckoutItemDto[]): Promise<CheckoutResult> {
    // 7단계의 $transaction 콜백 본문 그대로다. 바뀐 것은 tx를 매개변수로 받는다는 점뿐이다
    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await tx.$queryRaw<{ id: number; name: string; price: number; stock: number }[]>`
      SELECT id, name, price, stock FROM products WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`;
    let total = 0;
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw new NotFoundException(`product ${item.productId} not found`);
      if (product.stock < item.quantity) throw new ConflictException(`재고 부족: ${product.name}`);
      await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: item.quantity } } });
      total += product.price * item.quantity;
    }
    const order = await tx.order.create({
      data: {
        userId, price: total, paid: true,
        items: { create: items.map((i) => ({
          productId: i.productId, quantity: i.quantity, unitPrice: products.find((p) => p.id === i.productId)!.price,
        })) },
      },
      select: { ...orderSelect, items: { select: { productId: true, quantity: true, unitPrice: true } } },
    });
    return { ...toOrder(order), items: order.items };
  }
```

`placeOrder`로 빼낸 이유는 `checkout`이 길어져서만이 아니다.

키 기록 → 주문 → 응답 저장이 **한 트랜잭션** 안에 있어야 하므로, 주문 부분은 새 트랜잭션을 열지 않고 바깥의 `tx`를 받아서 쓴다.

`placeOrder` 안에서 `this.prisma`를 쓰면 3단계에서 본 것처럼 트랜잭션 밖으로 새어 나간다.

`Prisma.TransactionClient`는 `$transaction` 콜백이 받는 `tx`의 타입이다.

`PrismaClient`에서 `$transaction`·`$connect` 같은 메서드를 뺀 모양이라, 그 안에서 트랜잭션을 또 열 수는 없다.

`interface`를 `type`으로 바꾼 이유가 있다.

`response`(Json 컬럼)에 넣으려면 값이 "아무 문자열 키에 JSON 값이 들어 있는 객체"(`{ [key: string]: JsonValue }`) 모양이어야 한다.

`type`으로 선언한 객체 타입은 이 모양에 맞는다고 인정되지만, `interface`는 나중에 다른 곳에서 필드가 덧붙을 수 있는(선언 병합) 열린 타입이라 인정되지 않는다.

바꾸지 않으면 `Type 'CheckoutResult' is not assignable to type ... InputJsonObject`라는 타입 에러가 난다.

### 작업 3. 컨트롤러에서 Idempotency-Key 헤더 받기

```ts
// src/orders/orders.controller.ts
// "@nestjs/common" import 목록에 Headers를 추가하고 checkout을 바꾼다
  @Post("checkout")
  @UseGuards(AuthGuard("jwt"))
  checkout(@Body() dto: CheckoutDto, @Req() req: Request, @Headers("idempotency-key") idempotencyKey?: string) {
    const userId = (req.user as { userId: string }).userId;
    return this.ordersService.checkout(userId, dto.items, idempotencyKey);
  }
```

키가 없으면 지금까지처럼 처리한다.

> 실제 결제 API라면 키를 필수로 요구하는 편이 안전하다.

### 작업 4. 같은 키, 다른 내용으로 보내 보기

같은 키로 세 번 보낸다. 처음 두 번은 내용이 같고, 세 번째는 수량만 다르다. 시드를 돌리면 주문이 5건으로 돌아가므로, 새 주문의 id는 6부터 시작한다. 401이 나면 실험 ④ 앞의 `TOKEN=...` 줄로 토큰을 다시 받는다.

```sh
npx prisma db seed

# ① 처음 보내는 키 → 주문을 만들고, 응답을 키와 함께 저장한다
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -H 'Idempotency-Key: order-abc' \
  -d '{"items":[{"productId":2,"quantity":1}]}'
# {"id":6,"user":"kim","price":30000,"paid":true,"items":[{"productId":2,"quantity":1,"unitPrice":30000}]} → 201

# ② 같은 키, 같은 내용 → 재시도로 보고, 주문을 만들지 않고 저장해 둔 응답을 돌려준다
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -H 'Idempotency-Key: order-abc' \
  -d '{"items":[{"productId":2,"quantity":1}]}'
# {"id":6,"paid":true,"user":"kim","items":[{"quantity":1,"productId":2,"unitPrice":30000}],"price":30000} → 201

# ③ 같은 키, 다른 내용(수량 5) → 요청 지문(requestHash)이 달라 거절한다
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -H 'Idempotency-Key: order-abc' \
  -d '{"items":[{"productId":2,"quantity":5}]}'
# {"message":"같은 Idempotency-Key로 다른 내용의 요청을 보냈다","error":"Unprocessable Entity","statusCode":422}
```

볼 것은 세 가지다.

- **①과 ②의 `id`가 둘 다 6이다.** ②는 새 주문을 만들지 않았다. 실험 ④에서는 같은 요청이 `id` 6, 7로 두 번 결제됐었다. 서버 콘솔에도 ②에서는 `결제 완료` 대신 `멱등 재응답: key=order-abc`가 찍힌다.

- **②의 필드 순서가 ①과 다르다.** ②는 새로 만든 응답이 아니라 `response`(JSONB) 컬럼에 저장해 둔 것을 꺼낸 것이다. JSONB는 저장할 때 키를 자기 방식대로 정렬한다. JSON 객체에서 키 순서는 의미가 없으므로 같은 응답이다.

- **③은 422로 끝나고 아무것도 바뀌지 않는다.** 클라이언트가 키를 재사용하는 실수를 했다는 신호다. 옛 응답을 돌려주면 수량 5를 주문한 줄 착각하게 되므로 거절한다.

DB에서도 확인한다. 주문은 하나만 늘었고, 키 행 하나에 그 주문의 응답이 들어 있어야 한다.

```sh
docker compose exec db psql -U order -d order_api \
  -c "SELECT count(*) FROM orders" \
  -c "SELECT user_id, key, response->>'id' AS order_id FROM idempotency_keys" \
  -c "SELECT id, stock FROM products ORDER BY id"
# 출력
 count 
-------
     6
(1 row)

 user_id |    key    | order_id 
---------+-----------+----------
 kim     | order-abc | 6
(1 row)

 id | stock 
----+-------
  1 |    10
  2 |    99
(2 rows)
```

### 용어 | Prisma Client API (복합키·트랜잭션 타입)

- `userId_key`: 복합 기본키 `@@id([userId, key])`로 한 행을 가리킬 때 Prisma가 만들어 주는 이름이다.

- `Prisma.TransactionClient`: `$transaction` 콜백이 넘겨주는 `tx`의 타입이다.

### 용어 | Node API

- `createHash("sha256").update(값).digest("hex")`: Node 내장 해시 함수다. 같은 입력이면 항상 같은 짧은 문자열(지문)을 만든다.

### 용어 | NestJS 데코레이터

- `@Headers("이름")`: 요청 헤더 값을 꺼낸다. 헤더 이름은 대소문자를 구분하지 않으므로 소문자로 적는다.

### 개념 | 실패한 요청은 기억하지 않는다

재고 부족으로 409가 나면 트랜잭션 전체가 롤백되니 키 행도 함께 사라진다. 그래서 재고가 채워진 뒤 같은 키로 재시도하면 정상 처리된다.

> "실패도 기억해서 계속 같은 실패를 돌려줄 것인가"는 API마다 정하는 정책이고, 여기서는 성공만 기억한다.

### 작업 5. 동시에 같은 키

`stampede.mjs`가 세 번째 인자로 키를 받도록 고친다.

```js
// scripts/stampede.mjs
// 사용법: node scripts/stampede.mjs [요청 수] [items JSON] [Idempotency-Key]
const idempotencyKey = process.argv[4];
// ... fetch의 headers를 이렇게 ...
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        // 키가 있을 때만 Idempotency-Key 헤더를 넣는다
        ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }),
      },
```

```sh
node scripts/stampede.mjs 20 '[{"productId":1,"quantity":1}]' same-key-1
응답 코드별 개수: { '201': 20 }
┌─────────┬────┬─────────────────┬───────────┬───────────┐
│ (index) │ id │ name            │ 남은 재고 │ 팔린 수량 │
├─────────┼────┼─────────────────┼───────────┼───────────┤
│ 0       │ 1  │ '한정판 키보드' │ 9         │ 1         │
│ 1       │ 2  │ '마우스'        │ 99        │ 1         │
└─────────┴────┴─────────────────┴───────────┴───────────┘
```

20개가 동시에 와도 키보드는 1개만 팔렸다. 서버 콘솔에는 `멱등 재응답: key=same-key-1`이 19번 찍힌다.

### 남길 것

- **찾아보면 되는 것**: `userId_key`(복합키 이름), `Prisma.TransactionClient`, `createHash("sha256")`, `@Headers("이름")`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 키를 트랜잭션 맨 앞에서 `INSERT`하면, 같은 키의 두 번째 요청은 기본키에 걸려 첫 번째가 끝날 때까지 기다린다. "처리 중" 상태를 따로 만들지 않아도 DB가 줄을 세운다.
  
  - 주문과 그 응답을 같은 트랜잭션에 저장한다. 실패해서 롤백되면 키도 함께 사라지므로 성공만 기억된다.

- **에러 신호**:
  
  - 같은 요청 두 번에 `201`이 두 번, 주문 id가 6, 7로 다르다 → `Idempotency-Key` 헤더
  
  - `P2002` → 멱등성 키라면 의도한 것(저장된 응답을 돌려주는 `catch` 경로). 아니라면 중복 데이터
  
  - 422 `같은 Idempotency-Key로 다른 내용의 요청을 보냈다` → 클라이언트가 키를 만드는 시점
  
  - `Type 'CheckoutResult' is not assignable to type ... InputJsonObject` → `interface`를 `type`으로

## 10. 9단계: outbox로 DB와 알림이 어긋나지 않게

지금 알림은 3단계에서 정한 대로 커밋한 다음에 보낸다.

이 위치가 왜 중요한지, 그리고 그것만으로 왜 부족한지 두 번 깨뜨려 본다. `scratch-client.mjs`를 다른 터미널에서 켜 둔다.

### 실험 | 일부러 깨뜨려보기 ⑤: 커밋 전에 보낸 알림(유령 알림)

`checkout`의 트랜잭션 안, `placeOrder` 바로 다음에 두 줄을 잠깐 넣는다.

```ts
// src/orders/orders.service.ts
        const placed = await this.placeOrder(tx, userId, items);
        this.notifications.notifyUser(userId, "order.created", placed); // 깨뜨려보기: 커밋 전에 알림
        await new Promise((r) => setTimeout(r, 6000)); // 깨뜨려보기: 트랜잭션 안에서 느린 작업
```

저장하면 `start:dev`가 다시 빌드해 서버를 다시 띄운다. 서버 터미널에 `Found 0 errors`가 찍혔는지 확인한다. 에러가 있으면 서버는 옛 코드 그대로라 실험이 되지 않는다.

이제 터미널 세 개로 진행한다.

| 터미널 | 하는 일 |
|---|---|
| 1 | `npm run start:dev`(이미 켜져 있다). 에러가 여기에 찍힌다 |
| 2 | 알림을 받는 클라이언트. `kim`으로 로그인해 WebSocket에 붙어 있는다 |
| 3 | 시드와 결제 요청을 보낸다 |

```sh
# 터미널 2: kim으로 접속해 알림을 기다린다. "연결됨"이 찍히면 그대로 둔다
node scratch-client.mjs
# 연결됨
```

```sh
# 터미널 3: 재고와 주문을 되돌리고(새 주문 id가 6이 된다) 결제를 보낸다
# 401이 나면 8단계 실험 ④ 앞의 TOKEN=... 줄로 토큰을 다시 받는다
npx prisma db seed
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"items":[{"productId":2,"quantity":1}]}'
```

`curl`이 바로 끝나지 않고 6초쯤 멈춰 있다. 그동안 세 터미널에서 이런 순서로 일이 일어난다.

**터미널 2에 알림이 먼저 온다.** 요청을 보내자마자, 아직 커밋도 안 된 주문의 알림이다.

```sh
알림: {
  id: 6,
  user: 'kim',
  price: 30000,
  paid: true,
  items: [ { productId: 2, quantity: 1, unitPrice: 30000 } ]
}
```

**6초 뒤 터미널 3의 `curl`이 500으로 끝난다.**

```sh
{"statusCode":500,"message":"Internal server error"}%
```

**터미널 1에 이유가 찍힌다.** 트랜잭션이 5초 상한을 넘겨 커밋하지 못했다.

```sh
[Nest] 99420  - 2025. 10. 12. 오전 2:19:40   ERROR [ExceptionsHandler] PrismaClientKnownRequestError: Transaction API error: A commit cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 6057 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.
    at yr.#transformRequestError (/Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest/node_modules/@prisma/client/src/runtime/core/engines/client/ClientEngine.ts:309:14)
    at yr.transaction (/Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest/node_modules/@prisma/client/src/runtime/core/engines/client/ClientEngine.ts:462:18)
    at async Proxy._transactionWithCallback (/Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest/node_modules/@prisma/client/src/runtime/getPrismaClient.ts:872:9)
    at async OrdersService.checkout (/Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest/src/orders/orders.service.ts:50:22)
    at async file:///Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest/node_modules/@nestjs/core/router/router-execution-context.js:68:62
    at async OrdersController.checkout (file:///Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest/node_modules/@nestjs/core/router/router-proxy.js:6:17) {
  code: 'P2028',
  meta: {
    operation: 'commit',
    timeout: 5000,
    timeTaken: 6057
  },
  clientVersion: '7.10.0'
}
```

알림을 받은 주문 #6이 정말 있는지 터미널 3에서 확인한다.

```sh
curl localhost:4000/orders/6
{"message":"order 6 not found","error":"Not Found","statusCode":404}

# 마우스 stock 100 그대로, 재고 차감도 함께 롤백됐다
curl localhost:4000/products
[{"id":1,"name":"한정판 키보드","price":150000,"stock":10},{"id":2,"name":"마우스","price":30000,"stock":100}]% 
```

트랜잭션 안에서 시간이 오래 걸려 Prisma의 트랜잭션 시간 상한(기본 5초)을 넘겼고, 트랜잭션은 롤백됐다.

하지만 알림은 이미 나갔다. 사용자는 존재하지 않는 주문 #6의 알림을 받았다.

WebSocket 전송은 DB 트랜잭션의 일부가 아니라서 롤백되지 않는다. 두 줄을 지워 원복한다.

### 실험 | 일부러 깨뜨려보기 ⑥: 커밋 후, 알림 전에 죽는다

이번엔 원래 위치(커밋 다음)는 그대로 두고, 그 사이에서 프로세스가 죽는 상황을 만든다.

```ts
// src/orders/orders.service.ts
      const result = await this.prisma.$transaction(async (tx) => { /* ... */ });
      process.exit(1); // 깨뜨려보기: 커밋 직후, 알림 직전에 프로세스가 죽는다
      this.logger.log(`결제 완료: ...`);
      this.notifications.notifyUser(userId, "order.created", result);
```

`checkout` 안의 `const result = await this.prisma.$transaction(...)`이 끝나는 줄(`});`) 바로 아래, `this.logger.log(...)` 위에 `process.exit(1);` 한 줄을 넣는다. 실험 ⑤의 두 줄은 지운 상태여야 한다.

저장한 뒤 터미널 1에 `Found 0 errors`가 찍혔는지 확인한다.

터미널은 실험 ⑤와 같이 세 개를 쓴다. 터미널 2의 `scratch-client.mjs`는 켜 둔 그대로 `연결됨` 상태여야 한다.

```sh
# 터미널 3: 재고와 주문을 되돌리고(새 주문 id가 6이 된다) 결제를 보낸다
npx prisma db seed
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"items":[{"productId":2,"quantity":1}]}'
```

**터미널 3의 `curl`이 응답 없이 끝난다.** 커밋까지 마친 서버가 응답을 보내기 전에 죽었다.

```sh
curl: (52) Empty reply from server
```

**터미널 2는 연결이 끊긴다.** 알림은 오지 않는다.

```sh
연결 끊김
: xhr poll error
```

**터미널 1의 서버는 꺼진 채로 있다.**

`start:dev`는 파일이 바뀔 때만 다시 띄우므로, 앱이 스스로 죽으면 다시 켜지지 않는다.

지금 `curl localhost:4000/...`을 보내면 `Failed to connect`가 난다.

서버가 꺼져 있어도 DB는 따로 떠 있다. 주문이 정말 커밋됐는지 DB에 직접 묻는다.

```sh
# 터미널 3
docker compose exec db psql -U order -d order_api -c "SELECT id, user_id, price FROM orders WHERE id = 6"
# 출력
 id | user_id | price 
----+---------+-------
  6 | kim     | 30000
(1 row)
```

주문은 있다. 결제는 됐는데 사용자는 알림을 받지 못했다.

`process.exit(1)` 줄을 지워 원복하고 저장한다. 파일이 바뀌었으니 `start:dev`가 서버를 다시 띄우고, 터미널 2의 클라이언트는 스스로 다시 붙는다.

```sh
# 터미널 2
연결됨
```

다시 붙어도 주문 #6의 알림은 끝내 오지 않는다.

보낼 코드가 실행되기 전에 프로세스가 죽었고, "보내야 했다"는 기록은 어디에도 남지 않았기 때문이다.

서버가 살아났으니 API로도 주문을 확인할 수 있다.

```sh
# 터미널 3
curl localhost:4000/orders/6
{"id":6,"user":"kim","price":30000,"paid":true}
```

배포, 메모리 부족, 서버 장애처럼 프로세스는 언제든 죽을 수 있다.

**"DB에 쓰기"와 "다른 시스템에 보내기"를 연달아 하는 한, 어느 순서로 하든 사이에서 죽으면 한쪽만 남는다.**

- 커밋 전에 보내면 유령 알림이 생긴다(실험 ⑤).

- 커밋 후에 보내면 알림이 유실된다(실험 ⑥).

### 작업 1. 고치기: 보낼 일을 DB에 같이 적는다

알림을 직접 보내지 않고, "이 알림을 보내야 한다"는 기록을 주문과 같은 트랜잭션 안에서 `outbox_events` 테이블에 쓴다.

그러면 주문과 알림 기록은 3단계부터 익숙한 "전부 아니면 전무"가 된다.

실제 전송은 별도의 일꾼(relay)이 이 테이블을 주기적으로 읽어서 한다.

```prisma
// prisma/schema.prisma
model OutboxEvent {
  id          Int       @id @default(autoincrement())
  type        String    // 이벤트 이름 ("order.created")
  userId      String    @map("user_id") // 알림을 받을 사용자
  payload     Json      // 보낼 내용
  createdAt   DateTime  @default(now()) @map("created_at")
  // 보낸 시각. NULL이면 아직 안 보낸 것
  publishedAt DateTime? @map("published_at")

  @@map("outbox_events")
}
```

```sh
npx prisma migrate dev --name add-outbox-events
npx prisma generate
```

시드의 `TRUNCATE` 목록 맨 앞에 `outbox_events`를 추가한다.

```ts
// prisma/seed.ts
// TRUNCATE 한 줄만 이렇게 바꾼다. 8단계에서 넣은 idempotency_keys 앞에 붙인다
await prisma.$executeRaw`TRUNCATE outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
```

`OutboxEvent`도 `IdempotencyKey`처럼 다른 모델과의 관계(`@relation`)가 없다.

`user_id` 컬럼은 있지만 외래키가 아니라 그냥 문자열이라, `CASCADE`가 따라오지 않는다.

목록에 직접 적어야 한다.

빼먹으면 시드를 다시 돌려도 지난 실험의 이벤트가 남는다.

그중 아직 안 보낸 것(`published_at`이 NULL)이 있으면, 다음 작업에서 만들 relay가 이미 지워진 주문의 알림을 뒤늦게 보낸다.

목록에 없는 테이블에는 `RESTART IDENTITY`도 적용되지 않으니, 이벤트 id도 1로 돌아가지 않고 계속 커진다.

이것으로 시드의 `TRUNCATE` 목록은 10단계 테스트의 것과 같은 최종 모양이 된다.

### 작업 2. 주문을 만들 때 outbox에 기록하기

```ts
// src/orders/orders.service.ts
// checkout의 트랜잭션 안, placeOrder 다음에 추가
        const placed = await this.placeOrder(tx, userId, items);
        // 알림을 "지금 보내지" 않고, 보낼 일을 같은 트랜잭션 안에서 기록만 한다
        await tx.outboxEvent.create({ data: { type: "order.created", userId, payload: placed } });

// 트랜잭션 밖의 알림 호출은 지운다
      this.logger.log(`결제 완료: #${result.id} (${result.user}) ${result.price}원`);
      return result; // 알림은 OutboxRelay가 커밋된 outbox 행을 보고 보낸다
```

`create()`(`POST /orders`)도 같은 문제를 안고 있으니 같은 방식으로 바꾼다.

```ts
// src/orders/orders.service.ts
  async create(input: Omit<Order, "id">, creatorId: string): Promise<Order> {
    const { user, ...rest } = input;
    // 주문 저장과 알림 기록을 한 트랜잭션으로(checkout과 같은 outbox 방식)
    const order = await this.prisma.$transaction(async (tx) => {
      const created = toOrder(await tx.order.create({ data: { ...rest, userId: user }, select: orderSelect }));
      await tx.outboxEvent.create({ data: { type: "order.created", userId: creatorId, payload: created } });
      return created;
    });
    this.logger.log(`주문 생성: #${order.id} (${order.user})`);
    return order;
  }
```

이제 `OrdersService`는 `NotificationsGateway`를 쓰지 않는다.

생성자를 `constructor(private readonly prisma: PrismaService) {}`로 줄이고, `OrdersModule`의 `imports: [NotificationsModule]`도 지운다.

> 주문 쪽은 "무엇을 보내야 하는지 기록"만 하고, "어떻게 보내는지"는 모르게 됐다.

### 작업 3. relay(전달하는 일꾼)

```ts
// src/outbox/outbox.relay.ts
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { NotificationsGateway } from "../notifications/notifications.gateway.js";
import { PrismaService } from "../prisma/prisma.service.js";

// $queryRaw는 컬럼 이름을 그대로 돌려준다(user_id) — Prisma 모델의 필드 이름(userId)이 아니다
type PendingEvent = { id: number; type: string; user_id: string; payload: Record<string, unknown> };

// outbox_events에 쌓인 "아직 안 보낸 이벤트"를 주기적으로 꺼내 실제로 보내는 일꾼
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsGateway,
  ) {}

  onApplicationBootstrap() {
    // 0.5초마다 한 번씩 확인한다(폴링). void : 반환된 Promise를 일부러 기다리지 않는다는 표시
    this.timer = setInterval(() => void this.tick(), 500);
  }

  onModuleDestroy() {
    clearInterval(this.timer); // 앱이 꺼질 때 타이머를 멈춘다
  }

  private async tick() {
    if (this.running) return; // 이전 회차가 아직 안 끝났으면 건너뛴다
    this.running = true;
    try {
      const sent = await this.publishBatch();
      if (sent > 0) this.logger.log(`outbox 이벤트 ${sent}건 발행`);
    } catch (err) {
      this.logger.error("outbox 발행 실패 — 다음 회차에 다시 시도한다", err as Error);
    } finally {
      this.running = false;
    }
  }

  async publishBatch(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      // relay가 여러 개 떠 있어도 같은 이벤트를 동시에 집어 가지 않는다
      const events = await tx.$queryRaw<PendingEvent[]>`
        SELECT id, type, user_id, payload FROM outbox_events
        WHERE published_at IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`;
      for (const e of events) {
        // eventId를 함께 보낸다 — 같은 이벤트가 두 번 와도 받는 쪽이 걸러낼 수 있게
        this.notifications.notifyUser(e.user_id, e.type, { eventId: e.id, ...e.payload });
      }
      if (events.length > 0) {
        // 보낸 것들에 보낸 시각을 기록한다 → 다음 회차부터는 안 집힌다
        await tx.outboxEvent.updateMany({
          where: { id: { in: events.map((e) => e.id) } }, data: { publishedAt: new Date() },
        });
      }
      return events.length;
    });
  }
}
```

```ts
// src/outbox/outbox.module.ts
import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { OutboxRelay } from "./outbox.relay.js";

// 게이트웨이를 쓰는 쪽이 OrdersModule에서 OutboxModule로 옮겨 왔다
@Module({ imports: [NotificationsModule], providers: [OutboxRelay] })
export class OutboxModule {}
```

`app.module.ts`의 `imports`에 `OutboxModule`을 추가한다.

```ts
// src/app.module.ts
// import 한 줄과 imports 배열의 OutboxModule만 추가한다
import { OutboxModule } from "./outbox/outbox.module.js";
// ... 기존 import 그대로 ...

@Module({
  imports: [PrismaModule, OrdersModule, UsersModule, AuthModule, NotificationsModule, ProductsModule, OutboxModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

저장한 뒤 터미널 1에 `Found 0 errors`가 찍혔는지 확인한다.

실험 ⑤·⑥처럼 터미널 세 개를 쓰고, 터미널 2의 `scratch-client.mjs`는 `연결됨` 상태여야 한다.

정상 흐름을 확인한다. 결제가 커밋되면 relay가 0.5초 안에 그 이벤트를 집어 보낸다.

```sh
# 터미널 3: 재고·주문·outbox를 되돌리고(새 주문 id 6, 이벤트 id 1) 결제를 보낸다
npx prisma db seed
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"items":[{"productId":2,"quantity":1}]}'
{"id":6,"user":"kim","price":30000,"paid":true,"items":[{"productId":2,"quantity":1,"unitPrice":30000}]}
```

**터미널 3에는 응답이 바로 온다.** 결제 API는 이제 알림을 기다리지 않는다. outbox 행을 쓰고 커밋하면 끝이다.

**터미널 1에 두 줄이 차례로 찍힌다.** 첫 줄은 결제 요청을 처리한 `OrdersService`가, 둘째 줄은 0.5초 안에 다음 회차를 돈 `OutboxRelay`가 찍은 것이다.

```sh
[Nest] 31072  - 2025. 10. 12. 오전 2:40:14     LOG [OrdersService] 결제 완료: #6 (kim) 30000원
[Nest] 31072  - 2025. 10. 12. 오전 2:40:14     LOG [OutboxRelay] outbox 이벤트 1건 발행
```

**터미널 2에 알림이 온다.** 실험 ⑤의 알림과 달리 이번에는 커밋된 주문의 알림이다.

```sh
알림: {
  eventId: 1,
  id: 6,
  paid: true,
  user: 'kim',
  items: [ { quantity: 1, productId: 2, unitPrice: 30000 } ],
  price: 30000
}
```

맨 앞의 `eventId: 1`은 relay가 붙인 outbox 행의 id다.

나머지는 `payload`(JSONB) 컬럼에서 꺼낸 것이라, 8단계의 저장된 응답처럼 필드 순서가 결제 응답과 다르다.

DB에서도 그 이벤트가 "보낸 것"으로 표시됐는지 본다.

```sh
# 터미널 3
docker compose exec db psql -U order -d order_api -c "SELECT id, type, user_id, published_at FROM outbox_events"

# 출력
 id |     type      | user_id |      published_at       
----+---------------+---------+-------------------------
  1 | order.created | kim     | 2025-10-11 17:40:14.824
(1 row)
```

`published_at`이 채워져 있으면 relay가 보낸 뒤 기록까지 마친 것이다. 비어 있다면 relay가 아직 돌지 않은 것이니, `app.module.ts`에 `OutboxModule`을 넣었는지 확인한다.

### 용어 | NestJS API (생명주기 인터페이스)

- `OnApplicationBootstrap`: 앱이 모든 모듈을 초기화한 뒤 Nest가 `onApplicationBootstrap()`을 호출해 주는 생명주기 인터페이스다.
- `OnModuleDestroy`: 앱이 꺼질 때 Nest가 `onModuleDestroy()`를 호출해 준다. "꺼질 때"가 언제인지는 아래 "생명주기 훅이 불리는 때"에서 다룬다.

### 개념 | 생명주기 훅이 불리는 때

Nest는 앱을 켜고 끄는 과정의 정해진 지점에서, 그 메서드를 가진 프로바이더를 찾아 대신 호출해 준다. 메서드 이름만 맞으면 불리고, `implements OnApplicationBootstrap`은 이름 오타를 타입 검사로 잡기 위한 표시다.

| 시점 | 훅 | 이 문서에서 |
|---|---|---|
| 켤 때 1 | `onModuleInit()`: 그 모듈의 의존성이 준비된 직후 | 쓰지 않는다 |
| 켤 때 2 | `onApplicationBootstrap()`: 모든 모듈의 `onModuleInit`이 끝난 뒤 | relay 타이머를 시작한다 |
| 끌 때 1 | `onModuleDestroy()`: `app.close()`가 불리면 가장 먼저 | relay 타이머를 멈춘다 |
| 끌 때 2 | `beforeApplicationShutdown()`, `onApplicationShutdown()`: 그다음 차례로 | 쓰지 않는다 |

relay를 `onModuleInit`이 아니라 `onApplicationBootstrap`에서 켜는 이유는, 첫 `tick()`이 돌 때 `PrismaService`와 `NotificationsGateway`를 포함한 다른 모듈이 전부 준비돼 있도록 하기 위해서다.

끌 때의 훅은 **`app.close()`가 불려야** 돈다.

- e2e 테스트의 `afterAll`에서 `app.close()`를 부르는 것이 그 경우다. 이때 `onModuleDestroy()`가 타이머를 멈추지 않으면, 앱을 닫은 뒤에도 `setInterval`이 살아 남아 0.5초마다 `tick()`을 부른다.
- `npm run start:dev`를 Ctrl+C로 끄는 것은 `app.close()`가 아니다. `main.ts`에서 `app.enableShutdownHooks()`를 켜 두지 않으면 Nest는 종료 신호를 받지 않고, 프로세스가 그냥 끝나며 끌 때의 훅은 하나도 불리지 않는다. 지금은 프로세스와 함께 타이머도 사라지니 문제가 없다.

> C의 `atexit()`처럼 "끝날 때 정리"를 등록하는 자리다. 다만 Nest의 훅은 `app.close()`를 거칠 때만 불리므로, `kill -9`나 깨뜨려보기 ⑥의 `process.exit(1)`처럼 그냥 끝나 버리면 돌지 않는다.

### 용어 | SQL (작업 큐 잠금)

- `FOR UPDATE SKIP LOCKED`: 다른 트랜잭션(다른 서버 인스턴스의 relay)이 이미 잠근 행은 기다리지 않고 건너뛴다. 아래 "잠긴 행을 만났을 때: 기다리기, 실패하기, 건너뛰기"에서 다룬다.

### 개념 | 잠긴 행을 만났을 때: 기다리기, 실패하기, 건너뛰기

`FOR UPDATE`는 이미 다른 트랜잭션이 잠근 행을 만나면 풀릴 때까지 기다린다(0장 개념 3). 뒤에 무엇을 붙이느냐로 이 반응을 바꿀 수 있다.

| 쓰는 법 | 잠긴 행을 만나면 | 맞는 곳 |
|---|---|---|
| `FOR UPDATE` | 풀릴 때까지 기다린다 | 그 행을 꼭 처리해야 할 때(7단계의 재고) |
| `FOR UPDATE NOWAIT` | 즉시 에러(`55P03`)로 실패한다 | 기다리느니 바로 실패를 알리는 편이 나을 때(도전 과제 1) |
| `FOR UPDATE SKIP LOCKED` | 그 행을 빼고 나머지만 돌려준다 | 같은 일을 여러 일꾼이 나눠 가질 때(relay) |

relay가 서버 인스턴스마다 하나씩, 두 개 떠 있고 안 보낸 이벤트가 1, 2, 3번 셋 있다고 하자.

```sql
-- relay A의 트랜잭션: 1, 2번을 잠그고 가져간다
SELECT id FROM outbox_events WHERE published_at IS NULL ORDER BY id LIMIT 2 FOR UPDATE SKIP LOCKED;
-- 결과: 1, 2

-- A가 커밋하기 전, relay B의 트랜잭션: 잠긴 1, 2번은 건너뛰고 3번만 가져간다
SELECT id FROM outbox_events WHERE published_at IS NULL ORDER BY id LIMIT 2 FOR UPDATE SKIP LOCKED;
-- 결과: 3
```

- `SKIP LOCKED`가 없으면 B는 A가 커밋할 때까지 기다린다. 그 뒤 PostgreSQL이 1, 2번을 다시 검사하면 `published_at`이 채워져 있어 빠지고, B는 결국 같은 이벤트를 두 번 보내지는 않지만 그동안 아무 일도 못 한다.
- `SKIP LOCKED`의 결과는 "지금 잠기지 않은 행"일 뿐이라, 재고처럼 특정 행을 반드시 확인해야 하는 곳에 쓰면 잠긴 상품이 "없는 상품"처럼 빠져 버린다.

> 작업 큐를 DB 테이블로 만들 때 쓰는 대표적인 문법이다. 여러 일꾼이 서로 기다리지 않고 남은 일만 집어 간다.

### 작업 4. 깨뜨려보기 ⑥을 다시 해 본다

outbox로 바꾼 뒤에도 실험 ⑥처럼 커밋 직후에 죽으면 어떻게 되는지 본다. 이번에는 알림이 유실되지 않고, 서버가 살아난 뒤 보내져야 한다.

`checkout`에 `process.exit(1);` 한 줄을 다시 넣는다. 위치는 실험 ⑥과 같은 트랜잭션 직후다.

```ts
// src/orders/orders.service.ts
// checkout의 try 안. 트랜잭션이 끝난 바로 다음 줄에 한 줄만 넣는다
      const result = await this.prisma.$transaction(async (tx) => {
        // ... 키 기록 → placeOrder → outboxEvent.create → 응답 저장 (작업 2 그대로) ...
        return placed;
      });
      process.exit(1); // 깨뜨려보기: 커밋 직후에 프로세스가 죽는다
      this.logger.log(`결제 완료: #${result.id} (${result.user}) ${result.price}원`);
      return result;
```

이제 그 아래에 알림 호출은 없지만, 트랜잭션 직후에 죽는 것은 같다.

저장한 뒤 터미널 1에 `Found 0 errors`가 찍혔는지, 터미널 2가 `연결됨` 상태인지 확인한다.

```sh
# 터미널 3: 재고·주문·outbox를 되돌리고(새 주문 id 6, 이벤트 id 1) 결제를 보낸다
npx prisma db seed
curl -X POST localhost:4000/orders/checkout -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d '{"items":[{"productId":2,"quantity":1}]}'
curl: (52) Empty reply from server
```

**여기까지는 실험 ⑥과 같다.** 터미널 3은 응답 없이 끝나고, 터미널 2에는 `연결 끊김`이 찍히고, 터미널 1의 서버는 꺼진 채로 있다.

다른 점은 DB에 있다. 서버가 꺼진 상태에서 outbox를 본다.

```sh
# 터미널 3
docker compose exec db psql -U order -d order_api -c "SELECT id, type, user_id, published_at FROM outbox_events ORDER BY id"

# 출력
 id |     type      | user_id | published_at 
----+---------------+---------+--------------
  1 | order.created | kim     | 
(1 row)
```

`published_at`이 비어 있는 1번 행은 커밋됐지만 아직 안 보낸 이벤트다.

주문과 같은 트랜잭션에서 쓰였으니, 주문 #6이 있으면 이 행도 반드시 있다.

실험 ⑥에서는 "보내야 했다"는 기록이 어디에도 없었다.

`process.exit(1)` 줄을 지우고 저장한다. 서버가 다시 뜨고, relay가 부팅 직후 첫 회차(0.5초 안)에 이 이벤트를 보낸다.

```sh
# 터미널 1
[Nest] 49036  - 2025. 10. 12. 오전 2:49:03     LOG [OutboxRelay] outbox 이벤트 1건 발행
```

같은 쿼리로 다시 보면 1번 행의 `published_at`이 채워져 있다.

```sh
# 터미널 3
docker compose exec db psql -U order -d order_api -c "SELECT id, type, user_id, published_at FROM outbox_events ORDER BY id"

# 출력
 id |     type      | user_id |      published_at       
----+---------------+---------+-------------------------
  1 | order.created | kim     | 2025-10-11 17:49:03.204
(1 row)
```

**그런데 터미널 2에는 알림이 안 찍힐 때가 많다.**

서버가 죽은 사이 끊긴 클라이언트는 잠시 뒤에야 다시 연결하는데, 그보다 relay가 먼저 보내면 그 순간 받을 소켓이 없다(아래 "대가" 절의 접속해 있지 않은 사용자와 같은 처지다).

터미널 2에 `연결됨`만 찍히고 알림이 없다면 이 경우다.

알림을 눈으로 확인하려면, 터미널 2에 `연결됨`이 찍힌 것을 본 뒤 이 이벤트를 "안 보낸 상태"로 되돌린다.

```sh
# 터미널 3
docker compose exec db psql -U order -d order_api -c "UPDATE outbox_events SET published_at = NULL WHERE id = 1"
```

0.5초 안에 relay가 다음 회차에서 다시 집어 보낸다. 이번에는 클라이언트가 붙어 있으니 받는다.

```sh
# 터미널 2
알림: {
  eventId: 1,
  id: 6,
  paid: true,
  user: 'kim',
  items: [ { quantity: 1, productId: 2, unitPrice: 30000 } ],
  price: 30000
}
```

**죽기 전에 커밋된 일은 살아난 뒤에 반드시 보내진다.**

반대로 ⑤처럼 롤백되면 outbox 행도 함께 사라지므로 유령 알림은 생길 수 없다.

### 개념 | 대가: "적어도 한 번"

relay가 알림을 보낸 뒤, `published_at`을 기록하는 커밋 직전에 죽으면 어떻게 될까. 다음에 살아난 relay가 그 이벤트를 한 번 더 보낸다.

outbox가 보장하는 것은 "정확히 한 번"이 아니라 "적어도 한 번(at-least-once)"이다. 0장 개념 4과 같은 이유로, 네트워크 너머로 보내는 일에서 "정확히 한 번"은 얻을 수 없다.

> 그래서 받는 쪽이 `eventId`를 보고 이미 처리한 이벤트를 무시해야 한다. 받는 쪽에도 8단계의 멱등성이 필요한 것이다.

그리고 outbox는 "relay가 게이트웨이에 넘긴 것"까지 보장한다. 그 순간 접속해 있지 않은 사용자에게는 `05`의 room에 소켓이 없으니 전달되지 않는다.

오프라인 사용자에게 나중에라도 보여 주려면 알림 자체를 DB에 저장하고 접속할 때 읽게 해야 한다. 그건 이 문서의 범위 밖이다.

### 남길 것

- **찾아보면 되는 것**: 생명주기 훅 순서 표, `FOR UPDATE` / `NOWAIT` / `SKIP LOCKED` 표, `app.enableShutdownHooks()`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - "DB에 쓰기"와 "다른 시스템에 보내기"를 연달아 하면, 어느 순서든 사이에서 죽을 때 한쪽만 남는다. 보낼 일을 같은 트랜잭션에 기록(outbox)하고, 보내는 것은 따로 한다.
  
  - outbox는 "정확히 한 번"이 아니라 "적어도 한 번"이다. 받는 쪽이 `eventId`로 중복을 거른다.

- **에러 신호**:
  
  - 알림은 왔는데 그 주문이 `order 6 not found`(404) → 알림 호출이 트랜잭션 안에 있는지
  
  - `P2028` `A commit cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms` → 트랜잭션 안의 느린 작업
  
  - `curl: Empty reply from server` 뒤, 주문은 있는데 알림이 끝내 안 온다 → 알림이 outbox를 거치는지
  
  - `published_at`은 채워졌는데 `scratch-client.mjs`에 알림이 없다 → 클라이언트가 다시 연결된 시점

## 11. 10단계: 동시성 회귀 테스트

경쟁 조건은 손으로 몇 번 눌러 봐서는 안 드러난다.

오늘 고친 것이 나중에 누가 `FOR UPDATE`를 지워서 다시 깨지면, 그걸 잡아 줄 자동 테스트가 필요하다.

node-workspace 저장소의 [`appendix/02-test-toolkit`](https://github.com/seungwoo7050/node-workspace/tree/appendix/02-test-toolkit)의 e2e 테스트처럼 앱을 실제로 띄우되, DB는 진짜 PostgreSQL을 쓴다.

경쟁 조건은 진짜 DB의 잠금에서만 재현되기 때문이다.

### 작업 1. 테스트 전용 DB 만들기

테스트는 매번 테이블을 비우므로, 개발 DB가 아니라 테스트 전용 DB를 따로 만든다.

```sh
# createdb : 새 DB를 만드는 PostgreSQL 명령
docker compose exec db createdb -U order order_api_test
# 테스트 DB에 마이그레이션을 적용한다(migrate deploy : 만들어진 마이그레이션을 적용만 한다)
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
# .env에 추가
TEST_DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test
```

### 작업 2. e2e 테스트가 테스트 DB를 쓰게 하기

`.env`를 읽게 만들어 둔 `test/setup-env.ts`에 두 줄을 더해, 테스트가 `DATABASE_URL` 대신 `TEST_DATABASE_URL`을 쓰게 바꿔치기한다.

```ts
// test/setup-env.ts
// e2e 테스트는 개발 DB가 아니라 테스트 전용 DB를 쓴다 — 테스트가 매번 테이블을 비우기 때문이다
process.loadEnvFile();
// 아래 두 줄을 추가한다
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL이 없다 — 개발 DB를 지우지 않도록 테스트를 멈춘다");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // PrismaService가 읽기 전에 바꿔치기한다
```

```ts
// vitest.config.e2e.ts
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // 두 e2e 파일이 같은 테스트 DB를 쓰므로 파일을 동시에 돌리지 않는다
    fileParallelism: false,
```

### 작업 3. 동시성 회귀 테스트 작성·실행

```ts
// test/checkout.e2e-spec.ts
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

describe("POST /orders/checkout — 동시성 회귀 테스트", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // main.ts와 같은 전역 설정을 테스트 앱에도 건다
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0); // 0 : 비어 있는 아무 포트나 쓴다
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService); // DI 컨테이너에서 꺼내 DB를 직접 준비·검사한다
  });

  beforeEach(async () => {
    // 테스트마다 깨끗한 상태에서 시작한다(07의 "테스트 격리")
    await prisma.$executeRaw`TRUNCATE outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await prisma.user.create({ data: { id: "kim", name: "김" } });
    await prisma.product.create({ data: { name: "테스트 상품", price: 1000, stock: 5 } }); // id 1
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
    });
    token = ((await res.json()) as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close(); // OutboxRelay의 타이머와 DB 연결도 여기서 정리된다
  });

  const checkout = (headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/orders/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify({ items: [{ productId: 1, quantity: 1 }] }),
    });

  it("재고 5개에 동시 요청 20개 → 정확히 5건만 성공하고 재고는 0", async () => {
    const statuses = await Promise.all(Array.from({ length: 20 }, () => checkout().then((r) => r.status)));

    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(15);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: 1 } });
    expect(product.stock).toBe(0);
    // 팔린 수량의 합을 구한다
    const sold = await prisma.orderItem.aggregate({ where: { productId: 1 }, _sum: { quantity: true } });
    expect(sold._sum.quantity).toBe(5);
  });

  it("같은 Idempotency-Key로 동시 요청 10개 → 주문은 1건, 응답은 모두 같은 주문", async () => {
    const bodies = await Promise.all(
      Array.from({ length: 10 }, () => checkout({ "Idempotency-Key": "same-key" }).then((r) => r.json() as Promise<{ id: number }>)),
    );

    // Set의 크기 = 서로 다른 주문 id의 개수
    expect(new Set(bodies.map((b) => b.id)).size).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1); // 알림 기록도 한 번만
  });
});
```

```sh
npm run test:e2e

# 출력
npm notice run order-api-nest@0.0.1 test:e2e
npm notice run vitest run --config ./vitest.config.e2e.ts
The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option. You can remove the plugin and set resolve.tsconfigPaths: true in your Vite config instead.

 RUN  v4.1.11 /Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest

 ✓ test/checkout.e2e-spec.ts (2 tests) 397ms
 ✓ test/app.e2e-spec.ts (1 test) 89ms

 Test Files  2 passed (2)
      Tests  3 passed (3)
   Start at  02:56:55
   Duration  1.50s (transform 92ms, setup 14ms, import 825ms, tests 485ms, environment 0ms)
```

나머지 1개는 Nest 템플릿이 만들어 둔 `test/app.e2e-spec.ts`다.

### 용어 | Prisma Client API (집계)

- `aggregate({ _sum: { 필드: true } })`: SQL의 `SUM`/`COUNT` 같은 집계를 한다.

### 실험 | 이 테스트가 정말 버그를 잡는지 확인한다

통과하는 테스트만 봐서는 그 테스트가 버그를 잡을 수 있는지 알 수 없다.

7단계에서 고친 것(`FOR UPDATE`)을 일부러 지워서, 테스트가 실패하는지 본다.

`placeOrder`의 SQL 끝에서 `FOR UPDATE`만 지운다.

```ts
// src/orders/orders.service.ts
// placeOrder 안. 끝의 FOR UPDATE만 지운다
    const products = await tx.$queryRaw<{ id: number; name: string; price: number; stock: number }[]>`
      SELECT id, name, price, stock FROM products WHERE id = ANY(${ids}) ORDER BY id`; // 깨뜨려보기: FOR UPDATE 제거
```

테스트는 자기 앱을 따로 띄우므로 `start:dev`를 다시 켤 필요는 없다. 저장하고 바로 돌린다.

```sh
npm run test:e2e

# 출력
npm notice run order-api-nest@0.0.1 test:e2e
npm notice run vitest run --config ./vitest.config.e2e.ts
The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option. You can remove the plugin and set resolve.tsconfigPaths: true in your Vite config instead.

 RUN  v4.1.11 /Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest

 ❯ test/checkout.e2e-spec.ts (0 test)
 ❯ test/app.e2e-spec.ts (0 test)

 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/app.e2e-spec.ts [ test/app.e2e-spec.ts ]
Error: Transform failed with 1 error:

[PARSE_ERROR] Expected a semicolon or an implicit semicolon after a statement, but found none
    ╭─[ src/orders/orders.service.ts:90:50 ]
    │
 90 │       if (!product) throw new NotFoundException(`product ${item.productId} not found`);
    │                                                  │ 
    │                                                  ╰─ 
    │ 
    │ Help: Try inserting a semicolon here
────╯

  Plugin: vite:oxc
  File: /Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest/src/orders/orders.service.ts
 ❯ transformWithOxc node_modules/vite/dist/node/chunks/node.js:7581:19
 ❯ TransformPluginContext.transform node_modules/vite/dist/node/chunks/node.js:7653:26
 ❯ EnvironmentPluginContainer.transform node_modules/vite/dist/node/chunks/node.js:8545:51
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/node.js:20184:26
 ❯ fetchModule node_modules/vite/dist/node/chunks/node.js:36165:15

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  test/checkout.e2e-spec.ts [ test/checkout.e2e-spec.ts ]
Error: Transform failed with 1 error:

[PARSE_ERROR] Expected a semicolon or an implicit semicolon after a statement, but found none
    ╭─[ src/orders/orders.service.ts:90:50 ]
    │
 90 │       if (!product) throw new NotFoundException(`product ${item.productId} not found`);
    │                                                  │ 
    │                                                  ╰─ 
    │ 
    │ Help: Try inserting a semicolon here
────╯

  Plugin: vite:oxc
  File: /Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest/src/orders/orders.service.ts
 ❯ transformWithOxc node_modules/vite/dist/node/chunks/node.js:7581:19
 ❯ TransformPluginContext.transform node_modules/vite/dist/node/chunks/node.js:7653:26
 ❯ EnvironmentPluginContainer.transform node_modules/vite/dist/node/chunks/node.js:8545:51
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/node.js:20184:26

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  2 failed (2)
      Tests  no tests
   Start at  03:00:24
   Duration  1000ms (transform 72ms, setup 15ms, import 0ms, tests 0ms, environment 0ms)
```

**첫 번째 테스트가 실패했다.**

재고 5개짜리에 결제가 14건 성공했다.

잠그지 않으니 요청들이 같은 재고 5를 읽고, 각자 "재고 충분"이라고 판단한 뒤 차감했다.

4단계의 갱신 손실이 다시 살아난 것이다. 차감은 `stock - 1`로 DB가 하니 재고는 5에서 14만큼 줄어 음수(-9)가 된다.

그 검사(`expect(product.stock).toBe(0)`)는 앞 줄에서 이미 실패해서 실행되지 않았다.

성공 건수는 돌릴 때마다 다르다. 다른 요청이 커밋한 뒤에 읽은 요청은 줄어든 재고를 보고 409가 되기 때문이다.

5가 아니기만 하면 테스트가 버그를 잡은 것이다.

**두 번째 테스트는 그대로 통과한다.**

멱등성은 `FOR UPDATE`가 아니라 `idempotency_keys`의 기본키가 지키기 때문이다.

어떤 테스트가 어떤 코드를 지키는지 이렇게 드러난다.

`FOR UPDATE`를 다시 붙여 원복하고, 한 번 더 돌려 통과로 돌아오는지 확인한다.

```sh
npm run test:e2e

# 출력
npm notice run order-api-nest@0.0.1 test:e2e
npm notice run vitest run --config ./vitest.config.e2e.ts
The plugin "vite-tsconfig-paths" is detected. Vite now supports tsconfig paths resolution natively via the resolve.tsconfigPaths option. You can remove the plugin and set resolve.tsconfigPaths: true in your Vite config instead.

 RUN  v4.1.11 /Users/woopinbell/Desktop/ongoing/nodejs/order2/order-api-nest

 ✓ test/app.e2e-spec.ts (1 test) 98ms
 ✓ test/checkout.e2e-spec.ts (2 tests) 328ms

 Test Files  2 passed (2)
      Tests  3 passed (3)
   Start at  03:02:27
   Duration  1.29s (transform 99ms, setup 16ms, import 645ms, tests 426ms, environment 0ms)
```

### 남길 것

- **찾아보면 되는 것**: `createdb`, `prisma migrate deploy`, vitest의 `setupFiles`·`fileParallelism`, `aggregate({ _sum })`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 경쟁 조건은 진짜 DB의 잠금에서만 재현된다. 동시성 테스트는 실제 PostgreSQL의 테스트 전용 DB로 돌린다.
  
  - 회귀 테스트는 고친 코드(`FOR UPDATE`)를 지웠을 때 실패하는 걸 봐야 믿을 수 있다.

- **에러 신호**:
  
  - `TEST_DATABASE_URL이 없다 — 개발 DB를 지우지 않도록 테스트를 멈춘다` → `.env`의 `TEST_DATABASE_URL`
  
  - `expected [ 201, 201, … ] to have a length of 5 but got 14` → 잠금(`FOR UPDATE`)이 빠졌는지

## 12. 11단계: 누가 누구를 기다리는지 디버깅하기

동시성 버그는 "가끔", "부하가 걸릴 때만" 나타난다. 그래서 **재현보다 그 순간의 상태를 들여다보는 법이 더 중요하다.**

### 진단 1. 지금 잠금을 기다리는 쿼리 찾기

`psql`을 하나 열어 트랜잭션 안에서 키보드 행을 잠근 채 버틴다.

```text
order_api=# BEGIN;
order_api=*# SELECT id, stock FROM products WHERE id = 1 FOR UPDATE;
```

이 상태에서 키보드를 결제하면 `curl`이 응답 없이 멈춘다. 다른 터미널의 `psql`에서 지금 DB에서 도는 쿼리를 본다.

```sql
SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocked_by, left(query, 60) AS query
FROM pg_stat_activity
WHERE datname = 'order_api' AND pid <> pg_backend_pid() AND state <> 'idle'
ORDER BY pid;
```

```text
 pid |        state        | wait_event_type |  wait_event   | blocked_by |  query
-----+---------------------+-----------------+---------------+------------+---------------------------------------------------------
 380 | active              | Lock            | transactionid | {387}      | SELECT id, name, price, stock FROM products WHERE id ...
 387 | idle in transaction | Client          | ClientRead    | {}         | SELECT id, stock FROM products WHERE id = 1 FOR UPDATE;
```

결제 쿼리(380)가 `Lock`을 기다리고 있고, 막고 있는 건 387번이다.

387번의 상태 `idle in transaction`은 "트랜잭션을 연 채로 아무것도 안 하고 있다"는 뜻이다. 잠금을 쥔 채 클라이언트(`psql`의 사람)를 기다리는 중이다.

- 첫 `psql`에서 `COMMIT;`을 치면 결제가 곧바로 진행된다(커밋 대신 강제로 끊는 방법은 진단 2).

- 5초 넘게 버티면 결제 요청은 Prisma의 트랜잭션 시간 상한에 걸려 `P2028`(`A query cannot be executed on an expired transaction`)로 500이 된다.

> 운영 중에 `P2028`이 갑자기 늘면, 이렇게 누군가 잠금을 오래 쥐고 있는지부터 의심한다.

#### 용어 | SQL (막힌 쿼리 찾기)

- `pg_stat_activity`: 지금 접속한 커넥션들과 각자 실행 중인 쿼리를 보여 주는 시스템 뷰다.

- `pg_blocking_pids(pid)`: 이 커넥션을 막고 있는 커넥션들의 pid를 돌려준다.

### 진단 2. 오래 열린 트랜잭션 찾고 끊기

진단 1은 "지금 누가 막혀 있는가"를 봤다. 운영에서는 반대 방향의 질문이 더 자주 필요하다. "누가 트랜잭션을 너무 오래 열어 두고 있는가?"

잠금은 트랜잭션이 끝날 때 풀리므로(0장 개념 3), 오래 열린 트랜잭션이 곧 오래 쥔 잠금이다. 사람이 `psql`에서 `BEGIN`만 하고 자리를 비웠거나, 앱 코드가 트랜잭션 안에서 느린 외부 호출을 기다리는 경우가 대표적이다.

`pg_stat_activity`의 시각 컬럼으로 "얼마나 오래"를 계산한다. 진단 1과 같은 상황(첫 `psql`이 키보드 행을 잠근 채 버티고, 결제 요청이 막혀 있다)에서 실행한다.

```sql
-- 오래된 트랜잭션이 위로 오게 정렬한다
SELECT pid, state, now() - xact_start AS tx_age, now() - state_change AS in_state_for,
       wait_event_type, left(query, 45) AS query
FROM pg_stat_activity
WHERE datname = 'order_api' AND state <> 'idle' AND pid <> pg_backend_pid()
ORDER BY xact_start;
```

```text
 pid |        state        |     tx_age      |  in_state_for   | wait_event_type |  query
-----+---------------------+-----------------+-----------------+-----------------+-----------------------------------------------
  45 | idle in transaction | 00:00:02.108733 | 00:00:02.104494 | Client          | SELECT id, stock FROM products WHERE id = 1 F
  38 | active              | 00:00:01.285583 | 00:00:01.28408  | Lock            | SELECT id, name, price, stock FROM pro...
```

맨 위의 45번이 범인이다. 트랜잭션을 연 지 2초가 지났는데 그동안 아무것도 안 하고(`idle in transaction`) 클라이언트를 기다리고 있다(`Client`).

`query` 칸은 "지금 실행 중인 쿼리"가 아니라 마지막으로 실행한 쿼리라서, 무엇을 잠갔는지 짐작하는 단서가 된다.

> 실제 서비스에서 이 칸이 몇 분, 몇 시간이 되어 있으면 그 커넥션은 거의 확실히 사고다.

#### 용어 | SQL (경과 시간)

- `xact_start`: 이 커넥션의 현재 트랜잭션이 시작된 시각이다.

- `state_change`: 지금 상태(`state`)가 된 시각이다.

- `now() - 시각`: 경과 시간이다.

#### 끊기

원인을 고칠 시간이 없으면 그 커넥션을 강제로 끊는다.

```sql
-- 그 커넥션을 서버 쪽에서 끊는다. 진행 중이던 트랜잭션은 롤백되고, 쥐고 있던 잠금이 풀린다
SELECT pg_terminate_backend(45);
```

```text
# 막혀 있던 결제 요청 — 끊는 즉시 진행된다
{"id":6,"user":"kim","price":150000,"paid":true,"items":[...]} → 201
# 끊긴 첫 psql 쪽
FATAL:  terminating connection due to administrator command
server closed the connection unexpectedly
```

끊긴 쪽의 작업은 롤백된다(커밋 전이었으므로).

사람이 `psql`로 하던 작업이라면 다시 하면 되지만, 앱의 커넥션이라면 그 요청은 실패한다.

그래서 `pg_terminate_backend`는 "막힌 다수를 살리려고 막고 있는 하나를 희생하는" 응급처치다.

> 끊은 뒤에는 왜 그 트랜잭션이 그렇게 오래 열려 있었는지를 반드시 찾는다.

#### 예방하기

PostgreSQL에는 `idle in transaction` 상태가 일정 시간 넘으면 그 세션을 자동으로 끊는 설정이 있다.

```text
order_api=# SHOW idle_in_transaction_session_timeout;
 idle_in_transaction_session_timeout
-------------------------------------
 0                                        ← 기본값 0 = 꺼져 있다
```

진단 1의 첫 `psql`에서 `BEGIN` 전에 `SET idle_in_transaction_session_timeout = '2s';`를 먼저 실행하고 같은 실험을 하면, 2초 뒤 그 세션이 저절로 끊기고 막혀 있던 결제가 진행된다.

DB 로그(`docker compose logs db`)에도 남는다.

```text
FATAL:  terminating connection due to idle-in-transaction timeout
```

`SET`은 그 세션에만 적용된다. DB 전체에 걸려면 `ALTER DATABASE order_api SET idle_in_transaction_session_timeout = '1min';`처럼 DB나 서버 설정에 넣는다.

값은 "정상적인 트랜잭션이 이보다 오래 쉬는 일은 없다"고 확신할 수 있는 길이로 잡는다.

> Prisma의 대화형 트랜잭션은 이미 5초 상한(`timeout`)이 있으므로, 이 설정은 주로 앱 밖에서 열린 세션(사람의 `psql`, 배치 스크립트)에 대한 안전망이다.

### 진단 3. 쿼리 로그로 트랜잭션 흐름 보기

`08`부터 써 온 `PRISMA_LOG=query`는 트랜잭션 안에서도 쓸 수 있다. 결제 한 건을 성공시키고, 한 건을 재고 부족으로 실패시켜 본다.

```text
# 성공한 결제
prisma:query SELECT id, name, price, stock FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE
prisma:query UPDATE "public"."products" SET "stock" = ("public"."products"."stock" - $1) WHERE ...
prisma:query INSERT INTO "public"."orders" ("user_id","price","paid","created_at") VALUES ($1,$2,$3,$4) RETURNING ...
prisma:query INSERT INTO "public"."order_items" ("order_id","product_id","quantity","unit_price") VALUES ...
prisma:query SELECT "public"."orders"."id", ... FROM "public"."orders" WHERE ...
prisma:query SELECT "public"."order_items"."order_id", ... FROM "public"."order_items" WHERE ...
prisma:query INSERT INTO "public"."outbox_events" ("type","user_id","payload","created_at") VALUES ...
prisma:query COMMIT

# 재고 부족으로 실패한 결제
prisma:query SELECT id, name, price, stock FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE
prisma:query ROLLBACK
```

읽을 때 알아 둘 점이 세 가지 있다.

1. `COMMIT`과 `ROLLBACK`은 찍히지만 `BEGIN`은 찍히지 않는다. 트랜잭션의 끝은 보이지만 시작은 직접 표시되지 않으므로, "이 `COMMIT` 앞의 쿼리들이 한 트랜잭션"이라고 읽는다. 실패한 결제에서는 `FOR UPDATE` 다음 바로 `ROLLBACK`이 나와서, 앱이 재고를 보고 예외를 던져 3단계의 롤백이 일어났다는 걸 그대로 확인할 수 있다.

2. 중첩 쓰기 한 번이 쿼리 여러 개가 된다. 코드에서는 `tx.order.create(...)` 한 번인데, 로그에는 `orders` INSERT, `order_items` INSERT, 그리고 결과를 돌려주기 위한 SELECT 두 개가 찍힌다. "생각보다 쿼리가 많다"를 확인하는 데 쿼리 로그만 한 게 없다.

3. relay가 잡음을 만든다. `OutboxRelay`가 0.5초마다 `SELECT ... FOR UPDATE SKIP LOCKED`와 `COMMIT`을 찍는다. 보고 싶은 요청의 로그가 그 사이에 섞인다.

그리고 한계가 하나 있다. 로그 한 줄에는 어느 커넥션(트랜잭션)의 쿼리인지가 안 찍힌다. 동시 요청이 몰리면 여러 트랜잭션의 줄이 뒤섞여서, 어느 `COMMIT`이 어느 요청의 것인지 가를 수 없다.

> 쿼리 로그는 요청 하나를 혼자 보내서 재현할 때 쓰고, 동시성 문제는 그 순간의 상태를 커넥션별로 보여 주는 `pg_stat_activity`(진단 1, 2)로 본다.

### 진단 4. 에러 코드로 원인 가르기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| `409 재고 부족: 마우스`인데 키보드 재고가 줄어 있다 | 앞에서 실행한 `UPDATE`가 이미 따로 반영됐다(반쪽 상태) | 쿼리들이 한 트랜잭션에 묶여 있는지 | 2단계 |
| 같은 상품 두 줄짜리 요청이 400이 아니라 409 "이미 존재하는 값이다" | `order_items` 복합 기본키 충돌 | DTO의 `@ArrayUnique` | 2단계 |
| 409로 롤백됐는데 일부 변경이 남아 있다 | 그 쿼리가 트랜잭션 밖에서 따로 커밋됐다 | 콜백 안에서 `tx` 대신 `this.prisma`를 쓴 쿼리 | 3단계 |
| 응답은 `{ '201': 50 }`으로 전부 성공인데, 남은 재고 + 팔린 수량 ≠ 처음 재고 | 갱신 손실 | 앱이 읽은 값으로 계산해서 덮어쓰는 곳 | 4단계 |
| 상품은 있는데 재고 부족이 404 "대상을 찾을 수 없다"(`P2025`) | `update`가 `WHERE`에 맞는 행을 못 찾아 예외를 던졌다 | `updateMany` + `count` 검사로 바꿨는지 | 5단계 |
| `P2034` `Transaction failed due to a write conflict or a deadlock` | 쓰기 충돌 또는 교착 상태 | DB 로그의 `deadlock detected`, 잠그는 순서 | 6단계 |
| `ERROR:  deadlock detected` (DB 로그) | PostgreSQL이 교착 고리를 찾아 한쪽을 실패시켰다 | `DETAIL`의 누가 누구를 기다렸는지(진단 5) | 6단계 |
| `P2028` `Unable to start a transaction in the given time.` | 트랜잭션을 시작할 커넥션을 못 얻었다 | 커넥션 풀 고갈, 잠금 대기(진단 1), 오래 열린 트랜잭션(진단 2) | 6단계 |
| `WHERE id IN (${ids})`로 쓴 쿼리가 에러로 실패한다 | 배열 하나가 `$1` 매개변수 하나로 통째로 들어갔다 | `= ANY(${ids})`로 바꿨는지 | 7단계 |
| 같은 요청 두 번에 `201`이 두 번, 주문 id가 6, 7로 다르다 | 재시도인지 구별할 정보가 요청에 없다 | `Idempotency-Key` 헤더 | 8단계 |
| `P2002` | UNIQUE 위반 | 멱등성 키라면 의도한 것(저장된 응답을 돌려주는 `catch` 경로). 아니라면 중복 데이터 | 8단계 |
| 422 `같은 Idempotency-Key로 다른 내용의 요청을 보냈다` | 클라이언트가 키를 다른 요청에 재사용했다 | 클라이언트가 키를 만드는 시점 | 8단계 |
| `Type 'CheckoutResult' is not assignable to type ... InputJsonObject` | Json 컬럼에 넣는 값의 타입이 `interface`로 선언됐다 | `interface`를 `type`으로 | 8단계 |
| 알림은 왔는데 그 주문이 `order 6 not found`(404) | 커밋 전에 보낸 알림(유령 알림) | 알림 호출이 트랜잭션 안에 있는지 | 9단계 ⑤ |
| `P2028` `A commit cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms` | 트랜잭션이 시간 상한(5초)을 넘겨 롤백됐다 | 트랜잭션 안의 느린 작업 | 9단계 ⑤ |
| `curl: Empty reply from server` 뒤, 주문은 있는데 알림이 끝내 안 온다 | 커밋 후, 알림 전에 프로세스가 죽었다 | 알림이 outbox를 거치는지 | 9단계 ⑥ |
| `published_at`은 채워졌는데 `scratch-client.mjs`에 알림이 없다 | 보낸 순간 그 사용자의 소켓이 없었다 | 클라이언트가 다시 연결된 시점 | 9단계 |
| `TEST_DATABASE_URL이 없다 — 개발 DB를 지우지 않도록 테스트를 멈춘다` | 테스트가 개발 DB를 쓰려 했다 | `.env`의 `TEST_DATABASE_URL` | 10단계 |
| `expected [ 201, 201, … ] to have a length of 5 but got 14` | 동시 요청에 재고보다 많이 팔렸다 | 잠금(`FOR UPDATE`)이 빠졌는지 | 10단계 |
| `curl`이 응답 없이 멈춘다 | 잠금을 기다리는 중이다 | `pg_stat_activity`의 `blocked_by`(진단 1) | 11단계 |
| `P2028` `A query cannot be executed on an expired transaction` | 잠금을 기다리다 트랜잭션 시간 상한을 넘겼다 | 잠금을 쥔 쪽(진단 1), 오래 열린 트랜잭션(진단 2) | 11단계 |
| `FATAL:  terminating connection due to administrator command` | `pg_terminate_backend`로 끊겼다 | 그 트랜잭션이 왜 오래 열려 있었는지 | 11단계 |
| `FATAL:  terminating connection due to idle-in-transaction timeout` | 트랜잭션을 연 채 너무 오래 쉬었다 | `idle_in_transaction_session_timeout`, 그 세션의 주인 | 11단계 |
| `P2010` `Raw query failed. Code: 55P03` | `NOWAIT`가 이미 잠긴 행을 만났다 | `NOWAIT`를 붙인 쿼리 | 11단계 도전 과제 1 |
| `outbox 발행 실패`, 또는 `pending`이 계속 는다 | relay가 멈췄거나 처리 속도가 쌓이는 속도를 못 따라간다 | 서버 콘솔, 진단 6의 쿼리 | 11단계 |

`P2034`는 메시지 자체가 `Please retry your transaction`이라고 말한다. 교착으로 실패한 트랜잭션은 롤백됐을 뿐이라 다시 실행하면 대개 성공한다. 그래서 자동 재시도를 붙이기도 한다.

> 하지만 6단계처럼 순서가 엇갈린 구조라면 재시도는 증상만 가린다. 순서부터 고친다.

### 진단 5. DB 로그 보기

```sh
docker compose logs db | grep -A4 "deadlock detected"
```

교착 상태는 앱보다 DB 로그에 더 자세히 남는다. 어떤 프로세스가 어떤 쿼리로 누구를 기다렸는지가 `DETAIL`에 고리 모양 그대로 찍힌다.

### 진단 6. outbox가 밀리고 있는지 확인하기

```sql
SELECT count(*) FILTER (WHERE published_at IS NULL) AS pending, count(*) AS total FROM outbox_events;
```

`pending`이 계속 늘기만 하면 relay가 멈췄거나(서버 콘솔의 `outbox 발행 실패`) 처리 속도가 쌓이는 속도를 못 따라가는 것이다.

### 시험해보기

```sh
npx prisma db seed && node scripts/stampede.mjs 50
```

`201`이 10건, 남은 재고 0, 팔린 수량 10인지 확인한다. 이어서 6단계의 "반대 순서 동시 실행"을 돌려 서버 콘솔에 에러가 한 줄도 없는지 확인한다.

### 도전 과제

하나씩 고치고 원복하며 확인한다.

#### 1. `NOWAIT`로 바꿔 보기

진단 1의 실험에서 첫 `psql`의 `FOR UPDATE`를 `FOR UPDATE NOWAIT`로 바꾸고, 결제 쪽 SQL에도 `NOWAIT`을 붙인다.

기다리는 대신 무엇이 일어나는가? 선착순 이벤트에서 "기다리게 하기"와 "바로 실패시키기" 중 무엇이 나은지 생각해 본다.

**답**

1. 첫 `psql`의 `FOR UPDATE NOWAIT`는 평소처럼 잠금을 얻는다. 그 행을 잠근 사람이 아직 없기 때문이다. `NOWAIT`는 이미 잠긴 행을 만났을 때만 차이를 만든다.

2. 그 상태에서 키보드를 결제하면 `curl`이 멈추지 않고 바로(0.02초 안에) `{"statusCode":500,"message":"Internal server error"}`를 받는다.

3. 서버 콘솔에는 `code: 'P2010'`과 `Raw query failed. Code: 55P03. Message: could not obtain lock on row in relation "products"`가 찍힌다. 트랜잭션은 롤백돼 키보드 재고는 10 그대로다.

4. 잠금이 없을 때 보낸 결제는 평소처럼 201이다.

5. 같은 코드로 `npx prisma db seed && node scripts/stampede.mjs 50`을 돌리면 `{ '201': 4, '500': 46 }`처럼 재고 10개 중 3~4개만 팔린다. 앞 요청이 행을 잠근 순간에 들어온 요청은 재고가 남아 있어도 전부 실패하기 때문이다.

> 선착순 이벤트처럼 한 행에 요청이 몰리는 곳에서는 기다리게 하는 편이 맞다. 기다리면 재고가 정확히 다 팔리고 나머지는 "재고 부족"(409)이라는 분명한 이유로 실패한다. `NOWAIT`는 응답은 빠르지만 재고가 남았는데도 실패시키고, 실패 이유도 500으로 뭉개진다. 쓰려면 `55P03`을 "잠시 후 다시 시도" 같은 응답으로 따로 바꿔 줘야 한다.

#### 2. 받는 쪽에서 중복 이벤트 거르기

`scratch-client.mjs`에 `eventId`를 기억하는 `Set`을 두고, 이미 받은 `eventId`면 무시하게 고친다. 그리고 `published_at`을 `psql`에서 `NULL`로 되돌려 같은 이벤트를 다시 보내게 만든다.

클라이언트가 중복을 걸러내는지 확인한다.

같은 이벤트가 두 번 오면 고치기 전과 후에 무엇이 달라지는가?

**답**

1. 결제하면 두 클라이언트 모두 `알림: { eventId: 1, id: 6, ... }`을 한 번 찍는다.

2. `psql`에서 `UPDATE outbox_events SET published_at = NULL WHERE id = 1;`을 실행하면 0.5초 안에 relay가 같은 이벤트를 다시 보낸다. 서버 콘솔에 `[OutboxRelay] outbox 이벤트 1건 발행`이 한 번 더 찍힌다.

3. 고치지 않은 `scratch-client.mjs`는 똑같은 `알림: { eventId: 1, ... }`을 두 번째로 찍는다. 같은 주문을 두 번 처리하는 셈이다.

4. 고친 클라이언트는 `eventId` 1이 이미 `Set`에 있으므로 알림을 처리하지 않고 `중복 무시: eventId 1`만 찍는다.

### 남길 것

- **찾아보면 되는 것**: `pg_stat_activity`의 컬럼 이름(`wait_event_type`, `xact_start`, `state_change`), `pg_blocking_pids`, `pg_terminate_backend`, `idle_in_transaction_session_timeout`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 동시성 버그는 재현보다 그 순간의 상태를 본다. 막힌 쪽은 `wait_event_type`이 `Lock`, 막고 있는 쪽은 대개 `idle in transaction`이다.
  
  - 쿼리 로그는 요청 하나를 혼자 보낼 때만 읽힌다. 동시에 몰린 상황은 커넥션별로 보이는 `pg_stat_activity`로 본다.

- **에러 신호**:
  
  - `curl`이 응답 없이 멈춘다 → `pg_stat_activity`의 `blocked_by`(진단 1)
  
  - `P2028` `A query cannot be executed on an expired transaction` → 잠금을 쥔 쪽(진단 1), 오래 열린 트랜잭션(진단 2)
  
  - `FATAL:  terminating connection due to administrator command` → 그 트랜잭션이 왜 오래 열려 있었는지
  
  - `FATAL:  terminating connection due to idle-in-transaction timeout` → `idle_in_transaction_session_timeout`, 그 세션의 주인
  
  - `P2010` `Raw query failed. Code: 55P03` → `NOWAIT`를 붙인 쿼리
  
  - `outbox 발행 실패`, 또는 `pending`이 계속 는다 → 서버 콘솔, 진단 6의 쿼리

## 13. 완성 확인

- [ ] 1단계: `GET /products`로 재고가 보이고, `order_items`가 복합 기본키로 주문과 상품을 잇는다

- [ ] 2~3단계: 중간에 실패한 결제가 트랜잭션 덕분에 재고를 건드리지 않는다

- [ ] 4~5단계: 동시 요청 50개에 정확히 10건만 성공한다(갱신 손실을 재현하고 고쳤다)

- [ ] 6단계: 반대 순서 동시 결제에서 교착 상태를 재현했고, 잠금 순서를 통일해 없앴다

- [ ] 8단계: 같은 `Idempotency-Key`의 요청은 동시에 와도 주문 1건, 다른 내용이면 422

- [ ] 9단계: 커밋 직후 프로세스가 죽어도, 재시작 후 알림이 보내진다

- [ ] 10단계: `npm run test:e2e`가 통과하고, `FOR UPDATE`를 지우면 실패한다

- [ ] 11단계: `pg_stat_activity`로 막힌 쿼리와 오래 열린 트랜잭션을 찾고, `pg_terminate_backend`로 풀어 봤다

## 14. 다음 단계

### 자가 점검

1. 트랜잭션으로 감쌌는데도 4단계에서 재고 10개짜리가 50개 팔린 이유는? 트랜잭션이 보장하는 것과 보장하지 않는 것을 구분해서 말해 본다.

2. 조건부 `UPDATE`(`WHERE stock >= 1`)가 동시 요청에서도 정확한 이유를, 행 잠금과 "기다린 뒤 다시 검사"로 설명하면?

3. 6단계에서 교착 상태 9번이 왜 실패 56건이 됐는가? 커넥션 풀과 연결해서 설명한다.

4. `SELECT ... FOR UPDATE`의 `ORDER BY id`는 무엇을 막는가?

5. 멱등성 키를 트랜잭션 맨 앞에서 `INSERT`하면, 같은 키의 동시 요청이 왜 자연스럽게 줄을 서는가?

6. outbox 없이 "커밋 후 알림"만으로 부족한 이유는? outbox가 보장하는 것은 "정확히 한 번"인가?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 격리 수준 바꾸기(`REPEATABLE READ`, `SERIALIZABLE`)와 직렬화 실패 시 재시도 — 잠금 대신 DB가 충돌을 감지해 한쪽을 실패시키는 방식

- 낙관적 잠금(`version` 컬럼) 구현과 재시도 정책

- 여러 서비스나 여러 DB에 걸친 작업(분산 트랜잭션, 실패 시 앞 단계를 되돌리는 보상 트랜잭션)

- Redis 같은 외부 저장소를 쓰는 분산 락

- outbox를 메시지 브로커(Kafka, RabbitMQ 등)로 발행하기, 폴링 대신 DB의 변경 로그를 읽는 방식(CDC)

- 오래된 멱등성 키와 발행 완료된 outbox 행을 주기적으로 지우는 정리 작업

- 실제 결제 대행사 연동(결제 승인 실패, 결제는 됐는데 우리 DB 저장이 실패한 경우의 처리)