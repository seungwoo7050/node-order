import { expect, test, type Page } from "@playwright/test";

// 상품 설명 초안: API가 SSE로 보내는 글이 설명 칸에 차례로 차오르고, 저장은 판매자가 누를 때만 된다.
// API는 키가 없으면 with-api.sh가 띄운 LLM 시뮬레이터(order-api-nest/scripts/llm-sim.mjs, 조각 5개를 250ms 간격)로 생성한다.
// 프롬프트(키워드)에 "sim:error"가 있으면 시뮬레이터가 조각 두 개 뒤에 오류를 보낸다
const API = "http://localhost:4000";
const CHUNKS = ["가볍게 손에 감기는 모양으로 ", "오래 써도 손목이 편합니다. ", "책상 위 어디에 두어도 ", "잘 어울리는 단정한 디자인이라 ", "매일 쓰는 물건으로 오래 곁에 둘 수 있습니다."];
const PRODUCT = 6;

test.use({ serviceWorkers: "block" });

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

const savedDescription = async (page: Page) =>
  ((await (await page.request.get(`${API}/products/${PRODUCT}`)).json()) as { description: string }).description;

test("LLM 키가 없으면(features.llm false) 초안 버튼이 보이지 않는다", async ({ page }) => {
  await page.route(`${API}/features`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ payments: [], integrations: { toss: false, stripe: false, errorTracking: false, llm: false } }) }));
  await loginAsKim(page);
  await page.goto(`/admin/products/${PRODUCT}`);
  await expect(page.getByLabel("설명")).toBeVisible();
  await expect(page.getByRole("button", { name: "저장" })).toBeVisible();
  await expect(page.getByRole("button", { name: "설명 초안 만들기" })).toHaveCount(0);
  await expect(page.getByLabel("초안 키워드(선택)")).toHaveCount(0);
});

test.describe("LLM이 켜져 있을 때", () => {
  test.beforeEach(async ({ request }) => {
    const features = (await (await request.get(`${API}/features`)).json()) as { integrations?: { llm: boolean } };
    test.skip(!features.integrations?.llm, "4000의 API에 LLM 공급자가 없다(with-api.sh가 띄운 API는 LLM 시뮬레이터를 쓴다)");
  });

  test("받은 글이 설명 칸에 차례로 차오르고, 저장을 누르기 전에는 상품이 바뀌지 않는다", async ({ page }) => {
    await loginAsKim(page);
    const before = await savedDescription(page);
    await page.goto(`/admin/products/${PRODUCT}`);
    const textarea = page.getByLabel("설명");
    await page.getByLabel("초안 키워드(선택)").fill("손목, 단정한");
    await page.getByRole("button", { name: "설명 초안 만들기" }).click();
    await expect(page.getByRole("status").filter({ hasText: "초안을 받는 중" })).toBeVisible();
    await expect(page.getByRole("button", { name: "저장" })).toBeDisabled();

    // 끝날 때까지 칸의 값을 지켜본다: 매번 앞의 값을 이어 쓰고, 중간 단계를 여럿 거친다
    const full = CHUNKS.join("");
    const seen: string[] = [];
    await expect.poll(async () => {
      const value = await textarea.inputValue();
      if (seen.at(-1) !== value) seen.push(value);
      return value;
    }, { intervals: [50], timeout: 10_000 }).toBe(full);
    const steps = seen.filter((v) => v.length > 0);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.startsWith(steps[i - 1]!)).toBe(true);
    expect(steps[0]!.length).toBeLessThan(full.length);

    await expect(page.getByRole("button", { name: "설명 초안 만들기" })).toBeVisible();
    await expect(page.getByRole("button", { name: "저장" })).toBeEnabled();
    await expect(page.getByTestId("draft-error")).toHaveCount(0);
    expect(await savedDescription(page)).toBe(before);
  });

  test("중간에 오류가 나면 받은 글은 남고 오류 문구가 보이며 저장되지 않는다", async ({ page }) => {
    await loginAsKim(page);
    const before = await savedDescription(page);
    await page.goto(`/admin/products/${PRODUCT}`);
    await page.getByLabel("초안 키워드(선택)").fill("sim:error");
    await page.getByRole("button", { name: "설명 초안 만들기" }).click();

    await expect(page.getByTestId("draft-error")).toContainText("멈췄습니다");
    await expect(page.getByLabel("설명")).toHaveValue(CHUNKS[0]! + CHUNKS[1]!);
    expect(await savedDescription(page)).toBe(before);
    await page.reload();
    await expect(page.getByLabel("설명")).toHaveValue(before);
  });
});
