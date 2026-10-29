# node-order

![Language](https://img.shields.io/badge/language-TypeScript-blue?logo=typescript&logoColor=white)
![Runtime](https://img.shields.io/badge/runtime-Node.js-339933?logo=nodedotjs&logoColor=white)
![Stack](https://img.shields.io/badge/stack-NestJS%20%7C%20Next.js%20%7C%20Prisma%20%7C%20PostgreSQL%20%7C%20Redis-lightgrey)

백엔드 학습을 위해 설계하고 배포한 주문 서비스입니다. 서버를 껐다 켜면 주문이 사라지던 NestJS API에서 시작해, PostgreSQL과 Redis, S3를 쓰고 AWS에 무중단으로 배포하는 서비스까지 키웠습니다. 한 번에 만들지 않고 단계마다 브랜치를 하나씩 남겼습니다.

> **지금 코드는 [`24-zero-downtime-release`](https://github.com/seungwoo7050/node-order/tree/24-zero-downtime-release) 브랜치에 있습니다.**  
> 이 `main` 브랜치에는 이 문서만 둡니다. 다음 단계를 더하면 `25`, `26` 브랜치로 이어지고, 이 문서의 링크도 그 브랜치로 옮깁니다.

- 데모: https://shop.43-202-205-93.sslip.io/
- 지금 코드: [`24-zero-downtime-release`](https://github.com/seungwoo7050/node-order/tree/24-zero-downtime-release)
- 단계별 브랜치: [아래 목록](#단계별-브랜치)

## 데모 둘러보기

- 로그인 화면에서 "일반 사용자로"나 "관리자로"를 누르면 비밀번호 없이 임시 계정이 만들어집니다. 이 계정은 24시간 뒤 지워집니다.
- 공개 데모라서 매일 새벽 4시(KST)에 상품과 데모 주문을 처음 상태로 되돌립니다. 새벽 3시 30분의 DB 백업이 그날 성공했을 때만 되돌립니다. GitHub로 가입한 계정과 그 주문은 남습니다.
- 결제는 Stripe 테스트 모드라 실제로 돈이 나가지 않습니다.

## 구성

```text
브라우저
  │
Caddy (EC2 한 대, HTTPS)
  ├─ web-blue / web-green   Next.js 화면
  └─ api-blue / api-green   NestJS API ── Redis (같은 서버의 컨테이너)
                                │
                                ├─ PostgreSQL (RDS)
                                └─ 상품 이미지 (S3)

GitHub Actions 배포 순서: 검사, 이미지를 GHCR에 올리기, SSH로 release.sh up, 대기 쪽 스모크 테스트, release.sh switch
```

- 배포는 블루그린입니다. 쉬고 있는 쪽에 새 이미지를 띄우고 스모크 테스트를 통과하면 Caddy가 그쪽으로 트래픽을 넘깁니다. 이전 쪽은 지우지 않고 멈춰 두어 되돌리기는 다시 가리키기만 하면 됩니다.
- 서버 한 대에 모았습니다. ALB와 ECS는 학습용 서비스 한 대에 비해 비용이 컸고, 무엇이 어디서 도는지 직접 보려고 EC2와 Docker Compose를 골랐습니다.

## 다룬 문제와 결과

수치는 제 PC나 리허설 환경에서 k6와 스크립트로 잰 값입니다.

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

## 한계

- 운영 서버에는 지표 수집과 경보가 없습니다. Prometheus와 Grafana는 로컬 환경에서만 구성했습니다.
- 서버 한 대 구성이라 재부팅하는 동안은 서비스가 멈춥니다. 리소스는 IaC 도구 없이 AWS CLI 스크립트로 만들었습니다.
- 실제 사용자 트래픽과 실제 결제는 없습니다.

## 단계별 브랜치

[node-workspace](https://github.com/seungwoo7050/node-workspace)에서 만든 주문 API에서 출발합니다. 단계마다 브랜치가 하나씩 있고, 각 브랜치의 `README.md`에 그 단계의 시작점, 바뀐 것, 실행과 테스트 방법을 적었습니다.

### 요구 환경

- Node.js와 npm이 필요합니다. 어느 브랜치의 package.json에도 engines 지정은 없습니다. `17` 이후의 CI는 Node.js 24를 씁니다.
- Docker가 필요합니다. 모든 브랜치가 PostgreSQL을 compose로 띄웁니다(`04`부터 Redis, `06`부터 S3 호환 저장소 RustFS가 더해집니다).
- 그 밖에 필요한 것(Playwright 브라우저, k6, GitHub, Stripe, AWS 계정과 CLI)은 각 브랜치 `README.md`의 실행 절에 적었습니다.

### 시작 상태

브랜치끼리 공통 조상이 없습니다. 24개 브랜치의 루트 커밋이 모두 다릅니다. 각 브랜치는 앞 단계 소스를 파일째 가져온 커밋에서 시작합니다. 아래 표의 "시작" 열이 그 출발점입니다.

### 지원 범위

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

- 번호 순서대로 진행합니다. `01`~`04`는 API(`order-api-nest`)만 바꾸고, `05`에서 주문 콘솔(`order-console-next`)이 들어옵니다.
- `16`부터 루트에서 두 프로젝트를 함께 띄우고 검사하며, `17`부터 CI, `18`부터 AWS 배포가 붙습니다.

### 구성

- 각 브랜치 루트에 프로젝트 폴더가 있습니다. `01`~`04`는 `order-api-nest/` 하나이고, `05`부터 `order-console-next/`가 더해집니다. `12`부터 루트 `package.json`이 두 폴더를 npm 워크스페이스로 묶습니다.
- `18`부터 `deploy/`(AWS 스크립트, 운영 compose)와 `.github/workflows/`가 있습니다.
- 각 브랜치 루트의 `README.md`에 그 단계의 시작 브랜치, 지원 범위, 구성, 실행, 테스트, 정리를 적었습니다.

### 실행

```sh
# 저장소를 둘 위치에서
git clone https://github.com/seungwoo7050/node-order.git
cd node-order
git switch 10-rls # 원하는 브랜치
```

브랜치를 바꾸면 작업 트리 전체가 그 단계로 바뀝니다. 두 단계를 나란히 두고 보려면 worktree를 씁니다.

```sh
# node-order 안에서
git worktree add ../09-category-tree 09-category-tree
```

설치는 `11`까지 프로젝트 폴더마다 `npm ci`, `12`부터 루트에서 `npm ci` 한 번입니다. `15`까지는 `order-api-nest/`에서 `docker compose up -d`와 마이그레이션, 시드 뒤 `npm run start:dev`로 API를 띄웁니다. `16`부터는 루트에서 `docker compose up -d` 뒤 `npm run dev:api`, `npm run dev:web`으로 띄웁니다. 정확한 명령과 필요한 `.env`는 각 브랜치 README의 실행 절에 있습니다.

### 테스트

- 모든 브랜치의 `order-api-nest`에 Vitest 단위, e2e 테스트가 있습니다. e2e는 compose로 띄운 PostgreSQL의 테스트 DB를 씁니다.
- `05`부터 `order-console-next`에 Playwright e2e가, `19`부터 Vitest 단위 테스트가 있습니다.
- `15`부터 Prometheus 경보 규칙의 `promtool` 테스트가 있습니다.
- `16`부터 루트에서 `npm run lint`, `npm run typecheck`, `npm run test:api`, `npm run test:web`, `npm run test:rules`로 돌립니다. `17`부터 같은 검사를 GitHub Actions가 푸시마다 돌립니다.
- 각 브랜치에서 무엇을 어떤 순서로 돌리는지는 그 브랜치 README의 테스트 절에 있습니다.
