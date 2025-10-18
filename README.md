# 06: 파일 업로드

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20S3%20presigned%20URL%20%7C%20RustFS-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [05-front-state](https://github.com/seungwoo7050/node-order/tree/05-front-state) 브랜치

상품 이미지 업로드를 더했습니다.
브라우저는 서버가 발급한 presigned URL로 S3 호환 저장소(compose의 RustFS)에 파일을 직접 PUT하고, 서버는 확인 요청에서 크기와 첫 바이트를 검사한 뒤 상품에 연결합니다.
리더 인스턴스는 어느 상품도 가리키지 않는 이미지 파일을 주기적으로 지웁니다.

## 지원 범위

- 05의 API와 화면 전부
- `POST /products/:id/image/upload-url`(JWT 필요): 본문 `{ contentType, size }`
  - `contentType`은 `image/png`, `image/jpeg`, `image/webp`만, `size`는 `MAX_IMAGE_BYTES`(2MB) 이하
  - 키는 서버가 `products/<상품 id>/<uuid>.<확장자>`로 정함
  - `Content-Type`을 서명 헤더에 넣은 PUT URL을 `UPLOAD_URL_TTL_SECONDS`(60초) 동안 유효하게 발급. 응답 `{ key, uploadUrl, expiresIn }`
- `POST /products/:id/image/confirm`(JWT 필요): 본문 `{ key }`
  - 키 형식과 상품 경로 일치 확인, `HeadObject`로 존재·크기 확인
  - 앞 12바이트를 Range GET으로 읽어 PNG·JPEG·WebP 시그니처 확인. 맞지 않으면 파일을 지우고 400 `이미지 파일이 아니다`
  - 상품의 `image_key`를 바꾸고 이전 이미지 파일을 지움. 응답에 10분짜리 읽기 URL
- `GET /products`: 각 상품에 `imageUrl`(10분짜리 presigned GET URL, 이미지가 없으면 `null`)
- 서버 시작 시 `S3_BUCKET`이 없으면 만들고, `FRONTEND_URL`에서 PUT·GET을 허용하는 버킷 CORS를 설정
- 고아 이미지 정리(`OrphanImageCleanupJob`): 리더만 `ORPHAN_CLEANUP_INTERVAL_MS`(10분)마다 `products/` 아래 파일 중 DB의 `image_key`가 가리키지 않고 `ORPHAN_MIN_AGE_SECONDS`(1시간)보다 오래된 파일을 삭제
- 마이그레이션 10개(05의 9개 + `products.image_key`)
- 프론트 `/shop`: 이미지가 있으면 48px 썸네일, 로그인 상태면 상품마다 파일 선택 → URL 발급 → 저장소 PUT → confirm 후 상품 목록 쿼리 무효화. 실패하면 메시지 표시

## 구성

`05`에서 바뀐 곳만 적습니다.

```text
.
├── order-api-nest/
│   ├── .env                                # S3_*, MAX_IMAGE_BYTES, UPLOAD_URL_TTL_SECONDS, ORPHAN_* 추가
│   ├── docker-compose.yml                  # storage(rustfs/rustfs, 9000·9001, storagedata 볼륨) 추가
│   ├── package.json                        # @aws-sdk/client-s3, @aws-sdk/s3-request-presigner 추가
│   ├── prisma/
│   │   ├── schema.prisma                   # Product.imageKey
│   │   └── migrations/0010_add_product_image_key/
│   ├── scripts/
│   │   ├── upload-image.mjs                # 업로드 URL 발급 → 직접 PUT → confirm을 차례로 실행
│   │   ├── list-objects.mjs                # 버킷의 products/ 파일과 가리키는 상품(없으면 고아)
│   │   └── fixtures/                       # pixel.png, not-an-image.png(내용은 HTML)
│   └── src/
│       ├── app.module.ts                   # StorageModule 등록
│       ├── storage/                        # 전역 StorageService: 버킷·CORS 준비, presigned URL, head/range/list/delete
│       ├── products/
│       │   ├── product-images.controller.ts  # upload-url, confirm
│       │   ├── image-signature.ts          # 허용 형식, 확장자, 시그니처 검사
│       │   ├── product-image.dto.ts        # 요청 검증
│       │   └── products.controller.ts      # 목록에 imageUrl
│       └── leader/orphan-image-cleanup.job.ts
└── order-console-next/
    ├── app/shop/
    │   ├── page.tsx                        # 썸네일, 로그인 시 업로더
    │   └── product-image-uploader.tsx      # 업로드 3단계 useMutation
    └── e2e/
        ├── upload.spec.ts                  # 업로드 시나리오 2개
        └── fixtures/pixel.png
```

## 실행

05에 더해 compose가 RustFS를 띄웁니다(PostgreSQL `5433`, Redis `6380`, RustFS `9000`·`9001`, API `4000`, 프론트 `3000`).
백엔드 `.env`의 `S3_ACCESS_KEY`/`S3_SECRET_KEY`는 `docker-compose.yml`의 `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY`와 같은 값입니다. 버킷 `product-images`는 서버가 시작하면서 만듭니다.

```sh
cd order-api-nest
npm ci
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
npm run start:dev                  # localhost:4000
```

서버가 떠 있을 때 스크립트로 업로드 흐름을 확인합니다. 인수는 `<파일> [상품 id=1] [contentType=image/png]`입니다.

```sh
node scripts/upload-image.mjs scripts/fixtures/pixel.png 1
node scripts/upload-image.mjs scripts/fixtures/not-an-image.png 1    # confirm에서 400
node scripts/list-objects.mjs
```

프론트는 05와 같이 띄웁니다.

```sh
cd order-console-next
npm ci
cp .env.example .env.local
npm run dev                        # localhost:3000
```

http://localhost:3000/shop 에서 `kim` / `1234`로 로그인하면 상품마다 이미지 선택이 보입니다.

## 테스트

백엔드 e2e는 테스트 DB(`order_api_test`) 준비가 02와 같고, 새 마이그레이션을 적용해야 합니다.
앱 모듈 전체를 띄우므로 Redis와 RustFS도 떠 있어야 합니다(StorageService가 시작할 때 버킷을 확인).

```sh
cd order-api-nest
DATABASE_URL=postgresql://order:order@localhost:5433/order_api_test npx prisma migrate deploy
npm test                           # 단위 테스트(vitest)
npm run test:e2e                   # e2e 테스트
npm run lint                       # oxlint
```

프론트 e2e는 백엔드가 `4000`에, RustFS가 `9000`에 떠 있어야 하고 개발 서버는 Playwright가 띄웁니다.

```sh
cd order-console-next
npm run lint
npm run test:e2e
```

`e2e/upload.spec.ts`의 시나리오(05의 `shop.spec.ts` 4개도 그대로 돕니다):

- 상품 2에 `pixel.png`를 고르면 `localhost:9000`으로 PUT이 200이고, 목록의 `img`가 그 키의 읽기 URL로 바뀌어 실제로 그려짐
- 이름이 `.png`이고 MIME이 `image/png`인 HTML 내용 파일은 "이미지 파일이 아니다"로 거절됨

## 정리

```sh
cd order-api-nest
docker compose down      # PostgreSQL·Redis·RustFS 컨테이너 내림
docker compose down -v   # DB·저장소 볼륨까지 삭제
```
