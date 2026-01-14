"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, login } from "@/lib/api-client";
import { signInWithGithub } from "./actions";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  function done() {
    queryClient.clear();
    router.push("/shop");
  }

  async function onSubmit(formData: FormData) {
    try {
      await login(String(formData.get("id")), String(formData.get("password")));
      done();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "아이디 또는 비밀번호가 맞지 않습니다." : "로그인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    }
  }

  const field = "border-0 border-b border-line-strong bg-transparent py-2 font-light aria-invalid:border-danger";

  return (
    <main>
      <h1>로그인</h1>
      <form action={onSubmit}>
        <label className="grid gap-1">
          <span className="label">아이디</span>
          <input name="id" defaultValue="kim" autoComplete="username" className={field} />
        </label>
        <label className="grid gap-1">
          <span className="label">비밀번호</span>
          <input name="password" type="password" autoComplete="current-password" className={field}
            aria-invalid={error ? true : undefined} aria-describedby={error ? "login-error" : undefined} />
        </label>
        {error && <p id="login-error" role="alert" className="text-[0.82rem] text-danger">{error}</p>}
        <button type="submit">로그인</button>
      </form>
      <form action={signInWithGithub}>
        <button type="submit">GitHub로 로그인</button>
      </form>
    </main>
  );
}