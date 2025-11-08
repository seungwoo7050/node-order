# 09: 자기참조 트리

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Prisma%20%7C%20PostgreSQL%20WITH%20RECURSIVE-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [08-load-and-csp](https://github.com/seungwoo7050/node-order/tree/08-load-and-csp) 브랜치

상품에 "전자기기 > 컴퓨터 > 키보드" 같은 계층 카테고리를 붙입니다. `categories` 테이블이 `parent_id`로 자기 자신을 가리키게 해 트리를 만들고, 재귀 CTE로 하위 상품과 경로를 조회하며, 카테고리를 옮기거나 지울 때 순환이나 고아 노드가 생기지 않게 막습니다.

## 지원 범위

- 스키마와 시드

  - `categories` 테이블(`parent_id` 자기참조, 인덱스)과 상품의 `category_id` (`0011_add_categories`)

  - `parent_id` 외래 키는 `ON DELETE RESTRICT`, 상품의 `category_id`는 `ON DELETE SET NULL` (`0012_category_parent_restrict`)

  - 시드에 루트 2개, 3단계, 8개 노드로 된 카테고리 트리와 카테고리별 상품 4개 포함

- 트리 조회

  - `GET /categories/tree`: 전체를 쿼리 한 번으로 읽고, 메모리에서 id → 노드 Map으로 트리를 조립

  - `GET /categories/tree-naive`: 노드마다 자식을 다시 조회하는 비교용 구현(N+1)

- 재귀 CTE(`WITH RECURSIVE`) 조회

  - `GET /categories/:id/products`: 지정 카테고리와 그 아래 모든 하위 카테고리의 상품

  - `GET /categories/:id/path`: 루트에서 지정 카테고리까지의 경로(breadcrumb)

  - 두 조회 모두 카테고리가 없으면 404

- 이동 `PATCH /categories/:id` `{ "parentId": number | null }` (로그인 필요)

  - 자기 자신이나 자기 후손 아래로 옮기면 400. 새 부모에서 조상을 거슬러 올라가며 순환인지 검사

  - `pg_advisory_xact_lock`으로 이동을 하나씩 처리해, 동시에 들어온 두 이동이 함께 순환을 만들지 못하게 함

- 삭제 `DELETE /categories/:id` (로그인 필요)

  - 자식이 있으면 409. DB 외래 키(`RESTRICT`)도 같은 삭제를 막음

  - 지운 카테고리에 속했던 상품은 카테고리 없이 남음

- 재귀 쿼리에 `CYCLE` 절을 붙여, SQL로 직접 넣어 이미 순환이 생긴 데이터에서도 조회가 끝남

- 프론트(`order-console-next`)는 `08-load-and-csp` 그대로입니다. 바뀐 것은 없습니다.

## 구성

```text
.
├── order-api-nest/                       # NestJS API
│   ├── prisma/
│   │   ├── schema.prisma                 # Category 모델(CategoryTree 자기 관계)과 Product.categoryId
│   │   ├── migrations/
│   │   │   ├── 0011_add_categories/      # categories 테이블, products.category_id, 인덱스
│   │   │   └── 0012_category_parent_restrict/  # parent_id 외래 키를 RESTRICT로
│   │   └── seed.ts                       # 카테고리 트리 8개와 카테고리별 상품
│   ├── src/categories/
│   │   ├── categories.controller.ts      # tree, tree-naive, :id/products, :id/path, PATCH, DELETE
│   │   ├── categories.service.ts         # 트리 조립, 재귀 CTE, 순환 검사와 advisory lock
│   │   └── move-category.dto.ts          # parentId: 양의 정수 또는 null
│   ├── scripts/category-bulk.sql         # 실행할 때마다 '대량' 트리 156개 노드 추가
│   └── test/categories.e2e-spec.ts       # 순환 방지, CYCLE 절, 삭제 제한 회귀 테스트
├── order-console-next/                   # Next.js 주문 콘솔 (08-load-and-csp와 같음)
└── README.md
```

## 실행

인프라(PostgreSQL `5433`, Redis `6380`, RustFS `9000`/`9001`)를 compose로 띄우고, API는 로컬에서 실행합니다(`4000`). 처음이면 마이그레이션과 시드까지 합니다.

```sh
cd order-api-nest
npm ci
docker compose up -d db redis storage
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev # :4000
```

다른 터미널에서 조회해 봅니다. 데모 계정은 `kim` / `1234`입니다.

```sh
curl localhost:4000/categories/tree
curl localhost:4000/categories/3/path     # 전자기기 > 컴퓨터 > 키보드
curl localhost:4000/categories/1/products # 전자기기 아래 상품 전부
```

N+1 조회와 한 번에 읽기를 큰 트리로 비교하려면 노드를 늘립니다. 실행할 때마다 156개씩 늘어납니다.

```sh
docker compose exec -T db psql -U order -d order_api < scripts/category-bulk.sql
```

## 테스트

e2e는 `.env`의 `TEST_DATABASE_URL`(`order_api_test`)을 쓰고, 이 값이 없으면 개발 DB를 지우지 않도록 테스트를 멈춥니다. 테스트 DB는 처음 한 번 만들고, 마이그레이션이 늘면 다시 적용합니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test # 처음 한 번
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
npm test         # 단위 테스트
npm run test:e2e # 카테고리, 결제 동시성, refresh token 회귀 테스트
npm run lint
```

카테고리 e2e는 자기 자신이나 후손 아래로 옮기면 400이 나오는지, 순환이 이미 있는 데이터에서도 경로 조회가 3초 안에 끝나는지, 자식이 있는 카테고리를 지우면 409가 나오는지 확인합니다.

## 정리

```sh
cd order-api-nest
docker compose down    # 컨테이너만 내림
docker compose down -v # DB와 저장소 볼륨까지 삭제
```
