# 자기참조 트리: 상품 카테고리 계층

## 목표

이 프로젝트는 [`08-load-and-csp`](https://github.com/seungwoo7050/node-order/tree/08-load-and-csp)로부터 시작한다.

> 관계, N+1, 트랜잭션만 알면 따라갈 수 있는 프로젝트다.

상품에 "전자기기 > 컴퓨터 > 키보드" 같은 계층 카테고리를 붙인다.

테이블 하나가 자기 자신을 가리키는 외래키를 가지면 트리가 된다.

트리는 만드는 것보다 **읽고 바꾸는 것**이 어렵다. 이 문서에서 하는 일은 다섯 가지다.

1. 트리 전체를 노드 수와 상관없이 쿼리 한 번에 읽는다

2. "이 카테고리와 그 아래 전부의 상품"을 재귀 CTE로 한 번에 찾는다

3. 카테고리를 옮길 때 순환(자기 후손 아래로 들어가기)을 막는다

4. 이미 순환이 생긴 데이터에서도 쿼리가 끝나게 한다

5. 중간 카테고리를 지웠을 때 그 아래 가지가 조용히 흩어지지 않게 한다

```sh
# 키보드(3)의 경로: 루트부터 순서대로
curl localhost:4000/categories/3/path
[{"id":1,"name":"전자기기","depth":2},{"id":2,"name":"컴퓨터","depth":1},{"id":3,"name":"키보드","depth":0}]
```

```sh
# 컴퓨터(2)를 자기 자식인 키보드(3) 아래로 옮기려 하면 거부한다
curl -X PATCH localhost:4000/categories/2 -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"parentId":3}'
{"message":"자기 후손 아래로 옮길 수 없습니다(순환 발생)","error":"Bad Request","statusCode":400}
```

> 시작 기준점:  
> `order-api-nest`가 PostgreSQL·Redis·저장소(`docker compose up -d db redis storage`)에 붙어 있고, `products`·`orders`·`refresh_tokens` 테이블과 로그인(`POST /auth/login`)이 있다.  
> 이 문서에서는 백엔드만 작업한다.

## 이 문서 읽는 법

각 단계(`##`) 안의 소제목(`###`)은 앞머리로 성격을 나눈다.

| 앞머리 | 무엇인가 | 코드를 쳐야 하는가 |
|---|---|---|
| `작업 N.` | 파일을 고치고 명령을 치는 순서. 단계마다 1부터 센다 | 친다 |
| `개념 \|` | 왜 그런지, 자주 걸리는 지점의 설명 | 안 친다. 코드가 있어도 읽는 코드다 |
| `용어 \|` | 그 단계에서 처음 나온 API·문법·명령의 짧은 사전 | 안 친다 |
| `실험 \|` | 일부러 깨뜨려 보는 것. 결과가 에러거나 망가진 데이터다 | 친다. 이어지는 작업에서 고친다 |
| `진단 N.` | 11장에서 "트리 어디가 망가졌나"를 가르는 절차 | 친다(`psql`) |

- 처음 통과할 때는 `작업 N.`만 순서대로 따라가도 코드가 완성된다. `실험`은 그 단계의 문제를 눈으로 보는 것이라, 건너뛰어도 코드는 완성되지만 왜 고치는지는 실험에서 보인다. 11장만은 작업 대신 `진단 N.`을 따라간다.

- `작업 N.` 바로 뒤의 태그는 그 작업이 무엇을 남기는지다. 제목만 보고 커밋할 변경이 있는지 가를 수 있다. 섞이면 센 쪽 하나만 붙인다(`[커밋]` > `[원복]` > `[실행]` > `[확인]`).

| 태그 | 무엇이 남는가 | 커밋 |
|---|---|---|
| `[커밋]` | 저장소의 파일: 코드 작성·수정, 스키마와 마이그레이션, 시드, 새 스크립트 | 한다 |
| `[실행]` | 저장소 밖의 상태: 컨테이너, DB 데이터. 다음 작업이 이 상태에 기댄다 | 안 한다 |
| `[확인]` | 남는 것이 없다: 쿼리 수 세기, 조회, 결과 읽기 | 안 한다 |
| `[원복]` | `실험`에서 바꾼 것을 되돌린다 | 안 한다 |

- 이 문서에는 `[원복]` 작업이 없다. 실험(7·8단계)이 바꾼 데이터는 이어지는 실험·작업 앞의 `npx prisma db seed`가 되돌린다.

- 단계마다 끝에 `남길 것`이 있다. "찾아보면 되는 것 / 감각으로 남겨야 할 것 / 에러 신호" 세 줄이고, 둘째 줄만 남아도 그 단계는 성공이다. 셋째 줄은 11장 "진단 4"의 표에 모두 모았다.

- 0장(전제)은 작업이 없는 장이라 `개념`만 있다. 1장(준비)은 확인 명령뿐이고 12·13장은 체크리스트와 자가 점검이라서 `남길 것`을 두지 않았다.

| 단계 | 하는 일 |
|---|---|
| [0. 전제](#0-전제) | 부모 포인터 트리, 반복 조인, 고리를 C의 포인터에 빗대 본다(작업 없음) |
| [1. 준비](#1-준비) | DB·Redis·저장소를 띄운다 |
| [2. 1단계: 자기참조 모델](#2-1단계-자기참조-모델) | `categories` 테이블을 만들고 시드에 트리를 넣는다 |
| [3. 2단계: 일부러 깨뜨려보기 ① 노드마다 자식 조회](#3-2단계-일부러-깨뜨려보기-①-노드마다-자식-조회) | 노드마다 자식을 조회해 쿼리가 "노드 수 + 1"번 나가는 것을 본다 |
| [4. 3단계: 한 번에 읽고, 메모리에서 잇는다](#4-3단계-한-번에-읽고-메모리에서-잇는다) | 전부 한 번에 읽고 `Map`으로 이어 쿼리를 1번으로 줄인다 |
| [5. 4단계: 하위 카테고리의 상품 전부(재귀 CTE)](#5-4단계-하위-카테고리의-상품-전부재귀-cte) | `WITH RECURSIVE`로 아래로 내려가며 상품을 모은다 |
| [6. 5단계: 경로(빵부스러기), 위로 올라가는 재귀](#6-5단계-경로빵부스러기-위로-올라가는-재귀) | 같은 재귀를 반대 방향으로 돌려 경로를 구한다 |
| [7. 6단계: 옮기기, 자기 후손 아래로는 못 간다](#7-6단계-옮기기-자기-후손-아래로는-못-간다) | 순환 검사와 advisory lock으로 안전하게 옮긴다 |
| [8. 7단계: 일부러 깨뜨려보기 ② 이미 고리가 있는 데이터](#8-7단계-일부러-깨뜨려보기-②-이미-고리가-있는-데이터) | 고리 데이터에서 쿼리가 끝나지 않는 것을 보고 `CYCLE` 절로 고친다 |
| [9. 8단계: 일부러 깨뜨려보기 ③ 중간 카테고리 지우기](#9-8단계-일부러-깨뜨려보기-③-중간-카테고리-지우기) | `SET NULL`이 가지를 흩어 놓는 것을 보고 `RESTRICT`로 막는다 |
| [10. 9단계: 회귀 테스트](#10-9단계-회귀-테스트) | 순환·고리·삭제를 e2e 테스트로 고정한다 |
| [11. 디버깅](#11-디버깅) | `psql`로 트리를 그리고, 고리와 끝나지 않는 쿼리를 찾는다 |
| [12. 완성 확인](#12-완성-확인) | 시험해보기와 체크리스트 |
| [13. 다음 단계](#13-다음-단계) | 자가 점검과 이 문서에서 다루지 않은 것 |

## 0. 전제

### 개념 1 | 부모 포인터 하나로 트리가 된다.

C로 트리를 만든다면 노드마다 자식 포인터 배열을 두거나, 반대로 부모 포인터 하나만 둘 수 있다.

```c
struct Category { int id; char name[32]; struct Category *parent; }; // parent == NULL 이면 루트
```

관계형 DB는 두 번째 방식이 자연스럽다. 행마다 `parent_id` 칸 하나를 두고, 그 칸이 같은 테이블의 다른 행을 가리키게 한다.

이것을 자기참조 관계라고 한다.

자식 목록은 따로 저장하지 않는다. **"부모가 나인 행들"을 찾으면 그게 자식이다.**

### 개념 2 | 트리를 따라가는 건 반복 조인이다.

부모 포인터로 루트까지 올라가는 C 코드는 `while (n) n = n->parent;`다.

DB에서 이 반복을 한 쿼리 안에서 하는 문법이 재귀 CTE(`WITH RECURSIVE`)다.

시작 행을 하나 정하고, "지금까지 찾은 행들과 조인해서 다음 단계 행을 붙인다"를 더 붙일 것이 없을 때까지 되풀이한다.

### 개념 3 | 부모 포인터에는 고리가 생길 수 있다.

연결 리스트에 고리가 생기면 `while (n) n = n->next;`가 영원히 돈다. C에서는 "토끼와 거북이" 같은 방법으로 고리를 찾는다.

부모 포인터 트리도 같다. A의 부모가 B, B의 부모가 A면 위로 올라가는 반복이 끝나지 않는다.

**외래키는 "가리키는 행이 존재하는가"만 검사하지, 고리는 막아 주지 않는다.**

> 6~7단계에서 이 고리를 만들고, 막고, 그래도 생긴 경우에 대비한다.

## 1. 준비

`08`의 `order-api-nest`에서 이어 간다. 새로 설치할 패키지는 없다.

### 작업 1. [실행] DB·Redis·저장소 띄우기

```sh
cd order-api-nest
docker compose up -d db redis storage
```

## 2. 1단계: 자기참조 모델

### 작업 1. [커밋] Category 모델 추가와 마이그레이션

```prisma
// prisma/schema.prisma
// Product에 카테고리 연결을 추가하고, Category 모델을 새로 만든다
model Product {
  // ... 기존 필드 그대로 ...
  // 상품이 속한 카테고리(가장 아래 단계). 없어도 된다
  categoryId Int?        @map("category_id")
  category   Category?   @relation(fields: [categoryId], references: [id])

  @@index([categoryId])
  @@map("products")
}

model Category {
  id       Int        @id @default(autoincrement())
  name     String
  // 부모 카테고리. NULL이면 맨 위(루트)다. 같은 테이블의 다른 행을 가리키는 외래키(자기참조)
  parentId Int?       @map("parent_id")
  // 관계 이름("CategoryTree")으로 parent와 children이 같은 관계의 양쪽임을 짝지어 준다
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children Category[] @relation("CategoryTree")
  products Product[]

  @@index([parentId])
  @@map("categories")
}
```

`@@index([parentId])`는 `01`의 7단계에서 본 대로다. "부모가 X인 행"을 자주 찾으니 외래키 칸에 인덱스를 직접 건다.

```sh
npx prisma migrate dev --name add-categories
npx prisma generate
```

생성된 SQL의 마지막 줄을 눈여겨본다.

```sql
-- prisma/migrations/..._add_categories/migration.sql
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

선택 관계(`Int?`)의 기본값은 `ON DELETE SET NULL`이다.

> 8단계에서 이게 무슨 일을 하는지 본다.

### 용어 | Prisma 스키마 문법 (자기참조 관계)

- `@relation("CategoryTree", ...)`(관계 이름): 같은 모델 사이에 관계가 있으면 Prisma는 `parent`와 `children`이 한 관계의 양쪽인지 알 수 없다. 그래서 관계 이름을 양쪽에 똑같이 적어 짝을 지어 준다.

- `parent Category?` / `children Category[]`: 한 관계의 양쪽이다. 외래키(`fields`, `references`)는 `parent` 쪽에만 적는다. `children`은 DB 칸이 아니라 "부모가 나인 행들"을 Prisma가 찾아 주는 이름이다(0장 개념 1).

### 작업 2. [커밋] 시드에 트리 넣기

시드의 `TRUNCATE` 목록 맨 앞에 `categories`를 추가하고, 상품을 만들기 전에 트리를 넣는다.

부모를 먼저 만들어야 자식이 그 id를 가리킬 수 있다.

```ts
// prisma/seed.ts
// TRUNCATE 한 줄에 categories를 추가한다
await prisma.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;

// ... users, orders의 생성은 그대로 ...

// 카테고리 트리. 부모를 먼저 만들어야 자식이 그 id를 가리킬 수 있다
//   전자기기(1) ─ 컴퓨터(2) ─ 키보드(3), 마우스(4)
//              └ 음향(5) ── 헤드폰(6)
//   생활(7) ──── 주방(8)
const tree: [string, number | null][] = [
  ["전자기기", null], ["컴퓨터", 1], ["키보드", 2], ["마우스", 2], ["음향", 1], ["헤드폰", 5], ["생활", null], ["주방", 7],
];
for (const [name, parentId] of tree) await prisma.category.create({ data: { name, parentId } });

// 기존 두 상품에 categoryId를 붙이고, 상품 두 개를 더한다
await prisma.product.createMany({
  data: [
    { name: "한정판 키보드", price: 150000, stock: 10, categoryId: 3 }, // id 1 - 선착순 재고 10개
    { name: "마우스", price: 30000, stock: 100, categoryId: 4 },        // id 2
    { name: "무선 헤드폰", price: 90000, stock: 30, categoryId: 6 },     // id 3
    { name: "전기 주전자", price: 40000, stock: 20, categoryId: 8 },     // id 4
  ],
});
```

`createMany`가 아니라 `for` 안에서 `create`를 한 번씩 `await`하는 이유가 있다.

`RESTART IDENTITY`로 시퀀스를 되감았으니, 순서대로 하나씩 넣으면 id가 배열 순서대로 1부터 붙는다. 그래서 `["컴퓨터", 1]`의 `1`이 바로 앞에서 만든 "전자기기"를 가리킨다.

```sh
npx prisma db seed
```

### 남길 것

- **찾아보면 되는 것**: `@relation("이름", ...)`으로 자기참조 관계의 양쪽을 짝짓는 문법, `@@index`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 트리는 `parent_id` 칸 하나로 충분하다. 자식은 저장하지 않고 "부모가 나인 행"으로 찾으니, 그 칸에 인덱스가 필요하다.
  
  - `?`를 붙인 선택 관계는 기본으로 `ON DELETE SET NULL`이 된다. 루트를 표현하려고 붙인 `?`가 삭제 동작까지 정한다.

- **에러 신호**:
  
  - 시드에서 자식이 엉뚱한 부모를 가리킨다 → `TRUNCATE` 목록에 `categories`가 있는지(없으면 시퀀스가 되감기지 않아 id가 1부터 시작하지 않는다)

## 3. 2단계: 일부러 깨뜨려보기 ① 노드마다 자식 조회

### 작업 1. [커밋] 단순한 재귀 조회 만들기

가장 먼저 떠오르는 방법은 루트부터 내려가며 노드마다 "내 자식들"을 조회하는 재귀 함수다.

```ts
// src/categories/categories.service.ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

export type CategoryNode = { id: number; name: string; children: CategoryNode[] };

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // 2단계: 루트부터 내려가며 노드마다 자식을 조회한다(깨뜨려보기 - 노드 수만큼 쿼리)
  async treeNaive(): Promise<CategoryNode[]> {
    const load = async (parentId: number | null): Promise<CategoryNode[]> => {
      const rows = await this.prisma.category.findMany({ where: { parentId }, orderBy: { id: "asc" } });
      return Promise.all(rows.map(async (r) => ({ id: r.id, name: r.name, children: await load(r.id) })));
    };
    return load(null);
  }
}
```

`BadRequestException`과 `NotFoundException`은 4단계와 6단계에서 쓴다. import 줄은 처음부터 최종 모양으로 적어 둔다.

### 작업 2. [커밋] 컨트롤러·모듈 만들고 등록하기

```ts
// src/categories/categories.controller.ts
import { Controller, Get } from "@nestjs/common";
import { CategoriesService } from "./categories.service.js";

@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get("tree-naive")
  treeNaive() {
    return this.categories.treeNaive();
  }
}
```

```ts
// src/categories/categories.module.ts
import { Module } from "@nestjs/common";
import { CategoriesController } from "./categories.controller.js";
import { CategoriesService } from "./categories.service.js";

@Module({ controllers: [CategoriesController], providers: [CategoriesService] })
export class CategoriesModule {}
```

`PrismaModule`은 `@Global()`이라 `imports`에 적지 않아도 `PrismaService`를 주입받는다.

`app.module.ts`의 `imports`에 `CategoriesModule`을 추가한다.

```ts
// src/app.module.ts
// import 한 줄과 imports 배열의 CategoriesModule만 추가한다
import { CategoriesModule } from './categories/categories.module.js';
// ... 기존 import 그대로 ...

@Module({
  imports: [
    LoggerModule.forRoot({ /* ... 그대로 ... */ }),
    PrismaModule, StorageModule, HealthModule, CategoriesModule, OrdersModule, UsersModule, ProductsModule, OutboxModule, MeModule, LeaderModule, AuthModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService, ShutdownLogger],
})
export class AppModule {}
```

여기에 빠뜨리면 서버는 멀쩡히 뜨는데 `GET /categories/tree-naive`만 `{"message":"Cannot GET /categories/tree-naive","error":"Not Found","statusCode":404}`가 난다.

### 작업 3. [커밋] 큰 트리를 만드는 스크립트

시드의 8개로는 차이가 잘 안 보인다. 큰 트리를 만드는 SQL 파일을 둔다.

```sql
-- scripts/category-bulk.sql
-- 큰 트리 만들기: 루트 "대량" 아래에 5갈래씩 3단계(5 + 25 + 125 = 155개)를 더한다
-- 사용법: docker compose exec -T db psql -U order -d order_api < scripts/category-bulk.sql
WITH root AS (
  INSERT INTO categories (name, parent_id) VALUES ('대량', NULL) RETURNING id
), l1 AS (
  INSERT INTO categories (name, parent_id) SELECT '대량-' || i, root.id FROM root, generate_series(1, 5) AS i RETURNING id, name
), l2 AS (
  INSERT INTO categories (name, parent_id) SELECT l1.name || '-' || i, l1.id FROM l1, generate_series(1, 5) AS i RETURNING id, name
)
INSERT INTO categories (name, parent_id) SELECT l2.name || '-' || i, l2.id FROM l2, generate_series(1, 5) AS i;
SELECT count(*) AS categories FROM categories;
```

`-T`는 `docker compose exec`가 터미널을 붙이지 않게 한다. 그래야 `<`로 넘긴 파일 내용이 `psql`의 입력으로 들어간다.

### 작업 4. [확인] 쿼리 수 세기

`01`의 5단계처럼 `PRISMA_LOG=query`로 서버를 띄우면 실행되는 SQL이 서버 콘솔에 찍힌다. 다만 요청 하나에 쿼리가 백 줄 넘게 나오니 눈으로 셀 수는 없다. 콘솔 출력을 파일에도 남겨 두고 `grep`으로 센다.

```sh
# 터미널 1: 켜 둔 서버를 끄고, SQL 로그를 켜서 다시 띄운다
# 출력은 화면에 그대로 나오고 /tmp/sql.log에도 쌓인다
PRISMA_LOG=query npm run start:dev 2>&1 | tee /tmp/sql.log
```

띄우자마자 요청을 보내지 않았는데도 아래 쿼리가 0.5초마다 찍힌다.

```text
prisma:query BEGIN
prisma:query
        SELECT id, type, user_id, payload FROM outbox_events
        WHERE published_at IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED
prisma:query COMMIT
```

에러가 아니다. outbox relay가 보낼 이벤트가 있는지 확인하는 쿼리다. 오히려 DB에 잘 붙었다는 표시다. 이 쿼리가 계속 섞이기 때문에 셀 때는 `categories` 테이블을 읽는 쿼리만 거른다.

터미널 2에서 "요청 한 번에 `categories` 쿼리가 몇 번 나갔는지"를 출력하는 함수를 만든다. 요청 전 로그 줄 수를 기억했다가, 요청 뒤에 늘어난 줄에서만 센다. 3단계에서 `GET /categories/tree`도 세야 하니 주소 끝부분을 인자로 받는다(안 주면 `tree-naive`).

```sh
# 터미널 2: 이 터미널에서만 쓰는 함수. 터미널을 닫으면 사라지니 다시 붙여 넣는다
count_tree() {
  local before=$(wc -l < /tmp/sql.log)
  curl -s localhost:4000/categories/${1:-tree-naive} > /dev/null
  sleep 1
  tail -n +$((before + 1)) /tmp/sql.log | grep -c 'FROM "public"."categories"'
}
```

- `${1:-tree-naive}`: 첫 번째 인자. 비어 있으면 `tree-naive`를 쓴다. `count_tree tree`라고 부르면 `/categories/tree`를 센다.
- `wc -l`: 지금까지 쌓인 줄 수. `tail -n +N`은 N번째 줄부터 끝까지 보여 준다. 그래서 요청 뒤에 생긴 줄만 남는다.
- `sleep 1`: 응답은 왔는데 로그가 파일에 덜 써진 경우를 피하려고 잠깐 기다린다.
- `'FROM "public"."categories"'`: Prisma가 만든 `categories` 조회 SQL에만 있는 문자열이다. `categories`만으로 거르면 요청 로그(`"url":"/categories/tree-naive"`) 줄까지 세어 1이 더 나온다.

```sh
# 시드 트리(8개)에서 한 번
npx prisma db seed
count_tree tree-naive   # 9

# 큰 트리를 더해(시드 8개 + 대량 156개 = 164개) 한 번 더
docker compose exec -T db psql -U order -d order_api < scripts/category-bulk.sql
count_tree tree-naive   # 165
```

정확히 "노드 수 + 1"번이다(루트 찾기 1번 + 노드마다 1번).

N+1과 같은 모양인데, 트리라서 단계가 깊어질수록 왕복이 순서대로 쌓인다.

### 개념 | `Promise.all`이 있는데도 왕복이 쌓이는 이유

`treeNaive`는 형제들의 조회를 `Promise.all`로 동시에 보낸다. 그런데도 느린 이유는 **자식 조회는 부모 조회의 응답이 와야 시작할 수 있기** 때문이다.

`load(r.id)`는 `r`이 담긴 `rows`를 받은 다음에야 불린다.

시드 트리에서 쿼리가 나가는 순서를 단계별로 그리면 이렇다.

```text
왕복 1: 루트 찾기                 (parentId = null)          → 1, 7
왕복 2: 1과 7의 자식을 동시에       (parentId = 1, 7)          → 2, 5 / 8
왕복 3: 2, 5, 8의 자식을 동시에     (parentId = 2, 5, 8)       → 3, 4 / 6 / 없음
왕복 4: 3, 4, 6의 자식을 동시에     (parentId = 3, 4, 6)       → 모두 없음
```

- 걸리는 시간은 "깊이 + 1"번의 왕복이 순서대로 쌓인 만큼이다. 잎(자식 없는 노드)도 "자식이 없다"는 답을 받으려고 쿼리를 한 번씩 보낸다.

- 쿼리 수는 동시성과 상관없이 노드 수 + 1이다. 큰 트리의 마지막 단계에서는 125개가 한꺼번에 나가는데, 커넥션 풀 크기보다 많은 쿼리는 줄을 서서 기다린다. 그동안 다른 요청도 같은 풀을 쓰지 못한다.

> C로 치면 노드마다 `read()` 시스템 콜을 하나씩 부르는 것과 같다. 한 번에 크게 읽고 메모리에서 처리하는 쪽이 이긴다(3단계).

### 용어 | SQL (큰 트리 만들기)

- `WITH 이름 AS (INSERT ... RETURNING id)`: 앞 단계가 만든 행의 id를 다음 단계가 바로 받아 쓴다. 반복문 없이 SQL 한 문장으로 3단계 트리를 만든다. 아래 "데이터를 바꾸는 `WITH`와 `RETURNING`"에서 다룬다.

- `generate_series(1, 5)`: 1부터 5까지 숫자 행을 만든다. `FROM l1, generate_series(...)`처럼 붙이면 `l1`의 행마다 5개씩 생긴다. 이것도 아래에서 다룬다.

- `'대량-' || i`: `||`는 문자열을 이어 붙인다.

### 개념 | 데이터를 바꾸는 `WITH`와 `RETURNING`

`WITH`(CTE)는 보통 `SELECT` 결과에 이름을 붙여 다음 식에서 쓰는 문법이다.

PostgreSQL에서는 그 자리에 `INSERT`/`UPDATE`/`DELETE`도 넣을 수 있다. 이때 다음 단계가 읽는 것은 테이블이 아니라 **앞 단계의 `RETURNING` 결과**다.

#### 두 단계로 줄여 보기

`category-bulk.sql`을 두 단계, 3갈래로 줄이면 이렇다.

```sql
WITH root AS (
  INSERT INTO categories (name, parent_id) VALUES ('대량', NULL) RETURNING id
), l1 AS (
  INSERT INTO categories (name, parent_id) SELECT '대량-' || i, root.id FROM root, generate_series(1, 3) AS i RETURNING id, name
)
SELECT name FROM l1;
--   name
-- --------
--  대량-1
--  대량-2
--  대량-3
```

`FROM root, generate_series(1, 3) AS i`의 쉼표는 조건 없는 조인(곱집합)이다.

`root`가 1행이고 `generate_series`가 3행이라 1 × 3 = 3행이 되고, 각 행이 `root.id`를 부모로 가진다. 원래 스크립트에서는 1 × 5, 5 × 5, 25 × 5로 늘어나 루트 아래에 155개가 된다.

#### 왜 `RETURNING`으로 넘기나

한 문장 안의 모든 단계는 문장이 시작될 때의 테이블 상태를 본다. 앞 단계가 넣은 행을 테이블에서 다시 읽으면 보이지 않는다.

```sql
WITH ins AS (INSERT INTO categories (name) VALUES ('새 카테고리') RETURNING id)
SELECT (SELECT count(*) FROM categories WHERE name = '새 카테고리') AS seen, (SELECT count(*) FROM ins) AS returned;
--  seen | returned
-- ------+----------
--     0 |        1
```

- 앞 단계의 결과는 `RETURNING`에 적은 칸만 다음 단계로 넘어간다. `l2`가 `l1.name`을 쓰려고 `l1`에서 `RETURNING id, name`을 적었다.

- 문장 하나라서 중간 단계가 실패하면 앞 단계의 `INSERT`도 함께 취소된다. 트리가 반만 만들어지는 일이 없다.

> 스크립트 끝의 `SELECT count(*)`는 `;` 뒤의 별개 문장이라, 루트 "대량"까지 새로 들어간 156개가 모두 보인다. 시드 직후에 돌렸다면 164가 나온다.

### 남길 것

- **찾아보면 되는 것**: `generate_series`, 데이터를 바꾸는 `WITH ... RETURNING`의 문법, `docker compose exec -T`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 노드마다 자식을 조회하면 쿼리는 "노드 수 + 1"번이고, `Promise.all`로 형제를 동시에 보내도 깊이만큼의 왕복은 순서대로 쌓인다.
  
  - 쿼리 수는 눈으로 세지 않는다. 로그를 파일에 남기고(`tee`), 요청 뒤에 늘어난 줄에서 SQL에만 있는 문자열(`FROM "public"."categories"`)로 센다. 배경 작업(outbox relay)의 쿼리와 요청 로그가 같은 출력에 섞인다.

- **에러 신호**:
  
  - 서버는 멀쩡히 뜨는데 `GET /categories/tree-naive`만 `Cannot GET /categories/tree-naive`(404) → `app.module.ts`의 `imports`에 `CategoriesModule`이 있는지
  
  - 서버를 띄우자마자 `outbox 발행 실패 - 다음 회차에 다시 시도합니다`가 0.5초마다 찍힌다 → `docker compose ps`에 `db`가 떠 있는지(`docker compose up -d db redis storage`)
  
  - `PRISMA_LOG=query`로 띄우니 `outbox_events` 쿼리가 0.5초마다 찍힌다 → 에러가 아니다. relay가 도는 것이다
  
  - `count_tree`가 `no such file or directory: /tmp/sql.log`와 함께 `0`을 낸다 → 터미널 1의 서버를 `| tee /tmp/sql.log`를 붙여 띄웠는지
  
  - `count_tree tree`가 `count_tree tree-naive`와 같은 수를 낸다 → 인자를 받지 않는 예전 함수가 남아 있다. `type count_tree`로 보고 다시 정의한다

## 4. 3단계: 한 번에 읽고, 메모리에서 잇는다

카테고리는 보통 수백~수천 개다. 전부 한 번에 읽어도 작다.

읽은 다음 부모-자식 연결은 메모리에서 한다.

### 작업 1. [커밋] 전부 읽어 메모리에서 잇기

```ts
// src/categories/categories.service.ts
// treeNaive 아래에 추가한다
  // 3단계: 전부 한 번에 읽고, 메모리에서 부모-자식을 잇는다(쿼리 1번)
  async tree(): Promise<CategoryNode[]> {
    const rows = await this.prisma.category.findMany({ orderBy: { id: "asc" } });
    // id → 노드. C로 치면 "id로 바로 찾는 포인터 배열"을 먼저 만들어 두는 것
    const byId = new Map<number, CategoryNode>(rows.map((r) => [r.id, { id: r.id, name: r.name, children: [] }]));
    const roots: CategoryNode[] = [];
    for (const r of rows) {
      const node = byId.get(r.id)!;
      if (r.parentId === null) roots.push(node);
      else byId.get(r.parentId)?.children.push(node); // 부모 노드의 children에 내 노드(참조)를 넣는다
    }
    return roots;
  }
```

두 번 훑는다. 첫 번째는 모든 노드를 만들어 `Map`에 넣고, 두 번째는 각 노드를 부모의 `children`에 넣는다.

컨트롤러에 `GET /categories/tree`를 추가한다.

```ts
// src/categories/categories.controller.ts
// treeNaive 아래에 추가한다
  @Get("tree")
  tree() {
    return this.categories.tree();
  }
```

### 작업 2. [확인] 쿼리 수 다시 세기

2단계 작업 4의 두 터미널을 그대로 쓴다.

- 터미널 1: `PRISMA_LOG=query npm run start:dev 2>&1 | tee /tmp/sql.log`로 띄운 서버가 그대로 떠 있으면 된다. 파일을 저장하면 `--watch`가 같은 자리에서 다시 띄우므로 로그도 계속 `/tmp/sql.log`에 쌓인다. 서버를 껐다면 이 명령으로 다시 띄운다.
- 터미널 2: `count_tree`가 정의돼 있어야 한다. 터미널을 새로 열었다면 2단계 작업 4의 함수를 다시 붙여 넣는다.

같은 트리에서 `tree-naive`와 `tree`를 나란히 센다.

```sh
# 터미널 2: 시드 트리(8개)로 되돌리고 두 방식을 비교
npx prisma db seed
count_tree tree-naive # 9
count_tree tree # 1

# 큰 트리(164개)에서 다시 비교
docker compose exec -T db psql -U order -d order_api < scripts/category-bulk.sql
count_tree tree-naive # 165
count_tree tree # 1
```

`tree-naive`는 노드 수에 따라 늘지만 `tree`는 노드가 몇 개든 1번이다.

`count_tree tree`가 `0`이면 서버가 새 코드로 다시 뜨기 전에 요청이 나간 것이다. 터미널 1에 `Nest application successfully started`가 찍힌 뒤 다시 센다. 응답 자체는 `curl localhost:4000/categories/tree`로 볼 수 있다.

시드 트리를 들여쓰기로 그리면 이렇다.

```sh
1 전자기기
  2 컴퓨터
    3 키보드
    4 마우스
  5 음향
    6 헤드폰
7 생활
  8 주방
```

### 개념 | 참조를 넣기 때문에 순서와 상관없이 이어진다

JavaScript의 객체는 변수에 담기거나 배열에 들어갈 때 복사되지 않는다. 주소(참조)가 들어간다.

그래서 부모의 `children`에 넣은 것은 복사본이 아니라 **`Map`에 있는 것과 같은 객체**다.

C로 쓰면 이렇다.

```c
// byId[id]는 노드 구조체를 가리키는 포인터. children에는 포인터를 넣는다
for (int i = 0; i < n; i++) {
    struct Node *node = byId[rows[i].id];
    if (rows[i].parent_id == 0) roots[nroots++] = node;
    else push(&byId[rows[i].parent_id]->children, node);
}
```

- 키보드(3)를 컴퓨터(2)의 `children`에 넣은 뒤에 컴퓨터를 전자기기(1)에 넣어도, 넣은 것은 같은 컴퓨터 객체라서 키보드까지 따라온다. 행을 어떤 순서로 훑든 결과가 같다.

- 첫 번째 훑기에서 노드를 전부 만들어 두기 때문에, 자식이 부모보다 먼저 나와도 `byId.get(r.parentId)`가 비지 않는다. 노드를 만들면서 바로 잇는 한 번 훑기였다면 `ORDER BY`에 기대야 한다.

- Nest는 `roots`를 `JSON.stringify`로 바꿔 응답한다. 이때 포인터를 따라 자식의 자식까지 그대로 펼쳐진다.

> 7단계에서 보듯 고리에 걸린 노드는 어떤 루트에도 이어지지 않는다. 그래서 루트에서 출발하는 `JSON.stringify`가 그 고리를 만나지 않고, 응답에서 그 노드들이 빠질 뿐이다.

### 용어 | TypeScript 문법 (Map, `!`, `?.`)

- `new Map<number, CategoryNode>([[키, 값], ...])`: 키로 값을 바로 찾는 표다. 일반 객체(`{}`)와 달리 키가 숫자 그대로 유지된다.

- `byId.get(r.id)!`: 끝의 `!`는 "여기서는 `undefined`가 아니다"라고 컴파일러에게 단언한다. 실행 시 검사는 하지 않는다. 첫 번째 훑기에서 모든 id를 넣었으니 맞는 단언이다.

- `byId.get(r.parentId)?.children`: `?.`는 앞이 `undefined`면 거기서 멈추고 `undefined`를 돌려준다. 부모가 없는 행이 있어도 에러 없이 건너뛴다(외래키가 있으면 그런 행은 생기지 않는다).

### 남길 것

- **찾아보면 되는 것**: `Map`의 생성자 모양, `!`와 `?.`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 작은 트리는 통째로 한 번 읽고 메모리에서 잇는다. 쿼리 수가 노드 수와 상관없이 1번이 된다.
  
  - 메모리에서 이을 때는 "노드를 모두 만들기 → 잇기" 두 번 훑는다. 참조를 넣으니 순서에 기대지 않는다.

- **에러 신호**:
  
  - `GET /categories/tree`의 응답에서 어떤 카테고리가 통째로 빠졌다 → 그 카테고리가 고리에 걸렸는지(진단 2)

## 5. 4단계: 하위 카테고리의 상품 전부(재귀 CTE)

"전자기기"를 누르면 그 아래 키보드·마우스·헤드폰 상품이 모두 나와야 한다. 하위 카테고리 id 목록이 먼저 필요하다.

3단계처럼 트리를 앱으로 가져와 모을 수도 있지만, DB 안에서 한 번에 할 수 있다.

### 작업 1. [커밋] 하위 카테고리의 상품 조회

```ts
// src/categories/categories.service.ts
// tree 아래에 추가한다
  // 4단계: 이 카테고리와 그 아래 모든 카테고리의 상품(재귀 CTE, 쿼리 1번)
  async productsInSubtree(id: number) {
    await this.ensureExists(id);
    return this.prisma.$queryRaw<{ id: number; name: string; price: number; category: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM categories WHERE id = ${id}          -- 시작점
        UNION ALL
        SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id   -- 바로 아래 자식들을 계속 붙인다
      )
      SELECT p.id, p.name, p.price, c.name AS category
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.category_id IN (SELECT id FROM subtree)
      ORDER BY p.id`;
  }

  // 클래스의 맨 아래에 둔다. 없는 카테고리면 빈 배열 대신 404를 돌려주려고 먼저 확인한다
  private async ensureExists(id: number) {
    const found = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException(`category ${id} not found`);
  }
```

이 재귀 CTE는 0장 개념 2의 `while` 반복을 SQL이 대신 도는 것이다.

### 작업 2. [커밋] 컨트롤러에 `GET :id/products` 추가

```ts
// src/categories/categories.controller.ts
// import 줄에 Param, ParseIntPipe를 더하고, tree 아래에 경로를 추가한다
import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";

  @Get(":id/products")
  products(@Param("id", ParseIntPipe) id: number) {
    return this.categories.productsInSubtree(id);
  }
```

### 작업 3. [확인] 하위 카테고리 상품이 모두 나오는지

시드의 상품 4개는 각각 키보드(3), 마우스(4), 헤드폰(6), 주방(8)에 달려 있다. 상위 카테고리를 부르면 그 아래 모든 단계의 상품이 모여야 한다.

```sh
# 1 전자기기: 그 아래 키보드·마우스·헤드폰의 상품이 모두 나온다
curl localhost:4000/categories/1/products

# 2 컴퓨터: 키보드·마우스의 상품만 나온다(헤드폰은 5 음향 아래라 빠진다)
curl localhost:4000/categories/2/products

# 없는 카테고리: 빈 배열이 아니라 404
curl localhost:4000/categories/999/products
```

`category`는 상품이 직접 달린 카테고리 이름이다. 1번(전자기기)을 불렀어도 상품은 두 단계 아래인 키보드·마우스·헤드폰에 달려 있으니, 재귀 CTE가 손자 단계까지 내려갔다는 뜻이다.

### 용어 | SQL (재귀 CTE)

- `WITH RECURSIVE 이름 AS (시작 UNION ALL 반복)`: `UNION ALL` 위는 시작 행이고, 아래는 "지금까지 찾은 행(`subtree`)의 자식"을 찾는 식이다. DB는 아래 식을 새로 붙는 행이 없을 때까지 되풀이한다. 매 회차에 무엇과 조인하는지는 아래 "재귀 CTE가 도는 순서"에서 다룬다.

### 개념 | 재귀 CTE가 도는 순서

0장 개념 2에서는 "더 붙일 것이 없을 때까지 되풀이한다"고만 했다.

처음 보면 헷갈리는 것은 아래 식의 `JOIN subtree s`에서 `subtree`가 무엇을 가리키느냐다. 지금까지 쌓인 전체가 아니라 **바로 앞 회차에 새로 붙은 행들만** 가리킨다.

#### 회차를 눈으로 보기

회차 번호(`step`)를 하나 더 들고 다니게 하면 눈으로 볼 수 있다.

```sql
WITH RECURSIVE subtree AS (
  SELECT id, 0 AS step FROM categories WHERE id = 1
  UNION ALL
  SELECT c.id, s.step + 1 FROM categories c JOIN subtree s ON c.parent_id = s.id
)
SELECT step, array_agg(id ORDER BY id) FROM subtree GROUP BY step ORDER BY step;
--  step | array_agg
-- ------+-----------
--     0 | {1}
--     1 | {2,5}
--     2 | {3,4,6}
```

| 회차 | 조인 상대(앞 회차에 새로 붙은 행) | 새로 붙는 행 |
|---|---|---|
| 0(시작) | 없음 | 1 |
| 1 | 1 | 2, 5 |
| 2 | 2, 5 | 3, 4, 6 |
| 3 | 3, 4, 6 | 없음 → 끝 |

C로 치면 "이번 단계 노드 목록"으로 "다음 단계 노드 목록"을 만들고, 목록이 비면 멈추는 단계별(너비 우선) 탐색이다. 최종 결과는 모든 회차의 행을 합친 것이다.

2단계의 `treeNaive`와 같은 순서로 내려가지만, 회차마다 앱과 DB 사이를 왕복하지 않고 DB 안에서 돈다.

#### `UNION ALL`과 `UNION`, 그리고 순서

- `UNION ALL`은 붙는 행을 그대로 쌓는다. `UNION`으로 쓰면 이미 나온 행과 모든 칸이 같은 행은 버린다. 그래서 `id, parent_id`만 들고 다니는 CTE는 `UNION`만으로도 고리에서 멈춘다.

- 하지만 5단계처럼 `depth`를 들고 다니면 같은 카테고리도 회차마다 `depth`가 달라 "다른 행"이 되므로 `UNION`으로도 멈추지 않는다. 7단계의 `CYCLE` 절이 필요한 이유다.

- 회차 순서대로 쌓인다고 결과 순서가 보장되지는 않는다. 순서가 필요하면 5단계처럼 `ORDER BY`를 따로 적는다.

> 재귀 CTE가 끝나는 조건은 "새로 붙는 행이 없음" 하나뿐이다. 고리가 있으면 그 조건이 오지 않는다(7단계).

### 개념 | `$queryRaw`: 값은 매개변수로, 결과 타입은 약속으로

재귀 CTE는 Prisma의 `findMany`로 쓸 수 없어서 `$queryRaw`로 SQL을 직접 보낸다. 이때 두 가지를 알아 둔다.

#### `${id}`는 문자열 이어 붙이기가 아니다

`` $queryRaw`... WHERE id = ${id}` ``는 백틱 앞에 함수 이름을 붙인 태그드 템플릿이다.

JavaScript가 문자열을 먼저 완성하는 것이 아니라, SQL 조각들과 값들을 따로 `$queryRaw`에 넘긴다. Prisma는 `${id}` 자리를 `$1` 같은 매개변수로 바꾸고 값은 따로 보낸다.

- 그래서 `id`에 `"1; DROP TABLE categories"` 같은 값이 와도 SQL로 해석되지 않는다(SQL 인젝션이 안 된다).

- 대신 값 자리에만 쓸 수 있다. 테이블 이름이나 칸 이름을 `${...}`로 넣으면 문자열 값으로 들어가 SQL 에러가 난다.

- 괄호를 붙여 `` $queryRaw(`... ${id}`) ``처럼 쓰면 JavaScript가 문자열을 먼저 완성해 버려 이 보호가 사라진다. `$queryRaw`는 완성된 문자열을 받지 않으므로 타입 에러로 드러난다. 문자열을 그대로 보내는 `$queryRawUnsafe`에는 이 보호가 없다.

#### 타입 인자는 검사하지 않는다

`$queryRaw<{ id: number; name: string; ... }[]>`의 타입 인자는 "결과가 이런 모양일 것"이라는 **약속**이다. Prisma는 실행 시 결과를 이 타입에 맞는지 검사하지 않는다.

- 칸 이름은 SQL에 적은 그대로 돌아온다. `c.name AS category`라고 적었으니 `category`이고, `parent_id`를 고르면 `parentId`가 아니라 `parent_id`다.

- PostgreSQL의 `integer`는 `number`로, `boolean`은 `boolean`으로 온다. 이 문서의 쿼리는 이 두 가지만 돌려준다(6단계의 `EXISTS`도 `boolean`이다).

- 주의할 것은 `bigint`다. `count(*)`가 `bigint`라서 JavaScript의 `BigInt`로 오고, 그대로 응답하면 `JSON.stringify`가 `TypeError: Do not know how to serialize a BigInt`로 실패한다. 타입 인자에 `number`라고 적어도 실제 값은 `BigInt`다.

### 남길 것

- **찾아보면 되는 것**: `WITH RECURSIVE`의 모양(시작 `UNION ALL` 반복), `array_agg`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 재귀 CTE의 반복 쪽 `JOIN`은 "바로 앞 회차에 새로 붙은 행들"과 조인한다. 새로 붙는 행이 없을 때 끝난다.
  
  - `$queryRaw`의 `${값}`은 매개변수라 안전하지만, 타입 인자는 검사하지 않는 약속이다. 칸 이름과 `bigint`는 직접 챙긴다.

- **에러 신호**:
  
  - `{"message":"category 999 not found","error":"Not Found","statusCode":404}` → 그 id의 카테고리가 있는지(`ensureExists`)
  
  - `TypeError: Do not know how to serialize a BigInt` → `$queryRaw` 결과에 `count(*)` 같은 `bigint` 칸이 있는지

## 6. 5단계: 경로(빵부스러기), 위로 올라가는 재귀

상품 화면 위쪽의 "전자기기 > 컴퓨터 > 키보드"다. 이번에는 부모 쪽으로 올라간다.

### 작업 1. [커밋] 경로 조회

```ts
// src/categories/categories.service.ts
// productsInSubtree 아래에 추가한다
  // 5단계: 루트부터 이 카테고리까지의 경로(빵부스러기). 위로 거슬러 올라가는 재귀 CTE
  async path(id: number) {
    await this.ensureExists(id);
    return this.prisma.$queryRaw<{ id: number; name: string; depth: number }[]>`
      WITH RECURSIVE ancestors AS (
        SELECT id, name, parent_id, 0 AS depth FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id, c.name, c.parent_id, a.depth + 1 FROM categories c JOIN ancestors a ON c.id = a.parent_id
      )
      SELECT id, name, depth FROM ancestors ORDER BY depth DESC`;
  }
```

4단계와 조인 방향만 반대다(`c.parent_id = s.id` 대신 `c.id = a.parent_id`).

`depth`를 하나씩 늘려 두면 루트부터 순서대로 정렬할 수 있다.

컨트롤러에 `GET :id/path`를 추가한다.

```ts
// src/categories/categories.controller.ts
// products 아래에 추가한다
  @Get(":id/path")
  path(@Param("id", ParseIntPipe) id: number) {
    return this.categories.path(id);
  }
```

### 작업 2. [확인] 루트까지의 경로가 나오는지

시드 트리에서 키보드(3)의 부모는 컴퓨터(2), 컴퓨터의 부모는 전자기기(1)다.

```sh
# 3 키보드: 전자기기 > 컴퓨터 > 키보드
curl localhost:4000/categories/3/path

# 7 생활: 루트라서 자기 자신 하나
curl localhost:4000/categories/7/path

# 없는 카테고리: 404
curl localhost:4000/categories/999/path

# 숫자가 아닌 id: 400 (아래 "경로 변수와 ParseIntPipe"에서 다룬다)
curl localhost:4000/categories/abc/path
```

`depth`는 "시작한 카테고리에서 몇 단계 위인가"다. 키보드 자신이 0, 부모가 1, 조부모가 2다. `ORDER BY depth DESC`로 큰 것부터 놓았기 때문에 루트가 맨 앞에 오고, 화면에 그대로 `전자기기 > 컴퓨터 > 키보드`로 이어 붙이면 된다.

### 개념 | 경로 변수와 `ParseIntPipe`

`@Get(":id/path")`의 `:id`는 그 자리의 문자열을 받는 변수다. URL에서 온 값은 항상 문자열이므로 `ParseIntPipe`가 숫자로 바꾼다.

- `GET /categories/abc/path`는 서비스까지 가지 않고 `ParseIntPipe`에서 `{"message":"Validation failed (numeric string is expected)","error":"Bad Request","statusCode":400}`로 끝난다.

- `GET /categories/999/path`는 숫자라서 통과하고, 서비스의 `ensureExists`가 404를 던진다. 400과 404가 어느 층에서 나왔는지 다르다.

- `@Get("tree")`와 `@Get(":id/path")`는 서로 겹치지 않는다. 앞은 한 칸(`/categories/tree`), 뒤는 두 칸(`/categories/3/path`)이라서다. 만약 `@Get(":id")` 한 칸짜리를 만든다면 `"tree"`를 먼저 적어야 `:id`가 `"tree"`를 가로채지 않는다(`02`의 2단계와 같은 이야기).

### 남길 것

- **찾아보면 되는 것**: 위로 올라가는 조인 조건(`c.id = a.parent_id`). 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 내려가기와 올라가기는 같은 재귀 CTE에서 조인 방향만 바꾼 것이다. 회차를 세는 칸(`depth`)을 들고 다니면 정렬할 수 있다.

- **에러 신호**:
  
  - `Validation failed (numeric string is expected)`(400) → 경로의 `:id` 자리에 숫자가 아닌 값이 왔는지

## 7. 6단계: 옮기기, 자기 후손 아래로는 못 간다

"컴퓨터"를 "키보드" 아래로 옮기면, 키보드의 부모는 컴퓨터이므로 컴퓨터 → 키보드 → 컴퓨터 고리가 생긴다.

그래서 옮기기 전에 **새 부모의 조상 중에 내가 있는지** 확인한다. 5단계의 위로 올라가는 재귀를 그대로 쓴다.

### 작업 1. [커밋] 옮기기 서비스

```ts
// src/categories/categories.service.ts
// path 아래, ensureExists 위에 추가한다
  // 6단계: 카테고리를 다른 부모 아래로 옮긴다. 자기 자신이나 자기 후손 아래로는 못 옮긴다(순환 방지)
  async move(id: number, newParentId: number | null) {
    return this.prisma.$transaction(async (tx) => {
      // 트리 구조를 바꾸는 동안 다른 이동이 끼어들지 못하게, 테이블 단위가 아니라 "트리 변경 권한" 하나를 잠근다(앞에서 쓴 advisory lock)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(726002)`;
      const node = await tx.category.findUnique({ where: { id } });
      if (!node) throw new NotFoundException(`category ${id} not found`);
      if (newParentId !== null) {
        if (newParentId === id) throw new BadRequestException("자기 자신 아래로 옮길 수 없습니다");
        // 새 부모의 조상 중에 내가 있으면, 옮기는 순간 고리(순환)가 생긴다
        const [{ cycle }] = await tx.$queryRaw<{ cycle: boolean }[]>`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM categories WHERE id = ${newParentId}
            UNION ALL
            SELECT c.id, c.parent_id FROM categories c JOIN ancestors a ON c.id = a.parent_id
          )
          SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = ${id}) AS cycle`;
        if (cycle) throw new BadRequestException("자기 후손 아래로 옮길 수 없습니다(순환 발생)");
      }
      return tx.category.update({ where: { id }, data: { parentId: newParentId }, select: { id: true, name: true, parentId: true } });
    });
  }
```

`const [{ cycle }] = ...`는 결과 배열의 첫 행에서 `cycle` 칸을 꺼내는 구조 분해다. `SELECT EXISTS (...)`는 언제나 정확히 한 행을 돌려주므로 첫 행이 비는 일이 없다.

### 작업 2. [커밋] 요청 본문 DTO

```ts
// src/categories/move-category.dto.ts
import { IsInt, IsPositive, ValidateIf } from "class-validator";

export class MoveCategoryDto {
  // null이면 맨 위(루트)로 옮긴다. ValidateIf : null이 아닐 때만 아래 검사를 한다
  @ValidateIf((_, v) => v !== null) @IsInt() @IsPositive() parentId!: number | null;
}
```

### 작업 3. [커밋] 컨트롤러에 `PATCH :id` 추가하고 확인

트리를 바꾸는 요청은 로그인을 요구한다(실제 서비스라면 관리자만, `03`의 도전 과제 1).

```ts
// src/categories/categories.controller.ts
// import 줄을 바꾸고 두 줄을 더한 뒤, path 아래에 경로를 추가한다
import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { MoveCategoryDto } from "./move-category.dto.js";

  // 트리를 바꾸는 요청은 로그인을 요구한다(실제 서비스라면 관리자만)
  @Patch(":id")
  @UseGuards(AuthGuard("jwt"))
  move(@Param("id", ParseIntPipe) id: number, @Body() dto: MoveCategoryDto) {
    return this.categories.move(id, dto.parentId);
  }
```

로그인 토큰을 변수에 담고 옮겨 본다. 시드 사용자 `kim`의 비밀번호는 `.env`의 `DEMO_PASSWORD`(`1234`)다.

```sh
TOKEN=$(curl -s -X POST localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"id":"kim","password":"1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

# 컴퓨터(2)를 키보드(3) 아래로
curl -X PATCH localhost:4000/categories/2 -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"parentId":3}'

# 출력
{"message":"자기 후손 아래로 옮길 수 없습니다(순환 발생)","error":"Bad Request","statusCode":400}
```

나머지 경우는 `curl`을 매번 길게 치지 않도록 함수로 묶는다. `move_cat 옮길id 새부모id` 모양으로 부른다.

```sh
# 터미널 2: 위의 TOKEN을 쓴다. 터미널을 새로 열었다면 TOKEN=... 줄부터 다시 실행한다
move_cat() {
  curl -s -X PATCH localhost:4000/categories/$1 -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d "{\"parentId\":$2}"
  echo   # 응답 끝에 줄바꿈이 없어 다음 프롬프트와 붙는 것을 막는다
}
```

시드 트리를 다시 떠올리면 이렇다.

```text
1 전자기기
  2 컴퓨터
    3 키보드
    4 마우스
  5 음향
    6 헤드폰
7 생활
  8 주방
```

막혀야 하는 경우 세 가지와 통과해야 하는 경우 세 가지를 차례로 부른다.

```sh
# 막혀야 한다(400): 데이터는 바뀌지 않는다
move_cat 2 2 # 컴퓨터를 자기 자신 아래로
{"message":"자기 자신 아래로 옮길 수 없습니다","error":"Bad Request","statusCode":400}

move_cat 2 3 # 컴퓨터를 자기 자식(키보드) 아래로 → 2 → 3 → 2 고리
{"message":"자기 후손 아래로 옮길 수 없습니다(순환 발생)","error":"Bad Request","statusCode":400}

move_cat 1 6 # 전자기기를 손자(헤드폰) 아래로 → 두 단계 아래여도 막힌다
{"message":"자기 후손 아래로 옮길 수 없습니다(순환 발생)","error":"Bad Request","statusCode":400}

# 통과해야 한다(200): 음향(5)을 옮겼다가 원래 자리(1)로 되돌린다
move_cat 5 7 # 음향을 생활 아래로
{"id":5,"name":"음향","parentId":7}

move_cat 5 null # 음향을 맨 위(루트)로. JSON의 null이라 따옴표 없이 쓴다
{"id":5,"name":"음향","parentId":null}

move_cat 5 1 # 원래 자리로 되돌린다
{"id":5,"name":"음향","parentId":1}
```

- 첫 줄은 서비스의 `newParentId === id` 검사에서, 둘째·셋째 줄은 재귀 CTE가 새 부모의 조상에서 나를 찾아서 막힌 것이다. `1 6`은 헤드폰의 조상(음향 → 전자기기)을 끝까지 올라가서야 1을 찾는다.

- 200 응답은 서비스가 `select`로 고른 세 칸(`id`, `name`, `parentId`)이다. 마지막에 1로 되돌렸으므로 트리는 시드와 같다. `curl localhost:4000/categories/tree`로 확인할 수 있다.

입력 자체가 잘못된 경우는 서비스까지 가기 전에 다른 층에서 막힌다.

```sh
move_cat 99 1 # 없는 카테고리 → 서비스의 findUnique에서 404
{"message":"category 99 not found","error":"Not Found","statusCode":404}

move_cat 2 0 # 0은 양수가 아니다 → DTO의 @IsPositive에서 400
{"message":["parentId must be a positive number"],"error":"Bad Request","statusCode":400}
```

액세스 토큰은 15분(`.env`의 `ACCESS_TOKEN_TTL`) 뒤 만료된다. `{"message":"Unauthorized","statusCode":401}`가 나오면 위의 `TOKEN=...` 줄로 다시 받는다.

### 용어 | SQL (advisory lock, EXISTS)

- `pg_advisory_xact_lock(키)`: 숫자 키 하나에 거는 잠금이다. 트랜잭션이 끝나면 저절로 풀린다(`04`에서 본 세션 잠금과 달리, 커넥션 풀에서 써도 안전하다). 그래서 반드시 트랜잭션 안(`tx`)에서 불러야 하며, 아래 "트랜잭션에 묶인 잠금"에서 다룬다.

- `EXISTS (서브쿼리)`: 서브쿼리 결과가 한 행이라도 있으면 true다.

### 개념 | 트랜잭션에 묶인 잠금

`pg_advisory_xact_lock`에는 푸는 함수가 없다. 잡은 트랜잭션이 `COMMIT`이나 `ROLLBACK`으로 끝나는 순간 DB가 풀어 준다.

`move`가 잠금을 `$transaction` 콜백의 첫 줄에서 `tx`로 잡는 이유다. 검사와 `update`가 모두 같은 트랜잭션 안에 있으니, 잠금은 변경이 커밋될 때까지 유지된다.

#### 흔한 실수: 트랜잭션 밖에서 부르기

```ts
return this.prisma.$transaction(async (tx) => {
  // 잘못: tx가 아니라 this.prisma로 부르면 이 한 문장이 자기만의 트랜잭션이 되어,
  // 문장이 끝나는 순간 잠금도 풀린다. 아래 검사와 update는 보호받지 못한다
  await this.prisma.$executeRaw`SELECT pg_advisory_xact_lock(726002)`;
  // ...
});
```

psql 두 개로 확인하면 차이가 보인다. `pg_try_advisory_xact_lock`은 기다리지 않고 잡을 수 있으면 `t`, 이미 누가 잡고 있으면 `f`를 돌려준다.

```text
-- 세션 A: 트랜잭션 없이 잡는다
SELECT pg_advisory_xact_lock(726002);
-- 세션 B
SELECT pg_try_advisory_xact_lock(726002); -- t (A의 잠금은 이미 풀렸다)

-- 세션 A: 이번에는 트랜잭션 안에서 잡고 COMMIT하지 않는다
BEGIN; SELECT pg_advisory_xact_lock(726002);
-- 세션 B
SELECT pg_try_advisory_xact_lock(726002); -- f (A가 COMMIT할 때까지 못 잡는다)
```

#### 세션 잠금과 비교

| 구분 | `pg_advisory_lock`(세션) | `pg_advisory_xact_lock`(트랜잭션) |
|---|---|---|
| 풀리는 때 | `pg_advisory_unlock` 호출 또는 연결 종료 | 트랜잭션 종료 |
| 푸는 걸 잊으면 | 연결이 풀로 돌아가도 잠금이 남는다 | 잊을 일이 없다 |
| 트랜잭션 밖에서 부르면 | 연결이 살아 있는 동안 유지 | 그 문장이 끝나며 바로 풀린다 |

- 같은 트랜잭션에서 같은 키를 다시 잡아도 막히지 않는다. 다른 트랜잭션만 기다린다.

- 키 `726002`는 아무 숫자나 정한 것이다. 같은 일을 하는 코드끼리 같은 숫자를 쓰기만 하면 된다. 다른 일에 쓰는 키(`04`의 리더 선출 키 같은 것)와 겹치지만 않으면 된다.

> C의 `pthread_mutex_lock`은 모든 반환 경로에서 `unlock`을 챙겨야 하지만, 이 잠금은 트랜잭션이 끝나면 DB가 대신 푼다. 예외로 `ROLLBACK`돼도 마찬가지다.

### 개념 | 왜 잠그는가

검사와 변경 사이에 틈이 있으면 `02`의 0장 개념 1과 같은 경쟁 조건이 생긴다.

두 요청이 동시에 "A를 B 아래로", "B를 A 아래로"를 하면, 둘 다 검사 시점에는 고리가 없어서 통과한다. 둘 다 반영되면 고리가 생긴다.

두 요청은 서로 다른 행을 고치므로 `02`의 행 잠금으로는 막을 수 없다. 그래서 **"트리 구조를 바꾸는 권리" 하나를 `04`의 advisory lock으로 잠근다.**

> 트리 이동은 드문 관리 작업이라 한 번에 하나씩 처리해도 충분하다.

### 개념 | 검사에 걸리면 트랜잭션은 어떻게 끝나나

`move`의 `throw new BadRequestException(...)`은 `$transaction` 콜백 안에서 던져진다. 그 뒤에 일어나는 일은 이렇다.

1. 콜백이 반환한 Promise가 거부(reject)된다.

2. Prisma가 그것을 보고 트랜잭션을 `ROLLBACK`한다. 아직 아무것도 바꾸지 않았으니 되돌릴 것은 없지만, 그 순간 advisory lock도 풀린다.

3. 같은 예외가 `$transaction`을 부른 쪽으로 다시 던져지고, 컨트롤러를 거쳐 Nest가 `BadRequestException`을 400 응답으로 바꾼다.

예외를 던지는 것만으로 잠금 해제, 롤백, 응답 코드가 한꺼번에 정리된다. `try/finally`로 잠금을 푸는 코드를 따로 쓸 필요가 없다.

### 개념 | `null`과 빠진 값: `ValidateIf`가 가르는 것

JSON에는 `null`은 있지만 `undefined`는 없다. 본문에 `parentId` 키를 아예 안 보내면 DTO의 `parentId`는 `undefined`가 된다.

| 본문 | `dto.parentId` | `ValidateIf((_, v) => v !== null)` | 결과 |
|---|---|---|---|
| `{"parentId":3}` | `3` | 참 → `@IsInt`·`@IsPositive` 검사 통과 | 3 아래로 옮긴다 |
| `{"parentId":null}` | `null` | 거짓 → 검사를 건너뛴다 | 맨 위로 옮긴다 |
| `{}` | `undefined` | 참(`undefined !== null`) → `@IsInt` 실패 | 400 |
| `{"parentId":"3"}` | `"3"` | 참 → `@IsInt` 실패 | 400 |

`{}`를 400으로 막는 것이 이 조건의 요점이다.

`v != null`(느슨한 비교)이나 `@IsOptional()`을 썼다면 `{}`도 검사를 건너뛰고 `move(id, undefined)`가 불린다. 서비스는 `null`과 숫자만 생각하고 짰으니, 그 뒤 동작은 보장할 수 없다.

> C로 치면 `NULL` 포인터(루트로 옮겨라)와 초기화하지 않은 값(아무 말도 안 했다)을 구별하는 것이다.

### 남길 것

- **찾아보면 되는 것**: `pg_advisory_xact_lock`·`pg_try_advisory_xact_lock`, 세션/트랜잭션 잠금 비교 표, `ValidateIf`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 검사와 변경 사이의 틈은 "서로 다른 행을 고치는" 요청끼리도 문제를 만든다. 그럴 때는 행이 아니라 "그 일을 할 권리" 하나를 advisory lock으로 잠근다.
  
  - 트랜잭션 잠금은 반드시 `tx`로 부른다. `this.prisma`로 부르면 그 문장이 끝나는 순간 풀려서 아무것도 지키지 못한다.

- **에러 신호**:
  
  - `자기 자신 아래로 옮길 수 없습니다` / `자기 후손 아래로 옮길 수 없습니다(순환 발생)`(400) → 의도한 거부다. 새 부모가 내 후손인지 확인한다
  
  - `{"message":"Unauthorized","statusCode":401}` → 토큰이 만료(15분)됐거나 새 터미널이라 `$TOKEN`이 없다
  
  - `["parentId must be a positive number","parentId must be an integer number"]`(400) → 본문에 `parentId`가 빠졌다. 맨 위로 옮기려면 `null`을 보낸다
  
  - `["parentId must be a positive number"]`(400) 하나만 → `0`이나 음수를 보냈다

## 8. 7단계: 일부러 깨뜨려보기 ② 이미 고리가 있는 데이터

API는 고리를 막지만, `psql`로 직접 고치거나 예전 버그로 이미 고리가 들어간 데이터는 막지 못한다.

### 실험 | 고리를 직접 만들고 경로 조회하기

6단계에서 옮긴 카테고리를 `npx prisma db seed`로 되돌린 뒤 직접 만들어 본다.

```sh
npx prisma db seed
docker compose exec db psql -U order -d order_api
```

```text
order_api=# UPDATE categories SET parent_id = 3 WHERE id = 1;    -- 전자기기의 부모를 키보드로
order_api=# SELECT id, name, parent_id FROM categories WHERE id <= 3 ORDER BY id;
 id |   name   | parent_id
----+----------+-----------
  1 | 전자기기 |         3
  2 | 컴퓨터   |         1
  3 | 키보드   |         2       -- 1 → 3 → 2 → 1 고리
```

```sh
# -m 3: 3초가 지나면 기다리지 않고 끝낸다
curl -s -m 3 localhost:4000/categories/3/path
# 3초 동안 응답 없음, curl 종료 코드 28 = 시간 초과
```

`02`의 진단 2에서 쓴 쿼리로 DB를 보면 경로 쿼리가 아직 돌고 있다.

```text
order_api=# SELECT pid, now() - query_start AS running, left(query, 50) FROM pg_stat_activity WHERE query LIKE '%WITH RECURSIVE ancestors%' AND pid <> pg_backend_pid();
 614 | 00:00:03.174078 | WITH RECURSIVE ancestors AS ( SELEC...
order_api=# SELECT pg_cancel_backend(614);     -- 쿼리만 취소한다(연결은 그대로)
```

취소하자 서버 로그에 `canceling statement due to user request`와 Prisma의 `P2010`(raw 쿼리 실패)이 찍혔다.

취소하지 않았다면 이 쿼리는 행을 끝없이 쌓으며 CPU와 메모리를 쓰고, 그 커넥션을 붙잡고 있었을 것이다. 같은 요청이 몇 번만 더 오면 `02`의 6단계처럼 커넥션 풀이 마른다.

`curl -m 3`이 끝났다고 DB의 쿼리가 멈추지는 않는다는 점도 눈여겨본다. 클라이언트가 끊어도 서버는 이미 보낸 쿼리의 결과를 기다리고, DB는 그 쿼리를 계속 돌린다.

### 작업 1. [커밋] 고치기: `CYCLE` 절

PostgreSQL 14부터 재귀 CTE에 "이미 지나온 값을 다시 만나면 멈춘다"를 선언할 수 있다. 고리 데이터를 그대로 둔 채 psql에서 먼저 확인한다.

이 확인은 **바로 위 실험에서 만든 고리(1 → 3 → 2 → 1)가 DB에 있어야** 의미가 있다. 실험을 건너뛰었거나 그 뒤에 시드를 다시 넣었다면, 아래 쿼리는 고리를 만나지 않아 `is_cycle`이 모두 `f`인 3줄로 끝난다. 쿼리가 틀린 것이 아니라 데이터에 고리가 없을 뿐이다.

먼저 고리가 있는지 본다.

```sh
docker compose exec -T db psql -U order -d order_api -c "SELECT id, name, parent_id FROM categories WHERE id <= 3 ORDER BY id"
```

전자기기(1)의 `parent_id`가 `3`이면 고리가 있는 것이다. 비어 있으면(시드 그대로면) 고리를 만든다.

```sh
docker compose exec -T db psql -U order -d order_api -c "UPDATE categories SET parent_id = 3 WHERE id = 1"
```

```sh
docker compose exec db psql -U order -d order_api
order_api=# WITH RECURSIVE ancestors AS (
              SELECT id, name, parent_id, 0 AS depth FROM categories WHERE id = 3
              UNION ALL
              SELECT c.id, c.name, c.parent_id, a.depth + 1 FROM categories c JOIN ancestors a ON c.id = a.parent_id
            ) CYCLE id SET is_cycle USING visited
            SELECT id, name, depth, is_cycle FROM ancestors;
 id |   name   | depth | is_cycle
----+----------+-------+----------
  3 | 키보드   |     0 | f
  2 | 컴퓨터   |     1 | f
  1 | 전자기기 |     2 | f
  3 | 키보드   |     3 | t        -- 이미 지나온 3을 다시 만났다. 여기서 멈춘다
```

0장 개념 3에서 C로 고리를 찾을 때 방문 표시를 남기는 것과 같은 방법이다.

세 CTE(4~6단계) 모두에 붙이고, 마지막 행(`is_cycle = true`)은 결과에서 뺀다.

```ts
// src/categories/categories.service.ts
// productsInSubtree: CTE 끝에 CYCLE 절을 붙이고, WHERE에서 고리 행을 뺀다
      WITH RECURSIVE subtree AS (
        SELECT id FROM categories WHERE id = ${id}          -- 시작점
        UNION ALL
        SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id   -- 바로 아래 자식들을 계속 붙인다
      ) CYCLE id SET is_cycle USING visited   -- 이미 지나온 id를 다시 만나면 거기서 멈춘다(7단계)
      SELECT p.id, p.name, p.price, c.name AS category
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.category_id IN (SELECT id FROM subtree WHERE NOT is_cycle)
      ORDER BY p.id`;
```

```ts
// src/categories/categories.service.ts
// path: 같은 방식
      WITH RECURSIVE ancestors AS (
        SELECT id, name, parent_id, 0 AS depth FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id, c.name, c.parent_id, a.depth + 1 FROM categories c JOIN ancestors a ON c.id = a.parent_id
      ) CYCLE id SET is_cycle USING visited
      SELECT id, name, depth FROM ancestors WHERE NOT is_cycle ORDER BY depth DESC`;
```

```ts
// src/categories/categories.service.ts
// move의 순환 검사: CYCLE 절만 붙인다(고리 행의 id는 이미 나온 id라 EXISTS 결과가 같다)
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM categories WHERE id = ${newParentId}
            UNION ALL
            SELECT c.id, c.parent_id FROM categories c JOIN ancestors a ON c.id = a.parent_id
          ) CYCLE id SET is_cycle USING visited
          SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = ${id}) AS cycle`;
```

### 작업 2. [확인] 고리가 있어도 응답이 오는지

고리(1 → 3 → 2 → 1)를 그대로 둔 채, 실험에서 멈췄던 요청을 다시 보낸다. 파일을 저장했으면 `--watch`가 서버를 다시 띄웠을 테니 터미널 1에 `Nest application successfully started`가 찍힌 뒤 보낸다.

```sh
# 실험 때처럼 3초 제한을 걸어 둔다. 고치기 전에는 여기서 시간 초과(28)였다
curl -s -m 3 localhost:4000/categories/3/path; echo " (종료 코드 $?)"
[{"id":1,"name":"전자기기","depth":2},{"id":2,"name":"컴퓨터","depth":1},{"id":3,"name":"키보드","depth":0}] (종료 코드 0)

curl -s -m 3 localhost:4000/categories/1/products; echo " (종료 코드 $?)"
[{"id":1,"name":"한정판 키보드","price":150000,"category":"키보드"},{"id":2,"name":"마우스","price":30000,"category":"마우스"},{"id":3,"name":"무선 헤드폰","price":90000,"category":"헤드폰"}] (종료 코드 0)
```

- 종료 코드 `0`은 `curl`이 3초 안에 응답을 받았다는 뜻이다. 고치기 전과 달리 쿼리가 끝난다.

- `3/path`는 키보드 → 컴퓨터 → 전자기기까지 올라간 뒤, 전자기기의 부모인 키보드(3)를 다시 만나 멈춘다. 그 행은 `is_cycle`이 참이라 `WHERE NOT is_cycle`로 빠졌다. psql에서 본 4줄 중 위 3줄만 남은 것이다.

- `1/products`도 1 → 2 → 3 → 1에서 1을 다시 만나 멈춘다. 상품 3개가 모두 나오는 것은 고리와 상관없이 그 카테고리들이 1의 아래에 있기 때문이다.

멈추기는 하지만 고리 데이터가 정상이 된 것은 아니다. 고리 때문에 결과가 이상해진 곳도 있다.

```sh
# 컴퓨터(2) 아래인데 헤드폰까지 나온다: 2 → 3 → 1 → 5 → 6으로 고리를 타고 넘어갔다
curl -s localhost:4000/categories/2/products;
[{"id":1,"name":"한정판 키보드",...,"category":"키보드"},{"id":2,"name":"마우스",...,"category":"마우스"},{"id":3,"name":"무선 헤드폰",...,"category":"헤드폰"}]

# 3단계 트리: 전자기기 쪽(1~6)이 통째로 빠지고 생활만 남는다(어떤 루트에도 이어지지 않으므로)
curl -s localhost:4000/categories/tree;
[{"id":7,"name":"생활","children":[{"id":8,"name":"주방","children":[]}]}]
```

다음 단계로 가기 전에 `npx prisma db seed`로 고리를 없앤다.

고리를 막는 것(6단계)과 고리가 있어도 안전하게 끝나는 것(이 단계)은 **둘 다 필요하다.** 앞의 것은 정상 경로를, 뒤의 것은 이미 망가진 데이터를 대비한다.

3단계의 메모리 조립은 고리가 있어도 무한히 돌지는 않는다(각 행을 한 번씩만 본다). 대신 고리에 걸린 노드들은 어떤 루트에도 이어지지 않아 트리 결과에서 빠진다.

> 화면에서 카테고리가 사라졌다면 고리를 의심한다.

### 용어 | SQL (`CYCLE` 절)

- `CYCLE id SET is_cycle USING visited`: 행마다 지나온 `id` 목록(`visited`)을 들고 다니다가, 이미 있는 `id`를 만나면 `is_cycle`을 참으로 표시하고 더 내려가지 않는다. 두 칸이 실제로 어떻게 생겼는지는 아래 "`CYCLE` 절이 붙이는 두 칸"에서 다룬다.

### 개념 | `CYCLE` 절이 붙이는 두 칸

`CYCLE` 절은 CTE 결과에 칸 두 개를 더한다.

`SET` 뒤의 이름(`is_cycle`)은 고리를 만났는지 표시하는 참/거짓 칸이고, `USING` 뒤의 이름(`visited`)은 그 행까지 지나온 값들의 배열이다. "고치기: `CYCLE` 절"에서 본 쿼리의 `SELECT`에 `visited`까지 넣어 보면 이렇다.

```text
 id | depth | is_cycle |      visited
----+-------+----------+-------------------
  3 |     0 | f        | {(3)}
  2 |     1 | f        | {(3),(2)}
  1 |     2 | f        | {(3),(2),(1)}
  3 |     3 | t        | {(3),(2),(1),(3)}
```

- 고리를 만난 행 자체는 결과에 **한 번 나온다**(`is_cycle = t`). 그 행에서 더 이어 가지 않을 뿐이다. 그래서 `productsInSubtree`와 `path`는 `WHERE NOT is_cycle`로 그 행을 뺀다. 빼지 않으면 경로에 키보드가 두 번 나온다.

- `visited`의 원소가 `(3)`처럼 괄호에 싸인 이유는 `CYCLE` 뒤에 칸을 여러 개 적을 수 있어서다(진단 2의 `CYCLE start, cur`). 적은 칸들을 묶은 행 하나가 원소가 된다.

- 방문 목록은 행마다 따로 들고 다닌다. "같은 경로 안에서 다시 만났는가"만 보므로, 서로 다른 갈래가 같은 행에 닿는 것은 고리로 치지 않는다.

#### PostgreSQL 14 이전이라면

같은 일을 직접 쓴다. 경로 배열을 칸으로 들고 다니며, 이미 지나온 id면 붙이지 않는다.

```sql
WITH RECURSIVE ancestors AS (
  SELECT id, name, parent_id, 0 AS depth, ARRAY[id] AS path FROM categories WHERE id = 3
  UNION ALL
  SELECT c.id, c.name, c.parent_id, a.depth + 1, a.path || c.id FROM categories c JOIN ancestors a ON c.id = a.parent_id
  WHERE NOT c.id = ANY(a.path) -- 이미 지나온 id면 붙이지 않는다
)
SELECT id, name, depth FROM ancestors;
-- 3 키보드 0 / 2 컴퓨터 1 / 1 전자기기 2 (고리 행이 아예 붙지 않는다)
```

> 0장 개념 3의 방문 표시와 같은 방법이지만, 표시가 전역 배열 하나가 아니라 행마다 들고 다니는 경로라는 점이 다르다.

### 남길 것

- **찾아보면 되는 것**: `CYCLE 칸 SET 표시칸 USING 경로칸`의 문법, `pg_cancel_backend`, PostgreSQL 14 이전의 `ARRAY[...]`·`= ANY(...)` 대체 방법. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 외래키는 고리를 막지 않는다. 고리를 막는 검사(6단계)와, 고리가 있어도 끝나는 쿼리(`CYCLE` 절)는 둘 다 필요하다.
  
  - 끝나지 않는 쿼리는 클라이언트가 끊어도 DB에서 계속 돌며 커넥션을 붙잡는다. `pg_stat_activity`에서 찾아 `pg_cancel_backend`로 끊는다.

- **에러 신호**:
  
  - `curl -m 3`이 종료 코드 28(시간 초과)로 끝난다 → `pg_stat_activity`에서 오래 도는 재귀 CTE, `CYCLE` 절이 빠졌는지
  
  - 서버 로그에 `canceling statement due to user request`와 `P2010` → 누군가 `pg_cancel_backend`로 그 쿼리를 취소했다. 왜 오래 돌았는지 본다
  
  - 트리 화면이나 `GET /categories/tree`에서 카테고리가 사라졌다 → 고리(진단 2)
  
  - psql의 `CYCLE` 확인 쿼리가 `is_cycle`이 모두 `f`인 3줄로 끝난다 → 쿼리가 아니라 데이터에 고리가 없다. 실험의 `UPDATE`를 건너뛰었거나 그 뒤 시드를 다시 넣었는지

## 9. 8단계: 일부러 깨뜨려보기 ③ 중간 카테고리 지우기

### 작업 1. [커밋] 단순한 삭제 API 만들기

삭제 API(`DELETE :id`, 로그인 필요)를 먼저 단순하게 만든다. 컨트롤러가 `PrismaService`를 직접 쓰므로 생성자에 하나 더 받는다.

```ts
// src/categories/categories.controller.ts
// import 줄에 Delete, HttpCode를 더하고, PrismaService를 import한 뒤 생성자에 추가한다
import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PrismaService } from "../prisma/prisma.service.js";
import { CategoriesService } from "./categories.service.js";
import { MoveCategoryDto } from "./move-category.dto.js";

@Controller("categories")
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly prisma: PrismaService,
  ) {}

  // ... treeNaive, tree, products, path, move 그대로 ...

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(AuthGuard("jwt"))
  async remove(@Param("id", ParseIntPipe) id: number) {
    // 8단계 깨뜨려보기 ③: 자식이 있는지 보지 않고 그냥 지운다 → 자식의 parent_id는 DB의 SET NULL로 NULL이 된다
    await this.prisma.category.delete({ where: { id } }); // 이 카테고리의 상품은 category_id가 NULL이 된다(상품 쪽 관계의 SET NULL)
  }
}
```

`@HttpCode(204)`는 성공 응답을 본문 없는 `204 No Content`로 바꾼다. 지운 뒤 돌려줄 것이 없기 때문이다.

### 실험 | 중간 카테고리 지우기

7단계의 고리를 시드로 되돌린 뒤 "컴퓨터"(2번)를 지운다. 지우기 전 트리는 이렇다.

```text
1 전자기기
  2 컴퓨터      ← 이것을 지운다
    3 키보드
    4 마우스
  5 음향
    6 헤드폰
7 생활
  8 주방
```

`GET /categories/tree`는 JSON 한 줄이라 구조가 눈에 잘 안 들어온다. 위처럼 들여쓰기로 찍어 주는 함수를 터미널 2에 만든다.

```sh
# 터미널 2: 트리를 받아 "id 이름"을 깊이만큼 들여 써서 찍는다
show_tree() {
  curl -s localhost:4000/categories/tree | node -e '
    const print = (nodes, depth) => nodes.forEach((n) => {
      console.log("  ".repeat(depth) + n.id + " " + n.name);
      print(n.children, depth + 1);
    });
    print(JSON.parse(require("fs").readFileSync(0)), 0);'
}
```

`node -e '...'`는 따옴표 안의 JavaScript를 바로 실행한다. `readFileSync(0)`은 표준 입력(파이프로 들어온 `curl`의 출력)을 읽는다. 3단계의 `tree`를 손으로 펼쳐 보는 것과 같은 재귀다.

이제 지운다. `TOKEN`은 6단계 작업 3에서 받은 것을 쓴다. 15분이 지났거나 터미널을 새로 열었다면 그 `TOKEN=...` 줄을 다시 실행한다.

```sh
npx prisma db seed
show_tree          # 지우기 전: 위 그림과 같다

# -w "%{http_code}": 응답 본문 뒤에 상태 코드를 찍는다. 204는 본문이 없어 코드만 나온다
curl -s -X DELETE localhost:4000/categories/2 -H "Authorization: Bearer $TOKEN" -w "%{http_code}\n"
show_tree # 지운 뒤
```

```text
204
1 전자기기
  5 음향
    6 헤드폰
3 키보드
4 마우스
7 생활
  8 주방
```

- `204`: 지우기에 성공했다는 뜻이다. `401`이 나오면 `TOKEN`이 만료된 것이다.

- 컴퓨터(2)가 사라졌는데 그 자식인 키보드(3)와 마우스(4)는 지워지지 않았다. 대신 전자기기 아래가 아니라 **맨 왼쪽(루트 자리)**에 찍힌다.

DB에서 직접 보면 이유가 보인다.

```sh
docker compose exec -T db psql -U order -d order_api -c "SELECT id, name, parent_id FROM categories WHERE id IN (3, 4)"
```

```text
 id |  name  | parent_id
----+--------+-----------
  3 | 키보드 |
  4 | 마우스 |
```

`parent_id`가 원래 `2`였는데 비어(NULL) 있다.

에러 없이 지워졌고, 키보드와 마우스는 **조용히 루트가 됐다.**

1단계에서 본 `ON DELETE SET NULL` 때문이다. 자식의 `parent_id`가 NULL이 되면, 0장 개념 1의 정의대로 그 행은 루트다.

아무도 의도하지 않은 구조 변경이 일어났다.

### 작업 2. [커밋] 고치기: 스키마에 `onDelete: Restrict`

중간 카테고리를 지울 때 자식을 어떻게 할지(같이 지울지, 위로 올릴지, 다른 곳으로 옮길지)는 서버가 멋대로 정할 일이 아니다.

DB는 거부하고, API는 이유를 알려 준다. 먼저 DB 쪽이다.

```prisma
// prisma/schema.prisma
// Category의 parent 줄에 onDelete: Restrict를 붙인다
  // onDelete: Restrict : 자식이 있는 카테고리는 지울 수 없다(기본값 SET NULL이면 자식들이 조용히 루트가 된다 - 8단계)
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id], onDelete: Restrict)
```

```sh
npx prisma migrate dev --name category-parent-restrict
npx prisma generate
```

```sql
-- prisma/migrations/..._category_parent_restrict/migration.sql

-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_parent_id_fkey";

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### 작업 3. [커밋] 고치기: API에서 409로 알리기

```ts
// src/categories/categories.controller.ts
// import 줄에 ConflictException을 더하고, remove를 이렇게 바꾼다
import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, UseGuards } from "@nestjs/common";

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(AuthGuard("jwt"))
  async remove(@Param("id", ParseIntPipe) id: number) {
    // 자식이 있으면 무엇을 해야 할지(같이 지울지, 위로 올릴지) 서버가 멋대로 정하지 않는다 → 먼저 옮기거나 지우라고 알려 준다
    const children = await this.prisma.category.count({ where: { parentId: id } });
    if (children > 0) throw new ConflictException(`하위 카테고리 ${children}개가 있어 지울 수 없습니다 - 먼저 옮기거나 지웁니다`);
    await this.prisma.category.delete({ where: { id } }); // 이 카테고리의 상품은 category_id가 NULL이 된다(상품 쪽 관계의 SET NULL)
  }
```

### 작업 4. [확인] API와 DB가 각각 막는지

실험 때와 같은 터미널 2에서 한다. `TOKEN`과 `show_tree`가 그대로 있어야 한다(없으면 6단계 작업 3의 `TOKEN=...` 줄과 위 실험의 `show_tree`를 다시 실행한다).

먼저 실험에서 지운 컴퓨터를 시드로 되살리고, API로 같은 요청을 다시 보낸다.

```sh
npx prisma db seed

# 자식(키보드·마우스)이 있는 컴퓨터(2): 막혀야 한다
curl -s -X DELETE localhost:4000/categories/2 -H "Authorization: Bearer $TOKEN" -w " (%{http_code})\n"
{"message":"하위 카테고리 2개가 있어 지울 수 없습니다 - 먼저 옮기거나 지웁니다","error":"Conflict","statusCode":409} (409)

# 자식이 없는 키보드(3): 지워져야 한다
curl -s -X DELETE localhost:4000/categories/3 -H "Authorization: Bearer $TOKEN" -w " (%{http_code})\n"
 (204)
```

- 첫 줄은 컨트롤러의 `count` 검사에서 막힌 것이다. 실험 때와 달리 `show_tree`로 보면 컴퓨터가 그대로 있다.

- 둘째 줄은 본문 없이 상태 코드만 찍혔다. 키보드는 자식이 없으니 지워진다.

키보드에 달려 있던 상품은 어떻게 됐는지 본다.

```sh
docker compose exec -T db psql -U order -d order_api -c "SELECT id, name, category_id FROM products ORDER BY id"

 id |     name      | category_id
----+---------------+-------------
  1 | 한정판 키보드 |
  2 | 마우스        |           4
  3 | 무선 헤드폰   |           6
  4 | 전기 주전자   |           8
```

한정판 키보드의 `category_id`가 `3`에서 NULL로 바뀌었다. 상품은 지워지지 않고 남는다(상품 쪽 관계는 `SET NULL` 그대로다).

이번에는 API를 거치지 않고 DB에 직접 컴퓨터를 지우라고 해 본다. 컨트롤러의 `count` 검사가 없으니, 막아 주는 것은 작업 2의 `RESTRICT`뿐이다.

```sh
# 키보드는 지웠지만 마우스(4)가 아직 컴퓨터(2)의 자식이다
docker compose exec -T db psql -U order -d order_api -c "DELETE FROM categories WHERE id 

ERROR:  update or delete on table "categories" violates foreign key constraint "categories_parent_id_fkey" on table "categories"
DETAIL:  Key (id)=(2) is still referenced from table "categories".
```

- `violates foreign key constraint "categories_parent_id_fkey"`: 작업 2의 마이그레이션이 다시 만든 그 외래키가 거부했다.

- `Key (id)=(2) is still referenced`: 2번을 가리키는 행(마우스)이 아직 있다는 뜻이다.

- 작업 2 전(`SET NULL`)이었다면 에러 없이 지워지고 마우스가 루트가 됐을 것이다.

다음으로 가기 전에 `npx prisma db seed`로 트리를 되돌린다.

**API의 검사는 친절한 메시지를 위한 것이고, 정확성을 보장하는 것은 DB의 `RESTRICT`다**(`01`의 6단계와 같은 이야기).

API의 `count`와 `delete` 사이에 다른 요청이 자식을 하나 붙여도, 마지막 관문인 DB가 거부한다.

상품 쪽 관계는 `SET NULL`을 그대로 두었다. 카테고리가 없어져도 상품은 남아야 하니, 상품에서는 그게 원하는 동작이다.

> 같은 기본값이라도 관계마다 맞는지 따로 판단해야 한다.

### 용어 | Prisma 스키마 문법 (참조 동작)

- `onDelete: Restrict`: 이 행을 가리키는 행이 남아 있으면 삭제를 거부한다. DB에는 `ON DELETE RESTRICT`로 만들어진다. 다른 선택지와 Prisma의 기본값은 아래 "참조 동작: 부모 행을 지울 때"에서 다룬다.

### 개념 | 참조 동작: 부모 행을 지울 때

외래키는 "가리키는 행이 존재하는가"를 지키는 제약이다(0장 개념 3).

그 약속이 깨지려 할 때, 즉 누군가 가리킴을 받는 행을 지우려 할 때 DB가 무엇을 할지 정하는 것이 참조 동작이다. Prisma의 `onDelete`가 SQL의 `ON DELETE`로 바뀐다.

| Prisma `onDelete` | SQL | 부모를 지우면 자식 행은 |
|---|---|---|
| `Cascade` | `CASCADE` | 같이 지워진다 |
| `SetNull` | `SET NULL` | 외래키 칸이 NULL이 된다(칸이 `?`여야 한다) |
| `Restrict` | `RESTRICT` | 삭제를 거부한다 |
| `NoAction` | `NO ACTION` | 삭제를 거부한다 |
| `SetDefault` | `SET DEFAULT` | 외래키 칸이 그 칸의 기본값으로 바뀐다 |

#### 적지 않았을 때의 기본값

`onDelete`를 적지 않으면 Prisma는 관계 칸이 선택(`?`)인지로 기본값을 고른다. 이 프로젝트의 마이그레이션에 둘 다 있다.

```sql
-- 필수 관계(Order.user: User): 적지 않으면 RESTRICT
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- 선택 관계(Product.category: Category?): 적지 않으면 SET NULL
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

1단계의 카테고리 부모 관계가 `SET NULL`이 된 것도 `parentId Int?`였기 때문이다. 루트를 표현하려고 `?`를 붙였더니 삭제 동작까지 함께 정해진 셈이다.

- `Cascade`를 골랐다면 컴퓨터 하나를 지울 때 키보드·마우스 카테고리까지 사라진다. 조용히 구조가 바뀐다는 점은 `SET NULL`과 같아서 여기서는 고르지 않았다.

- `RESTRICT`와 `NO ACTION`은 보통 같은 오류(`violates foreign key constraint`)로 거부한다. 차이는 검사를 트랜잭션 끝으로 미루도록 설정한 제약(`DEFERRABLE`)에서만 드러나며, `NO ACTION`만 미룰 수 있다.

- `ON UPDATE CASCADE`는 부모의 id 값이 바뀌면 자식의 외래키도 따라 바꾼다. `autoincrement` id는 바꾸지 않으니 이 문서에서는 일어나지 않는다.

> `?` 하나가 "값이 없어도 된다"와 "부모가 사라지면 NULL로 만든다"를 함께 뜻한다. 뒤의 것이 원하는 동작인지는 관계마다 따로 확인한다.

### 남길 것

- **찾아보면 되는 것**: `onDelete`의 다섯 가지 값과 SQL 대응 표, Prisma의 기본값 규칙. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - `SET NULL`은 에러 없이 구조를 바꾼다. 자기참조 트리에서는 중간 노드를 지우면 그 아래 가지가 조용히 루트가 된다.
  
  - API의 사전 검사는 친절한 메시지용이고, 정확성은 DB 제약(`RESTRICT`)이 보장한다. 둘 다 둔다.

- **에러 신호**:
  
  - `DELETE`가 204로 끝났는데 자식 카테고리들이 맨 위로 올라왔다 → 부모 관계의 `onDelete`(기본값 `SET NULL`)
  
  - `하위 카테고리 2개가 있어 지울 수 없습니다 - 먼저 옮기거나 지웁니다`(409) → 의도한 거부다. 자식을 먼저 옮기거나 지운다
  
  - `violates foreign key constraint "categories_parent_id_fkey"` → `RESTRICT`가 막았다. API를 거치지 않은 삭제인지 본다

## 10. 9단계: 회귀 테스트

### 작업 1. [커밋] 카테고리 회귀 테스트

순환 검사, 고리 데이터, 삭제 거부 세 가지를 테스트로 고정한다. 앱을 띄우는 부분은 `03`의 `auth.e2e-spec.ts`와 같다.

```ts
// test/categories.e2e-spec.ts
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { PrismaExceptionFilter } from "../src/prisma/prisma-exception.filter.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

describe("카테고리 트리 - 회귀 테스트", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
    await app.listen(0);
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
    await prisma.user.create({ data: { id: "kim", name: "김", passwordHash: await hashPassword("pw-for-test") } });
    // 1 ─ 2 ─ 3
    for (const [name, parentId] of [["가", null], ["나", 1], ["다", 2]] as const) await prisma.category.create({ data: { name, parentId } });
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "kim", password: "pw-for-test" }),
    });
    token = ((await res.json()) as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const move = (id: number, parentId: number | null) =>
    fetch(`${baseUrl}/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ parentId }),
    });

  it("자기 후손 아래로는 옮길 수 없습니다", async () => {
    expect((await move(1, 3)).status).toBe(400);
    expect((await move(1, 1)).status).toBe(400);
    expect((await move(3, 1)).status).toBe(200); // 위로 옮기는 것은 된다
  });

  it("이미 순환이 생긴 데이터에서도 경로 조회가 끝난다(CYCLE 절)", async () => {
    await prisma.$executeRaw`UPDATE categories SET parent_id = 3 WHERE id = 1`; // 1 → 3 → 2 → 1
    // AbortSignal.timeout(3000): 3초 안에 응답이 없으면 요청을 끊고 실패로 친다
    const res = await fetch(`${baseUrl}/categories/3/path`, { signal: AbortSignal.timeout(3000) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBe(3);
  });

  it("자식이 있는 카테고리는 지울 수 없다", async () => {
    const res = await fetch(`${baseUrl}/categories/2`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(409);
  });
});
```

둘째 테스트는 `CYCLE` 절을 지우면 3초 뒤 `AbortSignal.timeout`이 요청을 끊어 실패한다. 이 테스트가 없으면 `CYCLE` 절이 빠져도 정상 데이터에서는 아무도 모른다.

### 작업 2. [커밋] 기존 테스트와 테스트 DB 맞추기

기존 e2e 테스트(`checkout`, `auth`)의 `TRUNCATE` 목록에도 `categories`를 추가한다.

```ts
// test/checkout.e2e-spec.ts, test/auth.e2e-spec.ts
// beforeEach의 TRUNCATE 한 줄을 이렇게 바꾼다
    await prisma.$executeRaw`TRUNCATE categories, refresh_tokens, outbox_events, idempotency_keys, order_items, orders, products, users RESTART IDENTITY CASCADE`;
```

새 마이그레이션 두 개(`add_categories`, `category_parent_restrict`)가 생겼으니 테스트 DB에도 적용한다.

```sh
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
npm run test:e2e

# 출력
  ...
 ✓ test/app.e2e-spec.ts (1 test) 140ms

 Test Files  4 passed (4)
      Tests  8 passed (8)
   Start at  17:05:05
   Duration  4.10s (transform 176ms, setup 21ms, import 1.73s, tests 1.96s, environment 0ms)
```

### 남길 것

- **찾아보면 되는 것**: `AbortSignal.timeout(ms)`, `prisma migrate deploy`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - "끝나지 않는 것"을 테스트할 때는 시간 상한을 걸어 실패로 바꾼다. 그래야 `CYCLE` 절이 빠졌을 때 테스트가 멈추지 않고 빨간불이 된다.
  
  - 마이그레이션이 생기면 개발 DB만이 아니라 테스트 DB에도 적용한다.

- **에러 신호**:
  
  - 테스트가 `Raw query failed`(P2010) 에러로 실패하고 메시지에 `relation "categories" does not exist`가 보인다 → 테스트 DB에 `migrate deploy`를 했는지
  
  - 순환 테스트가 3초 뒤 `TimeoutError`로 실패한다 → 경로 쿼리에 `CYCLE` 절이 있는지

## 11. 디버깅

### 진단 1. 트리를 psql에서 눈으로 보기

```sql
-- 들여쓰기로 트리를 그린다. path 배열 순서로 정렬하면 부모 바로 아래에 자식이 온다
WITH RECURSIVE t AS (
  SELECT id, name, parent_id, ARRAY[id] AS path, 0 AS depth FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.name, c.parent_id, t.path || c.id, t.depth + 1 FROM categories c JOIN t ON c.parent_id = t.id
)
SELECT repeat('  ', depth) || name AS tree FROM t ORDER BY path;
```

여기에 안 나오는 카테고리가 있다면 루트에서 이어지지 않는 것이다.

고리에 걸렸거나(7단계), 부모가 존재하지 않는 경우다(외래키가 있으면 후자는 생기지 않는다).

### 용어 | SQL (트리 그리기)

- `ARRAY[id]`: 값 하나로 배열을 만든다.

- `t.path || c.id`: 배열 끝에 값을 붙인다(문자열에 쓰면 이어 붙이기였던 `||`가 배열에도 쓰인다).

- `repeat('  ', depth)`: 문자열을 `depth`번 되풀이한다.

- `ORDER BY path`: 배열끼리 비교해 정렬한다. 왜 이것만으로 부모 바로 아래에 자식이 오는지는 아래 "배열로 정렬하면 트리 순서가 되는 이유"에서 다룬다.

### 개념 | 배열로 정렬하면 트리 순서가 되는 이유

배열 비교는 앞 원소부터 하나씩 비교하다가 처음 달라지는 자리에서 크고 작음을 정한다. 한쪽이 다른 쪽의 앞부분과 같으면 짧은 쪽이 앞이다.

사전에서 단어를 찾는 순서와 같다. `path` 칸을 함께 꺼내 보면 이렇다.

```text
  path   |    tree
---------+------------
 {1}     | 전자기기
 {1,2}   |   컴퓨터
 {1,2,3} |     키보드
 {1,2,4} |     마우스
 {1,5}   |   음향
 {1,5,6} |     헤드폰
 {7}     | 생활
 {7,8}   |   주방
```

- 부모의 경로는 자식 경로의 앞부분이라 부모가 항상 먼저 온다(`{1,2}` < `{1,2,3}`).

- 한 가지의 후손은 모두 같은 앞부분을 가지므로 다음 형제보다 먼저 몰아서 나온다(`{1,2,4}` < `{1,5}`).

- 원소가 정수라서 숫자로 비교한다. 경로를 `'1/10'` 같은 문자열로 이어 붙여 정렬하면 글자 단위로 비교해서 `'1/10'`이 `'1/2'`보다 앞에 온다. 배열로는 `ARRAY[1,10] < ARRAY[1,2]`가 거짓이다.

> C의 `strcmp`가 문자 단위로 비교하듯, 배열 비교는 원소 단위로 비교한다. 원소가 정수라는 점만 다르다.

### 진단 2. 고리 찾기

```sql
-- 모든 카테고리에서 위로 올라가며, 자기 자신을 다시 만나는 것을 찾는다
WITH RECURSIVE up AS (
  SELECT id AS start, parent_id AS cur FROM categories
  UNION ALL
  SELECT up.start, c.parent_id FROM up JOIN categories c ON c.id = up.cur WHERE up.cur <> up.start
) CYCLE start, cur SET is_cycle USING visited
SELECT DISTINCT start FROM up WHERE cur = start;
```

결과가 비어 있어야 정상이다.

7단계의 고리 데이터라면 1, 2, 3이 나온다. 고리에 걸린 노드는 모두 자기 자신으로 돌아오기 때문이다.

찾았으면 고리 안의 한 행의 `parent_id`를 올바른 부모(또는 `NULL`)로 고쳐 고리를 끊는다.

### 진단 3. 끝나지 않는 쿼리

응답이 오지 않으면 `02`의 진단 1~2처럼 `pg_stat_activity`에서 오래 도는 쿼리를 찾고 `pg_cancel_backend(pid)`로 취소한다. 재귀 CTE가 범인이라면 `CYCLE` 절이 빠졌는지 본다.

> 안전망으로 트랜잭션 안에서 `SET LOCAL statement_timeout = '2s'`를 걸어 두는 방법도 있다(그 트랜잭션 안의 쿼리가 2초를 넘으면 DB가 스스로 취소한다).

### 진단 4. 에러 메시지·증상으로 원인 가르기

각 단계 끝 `남길 것`의 에러 신호를 모두 모았다. 메시지를 외우는 게 아니라, 보이는 것에서 어느 칸(먼저 볼 곳)으로 가는지만 익히면 된다.

| 콘솔·응답에 보이는 것 | 뜻 | 먼저 볼 곳 | 나온 곳 |
|---|---|---|---|
| 시드에서 자식이 엉뚱한 부모를 가리킨다 | 시퀀스가 되감기지 않아 id가 1부터 시작하지 않았다 | 시드 `TRUNCATE` 목록의 `categories` | 1단계 |
| 서버는 멀쩡히 뜨는데 `Cannot GET /categories/tree-naive`(404) | 모듈이 `AppModule`의 `imports` 사슬에 없어 Nest가 모른다 | `app.module.ts`의 `imports`에 `CategoriesModule` | 2단계 |
| `outbox 발행 실패 - 다음 회차에 다시 시도합니다`가 0.5초마다 | relay가 DB에 붙지 못한다 | `docker compose ps`에 `db`가 있는지 | 2단계 |
| `outbox_events` 쿼리가 0.5초마다 찍힌다(`PRISMA_LOG=query`) | 에러가 아니다. relay가 돈다 | 없음. 셀 때 거르기만 한다 | 2단계 |
| `count_tree`가 `no such file or directory: /tmp/sql.log`와 `0` | 로그 파일이 없다 | 서버를 `\| tee /tmp/sql.log`로 띄웠는지 | 2단계 |
| `count_tree tree`가 `tree-naive`와 같은 수 | 인자를 받지 않는 예전 함수다 | `type count_tree`, 함수 다시 정의 | 2단계 |
| `GET /categories/tree`에서 카테고리가 통째로 빠졌다 | 고리에 걸린 노드는 어떤 루트에도 이어지지 않는다 | 진단 2의 고리 찾기 | 3단계 |
| `category 999 not found`(404) | 그 id의 카테고리가 없다 | 요청한 id, `ensureExists` | 4단계 |
| `TypeError: Do not know how to serialize a BigInt` | `$queryRaw` 결과에 `bigint` 칸이 있다 | `count(*)` 같은 칸, 타입 인자를 믿지 말 것 | 4단계 |
| `Validation failed (numeric string is expected)`(400) | 경로의 `:id`가 숫자가 아니다 | 요청 URL | 5단계 |
| `자기 자신 아래로 옮길 수 없습니다` / `자기 후손 아래로 옮길 수 없습니다(순환 발생)`(400) | 의도한 거부다 | 새 부모가 내 후손인지 | 6단계 |
| `{"message":"Unauthorized","statusCode":401}` | 토큰이 만료(15분)됐거나 `$TOKEN`이 없다 | 로그인 줄로 `TOKEN`을 다시 받는다 | 6단계 |
| `parentId must be an integer number`(400) | 본문에 `parentId`가 빠졌거나 숫자가 아니다 | 맨 위로 옮기려면 `null`을 보낸다 | 6단계 |
| `parentId must be a positive number`(400)만 | `0`이나 음수를 보냈다 | 요청 본문 | 6단계 |
| `curl -m 3`이 종료 코드 28(시간 초과) | 재귀 CTE가 고리를 따라 끝없이 돈다 | `pg_stat_activity`, `CYCLE` 절 | 7단계 |
| `CYCLE` 확인 쿼리가 `is_cycle` 모두 `f`인 3줄 | 데이터에 고리가 없다 | 실험의 `UPDATE`를 했는지 | 7단계 |
| `canceling statement due to user request`와 `P2010` | `pg_cancel_backend`로 쿼리가 취소됐다 | 그 쿼리가 왜 오래 돌았는지 | 7단계 |
| `DELETE`가 204인데 자식 카테고리들이 맨 위로 올라왔다 | 부모 관계가 `ON DELETE SET NULL`이다 | 스키마의 `onDelete` | 8단계 |
| `하위 카테고리 2개가 있어 지울 수 없습니다 - 먼저 옮기거나 지웁니다`(409) | 의도한 거부다 | 자식을 먼저 옮기거나 지운다 | 8단계 |
| `violates foreign key constraint "categories_parent_id_fkey"` | `RESTRICT`가 삭제를 막았다 | API를 거치지 않은 삭제인지 | 8단계 |
| 테스트가 `Raw query failed`(P2010), 메시지에 `relation "categories" does not exist` | 테스트 DB에 새 마이그레이션이 없다 | 테스트 DB에 `migrate deploy` | 9단계 |
| 순환 테스트가 3초 뒤 `TimeoutError` | 경로 쿼리가 끝나지 않았다 | `CYCLE` 절 | 9단계 |
| 진단 1의 트리에 안 나오는 카테고리가 있다 | 루트에서 이어지지 않는다(고리) | 진단 2 | 11장 |
| 진단 2의 결과가 비어 있지 않다 | 그 카테고리들이 고리에 걸렸다 | 고리 안 한 행의 `parent_id`를 고친다 | 11장 |

### 도전 과제

#### 1. materialized path로 바꾸기

카테고리가 수만 개로 커져 4단계의 재귀가 느려졌다고 하자.

각 행에 루트부터의 경로 문자열(예: `/1/2/3/`)을 저장하고 `LIKE '/1/2/%'`로 하위를 찾는 방식(materialized path)으로 바꿔 본다.

옮길 때 무엇을 더 고쳐야 하는가? 6단계의 잠금은 왜 더 중요해지는가?

**답**

1. `categories`에 `path` 칸을 두고, 새 행은 부모의 `path` 뒤에 자기 id를 붙여 채운다(키보드는 `/1/2/3/`). 하위 상품은 `WHERE c.path LIKE '/1/%'`, 경로는 `path`를 `/`로 쪼갠 id들로 구한다. 재귀가 없으니 `CYCLE` 절도 필요 없다.

2. 앞부분 일치(`LIKE '/1/2/%'`)에 인덱스를 쓰려면 `text_pattern_ops`로 인덱스를 건다. 164개 트리에서 `SET enable_seqscan = off`를 걸고 `EXPLAIN`을 보면 이 인덱스로 찾는다.

3. 옮길 때는 내 행 하나가 아니라 **나와 후손 전부**의 `path` 앞부분을 바꿔야 한다. 컴퓨터(2)를 생활(7) 아래로 옮기면 컴퓨터는 `/1/2/` → `/7/2/`, 키보드는 `/1/2/3/` → `/7/2/3/`이 된다.

   ```sql
   UPDATE categories SET path = '/7/2/' || substr(path, length('/1/2/') + 1) WHERE path LIKE '/1/2/%';
   ```

4. 순환 검사는 재귀 없이 문자열 비교 하나다. 새 부모의 `path`가 내 `path`로 시작하면 새 부모는 내 후손이므로 400을 돌려준다.

5. 부모 포인터만 있을 때 이동 하나는 한 행만 고친다. 잠금이 막는 것은 서로 엇갈린 두 이동이 만드는 고리뿐이었다.

6. materialized path에서는 고리와 상관없는 두 이동도 서로를 망가뜨린다. 키보드(3)를 음향(5) 아래로 옮기는 트랜잭션이 음향의 `path`(`/1/5/`)를 읽은 사이에, 다른 트랜잭션이 음향을 생활(7) 아래로 옮기고 커밋했다고 하자.

7. 결과는 음향 `/7/5/`, 키보드 `/1/5/3/`이다. 키보드의 `parent_id`는 5인데 `path`는 옛 경로라, `GET /categories/7/products`에서 한정판 키보드가 빠지고 `GET /categories/3/path`는 "전자기기 > 음향 > 키보드"가 된다.

8. 두 트랜잭션이 먼저 같은 advisory lock을 잡으면 뒤의 이동이 앞의 커밋을 기다렸다가 바뀐 `path`를 보고 고친다. 키보드도 `/7/5/3/`이 된다.

> `psql`로 `parent_id`만 고치면 `path`는 그대로라서 두 칸이 어긋난다. 같은 정보를 두 곳에 저장하면 둘을 함께 고치는 길을 하나로 묶어 두어야 한다.

#### 2. 상품 화면에 카테고리 트리 붙이기

`05`의 상품 화면에 카테고리 트리를 붙인다.

`GET /categories/tree`를 TanStack Query로 받아 왼쪽에 트리를 그리고, 카테고리를 고르면 `GET /categories/:id/products` 결과를 보여 준다.

전자기기, 컴퓨터, 주방을 차례로 고르면 무엇이 나오는가?

**답**

1. 트리는 목록 컴포넌트가 자기 자신을 다시 그리는 재귀로 그린다. 노드에 `children`이 있으면 같은 컴포넌트를 한 단계 안쪽에 그린다.

2. 고른 카테고리 id는 `useState`에 둔다. 상품은 `useQuery({ queryKey: ["categories", id, "products"], enabled: id !== null })`로 받는다. queryKey에 id가 들어가 카테고리마다 캐시가 따로 생기고, 고르기 전에는 요청하지 않는다.

3. 전자기기를 고르면 한정판 키보드·마우스·무선 헤드폰, 컴퓨터는 한정판 키보드·마우스, 주방은 전기 주전자가 나온다. 하위 카테고리의 상품까지 나오는 것은 서버의 재귀 CTE(4단계) 덕분이고, 화면은 받은 목록을 그리기만 한다.

> 프론트가 다른 포트에서 뜨면 백엔드의 `FRONTEND_URL`(CORS)과 `08`의 CSP `connect-src`에 들어가는 API 주소가 서로 맞아야 요청이 나간다.

### 남길 것

- **찾아보면 되는 것**: 트리를 그리는 재귀 CTE, 고리 찾기 쿼리, `statement_timeout`. 외울 필요 없다.

- **감각으로 남겨야 할 것**:
  
  - 트리가 이상하면 먼저 루트에서 이어지는지(진단 1)와 고리가 있는지(진단 2)를 본다. 사라진 노드는 대개 고리다.
  
  - 응답이 안 오면 앱보다 DB에서 오래 도는 쿼리를 먼저 찾는다. 재귀 CTE라면 `CYCLE` 절부터 의심한다.

- **에러 신호**:
  
  - 진단 1의 트리에 안 나오는 카테고리가 있다 → 진단 2의 고리 찾기
  
  - 진단 2의 결과가 비어 있지 않다 → 고리 안 한 행의 `parent_id`를 고친다

## 12. 완성 확인

### 시험해보기

서버(`npm run start:dev`)를 켜 둔 채 한 번에 확인한다.

```sh
npx prisma db seed
curl localhost:4000/categories/tree
curl localhost:4000/categories/1/products # 키보드·마우스·헤드폰 상품
curl localhost:4000/categories/3/path # 전자기기 > 컴퓨터 > 키보드
npm run test:e2e # 8 passed
```

### 체크리스트

- [ ] 트리 전체 조회가 카테고리 수와 상관없이 쿼리 1번이다(단순한 재귀는 노드 수 + 1번)

- [ ] 한 카테고리의 하위 상품 전부와 경로를 재귀 CTE 한 번으로 구한다

- [ ] 자기 자신·자기 후손 아래로 옮기는 요청이 400이고, 이동 검사가 advisory lock 안에서 돈다

- [ ] 고리가 있는 데이터에서 `CYCLE` 절 없이는 쿼리가 끝나지 않고, 있으면 바로 끝나는 것을 확인했다

- [ ] 자식이 있는 카테고리 삭제가 API에서는 409, DB에서는 외래키 오류로 막힌다

- [ ] `npm run test:e2e`가 통과한다

## 13. 다음 단계

### 자가 점검

1. 자식 목록을 저장하지 않는데 어떻게 자식을 찾는가? 그 조회에 인덱스가 필요한 이유는?

2. 노드마다 자식을 조회하면 쿼리가 몇 번인가? 한 번에 읽고 메모리에서 잇는 방법은 왜 순서와 상관없이 동작하는가?

3. `WITH RECURSIVE`의 두 부분은 각각 무엇을 하는가? 아래로 내려갈 때와 위로 올라갈 때 무엇이 달라지는가?

4. 옮기기 검사를 잠그지 않으면 어떤 순서로 고리가 생기는가? 행 잠금으로는 왜 막을 수 없는가?

5. 고리를 막는 검사가 있는데도 `CYCLE` 절이 필요한 이유는?

6. 같은 `ON DELETE SET NULL`이 상품 관계에서는 괜찮고 카테고리 부모 관계에서는 문제인 이유는?

### 이 문서에서 다루지 않은 것

존재만 언급한다.

- 트리를 저장하는 다른 방법들: 경로 문자열(materialized path), 중첩 집합(nested set), 모든 조상-자손 쌍을 따로 저장하는 클로저 테이블, PostgreSQL의 `ltree` 확장

- 형제 사이의 순서(정렬 순서 칸)와 끌어다 놓기로 순서 바꾸기

- 카테고리별 상품 수처럼 하위까지 합산한 값을 미리 계산해 두기
