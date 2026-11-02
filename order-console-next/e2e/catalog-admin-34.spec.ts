import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

test.describe("34-catalog-admin e2e", () => {
  test("스토어프론트와 관리자 레이아웃 분리 및 플로팅 배지 동작", async ({ page }) => {
    // 1. 비로그인 상태에서는 관리자 배지나 관리 메뉴가 보이지 않음
    await page.goto("/shop");
    await expect(page.getByTestId("admin-floating-badge")).toHaveCount(0);

    // 2. 관리자로 로그인하면 플로팅 배지가 보이고 클릭 시 워크스페이스로 이동
    await loginAsKim(page);

    const badge = page.getByTestId("admin-floating-badge");
    await expect(badge).toBeVisible();
    await expect(badge.getByRole("link", { name: "대시보드" })).toBeVisible();
    await expect(badge.getByRole("link", { name: "관리" })).toBeVisible();
    await expect(badge.getByRole("link", { name: "주문 처리" })).toBeVisible();

    // 플로팅 배지에서 관리(상품 관리)로 이동
    await badge.getByRole("link", { name: "관리" }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);

    // 3. 관리자 사이드바 확인
    const sidebar = page.getByTestId("admin-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "대시보드" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "상품 관리" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "카테고리 관리" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "회원 관리" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "시스템·API 금고" })).toBeVisible();
  });

  test("카탈로그 카테고리 트리 및 상점 필터 바 확인", async ({ page }) => {
    await page.goto("/shop");
    // 상점 상단에 카테고리 필터 바 존재
    const filterBar = page.getByTestId("category-filter-bar");
    await expect(filterBar).toBeVisible();
    await expect(filterBar.getByRole("button", { name: "전체" })).toBeVisible();

    // 관리자 로그인 후 카테고리 관리 화면 접근
    await loginAsKim(page);

    await page.goto("/admin/categories");
    await expect(page.getByRole("heading", { name: "카테고리 관리" })).toBeVisible();
    await expect(page.getByTestId("category-tree")).toBeVisible();
  });

  test("시스템 제어 및 API 금고 화면 확인", async ({ page }) => {
    await loginAsKim(page);

    await page.goto("/admin/system");
    await expect(page.getByRole("heading", { name: "시스템·API 금고" })).toBeVisible();
    await expect(page.getByTestId("control-pause-paid-apis")).toBeVisible();
    await expect(page.getByTestId("control-maintenance-mode")).toBeVisible();

    // /admin/integrations 경로도 동일하게 동작 (별칭 라우트)
    await page.goto("/admin/integrations");
    await expect(page.getByRole("heading", { name: "시스템·API 금고" })).toBeVisible();
  });

  test("회원 및 고객 관리 화면 접근 확인", async ({ page }) => {
    await loginAsKim(page);

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "회원 및 고객 관리" })).toBeVisible();
    await expect(page.getByTestId("user-search-input")).toBeVisible();

    // /admin/members 경로도 동일하게 동작
    await page.goto("/admin/members");
    await expect(page.getByRole("heading", { name: "회원 및 고객 관리" })).toBeVisible();
  });

  test("새 상품 등록 화면 및 옵션 빌더 폼 확인", async ({ page }) => {
    await loginAsKim(page);

    await page.goto("/admin/products");
    await expect(page.getByTestId("new-product-link")).toBeVisible();
    await page.getByTestId("new-product-link").click();

    await expect(page).toHaveURL(/\/admin\/products\/new$/);
    await expect(page.getByLabel("상품명")).toBeVisible();
    await expect(page.getByLabel("기본 가격(원)")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 옵션 추가" })).toBeVisible();
  });
});
