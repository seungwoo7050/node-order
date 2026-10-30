// 운영 Compose의 메모리 상한 합계가 서버 메모리 안에 드는지 본다(31 후속). monitoring/test.sh가 부른다:
//   docker compose --env-file deploy/rehearsal.env -f deploy/compose.yml --profile blue --profile green config --format json \
//     | node monitoring/check-memory-budget.mjs [서버 MB=2048] [OS·도커 몫 MB=256]
// 블루·그린 두 벌이 같이 뜨는 전환 순간을 센다(두 프로필을 모두 켠 설정). 손으로 도는 도구(tools 프로필, migrate)는 뺀다.
// 상한이 없는 상시 서비스가 있으면 실패한다
const [hostMb = 2048, reserveMb = 256] = process.argv.slice(2).map(Number);
const config = JSON.parse(await new Promise((resolve) => {
  let s = "";
  process.stdin.on("data", (c) => (s += c)).on("end", () => resolve(s));
}));

let total = 0;
let fail = false;
for (const [name, svc] of Object.entries(config.services)) {
  if (svc.profiles?.includes("tools")) continue;
  const bytes = Number(svc.mem_limit ?? svc.deploy?.resources?.limits?.memory ?? 0);
  if (!bytes) {
    console.log(`FAIL ${name}: 메모리 상한(mem_limit)이 없다`);
    fail = true;
    continue;
  }
  const mb = bytes / 1024 / 1024;
  total += mb;
  console.log(`     ${name.padEnd(14)} ${mb}MB`);
}
const budget = hostMb - reserveMb;
if (total > budget) {
  console.log(`FAIL 합계 ${total}MB > ${budget}MB(서버 ${hostMb}MB − OS·도커 ${reserveMb}MB)`);
  fail = true;
} else {
  console.log(`ok   합계 ${total}MB ≤ ${budget}MB(서버 ${hostMb}MB − OS·도커 ${reserveMb}MB, 블루·그린 두 벌 포함)`);
}
process.exit(fail ? 1 : 0);
