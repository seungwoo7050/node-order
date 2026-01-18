# 20: 운영

![Language](https://img.shields.io/badge/language-Bash-blue?logo=gnubash&logoColor=white)
![Stack](https://img.shields.io/badge/stack-systemd%20%7C%20Docker%20Compose%20%7C%20AWS%20(RDS%20%7C%20S3%20%7C%20CloudWatch)%20%7C%20GitHub%20Actions-lightgrey)

이 프로젝트는 아래 브랜치의 소스코드로부터 시작합니다.

- node-order 저장소의 [19-design](https://github.com/seungwoo7050/node-order/tree/19-design) 브랜치

운영 서버에 매일 도는 DB 백업(S3)과 데모 데이터 초기화를 systemd 타이머로 붙이고, 최신 백업을 임시 DB에 복원해 대조하는 스크립트를 더합니다. 컨테이너 로그 크기를 제한하고, 워크플로에 `.md`만 바뀐 푸시 건너뛰기와 오래된 GHCR 이미지 정리를 더합니다. 앱 코드(`order-api-nest`, `order-console-next`)는 `19`와 같습니다.

## 지원 범위

- systemd 타이머(`deploy/ops/systemd/`, 한국 시간, `Persistent=true`)
  - 03:30 백업(`backup.sh`): `pg_dump --format=custom` 출력을 서버 디스크에 쓰지 않고 S3 `backups-partial/`에 올린 뒤, 끝까지 성공하면 `backups/`로 옮김. 실패하면 `backups-partial/`의 조각을 지움. 성공한 날짜를 `.last-backup-ok`에 남김
  - 04:00 데모 초기화(`reset-demo.sh`): 서버 `.env`의 `DEMO_LOGIN`이 `1`이고 그날 백업이 성공했을 때만 시드를 다시 돌림. 백업이 없으면 실패로 끝나고, `FORCE=1`이면 백업 확인을 건너뜀
- 복원 확인(`restore-check.sh`): `backups/`의 최신 덤프를 같은 RDS의 임시 DB `order_api_restore_check`에 복원하고, `users`·`products`·`orders`·`order_items` 행 수를 운영 DB와 나란히 찍은 뒤 임시 DB를 지움. 표가 빠졌거나 `users`·`products`가 0이면 실패
- 운영 스크립트는 `psql`·`pg_dump`(`postgres:17`)와 AWS CLI(`amazon/aws-cli`)를 서버에 설치하지 않고 컨테이너로 실행하고, AWS 키 없이 EC2의 IAM 역할을 씀
- 보관
  - S3 수명 주기(`deploy/aws/70-backups.sh`): `backups/` 7일, `backups-partial/` 1일 뒤 삭제
  - RDS 자동 백업 보관 1일(`40-database.sh`의 `--backup-retention-period 1`)
- 컨테이너 로그: 운영 Compose의 모든 서비스에 `json-file`, 파일 10MB × 3개
- 워크플로(`.github/workflows/ci.yml`)
  - `.md`만 바뀐 푸시는 돌지 않음(`paths-ignore: ["**/*.md"]`)
  - 배포 때 `deploy/ops/`도 서버 `/opt/node-order/`로 올림(`scp -rp`, 실행 권한 유지)
  - 배포가 성공하면 `prune-images` 작업이 GHCR 패키지 세 개마다 최근 10개 버전만 남김. 이미지 빌드에 `provenance: false`를 주어 push 한 번이 버전 하나
- 백업 실패 알림, 로그의 서버 밖 전송, 운영 서버의 경보는 없습니다.

## 구성

`19`에서 바뀐 곳만 적습니다.

```text
.
├── .github/workflows/ci.yml          # paths-ignore, ops/ 올리기, provenance: false, prune-images 작업
└── deploy/
    ├── compose.yml                   # x-logging(10m × 3)을 모든 서비스에
    ├── aws/
    │   ├── 40-database.sh            # --backup-retention-period 1
    │   ├── 70-backups.sh             # 새 파일: S3 수명 주기 규칙(내 PC에서 실행)
    │   └── user-data.sh              # jq 설치
    └── ops/                          # 새 폴더. 서버의 /opt/node-order/ops로 올라감
        ├── lib.sh                    # 공통: .env 읽기, pg(), aws_(), log()
        ├── backup.sh                 # pg_dump → S3
        ├── reset-demo.sh             # 시드 다시 돌리기
        ├── restore-check.sh          # 임시 DB에 복원해 대조
        ├── install-timers.sh         # 단위 파일 설치와 타이머 켜기(sudo)
        └── systemd/                  # node-order-backup·node-order-reset-demo의 .service·.timer
```

## 실행

로컬 개발 환경은 `19`와 같습니다. 아래는 `18`에서 만든 운영 서버에 붙이는 절차입니다.

### 준비

- `deploy/aws/.local/`(커밋되지 않으므로 앞 브랜치의 폴더에서 옮겨 옴)
- 저장소 변수 `DEPLOY_BRANCH`와 `production` 환경의 허용 브랜치를 `20-operations`로
- `prune-images`가 패키지를 지울 수 있게, GHCR 패키지 세 개(`order-api`, `order-api-migrate`, `order-web`)의 Package settings → Manage Actions access에 이 저장소를 Admin으로

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

`18`에서 만든 RDS는 자동 백업이 0이므로 위 명령으로 1일로 바꿉니다. 새로 만드는 RDS는 `40-database.sh`가 처음부터 1일로 만듭니다.

### 배포 뒤 서버에서 한 번

```sh
git push                                           # 배포 작업이 deploy/ops/를 서버로 올림
$SSH 'sudo /opt/node-order/ops/install-timers.sh'  # 끝에 두 타이머의 다음 실행 시각을 찍음
```

### 확인

```sh
$SSH 'systemctl list-timers "node-order-*" --no-pager'
$SSH 'sudo systemctl start node-order-backup; journalctl -u node-order-backup -n 4 -o cat'   # 지금 한 번 백업
$SSH '/opt/node-order/ops/restore-check.sh'                                                 # 운영·복원 행 수 표
$SSH "docker inspect -f '{{json .HostConfig.LogConfig.Config}}' node-order-api-1"           # {"max-file":"3","max-size":"10m"}
aws rds describe-db-snapshots --db-instance-identifier node-order-db --snapshot-type automated \
  --query 'DBSnapshots[].[DBSnapshotIdentifier,Status]' --output text
```

## 테스트

로컬 테스트(`npm run lint`, `typecheck`, `test:api`, `test:web`, `test:rules`)와 CI의 검사·테스트 작업은 `19`와 같습니다. CI에는 배포 뒤 `prune-images` 작업이 더해졌습니다.

운영 스크립트에는 자동 테스트가 없고, 위 "확인"의 `restore-check.sh`가 백업이 복원되는지를 봅니다.

## 정리

AWS 리소스 정리는 `18`과 같습니다(`deploy/aws/90-destroy.sh`, `99-leftovers.sh`). S3 버킷을 지우면 `backups/`의 덤프도 함께 지워집니다.
