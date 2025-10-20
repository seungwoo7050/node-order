# 06: 파일 업로드

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20S3%20presigned%20URL%20%7C%20RustFS-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [05-front-state](https://github.com/seungwoo7050/node-order/tree/05-front-state) 브랜치의 `order-api-nest`, `order-console-next`

상품 이미지를 올릴 수 있게 합니다.

파일 바이트는 서버를 거치지 않고, 브라우저가 presigned URL로 오브젝트 저장소(S3 호환 RustFS)에 직접 PUT합니다.

서버는 올릴 자격(형식·크기·키)을 먼저 정해 주고, 올라간 파일을 다시 확인한 뒤에만 상품에 연결합니다.

## 지원 범위

- 업로드 URL 발급 `POST /products/:id/image/upload-url` (로그인 필요)

  - 형식(png·jpeg·webp)과 크기(최대 2MB, `MAX_IMAGE_BYTES`)를 검사하고, 60초짜리 PUT URL을 발급

  - 키는 클라이언트가 아니라 서버가 `products/{id}/{uuid}.{ext}`로 정함. `Content-Type`을 서명에 포함해, 신고한 형식과 다르게 올리면 저장소가 거절

- 업로드 확인 `POST /products/:id/image/confirm` (로그인 필요)

  - 키가 그 상품의 경로인지, 저장소에 실제로 있는지, 크기가 제한 안인지 `HeadObject`로 다시 확인. presigned URL만으로는 크기를 강제하지 못하기 때문

  - 앞 12바이트를 Range GET으로 읽어 시그니처(매직 바이트)를 검사. 확장자와 `Content-Type`만 png인 가짜 파일은 지우고 400

  - 상품의 `image_key`를 바꾸고, 이전 이미지 파일은 지움

- `GET /products`가 내부 키 대신 10분짜리 읽기 URL(`imageUrl`)을 내려줌. 버킷은 비공개

- 서버 시작 시 버킷이 없으면 만들고, `FRONTEND_URL`에서 PUT·GET할 수 있도록 CORS 설정

- 고아 파일 정리 (`OrphanImageCleanupJob`)

  - 리더 인스턴스만 10분마다 `products/` 아래 파일과 DB의 `image_key`를 비교해, 아무 상품도 가리키지 않는 파일을 지움

  - 올라간 지 1시간(`ORPHAN_MIN_AGE_SECONDS`)이 안 된 파일은 건드리지 않음. 업로드는 끝났지만 아직 confirm 전인 파일을 지우지 않기 위해

- 프론트 `/shop`

  - 상품마다 이미지가 있으면 썸네일 표시

  - 로그인하면 상품마다 파일 선택이 보이고, 고르면 URL 발급 → 저장소에 직접 PUT → 확인 순서로 올린 뒤 목록을 다시 받아 옴

- 05단계의 장바구니·로그인·결제·내 주문 화면은 그대로입니다.

## 구성

```text
.
├── order-api-nest/                     # NestJS API
│   ├── docker-compose.yml              # PostgreSQL(5433), Redis(6380), RustFS(9000 API, 9001 웹 콘솔)
│   ├── prisma/
│   │   ├── schema.prisma               # Product.imageKey(image_key) 추가
│   │   └── migrations/0010_add_product_image_key/
│   ├── src/
│   │   ├── storage/                    # 전역 StorageService: S3 클라이언트, 버킷·CORS 준비, presigned URL, head/list/delete
│   │   ├── products/
│   │   │   ├── product-images.controller.ts  # upload-url, confirm
│   │   │   ├── image-signature.ts      # 허용 형식과 매직 바이트 검사
│   │   │   ├── product-image.dto.ts    # 요청 검증(형식, 크기, 키 패턴)
│   │   │   └── products.controller.ts  # 목록에 imageUrl 포함
│   │   └── leader/
│   │       └── orphan-image-cleanup.job.ts  # 리더에서 고아 파일 정리
│   └── scripts/
│       ├── upload-image.mjs            # 업로드 URL → 직접 PUT → 확인을 한 번에
│       ├── list-objects.mjs            # 버킷 파일과 DB의 image_key 비교(고아 표시)
│       └── fixtures/                   # pixel.png, not-an-image.png(내용은 HTML)
├── order-console-next/                 # Next.js(App Router) 주문 콘솔
│   ├── app/shop/
│   │   ├── page.tsx                    # 상품 목록에 썸네일과 업로더 추가
│   │   └── product-image-uploader.tsx  # 업로드 3단계를 useMutation으로
│   └── e2e/
│       ├── shop.spec.ts                # 05단계 시나리오 4개
│       ├── upload.spec.ts              # 업로드 시나리오 2개
│       └── fixtures/pixel.png
└── README.md
```

## 실행

백엔드를 먼저 `4000`에 띄웁니다. 처음이면 마이그레이션과 시드까지 합니다. 버킷(`product-images`)은 서버가 시작하면서 만듭니다.

백엔드 `.env`의 `S3_ACCESS_KEY`/`S3_SECRET_KEY`는 `docker-compose.yml`의 `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY`와 같아야 합니다.

```sh
cd order-api-nest
npm ci
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev # :4000
```

서버가 떠 있는 상태에서 스크립트로 업로드 흐름을 확인할 수 있습니다.

```sh
cd order-api-nest
node scripts/upload-image.mjs scripts/fixtures/pixel.png 1                  # ① URL 발급 ② 직접 PUT ③ 확인
node scripts/upload-image.mjs scripts/fixtures/not-an-image.png 1 image/png # ③에서 "이미지 파일이 아니다"로 거절
node scripts/list-objects.mjs                                               # 버킷 파일과 가리키는 상품
```

저장소 안은 RustFS 웹 콘솔(http://localhost:9001)에서도 볼 수 있습니다.

다른 터미널에서 프론트를 띄웁니다(`3000`).

```sh
cd order-console-next
npm ci
cp .env.example .env.local
npm run dev
```

http://localhost:3000/shop 에서 확인합니다. 데모 계정은 `kim` / `1234`입니다.

## 테스트

백엔드 e2e는 테스트 전용 DB(`TEST_DATABASE_URL`)를 씁니다. 처음 한 번 만듭니다.

```sh
cd order-api-nest
docker compose exec db createdb -U order order_api_test
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
```

```sh
cd order-api-nest
npm test
npm run test:e2e
npm run lint
```

프론트 e2e는 백엔드가 `4000`에 떠 있어야 합니다. 프론트 개발 서버는 Playwright가 직접 띄웁니다.

```sh
cd order-console-next
npx playwright install chromium # 처음 한 번
npm run test:e2e
npm run lint
```

05단계의 4개 시나리오에 더해, 고른 이미지가 저장소로 직접 PUT되고 목록의 `img`가 그 키의 읽기 URL로 실제 렌더링되는지, 확장자와 MIME 타입만 png인 HTML 파일이 확인 단계에서 거절되는지 확인합니다.

## 정리

```sh
cd order-api-nest
docker compose down    # 컨테이너만 내림
docker compose down -v # DB·저장소 볼륨까지 삭제
```
