import { expect, test, type Page } from "@playwright/test";

// 토스 키가 없으면 API가 토스 시뮬레이터(order-api-nest/scripts/toss-sim.mjs)를 쓰고, 위젯 SDK도 시뮬레이터의 가짜 SDK다.
// 실제 키가 있으면 진짜 결제위젯이라 자동으로 돌 수 없어 건너뛴다
const API = "http://localhost:4000";

test.use({ serviceWorkers: "block" });

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

async function startTossCheckout(page: Page) {
  await loginAsKim(page);
  await page
    .getByRole("listitem")
    .filter({ hasText: "마우스" })
    .getByRole("button", { name: "담기" })
    .click();
  await page.getByTestId("cart-count").click();
  await page.getByRole("radio", { name: "토스페이먼츠" }).check();
  await Promise.all([
    page.waitForURL(/\/checkout\/toss\/\d+$/),
    page.getByRole("button", { name: "결제하기" }).click(),
  ]);
  await expect(page.getByTestId("toss-sim-methods")).toBeVisible();
  await expect(page.getByTestId("toss-sim-agreement")).toBeVisible();
}

test.describe("토스 결제(시뮬레이터)", () => {
  test.beforeEach(async ({ request }) => {
    const features = await (await request.get(`${API}/features`)).json();
    test.skip(
      features.toss?.clientKey !== "test_ck_simulator",
      "토스 시뮬레이터로 띄운 API에서만 돈다",
    );
  });

  test("토스로 주문 → 위젯 결제 → 승인되면 결제 완료로 보인다(CSP 위반 없음)", async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (/Content Security Policy/i.test(msg.text()))
        violations.push(msg.text());
    });

    await startTossCheckout(page);
    const orderId = page.url().match(/\/checkout\/toss\/(\d+)$/)![1];
    await expect(page.getByTestId("toss-checkout")).toContainText("30,000원");

    await Promise.all([
      page.waitForURL(/localhost:\d+\/widget\/pay\?/),
      page.getByRole("button", { name: "30,000원 결제하기" }).click(),
    ]);
    await Promise.all([
      page.waitForURL(new RegExp(`/me/orders/${orderId}\\?checkout=success$`)),
      page.getByRole("button", { name: "결제 승인" }).click(),
    ]);
    await expect(page.getByTestId("order-status")).toHaveText("결제 완료");
    await expect(page.getByTestId("order-detail")).toContainText("마우스");
    expect(violations).toEqual([]);
  });

  test("결제창에서 취소하면 실패 화면이 보이고 주문은 결제 대기로 남는다", async ({
    page,
  }) => {
    await startTossCheckout(page);
    const orderId = page.url().match(/\/checkout\/toss\/(\d+)$/)![1];
    await Promise.all([
      page.waitForURL(/\/widget\/pay\?/),
      page.getByRole("button", { name: /결제하기$/ }).click(),
    ]);
    await Promise.all([
      page.waitForURL(/\/checkout\/toss\/fail\?/),
      page.getByRole("button", { name: "결제 취소" }).click(),
    ]);
    await expect(page.getByText(/결제가 끝나지 않았습니다/)).toContainText("PAY_PROCESS_CANCELED");
    await page.getByRole("link", { name: `#${orderId}` }).click();
    await expect(page.getByTestId("toss-checkout")).toBeVisible(); // 같은 주문으로 다시 결제할 수 있다
    await page.goto(`/me/orders/${orderId}`);
    await expect(page.getByTestId("order-status")).toHaveText("결제 대기");
  });
});

test("콘솔 CSP가 토스 SDK·결제창 도메인만 더 허용한다", async ({ page }) => {
  const res = await page.goto("/shop");
  const csp = res!.headers()["content-security-policy"];
  const directive = (name: string) =>
    csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `)) ?? "";
  expect(directive("script-src")).toMatch(
    /'strict-dynamic' https:\/\/js\.tosspayments\.com/,
  );
  expect(directive("frame-src")).toBe("frame-src https://*.tosspayments.com");
  expect(directive("connect-src")).toContain("https://*.tosspayments.com");
  expect(directive("default-src")).toBe("default-src 'self'");
  expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
  expect(directive("object-src")).toBe("object-src 'none'");
});
