"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { API_URL, ApiError, authFetch, refreshAccessToken } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { shippingFor, useCartStore } from "@/lib/cart-store";
import { defaultProvider, featuresOptions, providerLabel, providerNote, type PaymentProvider } from "@/lib/features";
import { productListOptions } from "@/lib/lists";
import { shippingFeeFor, won } from "@/lib/orders";
import { privacyOptions, storeInfoOptions } from "@/lib/store-info";
import { useTRPC } from "@/lib/trpc";
import { useOnline } from "../online-banner";
import { Stepper } from "../shop/stepper";
import { AddressSearchModal } from "../address-search-modal";

type CheckoutResult = { id: number; price: number; checkoutUrl: string; provider: PaymentProvider; guestAccessToken?: string };

// 배송지 입력 칸. 형식은 API가 다시 검사한다(비었거나 우편번호가 5자리가 아니면 400)
const SHIPPING_FIELDS = [
  { name: "recipientName", label: "받는 분", autoComplete: "name", required: true, maxLength: 50 },
  { name: "recipientPhone", label: "연락처", autoComplete: "tel", required: true, inputMode: "tel", placeholder: "010-1234-5678", maxLength: 13, pattern: "0\\d{1,2}-?\\d{3,4}-?\\d{4}" },
  { name: "postalCode", label: "우편번호", autoComplete: "postal-code", required: true, inputMode: "numeric", placeholder: "5자리", pattern: "\\d{5}", maxLength: 5 },
  { name: "address1", label: "주소", autoComplete: "address-line1", required: true, maxLength: 200 },
  { name: "address2", label: "상세주소", autoComplete: "address-line2", required: false, maxLength: 200 },
  { name: "deliveryMemo", label: "배송 메모", autoComplete: "off", required: false, maxLength: 200, placeholder: "문 앞에 두세요" },
] as const;

