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
