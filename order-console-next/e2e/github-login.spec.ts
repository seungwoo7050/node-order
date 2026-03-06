import { expect, test } from "@playwright/test";

test("GitHub로 로그인을 누르면 PKCE를 붙여 GitHub 인가 화면으로 보낸다", async ({ page }) => {
  await page.route("https://github.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "stub" }));
  await page.goto("/login");
  const [request] = await Promise.all([
    page.waitForRequest((req) => req.url().startsWith("https://github.com/login/oauth/authorize")),
    page.getByRole("button", { name: "GitHub로 로그인" }).click(),
  ]);

  const params = new URL(request.url()).searchParams;
  expect(params.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/github");
  expect(params.get("response_type")).toBe("code");
  expect(params.get("code_challenge_method")).toBe("S256");
  expect(params.get("client_id")).toBeTruthy();

  const cookies = await page.context().cookies("http://localhost:3000");
  expect(cookies.find((c) => c.name === "authjs.pkce.code_verifier")?.httpOnly).toBe(true);
});

test("Auth.js 세션 없이 완료 화면을 열면 로그인 화면으로 돌려보낸다", async ({ page }) => {
  await page.goto("/auth/github/complete");
  await expect(page).toHaveURL(/\/login$/);
});

test("GitHub 콜백이 실패하면 로그인 화면에 실패 문구를 보인다", async ({ page }) => {
  // PKCE·state 쿠키 없이 콜백을 부르면 Auth.js가 실패로 보고 pages.error(/login?error=...)로 보낸다
  await page.goto("/api/auth/callback/github?code=bogus");
  await expect(page).toHaveURL(/\/login\?error=/);
  await expect(page.getByTestId("oauth-error")).toHaveText("GitHub 로그인을 마치지 못했습니다. 다시 시도해 주세요.");
});

test("error 쿼리가 없으면 실패 문구를 보이지 않는다", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "GitHub로 로그인" })).toBeVisible();
  await expect(page.getByTestId("oauth-error")).toHaveCount(0);
});