export default function CartPage() {
  const items = useCartStore((s) => s.items);
  const remove = useCartStore((s) => s.remove);
  // 소유자가 있는 배송지는 그 사람이 인증돼 있을 때만 보인다(세션 만료 뒤 앞 사람의 배송지를 보이지 않는다)
  const accessToken = useAuthStore((s) => s.accessToken);
  const authStatus = useAuthStore((s) => s.status);
  // 새로고침 직후에는 토큰이 없어 누구인지 모른다: 갱신을 한 번 해 보고, 그동안 배송지 칸을 잠근다(지우지도 덮어쓰지도 않게)
  const checkingAuth = authStatus === "checking";
  useEffect(() => {
    if (useAuthStore.getState().status === "checking") void refreshAccessToken().catch(() => {});
  }, []);
  const shipping = useCartStore((s) => shippingFor(s, accessToken));
  const setShipping = useCartStore((s) => s.setShipping);
  const online = useOnline();
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const { data: products } = useInfiniteQuery(productListOptions(trpc));
  const stockOf = (productId: number) => products?.pages.flatMap((p) => p.items).find((p) => p.id === productId)?.stock ?? Infinity;

  // 로그인 회원 프로필 조회 (기본 배송지 불러오기)
  const isMember = !!accessToken;
  const profileQuery = useQuery({
    queryKey: ["me", "profile", accessToken],
    queryFn: () =>
      authFetch<{
        id: string;
        name: string;
        phone: string | null;
        recipientName: string | null;
        recipientPhone: string | null;
        postalCode: string | null;
        address1: string | null;
        address2: string | null;
        deliveryMemo: string | null;
      }>("/me/profile"),
    enabled: isMember,
  });

  const loadedRef = useRef(false);
  const [guestPassword, setGuestPassword] = useState("");

  const hasDefaultShipping = !!(profileQuery.data?.postalCode && profileQuery.data?.address1);

  const applyDefaultShipping = () => {
    if (!profileQuery.data?.postalCode || !profileQuery.data?.address1) return;
    setShipping({
      recipientName: profileQuery.data.recipientName ?? profileQuery.data.name ?? shipping.recipientName,
      recipientPhone: profileQuery.data.recipientPhone ?? profileQuery.data.phone ?? shipping.recipientPhone,
      postalCode: profileQuery.data.postalCode,
      address1: profileQuery.data.address1,
      address2: profileQuery.data.address2 ?? "",
      deliveryMemo: profileQuery.data.deliveryMemo ?? "",
    });
  };

  useEffect(() => {
    if (isMember && profileQuery.data && !loadedRef.current) {
      if (
        profileQuery.data.postalCode &&
        profileQuery.data.address1 &&
        !shipping.recipientName &&
        !shipping.postalCode &&
        !shipping.address1
      ) {
        setShipping({
          recipientName: profileQuery.data.recipientName ?? profileQuery.data.name ?? "",
          recipientPhone: profileQuery.data.recipientPhone ?? profileQuery.data.phone ?? "",
          postalCode: profileQuery.data.postalCode,
          address1: profileQuery.data.address1,
          address2: profileQuery.data.address2 ?? "",
          deliveryMemo: profileQuery.data.deliveryMemo ?? "",
        });
      }
      loadedRef.current = true;
    }
  }, [isMember, profileQuery.data, setShipping, shipping]);

  // 결제 수단: API가 켜 둔 것만 보인다(키가 있는 PG)
  const features = useQuery(featuresOptions);
  const available = features.data?.payments ?? [];
  const [chosen, setChosen] = useState<PaymentProvider | null>(null);
  const provider = chosen && available.includes(chosen) ? chosen : defaultProvider(available);
  // 배송비는 상점 설정에서, 동의할 개인정보처리방침은 지금 시행 중인 판(서버가 둘 다 다시 확인한다)
  const store = useQuery(storeInfoOptions);
  const privacy = useQuery(privacyOptions);
  const [agreed, setAgreed] = useState(false);

  const checkout = useMutation({
    mutationFn: async () => {
      const key = useCartStore.getState().beginCheckout();
      if (!isMember) {
        // 비회원 주문
        const res = await fetch(`${API_URL}/orders/guest-checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
          body: JSON.stringify({
            provider,
            shipping,
            privacyConsentVersion: privacy.data?.version,
            password: guestPassword,
            items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
          throw new ApiError(res.status, Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? res.statusText));
        }
        return (await res.json()) as CheckoutResult;
      }

      // 회원 주문
      return authFetch<CheckoutResult>("/orders/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
        body: JSON.stringify({
          provider, shipping, privacyConsentVersion: privacy.data?.version,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        }),
      });
    },
    onError: (err) => {
      // 결제 도중 개인정보처리방침이 바뀌었다(400): 새 판을 다시 읽고 동의를 다시 받는다
      if (err instanceof ApiError && err.status === 400 && /개인정보처리방침/.test(err.message)) {
        setAgreed(false);
        void queryClient.invalidateQueries({ queryKey: privacyOptions.queryKey });
      }
    },
    onSuccess: (data) => {
      if (data.guestAccessToken) {
        useAuthStore.getState().setAccessToken(data.guestAccessToken);
      }
      useCartStore.getState().finishCheckout();
      void queryClient.invalidateQueries({ queryKey: trpc.products.list.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.me.orders.pathKey() });
      window.location.assign(data.checkoutUrl);
    },
  });

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const fee = store.data ? shippingFeeFor(subtotal, store.data) : null;
  const total = subtotal + (fee ?? 0);
  const showSummaryCard = isMember && hasDefaultShipping;

  return (
    <main className="page flex-1 pb-12 pt-2">
      <h1 className="title mb-8">장바구니</h1>
      {items.length === 0 ? (
        <p className="border-y border-line py-8 text-sm text-muted">
          <span className="mb-1 block font-serif font-normal text-fg">비어 있습니다</span>
          <Link href="/shop">상품</Link>에서 담으면 여기에 모입니다.
        </p>
      ) : (
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
          <ul className="border-t border-line">
            {items.map((i) => (
              <li key={i.productId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto_7rem]">
                <div className="min-w-0">
                  <p className="font-normal">{i.name}</p>
                  <p className="num text-[0.8rem] text-muted">{won(i.price)}</p>
                </div>
                <span className="num text-right sm:order-last">{won(i.price * i.quantity)}</span>
                <span className="col-span-2 flex items-center gap-3 sm:col-span-1">
                  <Stepper productId={i.productId} name={i.name} quantity={i.quantity} max={stockOf(i.productId)} />
                  <button type="button" className="link-quiet" onClick={() => remove(i.productId)}>빼기</button>
                </span>
              </li>
            ))}
          </ul>
          <aside aria-label="결제" className="lg:sticky lg:top-6"><form onSubmit={(e) => { e.preventDefault(); checkout.mutate(); }}>
            {!isMember && (
              <div className="mb-4 flex items-center justify-between rounded bg-neutral-100 p-2.5 text-xs border border-line">
                <span className="font-medium" data-testid="guest-badge">[비회원 주문]</span>
                <Link href="/login" className="underline text-muted hover:text-fg">
                  로그인하고 주문하기
                </Link>
              </div>
            )}

            {showSummaryCard ? (
              <div className="mb-4 rounded border border-line p-3 text-sm" data-testid="member-shipping-summary">
                <div className="flex items-center justify-between mb-1">
                  <span className="label">기본 배송지</span>
                  <button
                    type="button"
                    className="text-xs underline text-muted hover:text-fg"
                    data-testid="edit-shipping-button"
                    onClick={applyDefaultShipping}
                  >
                    기본 배송지 다시 채우기
                  </button>
                </div>
                <p className="font-medium">{profileQuery.data?.recipientName || shipping.recipientName} ({profileQuery.data?.recipientPhone || shipping.recipientPhone})</p>
                <p className="text-muted text-xs mt-0.5">({profileQuery.data?.postalCode}) {profileQuery.data?.address1} {profileQuery.data?.address2}</p>
                {profileQuery.data?.deliveryMemo && <p className="text-muted text-xs mt-1">메모: {profileQuery.data.deliveryMemo}</p>}
              </div>
            ) : null}

            <fieldset
              className="mb-6 block"
              data-testid="shipping-form"
              disabled={checkingAuth}
              aria-busy={checkingAuth}
            >
              <div className="flex items-center justify-between mb-2">
                <legend className="label">배송지</legend>
                <AddressSearchModal
                  onSelect={({ postalCode, address1 }) => {
                    setShipping({ postalCode, address1 });
                  }}
                />
              </div>
              {checkingAuth && <p role="status" className="mb-2 text-[0.78rem] text-muted">로그인 상태를 확인하는 중입니다…</p>}
              {SHIPPING_FIELDS.map((f) => (
                <label key={f.name} className="mb-2 block text-sm">
                  <span className="mb-1 block text-[0.78rem] text-muted">{f.label}{f.required ? "" : " (선택)"}</span>
                  <input
                    name={f.name} className="w-full border border-line px-2 py-1.5 text-sm" required={f.required} maxLength={f.maxLength}
                    autoComplete={f.autoComplete} inputMode={"inputMode" in f ? f.inputMode : undefined}
                    placeholder={"placeholder" in f ? f.placeholder : undefined} pattern={"pattern" in f ? f.pattern : undefined}
                    value={shipping[f.name]} onChange={(e) => setShipping({ [f.name]: e.target.value })}
                  />
                </label>
              ))}
            </fieldset>

            {!isMember && (
              <fieldset className="mb-5 border-t border-line pt-4">
                <legend className="label mb-2">비회원 주문 비밀번호</legend>
                <label className="mb-2 block text-sm">
                  <span className="mb-1 block text-[0.78rem] text-muted">주문 조회 시 사용할 비밀번호 (4자 이상)</span>
                  <input
                    type="password"
                    name="guestPassword"
                    required
                    minLength={4}
                    value={guestPassword}
                    onChange={(e) => setGuestPassword(e.target.value)}
                    placeholder="비밀번호 입력"
                    className="w-full border border-line px-2 py-1.5 text-sm"
                    data-testid="guest-password"
                  />
                </label>
              </fieldset>
            )}

            <dl className="mb-5 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="text-muted">상품 합계</dt>
              <dd className="num text-right">{won(subtotal)}</dd>
              <dt className="text-muted">배송비</dt>
              <dd className="num text-right" data-testid="shipping-fee">{fee === null ? "확인 중" : fee === 0 ? "무료" : won(fee)}</dd>
              <dt className="label self-baseline pt-2">합계</dt>
              <dd className="num pt-2 text-right text-xl font-normal" data-testid="cart-total">{won(total)}</dd>
            </dl>
            {store.data && fee !== null && fee > 0 && <p className="-mt-3 mb-5 text-[0.78rem] text-muted">상품 합계 {won(store.data.freeShippingThreshold)} 이상이면 배송비가 무료입니다.</p>}
            {available.length > 0 && (
              <fieldset className="mb-5">
                <legend className="label mb-2">결제 수단</legend>
                {available.map((p) => (
                  <label key={p} className="flex items-center gap-2 py-1 text-sm">
                    <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => setChosen(p)} />
                    {providerLabel[p]}
                  </label>
                ))}
              </fieldset>
            )}
            <label className="mb-4 flex items-start gap-2 text-[0.82rem]" data-testid="privacy-consent">
              {/* required: 동의하지 않으면 브라우저가 제출을 막는다(서버도 동의 판이 없으면 400) */}
              <input type="checkbox" className="mt-1" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={!privacy.data} />
              <span>
                [필수] 개인정보 수집·이용(받는 분, 연락처, 배송지)에 동의합니다.{" "}
                {privacy.data && <Link href="/legal/privacy" target="_blank">개인정보처리방침 {privacy.data.version}판 보기</Link>}
              </span>
            </label>
            <button type="submit" className="btn btn-primary w-full" disabled={checkout.isPending || !online || !provider || !privacy.data || fee === null}>
              {checkout.isPending ? "결제 화면을 여는 중…" : "결제하기"}
            </button>
            <p className="mt-3 text-[0.78rem] text-muted" data-testid="checkout-note">
              {!online ? "연결되면 결제할 수 있습니다."
                : features.isPending ? "결제 수단을 확인하는 중입니다."
                : features.isError ? "결제 수단을 불러오지 못해 지금은 결제할 수 없습니다. 잠시 뒤 다시 열어 주세요."
                : !provider ? "지금은 켜진 결제 수단이 없어 결제할 수 없습니다. 상점이 결제 키를 설정하면 열립니다."
                : privacy.isError || store.isError ? "상점 정보를 불러오지 못해 지금은 결제할 수 없습니다. 잠시 뒤 다시 열어 주세요."
                : `${providerNote[provider]} 24시간 안에 결제하지 않으면 주문이 취소됩니다.`}
            </p>
          </form></aside>
        </div>
      )}
      {checkout.isSuccess && <p role="status" className="mt-4 text-sm">주문 #{checkout.data.id} - 결제 화면으로 이동하는 중입니다.</p>}
      {checkout.error && (
        <p role="alert" className="alert mt-4">
          결제를 시작하지 못했습니다: {checkout.error.message}
          {checkout.error instanceof ApiError && checkout.error.status === 401 && <> - <Link href="/login">로그인</Link>해 주세요.</>}
        </p>
      )}
    </main>
  );
}
