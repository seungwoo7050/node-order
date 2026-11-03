# 29: 관리자 대시보드 · 상점 설정 · 정기 PG 대사

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Prisma%20%7C%20Caddy%20%7C%20k6%20%7C%20Playwright-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [23-caching](https://github.com/seungwoo7050/node-order/tree/23-caching) 브랜치

운영 배포를 같은 자리에서 컨테이너를 바꾸는 방식(`deploy.sh`)에서 블루·그린 두 벌을 번갈아 쓰는 방식(`release.sh`)으로 바꾸고, CI가 트래픽을 넘기기 전에 대기 환경을 Playwright로 스모크 테스트합니다. 주문 금액 칸 `price`를 `total_amount`로 바꾸는 과정을 여섯 개의 마이그레이션으로 나누고, 카탈로그 캐시 키에 형식 버전을 붙입니다. 이 PC에서 운영 구성을 띄우는 리허설 구성과 배포 중 끊김을 재는 도구를 더합니다.

## 지원 범위

- 블루그린 배포(`deploy/`)
  - 운영 Compose의 서비스 `api-blue`·`web-blue`(프로필 `blue`)와 `api-green`·`web-green`(프로필 `green`). 지금 트래픽을 받는 쪽과 각 태그는 서버 `.env`의 `ACTIVE`·`BLUE_TAG`·`GREEN_TAG`
  - Caddy는 `live/web.caddy`·`live/api.caddy`를 `import`하고, `release.sh`가 이 파일을 고쳐 `caddy reload`로 전환
  - `release.sh up <태그> [토큰]`: 대기 쪽에 새 이미지를 받아 마이그레이션 → 앱 역할 비밀번호 맞추기 → 기동(`--wait`). 준비되지 않으면 `abort`. 토큰을 주면 쿠키 `deploy_slot=<토큰>`을 든 웹 요청만 대기 쪽으로 보내고 응답에 `X-Deploy-Slot: preview`
  - `release.sh switch`: 트래픽을 대기 쪽으로 넘기고 `DRAIN_SECONDS`(기본 10초) 뒤 이전 쪽을 멈춤(지우지 않음). 지금·이전 태그 말고 GHCR 이미지는 지움
  - `release.sh abort`: 대기 쪽을 멈추고 태그와 라우팅을 되돌림. `release.sh <태그>`는 `up` 뒤 `switch`
  - `rollback.sh`: 멈춰 둔 이전 쪽을 다시 띄우고 트래픽을 넘김. DB는 되돌리지 않음
  - `ops/reset-demo.sh`는 `ACTIVE` 쪽 태그의 migrate 이미지로 시드를 돌림. `ops/psql.sh`는 서버에서 운영 DB에 `psql`
  - `deploy.sh`는 지움. `aws/60-server-env.sh`는 서버의 `ACTIVE`·`BLUE_TAG`·`GREEN_TAG`·`RATE_LIMIT_ALLOW_IPS` 값을 지키며 `.env`를 올림
- CI 배포 작업(`.github/workflows/ci.yml`)
  - 설정 파일 올리기 → `release.sh up <커밋> <무작위 토큰>` → 스모크(`npm run test:smoke`, 그 토큰의 쿠키로 대기 쪽) → `release.sh switch` → 공개 주소 확인
  - 스모크가 실패하면 `release.sh abort`, `test-results/`를 아티팩트로 남김
- 주문 금액 칸 이름 변경(expand-contract)
  - `0022` `total_amount` 추가 → `0023` `price` NULL 허용 → `0024` CHECK `NOT VALID` → `0025` 1만 행씩 커밋하는 백필 → `0026` 검증 뒤 NOT NULL → `0027` `lock_timeout` 1초를 둔 `price` 삭제
  - 앱은 `totalAmount`만 쓰고, API 응답과 `POST /orders` 입력의 이름은 `price` 그대로
- 캐시
  - 카탈로그 캐시 키 `catalog:v2`. 무효화와 시드는 옛 키 `catalog`도 지움
  - 캐시된 항목의 카테고리가 `{ id, name }` 배열(`categories`). 응답에는 이전과 같은 `categoryPath`도 붙임
- 요청 수 제한 허용 목록 `RATE_LIMIT_ALLOW_IPS`(쉼표로 구분, 일치하면 세지 않음). 운영 `RATE_LIMIT_PER_MINUTE`를 `.env`로 바꿀 수 있음(기본 300)
- 리허설: `deploy/compose.rehearsal.yaml`·`rehearsal.env`로 같은 `release.sh`를 이 PC에서 돌림(Caddy HTTP 웹 :8080·API :8081, Postgres :5434, 저장소 :9100). `rehearsal-build.sh <태그>`가 `rehearsal/*` 이미지를 만들고, `rehearsal-snapshot.sh save|restore [이름]`이 DB를 템플릿 DB로 저장·복원
- 측정 도구(`order-api-nest/`)
  - k6 `loadtest/steady.js`: 목록·상세(초당 30), 내 주문(10), 주문 쓰기(10)를 일정 속도로. 관리자 `loadtest` 계정과 `LOADTEST_PASSWORD`가 필요
  - `scripts/downtime-report.mjs <csv>`: k6 CSV에서 실패 수·종류·가장 긴 연속 실패 구간·초별 실패
  - `scripts/write-stall.mjs [초]`: 주문을 계속 넣으며 100ms 넘게 걸린 쓰기를 셈(`DATABASE_URL`)
  - `scripts/ws-watch.mjs [초] [API]`: WebSocket 끊김과 못 받은 주문 알림
- 화면 머리글·제목을 "Brown Store."로 바꿈

## 구성

`23`에서 바뀐 곳만 적습니다.

```text
.
├── .github/workflows/ci.yml            # 배포: up → 스모크 → switch, 실패하면 abort
├── deploy/
│   ├── compose.yml                     # api-/web-의 blue·green, migrate의 RELEASE_TAG, IMAGE_PREFIX
│   ├── Caddyfile                       # import /etc/caddy/live/*.caddy, PUBLIC_SCHEME
│   ├── release.sh, rollback.sh         # 새 파일 (deploy.sh는 지움)
│   ├── compose.rehearsal.yaml, rehearsal.env, rehearsal-build.sh, rehearsal-snapshot.sh  # 새 파일
│   ├── .env.example, .gitignore        # ACTIVE·BLUE_TAG·GREEN_TAG·RATE_LIMIT_ALLOW_IPS, live/
│   ├── aws/60-server-env.sh            # 서버의 블루그린 값 지키기
│   └── ops/                            # psql.sh(새 파일), lib.sh·reset-demo.sh(ACTIVE 태그)
├── order-api-nest/
│   ├── prisma/
│   │   ├── schema.prisma               # Order.totalAmount
│   │   ├── migrations/0022_* ~ 0027_*
│   │   ├── seed.ts, seed/catalog.json
│   ├── src/
│   │   ├── cache/                      # catalog:v2, 옛 키도 지움
│   │   ├── products/product-list.ts    # categories { id, name }
│   │   ├── me/, orders/, users/, trpc/, auth/demo-user.ts  # totalAmount ↔ price
│   │   └── rate-limit/                 # 허용 목록
│   ├── loadtest/steady.js              # 새 파일
│   ├── scripts/                        # downtime-report, write-stall, ws-watch(새 파일), bulk-orders.sql·page-drift 수정
│   └── test/                           # rate-limit(허용 목록), catalog-cache(옛 키), 나머지는 total_amount에 맞춤
├── order-console-next/
│   ├── package.json                    # test:smoke
│   ├── playwright.smoke.config.ts      # 새 파일: SMOKE_URL, DEPLOY_SLOT_TOKEN 쿠키
│   ├── smoke/release.smoke.ts          # 새 파일
│   └── app/layout.tsx, app/nav.tsx     # 제목
└── README.md
```

## 실행

개발 환경(`npm run dev:api`, `npm run dev:web`, `compose.yaml`)은 `23`과 같습니다.

### 리허설

저장소 루트에서 이미지를 만들고 첫 버전을 띄운 뒤, 시드를 넣습니다.

```sh
deploy/rehearsal-build.sh b1
cp deploy/rehearsal.env deploy/.env
deploy/release.sh b1                                       # 처음에는 blue
(cd deploy && RELEASE_TAG=b1 docker compose run --rm -T migrate npx prisma db seed)
```

웹은 http://localhost:8080, API는 http://localhost:8081 입니다. 다음 버전은 다른 태그로 빌드해 `deploy/release.sh b2`(또는 `up b2 <토큰>` → `switch`), 되돌리기는 `deploy/rollback.sh`입니다.

### 운영

`deploy/aws`에서 `60-server-env.sh`를 다시 실행해 서버 `.env`에 블루그린 줄을 더하고, 저장소 변수 `DEPLOY_BRANCH`와 `production` 환경의 허용 브랜치를 `24-zero-downtime-release`로 바꾼 뒤 푸시하면 CI가 배포합니다. 첫 배포는 `ACTIVE`가 비어 있으므로 blue에 띄우고, `switch`가 `live/`를 붙인 Caddy를 다시 만들면서 이전 구성의 `api`·`web` 컨테이너를 지웁니다(`--remove-orphans`).

```sh
# 서버(/opt/node-order)에서 손으로 되돌리기
bash rollback.sh
```

## 테스트

```sh
npm run verify:fast   # lint + typecheck + 단위 테스트 + 하네스 테스트
npm run verify        # 위 + API e2e + 웹 e2e + 경보 규칙(웹 e2e는 4000에 API가 없으면 스스로 띄운다)
```

에이전트 규칙과 훅(`.claude/settings.json`, `scripts/harness/`)은 [`AGENTS.md`](AGENTS.md)에 있습니다.

- API e2e 추가분: 허용 목록 IP는 세지 않음(`rate-limit.e2e-spec.ts`), 옛 형식 키를 읽지 않고 무효화 때 함께 지움(`catalog-cache.e2e-spec.ts`)
- 스모크(데모 사용자로 들어가 목록과 상세)는 대기 환경에 띄운 뒤 그 주소로 돌립니다.

```sh
deploy/release.sh up b2 <토큰>
SMOKE_URL=http://localhost:8080 DEPLOY_SLOT_TOKEN=<토큰> npm run test:smoke -w order-console-next
deploy/release.sh switch                                   # 실패했다면 deploy/release.sh abort
```

배포 중 끊김은 k6를 띄운 채 다른 터미널에서 배포하고 보고서로 봅니다. `steady.js`는 관리자 `loadtest` 계정으로 로그인하므로 리허설 DB에 먼저 만듭니다(비밀번호는 `password.ts`와 같은 scrypt 형식).

```sh
export LOADTEST_PASSWORD=<8자 이상>
node -e 'const c=require("crypto");const s=c.randomBytes(16).toString("hex");const h=c.scryptSync(process.env.LOADTEST_PASSWORD,Buffer.from(s,"hex"),64).toString("hex");console.log(`INSERT INTO users (id, name, role, password_hash) VALUES (\x27loadtest\x27, \x27loadtest\x27, \x27admin\x27, \x27scrypt$${s}$${h}\x27) ON CONFLICT (id) DO UPDATE SET role = \x27admin\x27, password_hash = EXCLUDED.password_hash;`)' \
  | (cd deploy && docker compose exec -T db psql -U order_owner -d order_api)

mkdir -p order-api-nest/loadtest/out
k6 run -e API=http://localhost:8081 -e DURATION=90s --out csv=order-api-nest/loadtest/out/run.csv order-api-nest/loadtest/steady.js
node order-api-nest/scripts/downtime-report.mjs order-api-nest/loadtest/out/run.csv
```

CI는 검사·테스트 작업이 `23`과 같고, 배포 작업이 위 "CI 배포 작업"대로 바뀌었습니다.

## 상품 검색(26)

- API: `GET /products/search?q=&page=`(20개씩 최대 5쪽), `GET /products/suggest?q=`(이름 최대 8개), `GET /search/popular`(최근 7일 상위 10개)
- 엔진 경계 `SearchEngine`(`order-api-nest/src/search/`)과 PostgreSQL 구현. 계약 테스트는 `test/search-engine.contract.ts`
- 색인: 상품·카테고리 트리거가 `search_dirty`에 기록하고, 리더 인스턴스의 `SearchIndexJob`이 `SEARCH_INDEX_INTERVAL_MS`(기본 2초)마다 반영
- 재색인 `npm run search:reindex`, 측정 `npm run search:bench -w order-api-nest`(테스트 DB에만 상품 1만 개를 넣고 끝나면 지움)
- 화면: 상점 머리글의 검색 상자(자동완성), `/shop/search?q=` 결과 페이지

### 측정

이 PC(Apple M1, 16GB, Docker의 Postgres 17)에서 `npm run search:bench`로 잰 값입니다. 실제 트래픽이 아니라, 테스트 DB에 넣은 합성 상품 1만 개(수식어 20 × 품목 25 × 색 8 조합)에 같은 연결로 200번씩 보낸 왕복 시간입니다. LIKE는 `products`의 이름·설명에 `LIKE '%검색어%'`(LIMIT 100), 새 검색은 `PgSearchEngine.search`(첫 쪽 20개, 오타 보충 포함)입니다.

| 검색어 | 경우 | LIKE 결과 | LIKE p50 / p95 (ms) | 새 검색 결과 | 새 검색 p50 / p95 (ms) | 새 검색 1위 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 가방 | 2-gram 1개, 흔한 품목 | 100 | 1.38 / 1.93 | 100 | 2.41 / 2.86 | 무선 가방 블랙 0 |
| 블루투스 이어폰 | 두 단어(토큰 5개 AND) | 20 | 2.67 / 3.30 | 20 | 0.68 / 0.99 | 블루투스 이어폰 레드 30 |
| 여행가방 | 띄어쓰기 없음(2-gram 결과 0 → 오타 보충) | 0 | 2.58 / 3.22 | 100 | 7.53 / 8.72 | 여행용 가방 네이비 3 |
| 블르투스 이어폰 | 오타(2-gram 결과 0 → 오타 보충) | 0 | 2.57 / 2.90 | 100 | 7.94 / 10.42 | 블루투스 이어폰 레드 30 |

- LIKE는 늘 순차 스캔(`Seq Scan on products`, 1만 행 중 9,980행을 버림)이라 상품 수에 비례해 느려지고, 띄어쓰기·오타가 다르면 0건입니다.
- 2-gram 일치는 `Bitmap Index Scan on product_search_tokens_idx`(GIN)로 맞는 행만 읽습니다(`블루투스 이어폰` 실행 0.16ms, 버퍼 31). 맞는 행이 많은 `가방`(400건)은 모두 순위를 매겨 정렬하므로 LIMIT에서 일찍 멈추는 LIKE보다 느립니다.
- 오타 보충은 `Bitmap Index Scan on product_search_name_trgm_idx`(GIN trgm)이고 실행 5ms입니다. 왕복이 7~10ms인 것은 2-gram 쿼리 뒤에 임계값(`set_config`)을 정하는 트랜잭션을 한 번 더 열기 때문입니다.
- 바꿀 신호(브리프): 상품 1만 개 초과, 또는 검색 p95가 이 표의 3배를 넘으면 다른 엔진 구현을 같은 계약 테스트로 더합니다.

<details>
<summary>EXPLAIN (ANALYZE, BUFFERS)</summary>

```text
-- LIKE '%블루투스 이어폰%'
Limit  (actual time=2.490..2.492 rows=20 loops=1)
  ->  Sort  (Sort Key: id)
        ->  Seq Scan on products  (actual time=0.026..2.481 rows=20 loops=1)
              Filter: ((name ~~ '%블루투스 이어폰%'::text) OR (description ~~ '%블루투스 이어폰%'::text))
              Rows Removed by Filter: 9980
              Buffers: shared hit=164
Execution Time: 2.499 ms

-- 2-gram 일치 '블루투스 이어폰'
Limit  (actual time=0.153..0.156 rows=20 loops=1)
  ->  Sort  (Sort Key: ts_rank(...) * 1 + word_similarity(...) * 0.5 DESC, product_id)
        ->  Bitmap Heap Scan on product_search s  (actual time=0.050..0.149 rows=20 loops=1)
              Recheck Cond: (tokens @@ '''블루'' & ''루투'' & ''투스'' & ''이어'' & ''어폰'''::tsquery)
              Buffers: shared hit=31
              ->  Bitmap Index Scan on product_search_tokens_idx  (actual time=0.038..0.038 rows=20 loops=1)
                    Index Cond: (tokens @@ '''블루'' & ''루투'' & ''투스'' & ''이어'' & ''어폰'''::tsquery)
Execution Time: 0.163 ms

-- 오타 보충 '블르투스 이어폰' (word_similarity_threshold 0.3)
Limit  (actual time=5.062..5.072 rows=100 loops=1)
  ->  Sort  (Sort Key: word_similarity(...) DESC, similarity(...) DESC, product_id)
        ->  Bitmap Heap Scan on product_search  (actual time=0.076..4.928 rows=400 loops=1)
              Filter: ('블르투스 이어폰'::text <% name)
              Buffers: shared hit=61
              ->  Bitmap Index Scan on product_search_name_trgm_idx  (actual time=0.059..0.059 rows=400 loops=1)
                    Index Cond: (name %> '블르투스 이어폰'::text)
Execution Time: 5.082 ms
```

</details>

## 토스페이먼츠 결제와 부분 환불(27)

- 국내 결제를 토스페이먼츠 결제위젯 SDK(`@tosspayments/tosspayments-sdk`)로 연동하고, 기존 Stripe와 공통 결제 게이트웨이 인터페이스로 추상화한다.
- 클라이언트 위변조를 막기 위해 승인 요청 금액을 서버 주문 합계(상품 + 배송비)와 대조한 뒤 토스 승인 API를 호출한다.
- 웹훅 수신 시 본문만 믿지 않고 토스 결제 조회 API를 역호출해 상태가 일치할 때만 결제 완료·취소를 반영하며, 관리자 부분 환불과 로컬/CI용 결제 시뮬레이터(`payments-sim`)를 포함한다.

## 주문 이행(28)

- 주문 상태 `orders.status`: pending_payment → paid → preparing → shipped → delivered → confirmed, 그리고 canceled. 전이 표는 `order-api-nest/src/fulfillment/order-state.ts` 한 곳, DB 반영은 조건부 update(`WHERE status = <from>`)이고 모든 전이가 `order_status_history`에 남는다. 옛 칸 `paid`·`canceled_at`은 같이 맞춘다(expand)
- 배송지는 주문에 사본으로 붙고(결제 시작 전에 검증, 로그에는 마스킹), 배송비는 상품 합계 5만 원 미만이면 3,000원(`shipping_fee`, `total_amount`에 포함)
- 관리자 API `/admin/orders`(상태 필터)·`/admin/orders/:id`와 `prepare`·`shipment`·`deliver`·`cancel`, `/admin/returns/:id/approve`·`reject`·`shipment`. 데모 관리자는 읽기만
- 손님 API `POST /me/orders/:id/confirm`(구매확정), `POST /me/orders/:id/returns`(배송 완료 뒤 7일 안). 단순변심 반품은 왕복 배송비 6,000원을 빼고 환불
- 취소·반품 환불은 상태 전이·재고 복구를 커밋한 뒤 27의 환불을 멱등 키 `cancel-<주문id>`·`return-<반품id>`로 부른다
- 리더 작업 `FulfillmentJob`(`FULFILLMENT_INTERVAL_MS`, 기본 10분): 24시간 넘은 미결제 주문 취소(PG 재조회 뒤), 발송 5일 뒤 배송 완료, 배송 완료 7일 뒤 구매확정, 환불이 확정된 반품 완료
- 알림 메일은 outbox 이벤트 종류별 템플릿(`src/mail/templates.ts`)
- 화면: 장바구니 배송지, 내 주문 상세(타임라인·송장 조회 링크·반품 신청·구매확정), 관리자 `/admin/orders`

## 관리자·PG 대사(29)

- 대시보드 `GET /admin/dashboard`(화면 `/admin`): 오늘(Asia/Seoul 자정 기준, 쿼리에 시간대를 적는다) 결제된 주문 수와 순매출(결제액 − 성공 환불액), 처리 대기, 재고 부족, 0건 검색어 상위 10, 미해결 대사 불일치. 캐시하지 않는다
- 상점 설정 `store_settings` 한 행(`GET/PUT /admin/settings`, 화면 `/admin/settings`): 사업자 정보·배송비·재고 부족 기준. 저장은 `If-Match: <version>`이 같을 때만(다르면 409). 사업자등록번호는 10자리 체크섬. API는 메모리에 캐시하고 저장하면 버린다(인스턴스가 둘이면 Redis pub/sub). 배송비는 주문에 저장하므로 지난 주문은 그대로다
- 비밀값(PG 키, `SENTRY_DSN`, `LLM_API_KEY`)은 환경변수에만 둔다. 설정 화면은 `GET /features`의 `integrations`(연결됨·없음)만 보인다
- 법적 고지 `legal_documents`(약관·개인정보처리방침·청약철회 안내): 고치면 새 판, `/legal/terms`·`/legal/privacy`·`/legal/refund`에서 지난 판도 열람. 결제는 지금 개인정보처리방침 판에 동의해야 하고(`privacyConsentVersion`), 주문에 판과 시각이 남는다. 모든 페이지 바닥글에 사업자 정보. 콘솔은 태그 캐시로 받고 저장하면 태그를 버려 배포 없이 바뀐다
- PG 대사: `PaymentGateway.listTransactions`(토스 거래 조회, Stripe PaymentIntent·환불 목록)로 기간 안의 PG 결제와 우리 payments·refunds를 양쪽에서 맞춘다. 불일치(amount_mismatch, status_mismatch, missing_in_db, missing_in_pg, refund_mismatch)는 (provider, 종류, 결제 키)로 upsert해 다시 돌려도 같다. 먼저 결과 미상 환불을 확정한다
- 데모 관리자에게 가는 `/admin/*` 응답은 배송지·연락처를 가린다(전역 인터셉터가 칸 이름으로 찾는다)
- expand 기간에 옛 API가 옛 칸(`paid`·`canceled_at`)만 바꾼 주문은 0034 트리거가 같은 트랜잭션에서 `status`를 맞추고, 결제 기한 작업은 옛 칸·결제 행도 본다. 구매확정과 반품 신청은 주문 행 잠금으로 줄을 선다. PG가 거절한 환불은 `POST /admin/orders/:id/refunds/:refundId/retry`가 새 시도 키(`<처음 키>-r<n>`)로 다시 요청한다
- 매일 04:00(Asia/Seoul) 뒤 리더가 전날 분을 돌리고(`RECONCILE_CHECK_INTERVAL_MS`마다 확인), 손으로는 `npm run payments:reconcile -- --date=YYYY-MM-DD`. provider 하나가 실패해도 나머지는 대사하고 종료 코드는 1. 화면 `/admin/reconciliation`에서 종류별로 보고 해결 표시(메모)한다

## 정리

```sh
(cd deploy && docker compose --profile blue --profile green down -v)   # 리허설 컨테이너와 볼륨
rm deploy/.env && rm -rf deploy/live
docker compose down                                                     # 개발 컨테이너
```
