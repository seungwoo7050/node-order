"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, demoEnabled, demoLogin, login } from "@/lib/api-client";
import { signInWithGithub } from "./actions";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data: demo } = useQuery({ queryKey: ["auth", "demo"], queryFn: demoEnabled, staleTime: Infinity });

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

  async function onDemo(as: "user" | "admin") {
    try {
      await demoLogin(as);
      done();
    } catch {
      setError("데모 로그인을 할 수 없습니다. 잠시 뒤 다시 시도해 주세요.");
    }
  }

  const field = "border-0 border-b border-line-strong bg-transparent py-2 font-light aria-invalid:border-danger";

  return (
    <main className="page flex-1 pb-12">
      <div className="mx-auto mt-8 grid max-w-[300px] gap-4">
        <h1 className="title mb-2">로그인</h1>
        {demo && (
          <section aria-labelledby="demo-title" className="grid gap-2">
            <h2 id="demo-title" className="label">데모로 둘러보기</h2>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn" onClick={() => onDemo("user")}>일반 사용자로</button>
              <button type="button" className="btn" onClick={() => onDemo("admin")}>관리자로</button>
            </div>
            <p className="text-[0.78rem] text-muted">비밀번호 없이 들어갑니다. 데모 데이터는 매일 초기화됩니다.</p>
            <p className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs text-muted before:border-t before:border-line after:border-t after:border-line">또는</p>
          </section>
        )}
        <form action={onSubmit} className="grid gap-4">
        <label className="grid gap-1">
          <span className="label">아이디</span>
          <input name="id" autoComplete="username" className={field} />
        </label>
        <label className="grid gap-1">
          <span className="label">비밀번호</span>
          <input name="password" type="password" autoComplete="current-password" className={field}
            aria-invalid={error ? true : undefined} aria-describedby={error ? "login-error" : undefined} />
        </label>
        {error && <p id="login-error" role="alert" className="text-[0.82rem] text-danger">{error}</p>}
          <button type="submit" className="btn btn-primary w-full">로그인</button>
        </form>
        <form action={signInWithGithub}>
          <button type="submit" className="btn w-full">GitHub로 로그인</button>
        </form>
      </div>
    </main>
  );
}