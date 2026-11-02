"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { API_URL } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

export default function SignupPage() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [idChecked, setIdChecked] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);

  const checkId = async () => {
    if (!id.trim()) {
      setIdError("아이디를 입력해 주세요");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/auth/check-id?id=${encodeURIComponent(id.trim())}`);
      const data = (await res.json()) as { available: boolean; reason?: string };
      if (data.available) {
        setIdChecked(true);
        setIdError(null);
      } else {
        setIdChecked(false);
        setIdError(data.reason ?? "사용할 수 없는 아이디입니다");
      }
    } catch {
      setIdError("아이디 중복 확인에 실패했습니다");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다");
      return;
    }

    setIsPending(true);
    try {
      const res = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: id.trim(),
          password,
          name: name.trim(),
          phone: phone.trim() || undefined,
        }),
        credentials: "include",
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? "회원가입에 실패했습니다");
        setError(msg);
        setIsPending(false);
        return;
      }

      const { accessToken } = (await res.json()) as { accessToken: string };
      useAuthStore.getState().setAccessToken(accessToken);
      router.push("/");
    } catch {
      setError("네트워크 오류가 발생했습니다");
      setIsPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="title mb-6">회원가입</h1>

      <form onSubmit={handleSubmit} className="grid gap-4 text-sm" data-testid="signup-form">
        <label className="grid gap-1">
          <span className="text-muted">아이디</span>
          <div className="flex gap-2">
            <input
              type="text"
              name="id"
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setIdChecked(false);
                setIdError(null);
              }}
              required
              className="flex-1 border border-line px-3 py-1.5"
              placeholder="영문, 숫자 3~30자"
              autoComplete="username"
              data-testid="signup-id"
            />
            <button
              type="button"
              onClick={checkId}
              className="btn text-xs px-3"
              data-testid="check-id-button"
            >
              중복 확인
            </button>
          </div>
          {idChecked && <span className="text-xs text-green-600">사용 가능한 아이디입니다.</span>}
          {idError && <span className="text-xs text-red-600">{idError}</span>}
        </label>

        <label className="grid gap-1">
          <span className="text-muted">비밀번호</span>
          <input
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="border border-line px-3 py-1.5"
            placeholder="8자 이상"
            autoComplete="new-password"
            data-testid="signup-password"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-muted">비밀번호 확인</span>
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            required
            className="border border-line px-3 py-1.5"
            placeholder="비밀번호 재입력"
            autoComplete="new-password"
            data-testid="signup-password-confirm"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-muted">이름</span>
          <input
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="border border-line px-3 py-1.5"
            autoComplete="name"
            data-testid="signup-name"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-muted">연락처 (선택)</span>
          <input
            type="tel"
            name="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="border border-line px-3 py-1.5"
            placeholder="010-1234-5678"
            autoComplete="tel"
            data-testid="signup-phone"
          />
        </label>

        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="btn mt-2 py-2"
          disabled={isPending}
          data-testid="signup-submit"
        >
          {isPending ? "가입하는 중…" : "회원가입"}
        </button>
      </form>

      <div className="mt-6 flex justify-between text-xs text-muted">
        <Link href="/login" className="underline hover:text-fg">
          이미 계정이 있으신가요? 로그인
        </Link>
        <Link href="/guest/orders" className="underline hover:text-fg">
          비회원 주문 조회
        </Link>
      </div>
    </div>
  );
}
