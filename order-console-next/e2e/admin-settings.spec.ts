import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

// 상점 설정·법적 고지·대시보드·대사 화면. 설정을 저장하면 배포 없이 바닥글과 /legal/*가 새 값을 보인다(태그 캐시 무효화)
test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

async function loginAsKim(page: Page) {
  await page.goto("/login");
  await page.getByLabel("아이디").fill("kim");
  await page.getByLabel("비밀번호").fill("1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/shop$/);
}

const form = (page: Page) => page.getByTestId("settings-form");
async function openSettings(page: Page) {
  await page.goto("/admin/settings");
  await expect(form(page).getByLabel("상호")).not.toHaveValue("");
}
async function save(page: Page) {
  await form(page).getByRole("button", { name: "저장" }).click();
}

// 이 테스트가 만든 약관 판은 본문 앞에 표시를 달고, 끝나면 DB에서 지운다(개발 DB에 판이 쌓이지 않게).
// 법적 고지 판은 API로 지울 수 없다(변경 이력 공개라 지우는 길을 두지 않는다). 그래서 API의 .env에 있는 관리자 DB 주소로 직접 지운다.
// 지운 뒤에도 이 실행의 콘솔 캐시(legal 태그)에는 남지만, 이 파일 뒤의 테스트는 이용약관을 보지 않는다
const E2E_MARK = "[e2e] ";
function adminDatabaseUrl(): string {
  // playwright는 order-console-next에서 돈다(npm -w). e2e는 CommonJS로 읽혀 import.meta를 쓸 수 없다
  const env = readFileSync(path.join(process.cwd(), "..", "order-api-nest", ".env"), "utf8");
  const url = process.env.ADMIN_DATABASE_URL ?? env.match(/^ADMIN_DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!url) throw new Error("order-api-nest/.env에 ADMIN_DATABASE_URL이 없다");
  return url;
}
async function deleteE2eLegalVersions(): Promise<number> {
  const db = new pg.Client({ connectionString: adminDatabaseUrl() });
  await db.connect();
  try {
    return (await db.query("DELETE FROM legal_documents WHERE body LIKE $1 AND version > 1", [`${E2E_MARK}%`])).rowCount ?? 0;
  } finally {
    await db.end();
  }
}

let original: Record<"storeName" | "privacyOfficer" | "returnShippingFee" | "businessNumber", string> | null = null;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ serviceWorkers: "block" });
  await loginAsKim(page);
  await openSettings(page);
  original = {
    storeName: await form(page).getByLabel("상호").inputValue(),
    privacyOfficer: await form(page).getByLabel("개인정보 보호책임자").inputValue(),
    returnShippingFee: await form(page).getByLabel("단순변심 반품 왕복 배송비(원)").inputValue(),
    businessNumber: await form(page).getByLabel("사업자등록번호").inputValue(),
  };
  await page.close();
});

// 다른 테스트가 보는 값(반품 배송비 등)을 처음 값으로 돌려놓는다. 화면으로 저장해 콘솔 캐시도 같이 버린다
test.afterAll(async ({ browser }) => {
  await deleteE2eLegalVersions();
  if (!original) return;
  const page = await browser.newPage({ serviceWorkers: "block" });
  await loginAsKim(page);
  await openSettings(page);
  await form(page).getByLabel("상호").fill(original.storeName);
  await form(page).getByLabel("개인정보 보호책임자").fill(original.privacyOfficer);
  await form(page).getByLabel("단순변심 반품 왕복 배송비(원)").fill(original.returnShippingFee);
  await form(page).getByLabel("사업자등록번호").fill(original.businessNumber);
  await save(page);
  await expect(page.getByTestId("save-done")).toBeVisible();
  await page.close();
});

test("설정을 저장하면 상점 바닥글과 /legal/*가 배포 없이 새 값을 보인다", async ({ page }) => {
  const name = `브라운 상점 ${Date.now().toString(36)}`;
  // 저장 전 페이지를 한 번 열어 캐시를 채워 둔다
  await page.goto("/legal/refund");
  await expect(page.getByTestId("store-footer")).toBeVisible();
  await expect(page.getByTestId("store-footer")).not.toContainText(name);

  await loginAsKim(page);
  await openSettings(page);
  await form(page).getByLabel("상호").fill(name);
  await form(page).getByLabel("개인정보 보호책임자").fill("정보보호 담당 이보안");
  await form(page).getByLabel("단순변심 반품 왕복 배송비(원)").fill("5500");
  await save(page);
  await expect(page.getByTestId("save-done")).toBeVisible();

  await page.goto("/shop");
  await expect(page.getByTestId("footer-store-name")).toHaveText(name);
  await expect(page.getByTestId("store-footer")).toContainText("정보보호 담당 이보안");
  await page.goto("/legal/terms");
  await expect(page.getByTestId("legal-store-facts")).toContainText(name);
  await page.goto("/legal/privacy");
  await expect(page.getByTestId("legal-store-facts")).toContainText("정보보호 담당 이보안");
  await page.goto("/legal/refund");
  await expect(page.getByTestId("legal-store-facts")).toContainText("5,500원");
  await expect(page.getByTestId("footer-store-name")).toHaveText(name);
});

