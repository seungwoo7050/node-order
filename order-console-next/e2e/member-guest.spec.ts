import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("회원가입 → 도로명 주소 검색 모달 → 회원 주문 및 기본 배송지 요약 → 비회원 주문 및 /guest/orders 조회 → 관리자 비회원 배지", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // 1. 회원가입 (/signup)
  await page.goto("/signup");
  await expect(page.getByTestId("signup-form")).toBeVisible();

  // 예약어 아이디 중복 체크 실패 확인
  await page.getByTestId("signup-id").fill("admin");
  await page.getByTestId("check-id-button").click();
  await expect(page.getByTestId("signup-form")).toContainText(/사용할 수 없는 아이디|예약된 접두사/);

  // 고유 아이디로 중복 체크 성공 확인
  const testUserId = `user${Date.now()}`;
  await page.getByTestId("signup-id").fill(testUserId);
  await page.getByTestId("check-id-button").click();
  await expect(page.getByTestId("signup-form")).toContainText("사용 가능한 아이디입니다.");

  // 회원가입 정보 입력 및 제출
  await page.getByTestId("signup-password").fill("password1234!");
  await page.getByTestId("signup-password-confirm").fill("password1234!");
  await page.getByTestId("signup-name").fill("테스트회원");
  await page.getByTestId("signup-phone").fill("010-1234-5678");
  await page.getByTestId("signup-submit").click();

  // 가입 완료 후 자동 로그인되어 홈/상점으로 이동 및 내 주문 링크 노출 확인
  await page.waitForURL(/\/(shop)?$/);
  await expect(page.getByRole("link", { name: "내 주문" })).toBeVisible();

  // 2. 도로명 주소 검색 모달: 내 정보(/me/profile)에서 기본 배송지 설정
  await page.goto("/me/profile");
  await expect(page.getByTestId("profile-form")).toBeVisible();

  // 도로명 주소 검색 모달 열기
  await page.getByTestId("open-address-search").click();
  const addressModal = page.getByRole("dialog");
  await expect(addressModal).toBeVisible();

  // "테헤란로" 검색 및 결과 선택
  await page.getByTestId("address-search-input").fill("테헤란로");
  await addressModal.getByRole("button", { name: "검색" }).click();
  await expect(page.getByTestId("address-result-item").first()).toBeVisible();
  await page.getByTestId("address-result-item").first().click();
  await expect(addressModal).toHaveCount(0);

  // 우편번호와 도로명 주소 자동 입력 확인
  await expect(page.getByTestId("profile-postal-code")).toHaveValue("06236");
  await expect(page.getByTestId("profile-address1")).toHaveValue("서울특별시 강남구 테헤란로 123");

  // 상세주소 및 받는 분 입력 후 기본 배송지 저장
  await page.getByTestId("profile-recipient-name").fill("김회원");
  await page.getByTestId("profile-recipient-phone").fill("010-5555-6666");
  await page.getByTestId("profile-address2").fill("3층 301호");
  await page.getByTestId("profile-delivery-memo").fill("문 앞");
  await page.getByTestId("save-profile-button").click();
  await expect(page.locator("text=내 정보 및 기본 배송지가 저장되었습니다.")).toBeVisible();

  // 3. 회원 주문 및 기본 배송지 요약 표시
  await page.getByRole("link", { name: "상품" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  const mouse = page.getByRole("listitem").filter({ hasText: "마우스" });
  await mouse.getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();
  await expect(page).toHaveURL(/\/cart$/);

  // 저장해 둔 기본 배송지가 요약 카드에 표시되는지 확인
  await expect(page.getByTestId("member-shipping-summary")).toBeVisible();
  await expect(page.getByTestId("member-shipping-summary")).toContainText("김회원");
  await expect(page.getByTestId("member-shipping-summary")).toContainText("06236");
  await expect(page.getByTestId("member-shipping-summary")).toContainText("서울특별시 강남구 테헤란로 123");

  // Stripe 리다이렉트 가로채기 및 회원 결제 진행
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "stripe" }),
  );
  await page.route("**/c/pay/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "stripe" }),
  );
  const memberCheckoutPromise = page.waitForResponse(
    (res) => res.url().includes("/orders/checkout") && res.status() === 201,
  );
  await page.getByTestId("privacy-consent").getByRole("checkbox").check();
  await page.getByRole("button", { name: "결제하기" }).click();
  await memberCheckoutPromise;
  await page.waitForURL(/checkout\.stripe\.com|\/c\/pay\//);

  // 4. 로그아웃 후 비회원 주문 및 /guest/orders 조회
  await page.goto("/me/orders");
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("link", { name: "비회원 주문", exact: true })).toBeVisible();

  // 상품 담기
  await page.getByRole("link", { name: "상품" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  const mouseGuest = page.getByRole("listitem").filter({ hasText: "마우스" });
  await mouseGuest.getByRole("button", { name: "담기" }).click();
  await page.getByTestId("cart-count").click();

  // 비회원 주문 배지 확인
  await expect(page.getByTestId("guest-badge")).toContainText("비회원 주문");

  // 배송지 폼 채우기 (도로명 주소 검색 모달 활용)
  await page.getByTestId("open-address-search").click();
  const guestAddressModal = page.getByRole("dialog");
  await page.getByTestId("address-search-input").fill("성수이로 51");
  await guestAddressModal.getByRole("button", { name: "검색" }).click();
  await expect(page.getByTestId("address-result-item").first()).toBeVisible();
  await page.getByTestId("address-result-item").first().click();

  const shippingForm = page.getByTestId("shipping-form");
  await shippingForm.getByLabel("받는 분", { exact: true }).fill("이비회원");
  await shippingForm.getByLabel("연락처", { exact: true }).fill("010-7777-8888");
  await shippingForm.getByLabel("상세주소 (선택)", { exact: true }).fill("2층");

  // 비회원 주문 비밀번호 입력
  await page.getByTestId("guest-password").fill("guestpass1234!");

  // 개인정보 수집 동의 및 결제
  await page.getByTestId("privacy-consent").getByRole("checkbox").check();

  let guestOrderId = 0;
  await page.route("**/orders/guest-checkout", async (route) => {
    const res = await route.fetch();
    const data = (await res.json()) as { id: number };
    await route.fulfill({ response: res });
    guestOrderId = data.id;
  });
  await page.getByRole("button", { name: "결제하기" }).click();
  await expect.poll(() => guestOrderId).toBeGreaterThan(0);
  await page.waitForURL(/checkout\.stripe\.com|\/c\/pay\//);

  // 비회원 주문 조회 (/guest/orders)
  await page.goto("/guest/orders");
  await expect(page.getByTestId("guest-lookup-form")).toBeVisible();

  // 틀린 비밀번호 입력 시 오류 메시지 확인
  await page.getByTestId("guest-order-id").fill(String(guestOrderId));
  await page.getByTestId("guest-lookup-password").fill("wrongpass");
  await page.getByTestId("guest-lookup-submit").click();
  await expect(page.getByTestId("guest-lookup-error")).toContainText("비밀번호가 일치하지 않습니다");

  // 올바른 비밀번호 입력 시 주문 상세 확인
  await page.getByTestId("guest-lookup-password").fill("guestpass1234!");
  await page.getByTestId("guest-lookup-submit").click();
  await expect(page.getByTestId("guest-order-detail")).toBeVisible();
  await expect(page.getByTestId("guest-order-detail")).toContainText(`주문 #${guestOrderId}`);
  await expect(page.getByTestId("order-shipping")).toContainText("이비회원");

  // 5. 관리자 /admin/orders 비회원 배지 및 주문 구분 필터 확인
  await page.goto("/login");
  await page.getByRole("button", { name: "관리자로" }).click();
  await expect(page).toHaveURL(/\/shop$/);

  // 관리자 주문 목록(전체 상태) 열기
  await page.getByRole("link", { name: "주문 처리" }).click();
  await expect(page).toHaveURL(/\/admin\/orders/);
  await page.getByTestId("status-filter").selectOption("");
  await expect(page.getByTestId("admin-orders")).toBeVisible();

  // 비회원 주문 행에 '비회원' 배지가 붙어 있는지 확인
  const guestOrderRow = page.getByRole("row").filter({ hasText: `#${guestOrderId}` });
  await expect(guestOrderRow).toBeVisible();
  await expect(guestOrderRow.getByTestId("guest-badge")).toHaveText("비회원");

  // 주문 구분 필터: 비회원 주문만 선택
  await page.getByTestId("guest-filter").selectOption("true");
  await expect(guestOrderRow).toBeVisible();
  const badges = page.getByTestId("guest-badge");
  const badgeCount = await badges.count();
  expect(badgeCount).toBeGreaterThan(0);

  // 주문 구분 필터: 회원 주문만 선택 시 해당 비회원 주문 미노출
  await page.getByTestId("guest-filter").selectOption("false");
  await expect(page.getByRole("row").filter({ hasText: `#${guestOrderId}` })).toHaveCount(0);
});
