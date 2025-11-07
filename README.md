# 09: 자기참조 트리

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL%20WITH%20RECURSIVE-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [08-load-and-csp](https://github.com/seungwoo7050/node-order/tree/08-load-and-csp) 브랜치

상품에 계층 카테고리를 붙입니다. `categories` 테이블의 `parent_id`가 같은 테이블을 가리키고, 하위 상품과 경로는 재귀 CTE(`WITH RECURSIVE ... CYCLE`)로 조회합니다.

카테고리 이동은 순환을 검사하고 advisory lock으로 직렬화하며, 자식이 있는 카테고리는 API(409)와 외래 키(`RESTRICT`) 양쪽에서 삭제를 막습니다.

## 지원 범위

- 스키마와 시드

  - `0011_add_categories`: `categories` 테이블(`parent_id` 자기참조, 인덱스), `products.category_id`(인덱스, `ON DELETE SET NULL`)

  - `0012_category_parent_restrict`: `categories.parent_id` 외래 키를 `ON DELETE RESTRICT`로 변경

  - 시드: 루트 2개, 최대 3단계, 8개 노드의 카테고리 트리(전자기기 > 컴퓨터 > 키보드·마우스, 전자기기 > 음향 > 헤드폰, 생활 > 주방)와 리프 카테고리에 하나씩 속한 상품 4개

- 트리 조회

  - `GET /categories/tree`: 카테고리 전체를 쿼리 한 번으로 읽고, id → 노드 Map으로 트리를 조립

  - `GET /categories/tree-naive`: 노드마다 자식을 다시 조회하는 비교용 구현(N+1)

- 재귀 CTE 조회

  - `GET /categories/:id/products`: 그 카테고리와 모든 하위 카테고리의 상품

  - `GET /categories/:id/path`: 루트에서 그 카테고리까지의 경로

  - 두 쿼리 모두 `CYCLE id SET is_cycle USING visited`로, DB에 이미 순환이 있어도 끝남. 카테고리가 없으면 404

- 이동 `PATCH /categories/:id` `{ "parentId": number | null }` (로그인 필요)

  - `parentId`는 양의 정수 또는 `null`(루트로 이동)

  - 자기 자신이나 자기 후손 아래로 옮기면 400. 새 부모에서 조상을 거슬러 올라가 옮길 노드가 나오는지로 검사

  - 트랜잭션 안에서 `pg_advisory_xact_lock`을 잡아 이동을 하나씩 처리

- 삭제 `DELETE /categories/:id` (로그인 필요, 성공 시 204)

  - 자식이 있으면 409. 외래 키(`RESTRICT`)도 같은 삭제를 막음

  - 지운 카테고리의 상품은 `category_id`가 `NULL`이 되어 남음

- `scripts/category-bulk.sql`: 실행할 때마다 `대량` 루트 아래 5×5×5 트리(156개 노드)를 추가

- 그 밖의 API와 `order-console-next`는 `08-load-and-csp`와 같습니다.

## 구성

`08`에서 바뀐 곳만 적습니다.

```text
order-api-nest/
├── prisma/
│   ├── schema.prisma                     # Category 모델(CategoryTree 자기 관계), Product.categoryId
│   ├── migrations/
│   │   ├── 0011_add_categories/          # categories 테이블, products.category_id, 인덱스
│   │   └── 0012_category_parent_restrict/  # parent_id 외래 키를 RESTRICT로
│   └── seed.ts                           # 카테고리 8개, 상품 4개에 카테고리 연결
├── src/
│   ├── app.module.ts                     # CategoriesModule 등록
│   └── categories/
│       ├── categories.controller.ts      # tree, tree-naive, :id/products, :id/path, PATCH, DELETE
│       ├── categories.service.ts         # 트리 조립, 재귀 CTE, 순환 검사와 advisory lock
│       ├── categories.module.ts
│       └── move-category.dto.ts          # parentId: 양의 정수 또는 null
├── scripts/category-bulk.sql             # 156개 노드 추가
└── test/
    ├── categories.e2e-spec.ts            # 순환 방지, CYCLE 절, 삭제 제한 회귀 테스트
    ├── auth.e2e-spec.ts                  # TRUNCATE에 categories 추가
    └── checkout.e2e-spec.ts              # TRUNCATE에 categories 추가
```

## 실행

인프라는 compose로, API는 로컬에서 띄웁니다. PostgreSQL `5433`, Redis `6380`, RustFS `9000`/`9001`, API `4000`입니다. 시드에는 전역 `tsx`가 필요합니다.

```sh
cd order-api-nest
npm ci
docker compose up -d db redis storage
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev # :4000
```

다른 터미널에서 조회합니다. 로그인이 필요한 이동·삭제에는 데모 계정 `kim` / `1234`의 access token을 씁니다.

```sh
curl localhost:4000/categories/tree
curl localhost:4000/categories/3/path     # 전자기기 > 컴퓨터 > 키보드
curl localhost:4000/categories/1/products # 전자기기 아래 상품(키보드, 마우스, 헤드폰)
```

트리를 키우려면 대량 노드를 넣습니다.

```sh
docker compose exec -T db psql -U order -d order_api < scripts/category-bulk.sql
```

컨테이너로 전체를 띄우는 방법(`--profile app`)과 콘솔 실행은 `08-load-and-csp`와 같습니다.

## 테스트

e2e는 `.env`의 `TEST_DATABASE_URL`(`order_api_test`)을 쓰고, 이 값이 없으면 테스트를 멈춥니다. 테스트 DB는 처음 한 번 만들고, 마이그레이션이 늘었으므로 다시 적용합니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test # 처음 한 번
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test         # vitest 단위 테스트
npm run test:e2e # 카테고리, 결제 동시성, refresh token 회전 회귀 테스트
npm run lint
```

카테고리 e2e는 자기 자신·후손 아래로의 이동이 400인지, 순환을 SQL로 직접 만든 뒤에도 경로 조회가 3초 안에 200으로 끝나는지, 자식이 있는 카테고리 삭제가 409인지 확인합니다.

콘솔 테스트는 `08-load-and-csp`와 같습니다.

## 정리

```sh
cd order-api-nest
docker compose down    # 컨테이너만 내림
docker compose down -v # DB와 저장소 볼륨까지 삭제
```
