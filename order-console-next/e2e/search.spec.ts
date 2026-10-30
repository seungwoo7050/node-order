import { expect, test } from "@playwright/test";

const API = "http://localhost:4000";

test.use({ serviceWorkers: "block" });

// 시드 상품은 마이그레이션·시드 뒤 리더의 색인 작업(2초 간격)이 반영한다. 첫 회차를 기다린다
test.beforeEach(async ({ request }) => {
  await expect
    .poll(async () => ((await (await request.get(`${API}/products/suggest?q=${encodeURIComponent("헤드폰")}`)).json()) as { items: unknown[] }).items.length, { timeout: 15_000 })
    .toBeGreaterThan(0);
});

test("검색 상자에 입력하면 자동완성이 뜨고, 화살표와 Enter로 상품을 고른다", async ({ page }) => {
  await page.goto("/shop");
  const box = page.getByRole("combobox", { name: "상품 검색" });
  await box.fill("헤드폰");
  const list = page.getByRole("listbox", { name: "추천 상품" });
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(box).toHaveAttribute("aria-expanded", "true");

  await box.press("ArrowDown");
  await box.press("ArrowDown");
  const active = list.getByRole("option", { selected: true });
  await expect(active).toHaveCount(1);
  await expect(box).toHaveAttribute("aria-activedescendant", (await active.getAttribute("id"))!);
  const name = (await active.textContent())!;

  await box.press("Enter");
  await expect(page).toHaveURL(/\/shop\/\d+$/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
});

test("Esc는 추천을 닫고, 추천을 고르지 않고 Enter만 누르면 결과 페이지로 간다", async ({ page }) => {
  await page.goto("/shop");
  const box = page.getByRole("combobox", { name: "상품 검색" });
  await box.fill("헤드폰");
  await expect(page.getByRole("listbox", { name: "추천 상품" }).getByRole("option")).toHaveCount(2);
  await box.press("Escape");
  await expect(box).toHaveAttribute("aria-expanded", "false");

  await box.press("Enter");
  await expect(page).toHaveURL(/\/shop\/search\?q=%ED%97%A4%EB%93%9C%ED%8F%B0$/);
  await expect(page.getByRole("heading", { name: "‘헤드폰’ 검색 결과" })).toBeVisible();
  const results = page.getByRole("list", { name: "검색 결과" });
  await expect(results.getByRole("link", { name: "무선 헤드폰" })).toBeVisible();
  await expect(results.getByRole("link", { name: "유선 헤드폰" })).toBeVisible();

  await page.reload(); // 주소의 q가 원본이다
  await expect(page.getByRole("combobox", { name: "상품 검색" })).toHaveValue("헤드폰");
  await expect(results.getByRole("link", { name: "무선 헤드폰" })).toBeVisible();
});

test("결과가 없으면 안내와 인기 검색어 칩이 보이고, 칩을 누르면 그 검색어로 찾는다", async ({ page, request }) => {
  // 인기 검색어는 서로 다른 IP 3곳 이상이 찾은 것만 공개된다. API는 루프백 프록시를 믿는다(with-api.sh의 TRUST_PROXY)
  for (const ip of ["192.0.2.31", "192.0.2.32", "192.0.2.33"]) {
    const res = await request.get(`${API}/products/search?q=${encodeURIComponent("헤드폰")}`, { headers: { "X-Forwarded-For": ip } });
    expect(res.ok()).toBe(true);
  }

  await page.goto(`/shop/search?q=${encodeURIComponent("없는상품zz")}`);
  await expect(page.getByText("‘없는상품zz’에 맞는 상품이 없습니다.", { exact: false })).toBeVisible();
  const chips = page.getByRole("navigation", { name: "인기 검색어" });
  const chip = chips.getByRole("link", { name: "헤드폰", exact: true });
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(page).toHaveURL(/\/shop\/search\?q=%ED%97%A4%EB%93%9C%ED%8F%B0$/);
  await expect(page.getByRole("combobox", { name: "상품 검색" })).toHaveValue("헤드폰");
  await expect(page.getByRole("list", { name: "검색 결과" }).getByRole("link", { name: "무선 헤드폰" })).toBeVisible();
});
