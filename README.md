# 18: 배포

![Language](https://img.shields.io/badge/language-TypeScript%20%7C%20Bash-blue?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-AWS%20(EC2%20%7C%20RDS%20%7C%20S3)%20%7C%20Caddy%20%7C%20GHCR%20%7C%20GitHub%20Actions-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [17-ci](https://github.com/seungwoo7050/node-order/tree/17-ci) 브랜치

`deploy/aws/`의 스크립트로 AWS에 EC2 한 대, RDS PostgreSQL, S3 버킷을 만들고, CI 워크플로에 GHCR 이미지 올리기와 SSH 배포 작업을 더했습니다. 서버의 `deploy/deploy.sh`는 지정한 커밋의 이미지로 컨테이너를 바꾸고, 실패하면 이전 태그로 되돌립니다. 앱 코드는 S3 자격 증명 처리와 `order.paid` 메일의 주문 번호 두 곳이 바뀌었습니다.

## 지원 범위

- `17-ci`까지의 기능과 CI 작업(`check`, `test-api`, `test-web`, `alert-rules`, `images`)
- 운영 구성
  - EC2(`t3.small`, Ubuntu 24.04, 디스크 16GB, 스왑 2GB) + RDS PostgreSQL 17(`db.t4g.micro`) + S3 버킷. 리전 기본값은 `ap-southeast-2`(`deploy/aws/lib.sh`)
  - 서버 안은 Docker Compose(`deploy/compose.yml`): caddy(80·443) → web(`3000`)·api(`4000`), redis(컨테이너, 저장 안 함), migrate(`tools` 프로필)
  - 주소는 탄력적 IP를 쓴 sslip.io(`shop.<IP를 -로 이은 것>.sslip.io`, `api.<IP를 -로 이은 것>.sslip.io`). Caddy가 HTTPS 인증서를 받는다
  - RDS는 `--no-publicly-accessible`이고 DB 보안 그룹은 서버 보안 그룹에서 오는 5432만 받는다. 연결은 `sslmode=verify-full`과 RDS 인증서 묶음(`NODE_EXTRA_CA_CERTS`)
  - S3는 공개 차단. 앱은 EC2 인스턴스 프로필(IAM 역할)의 임시 자격 증명을 쓴다(IMDSv2 필수, 홉 제한 2). `S3_ACCESS_KEY`가 없으면 SDK 기본 자격 증명을 쓰도록 `storage.service.ts`를 고쳤다
- `deploy/aws/` 스크립트(PC에서 실행)
  - 리소스 이름 앞부분은 `node-order`, 태그는 `Project=node-order`
  - DB 비밀번호·SSH 키·서버 `.env`는 `deploy/aws/.local/`(커밋하지 않음)에 만든다. `60-server-env.sh`는 비밀 값을 `(채워짐)`으로 가려서 보여 준다
- `.github/workflows/ci.yml`
  - 검사·테스트는 모든 브랜치에서 돈다
  - `images` 작업은 저장소 변수 `DEPLOY_BRANCH`와 이름이 같은 브랜치에서만 이미지 세 개(`order-api`, `order-api-migrate`, `order-web`)를 커밋 SHA 태그로 GHCR에 올린다. 다른 브랜치에서는 빌드만 한다
  - 웹 이미지의 `NEXT_PUBLIC_API_URL`은 `https://<API_HOST>`, `NEXT_PUBLIC_STORAGE_URL`은 저장소 변수 `STORAGE_URL`로 빌드한다
  - `deploy` 작업은 `DEPLOY_BRANCH`에서만, 다섯 작업이 모두 통과한 뒤 돈다. `concurrency: deploy-production`(`cancel-in-progress: false`), environment `production`
  - `deploy` 작업은 `compose.yml`, `Caddyfile`, `deploy.sh`를 서버로 복사하고 `GITHUB_TOKEN`을 표준 입력으로 넘겨 `deploy.sh <SHA>`를 실행한 뒤, 공개 주소의 `/health/ready`를 5초 간격으로 최대 12번 확인한다
- 서버의 `deploy/deploy.sh`
  - GHCR 로그인 → `.env`의 `IMAGE_TAG` 교체 → 이미지 받기 → 마이그레이션 → `order_app` 역할 비밀번호를 `DATABASE_URL`에 맞춤 → `docker compose up -d --wait`(120초)
  - 어느 단계든 실패하면 api·web 로그 30줄을 찍고 `IMAGE_TAG`를 이전 값으로 돌려 다시 띄운 뒤 실패로 끝낸다. 마이그레이션은 되돌리지 않는다
  - 끝나면 GHCR에서 로그아웃하고, 현재 태그가 아닌 이미지를 지운다
- `order.paid` 이벤트의 메일 job이 없는 `payload.id`를 읽던 것을 `orderIdOf()`로 고치고 단위 테스트(`outbox.relay.spec.ts`)를 더했다
- 시드는 배포 스크립트에 없다. 모든 표를 비우므로 손으로만 돌린다
- 서버가 한 대라 컨테이너를 바꾸는 동안 API가 응답하지 못하는 구간이 있다

## 구성

`17`에서 바뀐 곳만 적습니다.

```text
.
├── .github/workflows/ci.yml          # GHCR 올리기(DEPLOY_BRANCH만), deploy 작업
├── deploy/
│   ├── compose.yml                   # 운영 서버용: caddy, redis, migrate(tools), api, web
│   ├── Caddyfile                     # WEB_HOST → web:3000, API_HOST → api:4000
│   ├── deploy.sh                     # 서버에서 실행. 태그 교체, 실패하면 되돌림
│   ├── .env.example                  # 서버 .env 견본
│   ├── .gitignore                    # .env, rds-ca.pem
│   └── aws/
│       ├── lib.sh                    # 프로필·리전 기본값, NAME, 태그, 조회 함수
│       ├── 00-check.sh               # 읽기 명령으로 계정·요금 플랜·서비스별 사용 가능 여부 점검
│       ├── 10-budget.sh              # 월 예산 알림(인자: 메일 주소, 금액 기본 10)
│       ├── 20-network.sh             # 보안 그룹 node-order-web(80·443·22), node-order-db(서버에서 5432)
│       ├── 30-storage.sh             # S3 버킷(공개 차단), IAM 역할·인스턴스 프로필
│       ├── 40-database.sh            # RDS PostgreSQL, 소유자 비밀번호 생성
│       ├── 50-server.sh              # SSH 키 두 개(admin, ci), EC2, 탄력적 IP
│       ├── user-data.sh              # 첫 부팅: Docker, 스왑, 키 전용 SSH, RDS 인증서 묶음
│       ├── 60-server-env.sh          # .local/server.env를 만들어 서버 /opt/node-order/.env로 올림
│       ├── 61-stripe-webhook.sh      # 운영 주소로 Stripe 웹훅 엔드포인트 생성 후 60 실행
│       ├── 90-destroy.sh             # 만든 순서의 반대로 삭제(예산 알림은 남김)
│       ├── 99-leftovers.sh           # 태그와 종류별 개수로 남은 리소스 확인
│       └── .gitignore                # .local/
└── order-api-nest/src/
    ├── storage/storage.service.ts    # S3_ACCESS_KEY가 없으면 기본 자격 증명
    └── outbox/
        ├── outbox.relay.ts           # orderIdOf()
        └── outbox.relay.spec.ts
```

## 실행

로컬 개발 환경은 `16`과 같습니다. 아래는 AWS 배포 절차입니다.

### 준비

`aws login`을 지원하는 AWS CLI v2, GitHub CLI(`gh`), Python 3, OpenSSL이 필요하고, 운영용 GitHub OAuth 앱(콜백 `https://<WEB_HOST>/api/auth/callback/github`)과 Stripe 테스트 키(`sk_test_...`)를 씁니다. 스크립트는 `AWS_PROFILE`(기본 `node-order`)과 `AWS_REGION`(기본 `ap-southeast-2`)을 씁니다.

```sh
aws login --profile node-order --region ap-southeast-2
```

### AWS 리소스 만들기

`deploy/aws`에서 번호 순서대로 한 번씩 실행합니다. `20`~`50`은 리소스가 이미 있는지 확인하지 않습니다.

```sh
cd deploy/aws
./00-check.sh
./10-budget.sh <메일 주소> 10
./20-network.sh
./30-storage.sh
./40-database.sh   # RDS가 available이 될 때까지 기다림
./50-server.sh     # 끝에 IP, WEB_HOST, API_HOST, SSH 명령을 찍음
```

### 서버 `.env` 올리기

`61-stripe-webhook.sh`는 운영 주소(`https://api.<IP를 -로 이은 것>.sslip.io/payments/webhook`)로 Stripe 웹훅 엔드포인트를 만들고, 받은 서명 비밀과 환경 변수로 준 값을 넣어 `60-server-env.sh`를 실행합니다. `JWT_SECRET`, `AUTH_SECRET`, `DEMO_PASSWORD`, 앱 DB 비밀번호는 없을 때만 무작위로 만듭니다.

```sh
STRIPE_SECRET_KEY=<sk_test_...> \
GITHUB_CLIENT_ID=<운영 OAuth 앱 Client ID> \
GITHUB_CLIENT_SECRET=<운영 OAuth 앱 secret> \
./61-stripe-webhook.sh   # 마지막 줄: 600 ubuntu /opt/node-order/.env
```

이때 서버 호스트 키가 `.local/known_hosts`에 저장됩니다.

### 저장소 변수와 Secrets

```sh
R=<계정>/<저장소>
gh variable set DEPLOY_BRANCH -R $R -b 18-deploy
gh variable set DEPLOY_HOST   -R $R -b <서버 IP>
gh variable set WEB_HOST      -R $R -b shop.<IP를 -로 이은 것>.sslip.io
gh variable set API_HOST      -R $R -b api.<IP를 -로 이은 것>.sslip.io
gh variable set STORAGE_URL   -R $R -b https://s3.ap-southeast-2.amazonaws.com
gh secret set DEPLOY_SSH_KEY     -R $R < .local/ci_ed25519
gh secret set DEPLOY_KNOWN_HOSTS -R $R < .local/known_hosts
```

저장소 Settings → Environments → `production`의 배포 허용 브랜치를 `DEPLOY_BRANCH`와 같은 브랜치로 제한합니다.

### 배포

`DEPLOY_BRANCH` 브랜치에 푸시하면 검사·테스트·이미지 작업 뒤 `deploy` 작업이 돕니다.

```sh
git push
gh run watch
```

다른 브랜치가 배포하게 하려면 `DEPLOY_BRANCH`와 Environments의 허용 브랜치를 함께 바꿉니다. `deploy/aws/.local/`은 커밋되지 않으므로 새 브랜치의 작업 폴더로 직접 옮기고, 서버가 남아 있으면 `00`~`50`은 다시 실행하지 않습니다.

```sh
gh variable set DEPLOY_BRANCH -R $R -b <새 브랜치>
```

### 시드(처음 한 번, 또는 데모 초기화)

```sh
ssh -i .local/admin_ed25519 ubuntu@<서버 IP> 'cd /opt/node-order && docker compose run --rm migrate npx prisma db seed'
```

시드 사용자의 비밀번호는 서버 `.env`의 `DEMO_PASSWORD`입니다.

## 테스트

로컬 검사와 CI 작업은 `17`과 같고(`npm run lint`, `typecheck`, `test:api`, `test:web`, `test:rules`), `npm run test:api`에 `outbox.relay.spec.ts`가 더해졌습니다.

배포 결과는 다음으로 확인합니다(`deploy/aws`에서).

```sh
curl -fsS https://api.<IP를 -로 이은 것>.sslip.io/health/ready
gh run list --branch <DEPLOY_BRANCH>
gh run view <실행 id> --log-failed   # 배포 실패면 api·web 로그 30줄 포함

ssh -i .local/admin_ed25519 ubuntu@<서버 IP> 'cd /opt/node-order && docker compose ps'
ssh -i .local/admin_ed25519 ubuntu@<서버 IP> 'cd /opt/node-order && docker compose logs api --no-log-prefix --tail 100'
ssh -i .local/admin_ed25519 ubuntu@<서버 IP> 'grep ^IMAGE_TAG /opt/node-order/.env'   # 지금 떠 있는 커밋
```

브라우저에서는 `https://shop.<IP를 -로 이은 것>.sslip.io`에서 GitHub 로그인, 상품 이미지 올리기(S3), 테스트 카드 `4242 4242 4242 4242` 결제를 확인합니다.

## 정리

```sh
cd deploy/aws
./99-leftovers.sh                                    # 남은 리소스 확인
STRIPE_SECRET_KEY=<sk_test_...> ./90-destroy.sh      # 탄력적 IP, EC2, RDS(스냅숏 없이), 키 페어, S3, IAM, 보안 그룹, Stripe 웹훅 삭제
./99-leftovers.sh                                    # 지운 뒤 다시 확인
```

`90-destroy.sh`는 예산 알림을 남기고, 지우는 명령을 출력합니다. `STRIPE_SECRET_KEY` 없이 실행하면 Stripe 웹훅 엔드포인트는 남습니다.
