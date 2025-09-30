import pg from "pg";

process.loadEnvFile();
const API = "http://localhost:4000";
const N = Number(process.argv[2] ?? 10);

// 준비 운동: 없는 토큰으로 N번 동시에 refresh해서 서버의 DB 연결 N개를 미리 열어 둔다(아래 "실험" 참고)
await Promise.all(
  Array.from({ length: N }, () => fetch(`${API}/auth/refresh`, { method: "POST", headers: { Cookie: "refresh_token=warmup" } })),
);

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "kim", password: process.env.DEMO_PASSWORD }),
});
const cookie = login.headers.getSetCookie()[0].split(";")[0];

const statuses = await Promise.all(
  Array.from({ length: N }, () =>
    fetch(`${API}/auth/refresh`, { method: "POST", headers: { Cookie: cookie } }).then((r) => r.status),
  ),
);
const tally = statuses.reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
console.log("응답 코드별 개수:", tally);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query(`
  SELECT count(*)::int AS "발급된 토큰", count(*) FILTER (WHERE revoked_at IS NULL)::int AS "아직 유효한 토큰"
  FROM refresh_tokens WHERE user_id = 'kim'`);
console.table(rows);
await db.end();