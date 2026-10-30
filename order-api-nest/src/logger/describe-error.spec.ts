import { Prisma } from "../generated/prisma/client.js";
import { describeError } from "./describe-error.js";

describe("describeError", () => {
  it("Prisma 오류의 code·meta·cause를 붙인다(message가 비어도 원인이 보인다)", () => {
    const cause = Object.assign(new Error("relation \"product_search\" does not exist"), { name: "DriverAdapterError", code: "42P01" });
    const err = new Prisma.PrismaClientKnownRequestError("", { code: "P2010", clientVersion: "7", meta: { table: "product_search" } });
    (err as { cause?: unknown }).cause = cause;
    const line = describeError(err);
    expect(line).toContain("PrismaClientKnownRequestError: (메시지 없음)");
    expect(line).toContain("code=P2010");
    expect(line).toContain('meta={"table":"product_search"}');
    expect(line).toContain('cause=[DriverAdapterError: relation "product_search" does not exist code=42P01]');
  });

  it("Error가 아닌 값도 내용을 보인다", () => {
    expect(describeError({ reason: "timeout" })).toBe("{ reason: 'timeout' }");
    expect(describeError(new Error("boom"))).toBe("Error: boom");
  });
});
