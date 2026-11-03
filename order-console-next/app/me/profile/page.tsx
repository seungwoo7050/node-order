"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authFetch } from "@/lib/api-client";
import { useTRPC } from "@/lib/trpc";
import { AddressSearchModal } from "@/app/address-search-modal";

interface ProfileData {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  isGuest: boolean;
  recipientName: string | null;
  recipientPhone: string | null;
  postalCode: string | null;
  address1: string | null;
  address2: string | null;
  deliveryMemo: string | null;
}

function ProfileForm({ profile }: { profile: ProfileData }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState(profile.name ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [recipientName, setRecipientName] = useState(profile.recipientName ?? "");
  const [recipientPhone, setRecipientPhone] = useState(profile.recipientPhone ?? "");
  const [postalCode, setPostalCode] = useState(profile.postalCode ?? "");
  const [address1, setAddress1] = useState(profile.address1 ?? "");
  const [address2, setAddress2] = useState(profile.address2 ?? "");
  const [deliveryMemo, setDeliveryMemo] = useState(profile.deliveryMemo ?? "");
  const [profileSuccess, setProfileSuccess] = useState(false);

  // 비밀번호 변경 상태
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const updateProfileMutation = useMutation({
    mutationFn: (body: Record<string, string | null>) =>
      authFetch<ProfileData>("/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["me", "profile"], data);
      void queryClient.invalidateQueries({ queryKey: trpc.me.profile.queryKey() });
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      authFetch<{ success: boolean }>("/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setPasswordError(null);
      setPasswordSuccess(true);
      setTimeout(() => setPasswordSuccess(false), 3000);
    },
    onError: (err: Error) => {
      setPasswordError(err.message || "비밀번호 변경에 실패했습니다");
    },
  });

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate({
      name: name.trim(),
      phone: phone.trim() || null,
      recipientName: recipientName.trim() || null,
      recipientPhone: recipientPhone.trim() || null,
      postalCode: postalCode.trim() || null,
      address1: address1.trim() || null,
      address2: address2.trim() || null,
      deliveryMemo: deliveryMemo.trim() || null,
    });
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (newPassword !== newPasswordConfirm) {
      setPasswordError("새 비밀번호가 일치하지 않습니다");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("새 비밀번호는 8자 이상이어야 합니다");
      return;
    }

    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  return (
    <>
      <section className="mb-12 border-b border-line pb-8">
        <h2 className="subtitle mb-4">기본 회원 정보</h2>
        <form onSubmit={handleProfileSubmit} className="grid gap-4 text-sm" data-testid="profile-form">
          <div className="grid grid-cols-[100px_1fr] items-center gap-2">
            <span className="text-muted">아이디</span>
            <span className="font-mono">{profile.id}</span>
          </div>

          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            <span className="text-muted">이름</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="border border-line px-3 py-1.5"
              data-testid="profile-name"
            />
          </label>

          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            <span className="text-muted">연락처</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="010-1234-5678"
              className="border border-line px-3 py-1.5"
              data-testid="profile-phone"
            />
          </label>

          <h3 className="font-medium mt-6 mb-2">기본 배송지 설정</h3>
          <p className="text-xs text-muted mb-2">
            주문할 때 자동으로 채워질 기본 배송지입니다.
          </p>

          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            <span className="text-muted">받는 분</span>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="홍길동"
              className="border border-line px-3 py-1.5"
              data-testid="profile-recipient-name"
            />
          </label>

          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            <span className="text-muted">연락처</span>
            <input
              type="tel"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              placeholder="010-1234-5678"
              className="border border-line px-3 py-1.5"
              data-testid="profile-recipient-phone"
            />
          </label>

          <div className="grid grid-cols-[100px_1fr] items-center gap-2">
            <span className="text-muted">우편번호</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={postalCode}
                readOnly
                placeholder="06236"
                className="w-28 border border-line bg-neutral-50 px-3 py-1.5 font-mono"
                data-testid="profile-postal-code"
              />
              <AddressSearchModal
                onSelect={({ postalCode: p, address1: a }) => {
                  setPostalCode(p);
                  setAddress1(a);
                }}
              />
            </div>
          </div>

          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            <span className="text-muted">주소</span>
            <input
              type="text"
              value={address1}
              readOnly
              placeholder="우편번호 찾기로 도로명 주소를 검색해 주세요"
              className="border border-line bg-neutral-50 px-3 py-1.5"
              data-testid="profile-address1"
            />
          </label>

          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            <span className="text-muted">상세주소</span>
            <input
              type="text"
              value={address2}
              onChange={(e) => setAddress2(e.target.value)}
              placeholder="4층"
              className="border border-line px-3 py-1.5"
              data-testid="profile-address2"
            />
          </label>

          <label className="grid grid-cols-[100px_1fr] items-center gap-2">
            <span className="text-muted">배송 메모</span>
            <input
              type="text"
              value={deliveryMemo}
              onChange={(e) => setDeliveryMemo(e.target.value)}
              placeholder="문 앞"
              className="border border-line px-3 py-1.5"
              data-testid="profile-delivery-memo"
            />
          </label>

          {profileSuccess && (
            <p className="text-green-600 text-xs">내 정보 및 기본 배송지가 저장되었습니다.</p>
          )}
          {updateProfileMutation.error && (
            <p role="alert" className="alert">{(updateProfileMutation.error as Error).message}</p>
          )}

          <div className="mt-2">
            <button
              type="submit"
              className="btn"
              disabled={updateProfileMutation.isPending}
              data-testid="save-profile-button"
            >
              {updateProfileMutation.isPending ? "저장 중…" : "정보 저장"}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="subtitle mb-4">비밀번호 변경</h2>
        <form onSubmit={handlePasswordSubmit} className="grid max-w-md gap-3 text-sm" data-testid="password-form">
          <label className="grid gap-1">
            <span className="text-muted">현재 비밀번호</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="border border-line px-3 py-1.5"
              autoComplete="current-password"
              data-testid="current-password"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-muted">새 비밀번호 (8자 이상)</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="border border-line px-3 py-1.5"
              autoComplete="new-password"
              data-testid="new-password"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-muted">새 비밀번호 확인</span>
            <input
              type="password"
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              required
              className="border border-line px-3 py-1.5"
              autoComplete="new-password"
              data-testid="new-password-confirm"
            />
          </label>

          {passwordSuccess && (
            <p className="text-green-600 text-xs">비밀번호가 성공적으로 변경되었습니다.</p>
          )}
          {passwordError && (
            <p role="alert" className="alert">{passwordError}</p>
          )}

          <div className="mt-2">
            <button
              type="submit"
              className="btn"
              disabled={changePasswordMutation.isPending}
              data-testid="change-password-button"
            >
              {changePasswordMutation.isPending ? "변경 중…" : "비밀번호 변경"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

export default function ProfilePage() {
  const { data: profile, isLoading, error } = useQuery<ProfileData>({
    queryKey: ["me", "profile"],
    queryFn: () => authFetch<ProfileData>("/me/profile"),
  });

  if (isLoading) {
    return (
      <main className="page flex-1 pb-12 pt-8">
        <p className="mx-auto max-w-xl text-sm text-muted py-8">내 정보를 불러오는 중입니다…</p>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="page flex-1 pb-12 pt-8">
        <p role="alert" className="alert mx-auto max-w-xl my-8">로그인이 필요하거나 정보를 불러오지 못했습니다.</p>
      </main>
    );
  }

  return (
    <main className="page flex-1 pb-12 pt-8">
      <div className="mx-auto max-w-xl">
        <h1 className="title mb-8">내 정보 관리</h1>
        <ProfileForm profile={profile} key={profile.id} />
      </div>
    </main>
  );
}
