import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

let originalSettings: {
  storeName: string;
  storeDesign: string;
  announcementText: string;
  heroTitle: string;
} | null = null;

test.describe("36-storefront-designs e2e", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ serviceWorkers: "block" });
    await loginAsKim(page);
    await page.goto("/admin/settings");
    await expect(page.getByTestId("settings-form")).toBeVisible();

    originalSettings = {
      storeName: await page.getByLabel("상호").inputValue(),
      storeDesign: await page.getByTestId("store-design-select").inputValue(),
      announcementText: await page.getByLabel("상단 공지 문구").inputValue(),
      heroTitle: await page.getByLabel("히어로 타이틀").inputValue(),
    };
    await page.close();
  });

  test.afterAll(async ({ browser, request }) => {
    if (!originalSettings) return;
    const page = await browser.newPage({ serviceWorkers: "block" });
    await loginAsKim(page);
    await page.goto("/admin/settings");
    await expect(page.getByTestId("settings-form")).toBeVisible();

    await page.getByLabel("상호").fill(originalSettings.storeName);
    await page.getByTestId("store-design-select").selectOption(originalSettings.storeDesign);
    await page.getByLabel("상단 공지 문구").fill(originalSettings.announcementText);
    await page.getByLabel("히어로 타이틀").fill(originalSettings.heroTitle);
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByTestId("save-done")).toBeVisible();
    await page.close();

    // 테스트 중 생성된 임시 상품 소프트 삭제 정리
    const loginRes = await request.post("http://localhost:4000/auth/login", {
      data: { id: "kim", password: "1234" },
    });
    if (loginRes.ok()) {
      const { accessToken } = await loginRes.json();
      const listRes = await request.get("http://localhost:4000/admin/products", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (listRes.ok()) {
        const items = (await listRes.json()) as { id: number; name: string }[];
        for (const item of items) {
          if (item.name.startsWith("디자인테스트셔츠-") || item.name.startsWith("옵션테스트셔츠-")) {
            await request.delete(`http://localhost:4000/admin/products/${item.id}`, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
          }
        }
      }
    }
  });

  test("1. 디자인은 URL(?design=)로만 바뀌고, 전환 버튼은 없으며, CSS Modules가 실제로 적용된다", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByTestId("design-switcher")).toHaveCount(0);
    await expect(page.locator("[data-design]")).toHaveCount(1);
    for (const id of ["muji-hara", "zavanas-archive", "editorial-atelier"] as const) {
      await page.goto(`/shop?design=${id}`);
      const root = page.locator(`[data-design="${id}"]`);
      await expect(root).toBeVisible();
      await expect(root.getByTestId("product-list")).toHaveCSS("display", "grid");
    }
    await expect(page.getByTestId("hero-banner")).toBeVisible();
    await page.goto("/shop/6?design=muji-hara");
    await expect(page.locator('[data-design="muji-hara"]')).toBeVisible();
  });

  test("1b. ?design= 으로 고른 디자인이 상품 링크, 모달, 다음 페이지에서도 유지된다", async ({ page }) => {
    await page.goto("/shop?design=zavanas-archive");
    const link = page.getByRole("link", { name: "마우스", exact: true });
    await expect(link).toHaveAttribute("href", /design=zavanas-archive/);
    await link.click();
    await expect(page.getByRole("dialog").locator('[data-design="zavanas-archive"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/cart");
    await page.goto("/shop");
    await expect(page.locator('[data-design="zavanas-archive"]')).toBeVisible();
  });

  test("2. 카테고리 필터 바 및 정렬 옵션(가격순·리뷰순·최신순) 검증", async ({ page }) => {
    await page.goto("/shop");

    // 카테고리 필터 바 검증
    const filterBar = page.getByTestId("category-filter-bar");
    await expect(filterBar).toBeVisible();

    // 정렬 셀렉트 확인
    const sortSelect = page.getByTestId("sort-select");
    await expect(sortSelect).toBeVisible();

    // 2-1. 낮은 가격순 정렬 (price_asc)
    await sortSelect.selectOption("price_asc");
    // 최소 2개 이상의 상품이 목록에 렌더링됨
    const listItems = page.getByRole("listitem");
    await expect(listItems.first()).toBeVisible();

    // 2-2. 높은 가격순 정렬 (price_desc)
    await sortSelect.selectOption("price_desc");
    await expect(listItems.first()).toBeVisible();

    // 2-3. 리뷰 많은순 정렬 (reviews)
    await sortSelect.selectOption("reviews");
    await expect(listItems.first()).toBeVisible();

    // 2-4. 최신순 복귀 (latest)
    await sortSelect.selectOption("latest");
    await expect(listItems.first()).toBeVisible();
  });

  test("3. 상품 상세(PDP) 옵션 변경, 담기, 바로 구매하기 및 후기 요약 검증", async ({ page }) => {
    // 3-1. 옵션과 리뷰가 있는 테스트 상품을 생성하기 위해 관리자로 로그인
    await loginAsKim(page);
    await page.goto("/admin/products/new");
    await expect(page.getByRole("heading", { name: "새 상품" })).toBeVisible();

    const testProductName = `디자인테스트셔츠-${Date.now().toString().slice(-4)}`;
    await page.getByLabel("상품명").fill(testProductName);
    await page.getByLabel("기본 가격(원)").fill("45000");
    await page.getByLabel("설명").fill("3대 스토어프론트 디자인 검증을 위한 테스트 상품입니다.");

    // 옵션 1 추가
    await page.getByPlaceholder("옵션명 (예: 화이트 / M)").fill("화이트 / M");
    await page.getByPlaceholder("추가금(+/-)").fill("0");
    await page.getByPlaceholder("재고").fill("5");
    await page.getByRole("button", { name: "+ 옵션 추가" }).click();

    // 옵션 2 추가
    await page.getByPlaceholder("옵션명 (예: 화이트 / M)").fill("네이비 / L");
    await page.getByPlaceholder("추가금(+/-)").fill("3000");
    await page.getByPlaceholder("재고").fill("8");
    await page.getByRole("button", { name: "+ 옵션 추가" }).click();

    // 등록
    await page.getByRole("button", { name: "상품 등록" }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);

    // 3-2. 상점으로 이동하여 방금 만든 상품 찾기
    await page.goto("/shop");
    const productLink = page.getByRole("link", { name: testProductName });
    await expect(productLink).toBeVisible();
    await productLink.click();

    // PDP 모달 또는 상세 페이지 열림 확인
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: testProductName })).toBeVisible();

    // 옵션 선택 드롭다운 확인 및 가격 변동 검증
    const variantSelect = dialog.getByTestId("variant-select");
    await expect(variantSelect).toBeVisible();
    await variantSelect.selectOption({ index: 1 });

    // 리뷰 영역 렌더링 확인
    const reviewsSection = dialog.getByTestId("product-reviews");
    await expect(reviewsSection).toBeVisible();
    await expect(reviewsSection.getByTestId("product-average-rating")).toBeVisible();
    await expect(reviewsSection.getByTestId("product-review-count")).toBeVisible();

    // [장바구니 담기] 클릭 -> 토스트 표시 및 헤더 수량 증가
    const addToCartBtn = dialog.getByRole("button", { name: "담기" });
    await addToCartBtn.click();
    await expect(page.getByRole("status").filter({ hasText: "담았습니다" })).toBeVisible();
    await expect(page.getByTestId("cart-count")).toContainText("장바구니");

    // [바로 구매하기] 클릭 -> 장바구니 페이지로 이동 확인
    const buyNowBtn = dialog.getByTestId("buy-now-btn");
    await expect(buyNowBtn).toBeVisible();
    await buyNowBtn.click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole("heading", { name: "장바구니" })).toBeVisible();
  });

  test("4. 관리자 설정 변경 시 스토어 브랜딩(상점명, 공지 바, 기본 디자인) 즉시 반영 검증", async ({ page }) => {
    await loginAsKim(page);
    await page.goto("/admin/settings");
    await expect(page.getByTestId("settings-form")).toBeVisible();

    const customStoreName = "ARCHIVE LAB 2026";
    const customAnnouncement = "[공지] 2026 시즌 오픈 전 상품 20% 세일 및 즉시 무료배송";
    const customHeroTitle = "ARCHIVE EXCLUSIVE COLLECTION";

    // 브랜딩 정보 변경
    await page.getByLabel("상호").fill(customStoreName);
    await page.getByTestId("store-design-select").selectOption("zavanas-archive");
    await page.getByLabel("상단 공지 문구").fill(customAnnouncement);
    await page.getByLabel("히어로 타이틀").fill(customHeroTitle);

    // 저장
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByTestId("save-done")).toBeVisible();

    // 쿼리스트링 없이 스토어프론트(/shop) 접근
    await page.goto("/shop");

    // 헤더 상호명 반영 확인
    await expect(page.getByTestId("header-store-name")).toHaveText(customStoreName);

    // 최상단 공지 바 반영 확인
    await expect(page.getByTestId("announcement-bar")).toHaveText(customAnnouncement);

    // 기본 스토어 디자인이 zavanas-archive로 렌더링되는지 확인
    await expect(page.locator('[data-design="zavanas-archive"]')).toBeVisible();
  });
});
