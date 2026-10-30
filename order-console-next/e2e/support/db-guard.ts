import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// 웹 e2e가 DB 행을 직접 지우기 전에 보는 가드. 운영·공유 DB 주소가 .env에 들어 있어도 지우지 않고 실패한다.
// 통과: 이 컴퓨터의 DB(localhost, 127.0.0.1, ::1)이고 이름이 개발·테스트용(order_api, order_api_test, …_dev, …_test)
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DISPOSABLE_DB = /^(order_api|order_api_test|[a-z0-9_]+_(dev|test))$/;

export class UnsafeDatabaseError extends Error {
  constructor(reason: string) {
    super(`e2e가 지울 DB가 개발·테스트용이 아니다(${reason}). 지우지 않고 멈춘다`);
    this.name = "UnsafeDatabaseError";
  }
}

// 지워도 되는 DB면 주소를 그대로 돌려주고, 아니면 던진다. 비밀번호는 오류 문구에 싣지 않는다
export function assertDisposableDatabase(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new UnsafeDatabaseError("주소를 읽을 수 없다");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new UnsafeDatabaseError(`postgres 주소가 아니다: ${url.protocol}`);
  if (!LOCAL_HOSTS.has(url.hostname)) throw new UnsafeDatabaseError(`호스트 ${url.hostname}`);
  // ?host=로 소켓·다른 호스트를 따로 줄 수 있다(pg가 따른다)
  const hostParam = url.searchParams.get("host");
  if (hostParam && !LOCAL_HOSTS.has(hostParam)) throw new UnsafeDatabaseError(`host 인자 ${hostParam}`);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!DISPOSABLE_DB.test(name)) throw new UnsafeDatabaseError(`DB 이름 ${name || "(없음)"}`);
  return connectionString;
}

// e2e가 행을 지울 관리자 DB 주소. 환경변수 ADMIN_DATABASE_URL을 먼저 보고(CI·셸에서 준 값), 없을 때만 API의 .env 파일을 읽는다.
// 둘 다 없으면 무엇이 없는지 알린다. playwright는 order-console-next에서 돈다(npm -w). e2e는 CommonJS로 읽혀 import.meta를 쓸 수 없다
export function adminDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
  apiEnvPath = path.join(process.cwd(), "..", "order-api-nest", ".env"),
): string {
  const fromEnv = env.ADMIN_DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(apiEnvPath)) throw new Error(`ADMIN_DATABASE_URL 환경변수도, ${apiEnvPath} 파일도 없다`);
  const url = readFileSync(apiEnvPath, "utf8").match(/^ADMIN_DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!url) throw new Error(`ADMIN_DATABASE_URL 환경변수가 없고, ${apiEnvPath}에도 없다`);
  return url;
}
