# 18: 배포

![Language](https://img.shields.io/badge/language-TypeScript%20%7C%20Bash-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-AWS%20(EC2%20%7C%20RDS%20%7C%20S3)%20%7C%20Caddy%20%7C%20GHCR%20%7C%20GitHub%20Actions-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [17-ci](https://github.com/seungwoo7050/node-order/tree/17-ci) 브랜치의 전체 워크스페이스(`order-api-nest`, `order-console-next`, `monitoring`, `compose.yaml`, `.github/workflows/ci.yml`)

지금까지 주문 서비스는 PC와 CI의 가상 머신에서만 돌았습니다.

이 단계에서는 AWS에 서버 한 대와 관리형 DB를 스크립트로 만들고, CI의 검사가 모두 통과한 커밋만 그 서버에 자동으로 배포합니다. 새 버전이 준비되지 않으면 이전 버전으로 되돌립니다. 학습용이라 Free 플랜 크레딧 안에서 합니다.

과정 전체(막힌 곳, 개념, 에러 신호)는 [guide/README.md](guide/README.md)에 있습니다. 이 문서는 무엇이 있고 어떻게 돌리는지만 적습니다.

## 지원 범위

- 구성: EC2(`t3.small`, Ubuntu 24.04) 한 대 + RDS PostgreSQL(`db.t4g.micro`) + S3 버킷. 리전은 `ap-southeast-2`(Free 플랜 계정에서 서울을 쓸 수 없음)

  - 서버 안은 Docker Compose: Caddy(HTTPS) → web(Next) · api(Nest), Redis(컨테이너)

  - 주소는 sslip.io(`shop.<IP>.sslip.io`, `api.<IP>.sslip.io`). 도메인 없이 Let's Encrypt 인증서를 받음

  - DB는 인터넷에서 닿지 않고(`--no-publicly-accessible`), 서버 보안 그룹에서 오는 5432만 받음. 연결은 `sslmode=verify-full` + RDS 인증서 묶음(`NODE_EXTRA_CA_CERTS`)

- AWS 리소스는 `deploy/aws/`의 번호 붙은 스크립트로 만들고 지움(내 PC에서 실행)

  - 모든 리소스의 이름 앞부분은 `node-order`, 태그는 `Project=node-order`. 정리 스크립트가 이 태그로 남은 것을 찾음

  - 비밀번호·SSH 키는 `deploy/aws/.local/`(커밋하지 않음)에만 만들고 화면에 찍지 않음

- 서버와 CI 어디에도 오래 가는 AWS 액세스 키를 두지 않음

  - 앱의 S3 접근은 EC2에 붙인 IAM 역할의 임시 자격 증명(IMDSv2, 홉 제한 2). S3 접근 키가 없으면 SDK 기본 자격 증명을 쓰도록 앱을 고침

  - 이 계정은 SCP가 OIDC 공급자를 막으므로, 배포는 GHCR + SSH로 함(CI 전용 SSH 키, 호스트 키 고정)

- 워크플로 `.github/workflows/ci.yml`(`17`에서 이어서)

  - 검사·테스트는 모든 브랜치에서 그대로 돎(`branches: ["**"]`)

  - 이미지 올리기와 배포는 저장소 변수 `DEPLOY_BRANCH`와 이름이 같은 브랜치에서만. 다른 브랜치에서는 이미지를 빌드만 하고 배포 작업은 "건너뜀"

  - 이미지 세 개(`order-api`, `order-api-migrate`, `order-web`)를 커밋 해시 태그로 GHCR에 올림

  - 배포 작업은 검사·테스트·이미지 작업이 모두 통과해야 시작하고, 한 번에 하나만 돌며 도중에 취소되지 않음(`deploy-production`)

- 서버의 배포 스크립트 `deploy/deploy.sh`

  - 이미지 받기 → 마이그레이션 → 앱 역할 비밀번호 맞추기 → 컨테이너 교체 → `/health/ready`가 healthy가 될 때까지 대기

  - 어느 단계든 실패하면 `IMAGE_TAG`와 컨테이너를 이전 버전으로 되돌리고 실패로 끝냄. 마이그레이션은 되돌리지 않음

  - GHCR 로그인은 배포 동안만. 끝나면 이전 버전의 이미지를 지움(현재 버전의 마이그레이션 이미지는 남김)

- 운영 로그가 찾은 버그 수정: `order.paid` 이벤트의 주문 메일에 주문 번호가 `null`로 나가던 문제(`orderIdOf`와 단위 테스트)

- 시드는 배포 스크립트에 넣지 않음. 모든 테이블을 비우므로 처음 한 번(또는 데모 초기화 때) 손으로만 돌림

- 서버가 한 대라 컨테이너를 바꾸는 몇 초 동안 API는 응답하지 못합니다. 무중단 배포와 앱 로그의 CloudWatch 전송은 다루지 않습니다.

## 구성

```text
.
├── .github/
│   └── workflows/
│       └── ci.yml                    # 17에 이미지 올리기(GHCR)와 deploy 작업을 더함. DEPLOY_BRANCH로 배포 브랜치를 고름
├── deploy/                           # 이 단계에서 새로 만든 폴더
│   ├── compose.yml                   # 운영 서버의 Compose. caddy, redis, migrate(tools), api, web
│   ├── Caddyfile                     # 두 주소에 HTTPS를 붙이고 web:3000, api:4000으로 넘김
│   ├── deploy.sh                     # 서버에서 실행. 지정한 태그로 교체, 실패하면 되돌림
│   ├── .env.example                  # 서버 .env의 견본(실제 .env는 서버에만)
│   ├── .gitignore                    # .env, rds-ca.pem
│   └── aws/                          # 내 PC에서 실행해 AWS 리소스를 만들고 지우는 스크립트
│       ├── lib.sh                    # 공통 설정(프로필, 리전, NAME, 태그, 조회 함수)
│       ├── 00-check.sh               # 읽기 명령만으로 이 계정에서 무엇이 되는지 점검
│       ├── 10-budget.sh              # 예산 알림(크레딧 빼기 전 금액 기준)
│       ├── 20-network.sh             # 보안 그룹 두 개(서버: 80·443·22, DB: 서버에서 5432만)
│       ├── 30-storage.sh             # S3 버킷(공개 차단)과 IAM 역할·인스턴스 프로필. CORS는 앱이 시작할 때 넣음
│       ├── 40-database.sh            # RDS PostgreSQL
│       ├── 50-server.sh              # SSH 키, EC2, 탄력적 IP
│       ├── user-data.sh              # 서버 첫 부팅: Docker, 스왑, RDS 인증서 묶음, 키 전용 SSH
│       ├── 60-server-env.sh          # .local/server.env를 만들어 서버 /opt/node-order/.env로 올림
│       ├── 61-stripe-webhook.sh      # 운영 주소로 Stripe 웹훅 엔드포인트를 만들고 서명 비밀을 .env에 넣음
│       ├── 90-destroy.sh             # 만든 순서의 반대로 모두 지움
│       ├── 99-leftovers.sh           # 태그와 종류별 개수로 남은 리소스 확인
│       ├── .gitignore                # .local/
│       └── .local/                   # 키·비밀번호·secrets.env (커밋하지 않음)
├── order-api-nest/                   # NestJS API (storage: 기본 자격 증명, outbox: orderIdOf)
├── order-console-next/               # Next.js 프론트
├── monitoring/
├── compose.yaml                      # 개발용. 그대로
└── README.md
```

## 실행

### 준비

- AWS 계정과 AWS CLI 2.32 이상(`aws login`), GitHub CLI(`gh`), `13`의 GitHub OAuth 앱과 `14`의 Stripe 테스트 키

- 터미널에서 `aws`를 직접 칠 때는 프로필과 리전을 먼저 넣습니다. 스크립트 안에서는 `lib.sh`가 넣습니다.

```sh
aws login --profile node-order --region ap-southeast-2
export AWS_PROFILE=node-order AWS_REGION=ap-southeast-2
```

### AWS 리소스 만들기

`deploy/aws`에서 번호 순서대로 한 번씩 실행합니다. `20`~`50`은 이미 있는지 확인하지 않으므로 두 번 실행하면 `create-*`에서 멈춥니다.

```sh
cd deploy/aws
./00-check.sh                         # 기본 VPC, EC2·RDS·S3·IAM·Budgets가 OK인지 (IAM OIDC는 막혀 있어도 됨)
./10-budget.sh you@example.com 10     # 월 $10 기준 예산 알림
./20-network.sh && ./30-storage.sh
./40-database.sh                      # RDS가 available이 될 때까지 몇 분 기다림
./50-server.sh                        # 끝에 IP, WEB_HOST, API_HOST, SSH 명령을 찍음
```

### 서버 값 넣기

운영용 GitHub OAuth 앱을 하나 더 만듭니다(콜백 `https://<WEB_HOST>/api/auth/callback/github`). 개발용 앱은 그대로 둡니다. 값은 `.local/secrets.env`에 적습니다.

```sh
# deploy/aws/.local/secrets.env
STRIPE_SECRET_KEY=sk_test_...
PROD_GITHUB_CLIENT_ID=...
PROD_GITHUB_CLIENT_SECRET=...
```

Stripe 웹훅 비밀은 적지 않습니다. 아래 스크립트가 운영 주소로 엔드포인트를 만들고, 그 비밀까지 넣어 서버 `.env`를 올립니다.

```sh
S=.local/secrets.env
STRIPE_SECRET_KEY=$(grep '^STRIPE_SECRET_KEY=' "$S" | cut -d= -f2-) \
GITHUB_CLIENT_ID=$(grep '^PROD_GITHUB_CLIENT_ID=' "$S" | cut -d= -f2-) \
GITHUB_CLIENT_SECRET=$(grep '^PROD_GITHUB_CLIENT_SECRET=' "$S" | cut -d= -f2-) \
./61-stripe-webhook.sh                # 마지막 줄이 600 ubuntu /opt/node-order/.env면 올라간 것
```

### 저장소 값 넣기

주소는 Variables, 키는 Secrets에 둡니다. `<IP>` 자리는 `50-server.sh`의 출력입니다.

```sh
R=<계정>/<저장소>
gh variable set DEPLOY_BRANCH -R $R -b 18-deploy
gh variable set DEPLOY_HOST   -R $R -b <IP>
gh variable set WEB_HOST      -R $R -b shop.<IP를 -로 이은 것>.sslip.io
gh variable set API_HOST      -R $R -b api.<IP를 -로 이은 것>.sslip.io
gh variable set STORAGE_URL   -R $R -b https://s3.ap-southeast-2.amazonaws.com
gh secret set DEPLOY_SSH_KEY     -R $R < .local/ci_ed25519
gh secret set DEPLOY_KNOWN_HOSTS -R $R < .local/known_hosts
```

저장소 Settings → Environments → `production` → Deployment branches and tags에서 `18-deploy`만 허용하면, `DEPLOY_BRANCH`를 잘못 바꿔도 다른 브랜치는 배포되지 않습니다.

### 배포

`DEPLOY_BRANCH`의 브랜치에 푸시하면 검사 → 이미지 → 배포 순서로 돕니다.

```sh
git push
gh run watch
```

```text
ci  18-deploy  push
  린트·타입 검사      success   56초
  백엔드 테스트       success   79초
  프론트 e2e          success   140초
  경보 규칙 테스트    success   14초
  이미지 빌드·올리기  success   ...
  배포                success   ...
```

첫 배포에서는 Caddy가 인증서를 받는 동안 HTTPS가 잠깐 실패하므로, 배포 작업의 마지막 확인 단계가 최대 60초 다시 시도합니다.

### 시드(처음 한 번, 또는 데모 초기화)

```sh
ssh -i .local/admin_ed25519 ubuntu@<IP> 'cd /opt/node-order && docker compose run --rm migrate npx prisma db seed'
```

시드 사용자의 비밀번호는 서버 `.env`의 `DEMO_PASSWORD`(무작위 값)입니다. 다시 돌리면 모든 데이터가 시드 상태로 돌아갑니다.

## 결과 보기

```sh
curl -fsS https://api.<IP를 -로 이은 것>.sslip.io/health/ready   # API 준비 상태
gh run list --branch 18-deploy                                    # 최근 실행
gh run view <실행 id> --log-failed                                # 실패한 단계의 로그(배포 실패면 api 로그 30줄 포함)

# 서버(deploy/aws에서)
ssh -i .local/admin_ed25519 ubuntu@<IP> 'cd /opt/node-order && docker compose ps'
ssh -i .local/admin_ed25519 ubuntu@<IP> 'cd /opt/node-order && docker compose logs api --no-log-prefix --tail 100'
ssh -i .local/admin_ed25519 ubuntu@<IP> 'grep ^IMAGE_TAG /opt/node-order/.env'   # 지금 떠 있는 커밋
```

브라우저에서는 `https://shop.<IP를 -로 이은 것>.sslip.io`에서 GitHub 로그인, 상품 이미지 올리기(S3), 테스트 카드(`4242 4242 4242 4242`) 결제가 되는지 봅니다.

## 다음 단계로 넘어갈 때

서버는 한 대, 앱은 한 벌이고, 배포는 그 한 벌의 이미지를 바꾸는 일입니다. 새 브랜치가 배포하게 하려면 워크플로 파일은 그대로 두고 두 곳만 바꿉니다.

```sh
gh variable set DEPLOY_BRANCH -R $R -b <새 브랜치>
```

- Environments의 허용 브랜치를 새 브랜치로 바꿈. 끝난 브랜치에 푸시해도 배포되지 않음

- `deploy/aws/.local/`은 커밋되지 않으므로 새 브랜치의 작업 폴더로 직접 옮김

- 서버가 살아 있으면 `00`~`50` 스크립트는 다시 실행하지 않음

## 정리

켜 둔 동안 하루 약 $1.5가 크레딧에서 빠집니다. 며칠 안에 다시 배포할 거라면 지우지 않고 남은 것만 확인합니다.

```sh
cd deploy/aws
./99-leftovers.sh                                       # 켜 둔 상태: 스냅숏 0, 보안 그룹 2, 나머지 1
STRIPE_SECRET_KEY=<테스트 키> ./90-destroy.sh           # 모두 지움(Stripe 웹훅 엔드포인트 포함). 예산 알림은 남김
./99-leftovers.sh                                       # 지운 뒤: 모두 0
```
