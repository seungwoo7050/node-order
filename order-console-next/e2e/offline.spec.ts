import { test, expect, type Page } from "@playwright/test";

async function waitForController(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test("오프라인에서도 한 번 본 상품 목록이 보이고, 결제는 막힌다", async ({ page, context }) => {
  await page.goto("/shop");
  await waitForController(page);
  await expect(page.getByText("한정판 키보드")).toBeVisible();

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByText("한정판 키보드")).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toBeVisible();

    await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
    await expect(page.getByRole("button", { name: "결제" })).toBeDisabled();
  } finally {
    await context.setOffline(false);
  }
  await expect(page.getByTestId("offline-banner")).toBeHidden();
});

test("로그인이 필요한 응답은 캐시하지 않는다 - 오프라인에서 다른 사용자 토큰으로 받아 볼 수 없다", async ({ page, context }) => {
  await page.goto("/shop");
  await waitForController(page);

  await page.goto("/login");
  await page.getByPlaceholder("password").fill("1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await page.getByRole("link", { name: "내 주문" }).click();
  await expect(page.getByTestId("my-orders")).toBeVisible();

  const leeToken = await page.evaluate(async () => {
    const res = await fetch("http://localhost:4000/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "lee", password: "1234" }),
      credentials: "include",
    });
    return (await res.json()).accessToken as string;
  });

  await context.setOffline(true);
  try {
    const result = await page.evaluate(async (token) => {
      try {
        const res = await fetch("http://localhost:4000/me/orders", { headers: { Authorization: `Bearer ${token}` } });
        return `응답 ${res.status}`;
      } catch {
        return "요청 실패";
      }
    }, leeToken);
    expect(result).toBe("요청 실패");
  } finally {
    await context.setOffline(false);
  }
});
