# 20: 운영

![Language](https://img.shields.io/badge/language-Bash-blue?logo=gnubash&logoColor=white)
![Stack](https://img.shields.io/badge/stack-systemd%20%7C%20Docker%20Compose%20%7C%20AWS%20(RDS%20%7C%20S3%20%7C%20CloudWatch)%20%7C%20GitHub%20Actions-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [19-design](https://github.com/seungwoo7050/node-order/tree/19-design) 브랜치의 전체 워크스페이스(`order-api-nest`, `order-console-next`, `monitoring`, `deploy`, `compose.yaml`, `.github/workflows/ci.yml`)

`18`에서 배포한 서비스는 매일 돌아가지만, 백업도 정해진 작업도 없었습니다.

이 단계에서는 운영 서버에 매일 도는 백업과 데모 초기화를 붙이고, 백업이 실제로 복원되는지 확인합니다. 로그 크기를 제한하고, 장애를 일부러 내서 무엇이 저절로 돌아오는지 봅니다. 서버는 지우지 않고 다음 단계에서도 씁니다.

과정 전체(막힌 곳, 개념, 에러 신호)는 [guide/README.md](guide/README.md)에 있습니다. 이 문서는 무엇이 있고 어떻게 돌리는지만 적습니다.

## 지원 범위

- systemd 타이머(한국 시간)

  - 03:30 백업: `pg_dump`(custom 형식)를 서버 디스크를 거치지 않고 S3 `backups/`에 올림. 끝까지 성공한 덤프만 `backups-partial/`에서 옮김

  - 04:00 데모 초기화: 그날 백업이 성공했을 때만 시드를 다시 돌림(`.last-backup-ok`). `DEMO_LOGIN`이 1이 아니면 아무것도 하지 않음

- 복원 확인: 최신 백업을 같은 RDS의 임시 DB에 복원해 운영과 행 수를 대조하고 지움. 운영 DB는 읽기만 함

- 보관

  - S3 수명 주기: `backups/` 7일, `backups-partial/` 1일 뒤 삭제

  - RDS 자동 백업 1일(`40-database.sh`와 지금 인스턴스)

- 운영 스크립트는 `psql`·`pg_dump`·AWS CLI를 설치하지 않고 이미지로 실행. AWS 키 없이 EC2의 IAM 역할을 씀

- 컨테이너 로그: `json-file`, 파일 10MB × 3개

- 워크플로

  - `.md`만 바뀐 푸시는 돌지 않음(`paths-ignore`)

  - 배포 때 `deploy/ops/`도 서버로 올림(`scp -rp`, 실행 권한 유지)

  - 배포가 성공하면 GHCR 패키지마다 최근 10개 버전만 남김. 빌드 증명을 꺼서(`provenance: false`) push 한 번이 버전 하나

- 백업 실패 알림, 로그의 서버 밖 전송, 운영 서버의 경보는 다루지 않습니다(가이드의 도전 과제).

## 구성

```text
.
├── .github/workflows/ci.yml          # paths-ignore, ops/ 올리기, provenance: false, prune-images 작업
├── deploy/
│   ├── compose.yml                   # x-logging(10m × 3)을 모든 서비스에
│   ├── Caddyfile
│   ├── deploy.sh
│   ├── .env.example
│   ├── aws/
│   │   ├── 00-check.sh ~ 61-stripe-webhook.sh
│   │   ├── 40-database.sh            # --backup-retention-period 1
│   │   ├── 70-backups.sh             # S3 수명 주기 규칙(내 PC에서 실행)
│   │   ├── 90-destroy.sh, 99-leftovers.sh
│   │   ├── lib.sh
│   │   └── user-data.sh              # jq 설치
│   └── ops/                          # 서버의 /opt/node-order/ops로 올라감
│       ├── lib.sh                    # 공통: .env 읽기, pg(), aws_(), log()
│       ├── backup.sh                 # pg_dump → S3
│       ├── reset-demo.sh             # 시드 다시 돌리기
│       ├── restore-check.sh          # 임시 DB에 복원해 대조
│       ├── install-timers.sh         # 단위 파일 설치와 타이머 켜기(sudo)
│       └── systemd/                  # node-order-backup·node-order-reset-demo의 .service·.timer
├── monitoring/
├── order-api-nest/
├── order-console-next/
├── scripts/
├── compose.yaml
├── package.json
└── README.md
```

## 실행

### 준비

- `18`의 운영 서버와 `deploy/aws/.local/`(커밋되지 않으므로 앞 단계의 폴더에서 옮겨 옴)

- 저장소 변수 `DEPLOY_BRANCH`와 `production` 환경의 허용 브랜치를 `20-operations`로

- GHCR 패키지 세 개(`order-api`, `order-api-migrate`, `order-web`)의 Package settings → Manage Actions access에 이 저장소를 Admin으로

아래 `ssh`는 저장소 루트에서 칩니다.

```sh
SSH="ssh -i deploy/aws/.local/admin_ed25519 -o UserKnownHostsFile=deploy/aws/.local/known_hosts ubuntu@<서버 IP>"
```

### 내 PC에서 한 번

```sh
export AWS_PROFILE=node-order AWS_REGION=ap-southeast-2
deploy/aws/70-backups.sh
aws rds modify-db-instance --db-instance-identifier node-order-db --backup-retention-period 1 --apply-immediately
```

자동 백업을 0에서 켜면 DB가 잠깐(약 20초) 재시작됩니다.

### 배포 뒤 서버에서 한 번

```sh
git push
$SSH 'sudo /opt/node-order/ops/install-timers.sh'
```

## 결과 보기

```sh
$SSH 'systemctl list-timers "node-order-*" --no-pager'
$SSH 'sudo systemctl start node-order-backup; journalctl -u node-order-backup -n 4 -o cat'
$SSH '/opt/node-order/ops/restore-check.sh'
$SSH "docker inspect -f '{{json .HostConfig.LogConfig.Config}}' node-order-api-1"   # {"max-file":"3","max-size":"10m"}
aws rds describe-db-snapshots --db-instance-identifier node-order-db --snapshot-type automated \
  --query 'DBSnapshots[].[DBSnapshotIdentifier,Status]' --output text
```
