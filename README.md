# node-order

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Runtime](https://img.shields.io/badge/runtime-Node.js%2024-339933?logo=nodedotjs&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Prisma%20%7C%20PostgreSQL%20%7C%20Redis-lightgrey)

> [!IMPORTANT]
> **현재 위치한 `main` 브랜치는 01번부터 32번까지의 점진적 학습 및 아키텍처 구축 과정을 보존하는 인덱스형 브랜치입니다.**  
> 
> **최신 브랜치의 전체 소스코드와 리드미**는 아래의 **`32-production-prep`** 브랜치에서 확인하실 수 있습니다.
> #### 👉 [32-production-prep 최종 완성 브랜치 바로가기 (포트폴리오 README 및 전체 코드)](https://github.com/seungwoo7050/node-order/tree/32-production-prep) 👈

---

백엔드 학습 및 실전 프로덕션 구축을 위해 설계하고 배포한 고신뢰 주문·이커머스 서비스입니다.  
서버를 껐다 켜면 주문이 사라지던 단일 NestJS 메모리 API에서 시작해, PostgreSQL과 Redis, S3, 토스페이먼츠, 주문 상태 기계, PG 일일 대사, AI 에이전트 연동(MCP), 그리고 Prometheus/Alertmanager/Sentry 관측성과 AWS EC2 무중단 Blue/Green 배포까지 점진적으로 키웠습니다. 한 번에 만들지 않고 단계마다 완결된 브랜치를 하나씩 남겼습니다.

- 데모: https://shop.43-202-205-93.sslip.io/
- 단계별 브랜치: [아래 목록](#단계별-브랜치)

---

## 데모 둘러보기

- 로그인 화면에서 "일반 사용자로"나 "관리자로"를 누르면 비밀번호 없이 임시 계정이 만들어집니다. 이 계정은 24시간 뒤 지워집니다.
- 공개 데모라서 매일 새벽 4시(KST)에 상품과 데모 주문을 처음 상태로 되돌립니다. 새벽 3시 30분의 DB 백업이 그날 성공했을 때만 되돌립니다. GitHub로 가입한 계정과 그 주문은 남습니다.
- 결제는 토스페이먼츠 및 Stripe 테스트 모드로 연동되어 있어 실제로 돈이 청구되지 않습니다.

---

## 시스템 구성

```text
브라우저 (고객 / 관리자 / AI 에이전트)
  │
Caddy 리버스 프록시 (AWS EC2 한 대, HTTPS)
  ├─ web-blue / web-green   Next.js 16 쇼핑몰 & 관리자 콘솔 화면
  └─ api-blue / api-green   NestJS Core API & MCP 서버 ── Redis (같은 서버의 컨테이너)
                                │
                                ├─ PostgreSQL 17 (RDS Aurora)
                                └─ 상품 이미지 (S3 / RustFS)

모니터링 & 관측성:
  ├─ Prometheus v3 (서버 로컬 메트릭 및 리더 API 업무 지표 스크레이프)
  ├─ Alertmanager (14개 업무/시스템 경보 규칙 및 런북 연동)
  └─ Sentry (오류 이벤트의 개인정보/비밀값 자동 마스킹)

GitHub Actions 배포 파이프라인:
  검사(verify:fast) ➔ 이미지 GHCR 빌드 ➔ SSH release.sh up (대기 슬롯) ➔ 스모크 테스트 ➔ release.sh switch (무중단 전환)
```

- **블루그린 무중단 배포**: 쉬고 있는 대기 슬롯에 새 이미지를 띄우고 Playwright 스모크 테스트를 통과하면 Caddy가 트래픽을 즉시 넘깁니다. 이전 슬롯은 지우지 않고 멈춰 두어 롤백은 즉각적인 라우팅 복귀로 완료됩니다.
- **비용 0원 운영 아키텍처**: 모든 외부 유료 서비스(LLM, 유료 PG, 유료 메일러)는 키가 없어도 핵심 도메인이 멈추지 않는 방어적 기본값(Fallback/Null Object)으로 설계되었습니다.

---

## 다룬 문제와 결과

수치는 PC 및 리허설 환경에서 k6와 측정 스크립트로 잰 값입니다.

| 문제 | 한 일 | 결과 |
| --- | --- | --- |
| 재고 10개 상품에 동시 결제 50건이 모두 성공 | 재고를 `SELECT ... FOR UPDATE`로 잠그고 읽기. 낙관적 잠금, SERIALIZABLE과 k6로 비교 | 인기 상품 하나에 결제가 몰릴 때 모두 처리한 것은 비관적 잠금뿐(낙관적 잠금은 재시도 13,928번에 55.4%) |
| 상품 두 개를 반대 순서로 동시에 결제하면 60건 중 57건이 500 | 교착이 커넥션 풀 고갈로 번진 것을 확인하고 잠그는 순서를 상품 id 순으로 통일 | 60건 모두 성공 |
| 타임아웃 뒤 재시도하면 주문과 결제가 두 번 | `Idempotency-Key`를 주문과 같은 트랜잭션에 저장 | 같은 키로 동시 20건을 보내도 주문 1건 |
| 커밋 전에 알림을 보내면 롤백된 주문의 알림이 나가고, 커밋 뒤 보내기 전에 죽으면 알림이 사라짐 | 트랜잭셔널 아웃박스 | 재기동 뒤 빠짐없이 발송(적어도 한 번) |
| 새로고침만 했는데 로그아웃 | 동시에 나간 refresh 두 개를 서버가 재사용으로 본 것. 클라이언트가 refresh 하나를 나눠 쓰게 고침 | 새로고침 한 번에 refresh 한 번을 e2e로 고정 |
| DB가 죽으면 "API 응답 없음" 경보가 잘못 울리고 오류율 경보는 조용 | DB에 묻는 지표 하나의 실패가 `/metrics` 전체를 500으로 만든 것. 실패를 그 지표에 가둠 | DB 정지 71초 뒤 오류율 경보(로컬 환경) |
| 배포할 때마다 요청이 끊김 | 같은 자리 교체를 블루그린으로 | 초당 50건 리허설에서 실패 179건(3.52초)이 0건 |
| 칸 이름을 바꾸는 배포에서 옛 버전이 깨짐 | 마이그레이션을 네 번의 배포로 나눔(expand, contract) | 실패 176건이 배포마다 0건 |
| 상품 목록이 느림 | 재고는 빼고 카탈로그만 Redis에 캐시 | 목록 p95 166ms에서 79ms, 적중률 99.7% |
| 오타가 섞이거나 2글자 단어로 검색하면 상품을 못 찾음 | PostgreSQL `pg_trgm` 2-gram 색인 및 유사도 보정 (26) | 외장 검색 엔진 없이 오타 보정 및 실시간 자동완성 처리 |
| 결제 위변조 및 PG 비동기 장애로 인한 정산 오차 | 토스페이먼츠 결제위젯 연동, 웹훅 실조회 재검증, 매일 04시 전수 대사 배치 (27, 29) | 결제 금액 검증 및 불일치 감지/해결 파이프라인 구축 |
| 주문 결제 후 배송·반품·재고 복구의 다단계 상태 꼬임 | 순수 함수 상태 기계와 조건부 UPDATE, 멱등 환불 연동 (28) | 상태 전이 147쌍 전수 검증, 중복 환불·재고 누락 원천 차단 |
| 1인 운영자의 반복적인 주문 조회 및 재고/반품 처리 부담 | Model Context Protocol(MCP) 서버 구축 (30) | Claude Code 등 AI 에이전트가 11개 도구로 상점 자동 관리 (감사 로그 완비) |
| 운영 중 장애 발생 시 원인 규명 지연 및 개인정보 유출 위험 | Sentry 에러 마스킹, Prometheus 비즈니스 지표, 14개 경보 규칙 및 런북 (31, 32) | 주소·전화번호 철저 마스킹, 장애 발생 시 런북 링크로 즉각 대응 체계 완비 |

---

## 단계별 브랜치

각 단계의 브랜치를 체크아웃하면 그 시점의 소스코드와 상세 README를 확인할 수 있습니다:

| 브랜치 | 주제 | 시작 | 내용 |
| --- | --- | --- | --- |
| [01-postgres-prisma](https://github.com/seungwoo7050/node-order/tree/01-postgres-prisma) | PostgreSQL, Prisma | node-workspace `foundation/05-ws-gateway`의 API | 메모리 배열 저장을 PostgreSQL + Prisma로 바꾸고, 사용자 테이블과 외래키, 마이그레이션, 시드, 인덱스를 더합니다 |
| [02-transactions-and-concurrency](https://github.com/seungwoo7050/node-order/tree/02-transactions-and-concurrency) | 트랜잭션, 동시성 | 01의 소스 | 상품, 주문 품목 테이블과 결제 API를 더하고, 재고 차감을 비관적 잠금으로, 결제 요청을 `Idempotency-Key`로 멱등하게, 알림을 트랜잭셔널 아웃박스로 만듭니다 |
| [03-auth-hardening](https://github.com/seungwoo7050/node-order/tree/03-auth-hardening) | 인증 심화 | 02의 소스 | 로그인을 scrypt 비밀번호 해시 검증으로 바꾸고, 짧은 액세스 토큰과 httpOnly 쿠키의 refresh token(회전, 재사용 감지)을 더합니다 |
| [04-redis](https://github.com/seungwoo7050/node-order/tree/04-redis) | Redis, BullMQ | 03의 소스 | socket.io Redis 어댑터로 서버 여러 대가 알림을 주고받게 하고, 메일 발송을 BullMQ 큐로 옮깁니다 |
| [05-front-state](https://github.com/seungwoo7050/node-order/tree/05-front-state) | TanStack Query, Zustand | 04의 API, node-workspace `foundation/04-integration-and-auth`의 화면 | 주문 콘솔에 상품 목록, 장바구니, 로그인, 결제, 내 주문 화면을 더하고 Playwright e2e를 붙입니다 |
| [06-file-upload](https://github.com/seungwoo7050/node-order/tree/06-file-upload) | 파일 업로드 | 05의 소스 | presigned URL로 상품 이미지를 S3 호환 저장소(RustFS)에 직접 올립니다 |
| [07-operations](https://github.com/seungwoo7050/node-order/tree/07-operations) | 운영 준비 | 06의 소스 | API를 다단계 Dockerfile로 이미지화하고, pino 구조화 로그와 OpenTelemetry 추적을 붙입니다 |
| [08-load-and-csp](https://github.com/seungwoo7050/node-order/tree/08-load-and-csp) | k6, CSP | 07의 소스 | 결제 API용 k6 부하 시나리오와 부하용 시드를 더하고, 화면에 Content-Security-Policy를 겁니다 |
| [09-category-tree](https://github.com/seungwoo7050/node-order/tree/09-category-tree) | 자기참조 트리 | 08의 소스 | 상품에 계층 카테고리를 붙이고, 하위 상품과 경로를 재귀 CTE(`WITH RECURSIVE`)로 조회합니다 |
| [10-rls](https://github.com/seungwoo7050/node-order/tree/10-rls) | 행 수준 보안 | 09의 소스 | 주문 테이블에 PostgreSQL RLS 정책을 걸고, 앱은 테이블 소유자가 아닌 `order_app` 역할로 접속합니다 |
| [11-service-worker](https://github.com/seungwoo7050/node-order/tree/11-service-worker) | 서비스 워커 | 10의 소스 | 주문 콘솔에 서비스 워커를 등록해 페이지와 인증 없는 API 응답을 캐시하고, 네트워크가 끊기면 캐시로 응답합니다 |
| [12-trpc](https://github.com/seungwoo7050/node-order/tree/12-trpc) | tRPC | 11의 소스 | 저장소 루트를 npm 워크스페이스로 묶고, 백엔드에 tRPC 라우터를 붙여 화면이 타입을 공유합니다 |
| [13-authjs](https://github.com/seungwoo7050/node-order/tree/13-authjs) | Auth.js | 12의 소스 | GitHub 로그인을 더합니다. OAuth는 Next의 Auth.js가 맡고, 백엔드는 일회용 코드를 기존 토큰으로 바꿔 줍니다 |
| [14-stripe](https://github.com/seungwoo7050/node-order/tree/14-stripe) | Stripe | 13의 소스 | 결제를 Stripe Checkout(테스트 모드)으로 옮기고, 서명을 검증한 웹훅이 와야 결제 완료가 되게 합니다 |
| [15-monitoring](https://github.com/seungwoo7050/node-order/tree/15-monitoring) | Prometheus, Grafana | 14의 소스 | API가 `/metrics`로 지표를 내보내고, Prometheus, Alertmanager, Grafana로 수집, 경보, 대시보드를 붙입니다 |
| [16-release-candidate](https://github.com/seungwoo7050/node-order/tree/16-release-candidate) | 배포 준비 | 15의 소스 | 웹에도 컨테이너 이미지를 더하고, 루트 `compose.yaml` 하나로 인프라, 앱, 모니터링을 띄우며, 검사 명령을 루트 `package.json`에 모읍니다 |
| [17-ci](https://github.com/seungwoo7050/node-order/tree/17-ci) | GitHub Actions | 16의 소스 | 푸시마다 lint, 타입 검사, 테스트, e2e, 경보 규칙 테스트와 Docker 이미지 빌드를 돌립니다 |
| [18-deploy](https://github.com/seungwoo7050/node-order/tree/18-deploy) | AWS 배포 | 17의 소스 | 스크립트로 EC2, RDS, S3를 만들고, CI가 GHCR에 이미지를 올린 뒤 SSH로 배포합니다 |
| [19-design](https://github.com/seungwoo7050/node-order/tree/19-design) | 화면 다듬기 | 18의 소스 | 디자인 토큰으로 화면을 다시 그리고, 사용자 역할(`user`, `admin`)과 관리자 페이지, 데모 로그인을 더합니다 |
| [20-operations](https://github.com/seungwoo7050/node-order/tree/20-operations) | 운영 | 19의 소스 | 운영 서버에 DB 백업(S3)과 데모 데이터 초기화를 systemd 타이머로 붙이고, 백업 복원 대조 스크립트를 더합니다 |
| [21-public-demo](https://github.com/seungwoo7050/node-order/tree/21-public-demo) | 공개 데모 | 20의 소스 | 데모 로그인이 임시 사용자를 만들고, IP별 요청 수 제한을 더하며, 관리용 API를 관리자 전용으로 막습니다 |
| [22-pagination-locking](https://github.com/seungwoo7050/node-order/tree/22-pagination-locking) | 페이지네이션, 잠금 | 21의 소스 | 목록 API를 cursor 페이지로 나누고, 관리자 재고 조정 API, 화면과 REST API 문서(`/docs`)를 더합니다 |
| [23-caching](https://github.com/seungwoo7050/node-order/tree/23-caching) | 캐시 | 22의 소스 | 상품 카탈로그를 API는 Redis에, 화면은 Next 서버 캐시에 두고, 상품 수정이 두 캐시를 지우게 합니다 |
| [24-zero-downtime-release](https://github.com/seungwoo7050/node-order/tree/24-zero-downtime-release) | 무중단 배포 | 23의 소스 | 배포를 블루, 그린 전환으로 바꾸고, 전환 전에 스모크 테스트를 돌리며, 칸 이름 변경을 여러 마이그레이션으로 나눕니다 |
| [25-harness](https://github.com/seungwoo7050/node-order/tree/25-harness) | 하네스 & 테스트 | 24의 소스 | AGENTS.md, 파일 린트·위험 명령 차단 훅, 통합 빠른 검사(`verify:fast`)와 CI 파이프라인 정비 |
| [26-search](https://github.com/seungwoo7050/node-order/tree/26-search) | 상품 검색 | 25의 소스 | PostgreSQL `pg_trgm` 2-gram 인덱스, 오타 보정 검색, 실시간 자동완성, Redis 인기 검색어 |
| [27-toss-payments](https://github.com/seungwoo7050/node-order/tree/27-toss-payments) | 토스페이먼츠 연동 | 26의 소스 | 토스 결제위젯·승인·취소/부분환불, PG 웹훅 재조회 검증, 결제 대역 시뮬레이터 |
| [28-fulfillment](https://github.com/seungwoo7050/node-order/tree/28-fulfillment) | 주문 이행 | 27의 소스 | 주문 상태 기계(결제완료→배송준비→배송중→배송완료→구매확정), 배송지 사본 및 배송비 정책, 송장 추적 및 반품·재고 복구 |
| [29-admin](https://github.com/seungwoo7050/node-order/tree/29-admin) | 관리자 & PG 대사 | 28의 소스 | 관리자 대시보드(오늘 주문·재고 부족), 상점 설정(낙관적 락), 약관 버전 관리, 정기 PG 대사 배치 |
| [30-ai-mcp](https://github.com/seungwoo7050/node-order/tree/30-ai-mcp) | 판매자용 MCP & AI | 29의 소스 | Model Context Protocol(MCP) 서버(11개 도구), LLM 기반 상품 설명 초안 실시간 스트리밍 |
| [31-observability](https://github.com/seungwoo7050/node-order/tree/31-observability) | 관측성 | 30의 소스 | Sentry 에러 추적(개인정보 마스킹), Prometheus 업무 지표 수집, Alertmanager 경보 및 런북 |
| [32-production-prep](https://github.com/seungwoo7050/node-order/tree/32-production-prep) | 운영 배포 전 실험 | 31의 소스 | 비용 0원 운영 구성, 토스 개발자 테스트 키 연동, 모니터링 런북 결함 해결 및 포트폴리오 종합 아키텍처 수록 |

---

### 로컬 실행 방법

```sh
# 저장소를 둘 위치에서
git clone https://github.com/seungwoo7050/node-order.git
cd node-order
git switch 32-production-prep # 최신 브랜치로 전환
```

1. **설치 및 인프라 실행**: 루트에서 `npm ci` 후 `docker compose up -d`로 로컬 인프라(Postgres, Redis, Storage)를 실행합니다.
2. **환경변수 복사**:
   ```sh
   cp order-api-nest/.env.example order-api-nest/.env
   cp order-console-next/.env.example order-console-next/.env.local
   ```
3. **마이그레이션 및 시드**:
   ```sh
   cd order-api-nest && npx prisma migrate dev && npm run seed && cd ..
   ```
4. **개발 서버 실행**: `npm run dev:api` (API: 4000), `npm run dev:web` (Next.js 콘솔: 3000)으로 실행합니다.

### 테스트 검증

- **빠른 검사**: `npm run verify:fast` (Prisma + Lint + Typecheck + 단위 테스트 + 가드 테스트)
- **전체 검증**: `npm run verify` (빠른 검사 + e2e + 결제 시뮬레이터 + 모니터링 규칙)
- **경보 규칙 검사**: `npm run test:rules` (Prometheus 14개 경보 규칙 + Alertmanager 검증)
