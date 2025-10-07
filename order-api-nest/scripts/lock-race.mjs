import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import pg from "pg";

process.loadEnvFile();
const MODE = process.argv[2];
const TTL_MS = 2000; // Redis 잠금의 유효 시간
const PLAN = { A: { delay: 0, hold: 2500 }, B: { delay: 50, hold: 1500 }, C: { delay: 2200, hold: 1500 } };
const KEY = "lock:cleanup";
const PG_KEY = 726003;

// 부모 프로세스: 일꾼 셋을 동시에 띄우고, 각자가 잠금을 쥐고 있던 구간이 겹쳤는지 센다
if (!process.env.WORKER) {
  if (MODE !== "pg") await new Redis(process.env.REDIS_URL).del(KEY).then(() => {});
  const t0 = Date.now();
  const spans = [];
  await Promise.all(["A", "B", "C"].map((name) => new Promise((resolve) => {
    const child = fork(process.argv[1], [MODE], { env: { ...process.env, WORKER: name, T0: String(t0) } });
    child.on("message", (m) => { if (m.span) spans.push({ name, ...m.span }); else console.log(m.log); });
    child.on("exit", resolve);
  })));
  const overlaps = [];
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
    const [a, b] = [spans[i], spans[j]];
    if (a.from < b.to && b.from < a.to) overlaps.push(`${a.name}·${b.name} (${Math.max(a.from, b.from)}~${Math.min(a.to, b.to)}ms)`);
  }
  console.log(`\n=> 동시에 작업한 구간: ${overlaps.length ? overlaps.join(", ") : "없음"}`);
  process.exit(0);
}

// 일꾼 프로세스
const name = process.env.WORKER;
const { delay, hold } = PLAN[name];
const t = () => Date.now() - Number(process.env.T0);
const log = (msg) => process.send({ log: `${String(t()).padStart(5)}ms  ${name}: ${msg}` });
const freeze = (ms) => { const end = Date.now() + ms; while (Date.now() < end); }; // 이벤트 루프를 통째로 막는다
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(delay);

if (MODE === "pg") {
  // advisory lock: 잠금을 건 "연결"이 살아 있는 동안 유지된다
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [PG_KEY]);
    if (rows[0].ok) {
      const from = t(); log(`잠금 획득 → 작업 시작(${hold}ms 멈춤)`);
      freeze(hold);
      const to = t(); await client.query("SELECT pg_advisory_unlock($1)", [PG_KEY]);
      log("작업 끝 → 잠금 해제"); process.send({ span: { from, to } });
      break;
    }
    await sleep(100);
  }
  await client.end();
} else {
  const redis = new Redis(process.env.REDIS_URL);
  const token = `${name}-${randomUUID()}`; // 내 잠금임을 알아볼 값
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await redis.set(KEY, token, "PX", TTL_MS, "NX")) {
      const from = t(); log(`잠금 획득(TTL ${TTL_MS}ms) → 작업 시작(${hold}ms 멈춤)`);
      freeze(hold);
      const to = t();
      if (MODE === "redis-naive") {
        const deleted = await redis.del(KEY); // 누구 잠금인지 확인하지 않고 지운다
        log(`작업 끝 → DEL ${deleted ? "(누군가의 잠금을 지웠다)" : "(이미 없었다)"}`);
      } else {
        // 값이 내 token일 때만 지운다. 확인과 삭제를 Lua 스크립트 하나로 묶어 Redis 안에서 한 번에 실행한다
        const deleted = await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, KEY, token,
        );
        log(`작업 끝 → 내 잠금일 때만 삭제: ${deleted ? "삭제함" : "내 것이 아니라 안 지움"}`);
      }
      process.send({ span: { from, to } });
      break;
    }
    await sleep(100);
  }
  await redis.quit();
}
process.exit(0);