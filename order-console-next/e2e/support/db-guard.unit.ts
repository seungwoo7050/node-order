import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { UnsafeDatabaseError, adminDatabaseUrl, assertDisposableDatabase } from "./db-guard";

// 웹 e2e가 행을 직접 지우기 전의 가드(e2e/admin-settings.spec.ts). vitest가 돌린다(playwright는 *.spec.ts만 본다)
describe("e2e DB 가드", () => {
  it.each([
    "postgresql://order:order@localhost:5433/order_api",
    "postgresql://order:order@127.0.0.1:5433/order_api_test",
    "postgres://u:p@[::1]:5432/shop_dev",
    "postgresql://u:p@localhost/shop_test?sslmode=disable",
  ])("통과: %s", (url) => {
    expect(assertDisposableDatabase(url)).toBe(url);
  });

  it.each([
    ["postgresql://order:secret@db.example.com:5432/order_api", /호스트 db\.example\.com/],
    ["postgresql://order:secret@10.0.0.5:5432/order_api", /호스트 10\.0\.0\.5/],
    ["postgresql://order:secret@localhost:5432/order_prod", /DB 이름 order_prod/],
    ["postgresql://order:secret@localhost:5432/postgres", /DB 이름 postgres/],
    ["postgresql://order:secret@localhost:5432/", /DB 이름 \(없음\)/],
    ["postgresql://order:secret@localhost:5432/order_api?host=prod-db.internal", /host 인자/],
    ["mysql://order:secret@localhost/order_api", /postgres 주소가 아니다/],
    ["not a url", /읽을 수 없다/],
  ])("막음: %s", (url, reason) => {
    expect(() => assertDisposableDatabase(url)).toThrow(UnsafeDatabaseError);
    expect(() => assertDisposableDatabase(url)).toThrow(reason);
    expect(() => assertDisposableDatabase(url)).not.toThrow(/secret/); // 비밀번호를 오류 문구에 싣지 않는다
  });
});

describe("e2e 관리자 DB 주소", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "db-guard-"));
  const envFile = path.join(dir, ".env");
  const missing = path.join(dir, "missing.env");
  writeFileSync(envFile, "PORT=4000\nADMIN_DATABASE_URL=postgresql://file@localhost/order_api\n");

  it("환경변수가 있으면 .env 파일보다 먼저 쓰고, 파일이 없어도 된다", () => {
    const env = { ADMIN_DATABASE_URL: "postgresql://env@localhost/order_api_test" };
    expect(adminDatabaseUrl(env, envFile)).toBe(env.ADMIN_DATABASE_URL);
    expect(adminDatabaseUrl(env, missing)).toBe(env.ADMIN_DATABASE_URL);
  });

  it("환경변수가 없으면 API의 .env 파일에서 읽는다", () => {
    expect(adminDatabaseUrl({}, envFile)).toBe("postgresql://file@localhost/order_api");
  });

  it("둘 다 없으면 무엇이 없는지 알리는 오류", () => {
    expect(() => adminDatabaseUrl({}, missing)).toThrow(/ADMIN_DATABASE_URL 환경변수도, .*missing\.env 파일도 없다/);
    const empty = path.join(dir, "empty.env");
    writeFileSync(empty, "PORT=4000\n");
    expect(() => adminDatabaseUrl({}, empty)).toThrow(/ADMIN_DATABASE_URL 환경변수가 없고, .*empty\.env에도 없다/);
  });
});
