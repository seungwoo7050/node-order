import { describe, expect, it } from "vitest";
import { AddressesService } from "./addresses.service.js";

describe("AddressesService", () => {
  const service = new AddressesService();

  it("빈 검색어는 빈 목록을 반환한다", async () => {
    const res = await service.search("");
    expect(res.items).toEqual([]);
  });

  it("테헤란로 검색 시 테헤란로 관련 주소 목록을 반환한다", async () => {
    const res = await service.search("테헤란로");
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.some((item) => item.roadAddress.includes("테헤란로"))).toBe(true);
    expect(res.items[0]).toHaveProperty("postalCode");
    expect(res.items[0]).toHaveProperty("roadAddress");
    expect(res.items[0]).toHaveProperty("jibunAddress");
  });

  it("성수이로 검색 시 성수이로 관련 주소를 반환한다", async () => {
    const res = await service.search("성수이로");
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.some((item) => item.roadAddress.includes("성수이로"))).toBe(true);
  });

  it("판교역로 검색 시 판교 관련 주소를 반환한다", async () => {
    const res = await service.search("판교역로");
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.some((item) => item.roadAddress.includes("판교역로"))).toBe(true);
  });
});