test("다른 곳에서 먼저 저장했으면(오래된 version) 저장이 409이고 화면에 충돌 안내가 보인다", async ({ browser }) => {
  const a = await browser.newPage({ serviceWorkers: "block" });
  const b = await browser.newPage({ serviceWorkers: "block" });
  for (const p of [a, b]) {
    await loginAsKim(p);
    await openSettings(p);
  }
  await form(a).getByLabel("상호").fill("먼저 저장한 상호");
  await save(a);
  await expect(a.getByTestId("save-done")).toBeVisible();

  await form(b).getByLabel("상호").fill("나중에 저장한 상호");
  await save(b);
  await expect(b.getByTestId("save-conflict")).toContainText("다른 곳에서 먼저 설정을 저장했습니다");
  await b.getByRole("button", { name: "지금 값 불러오기" }).click();
  await expect(form(b).getByLabel("상호")).toHaveValue("먼저 저장한 상호");
  await save(b);
  await expect(b.getByTestId("save-done")).toBeVisible();
  await a.close();
  await b.close();
});

test("사업자등록번호 체크섬이 틀리면 그 칸 아래에 오류가 보이고 저장되지 않는다", async ({ page }) => {
  await loginAsKim(page);
  await openSettings(page);
  await form(page).getByLabel("사업자등록번호").fill("123-45-67890");
  await save(page);
  await expect(page.getByTestId("error-businessNumber")).toContainText("사업자등록번호가 올바르지 않습니다");
  await expect(form(page).getByLabel("사업자등록번호")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("save-done")).toHaveCount(0);
});

test("연결된 기능은 연결됨·없음만 보이고, 화면 어디에도 키 값이 없다", async ({ page }) => {
  await loginAsKim(page);
  await openSettings(page);
  const integrations = page.getByTestId("integrations");
  await expect(integrations).toContainText("토스페이먼츠");
  for (const text of await integrations.locator("dd").allTextContents()) expect(["연결됨", "없음"]).toContain(text);
  const html = await page.content();
  for (const secret of ["test_sk_simulator", "sk_test_simulator", "whsec_simulator", "localsecret123"]) expect(html).not.toContain(secret);
});

test("약관을 고치면 새 판이 생기고 공개 페이지에서 지난 판을 열람할 수 있다", async ({ page }) => {
  const body = `${E2E_MARK}이용약관 개정 ${Date.now().toString(36)}: 제3조(배송) 결제 뒤 3영업일 안에 발송합니다.`;
  await page.goto("/legal/terms");
  const before = await page.getByTestId("legal-version").textContent();
  const beforeVersion = Number(before!.match(/(\d+)판/)![1]);

  await loginAsKim(page);
  await page.goto("/admin/legal");
  await page.getByRole("tab", { name: "이용약관" }).click();
  await page.getByLabel("본문").fill(body);
  await page.getByRole("button", { name: "새 판으로 저장" }).click();
  await expect(page.getByTestId("legal-save-message")).toContainText(`${beforeVersion + 1}판으로 저장했습니다`);

  await page.goto("/legal/terms");
  await expect(page.getByTestId("legal-version")).toContainText(`${beforeVersion + 1}판`);
  await expect(page.getByTestId("legal-body")).toHaveText(body);
  await page.getByTestId("legal-history").getByRole("link", { name: `${beforeVersion}판` }).click();
  await expect(page).toHaveURL(new RegExp(`/legal/terms\\?version=${beforeVersion}$`));
  await expect(page.getByText("지난 판입니다")).toBeVisible();
  await expect(page.getByTestId("legal-body")).not.toHaveText(body);

  // 정리: 이 테스트가 만든 판만 지운다(다음 실행의 판 번호가 늘지 않는다)
  expect(await deleteE2eLegalVersions()).toBe(1);
});

test("장바구니는 지금 개인정보처리방침 판에 동의해야 결제할 수 있다", async ({ page }) => {
  await page.goto("/legal/privacy");
  const version = (await page.getByTestId("legal-version").textContent())!.match(/(\d+)판/)![1];
  await loginAsKim(page);
  await page.getByRole("listitem").filter({ hasText: "마우스" }).getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  const consent = page.getByTestId("privacy-consent");
  await expect(consent).toContainText(`개인정보처리방침 ${version}판 보기`);
  await expect(consent.getByRole("checkbox")).not.toBeChecked();
  await expect(consent.getByRole("checkbox")).toHaveAttribute("required", "");
});

test("대시보드 타일에서 처리 대기 목록으로 간다", async ({ page }) => {
  await loginAsKim(page);
  await page.getByRole("link", { name: "대시보드" }).click();
  await expect(page.getByRole("heading", { name: "오늘 처리할 것" })).toBeVisible();
  for (const id of ["tile-today", "tile-pending", "tile-low-stock", "tile-zero-search", "tile-reconciliation"]) await expect(page.getByTestId(id)).toBeVisible();
  await page.getByTestId("tile-pending").getByRole("link", { name: "배송 준비 중" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\?status=preparing$/);
  await expect(page.getByTestId("status-filter")).toHaveValue("preparing");
});

test("데모 관리자는 대시보드·대사·설정을 볼 수 있지만 쓰기 입력은 꺼져 있다", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "관리자로" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await page.goto("/admin");
  await expect(page.getByTestId("tile-today")).toBeVisible();
  await page.goto("/admin/reconciliation");
  await expect(page.getByRole("heading", { name: "PG 대사" })).toBeVisible();
  await expect(page.getByTestId("read-only-note")).toContainText("볼 수만 있습니다");
  await page.goto("/admin/settings");
  await expect(form(page).getByLabel("상호")).toBeDisabled();
  await expect(form(page).getByRole("button", { name: "저장" })).toBeDisabled();
  await page.goto("/admin/legal");
  await expect(page.getByLabel("본문")).toBeDisabled();
});
