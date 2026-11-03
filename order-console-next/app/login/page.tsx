"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { ApiError, demoEnabled, demoLogin, login } from "@/lib/api-client";
import { signInWithGithub } from "./actions";
import { OAuthError } from "./oauth-error";

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

  const [idValue, setIdValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const field = "border-0 border-b border-line-strong bg-transparent py-2 font-light aria-invalid:border-danger";

  return (
    <main className="page flex-1 pb-12">
      <div className="mx-auto mt-8 grid max-w-[340px] gap-4">
        <h1 className="title mb-2">로그인</h1>
        {demo && (
          <section aria-labelledby="demo-title" className="grid gap-2.5">
            <h2 id="demo-title" className="label">데모로 둘러보기 (읽기 전용)</h2>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn" onClick={() => onDemo("user")}>일반 사용자로</button>
              <button type="button" className="btn" onClick={() => onDemo("admin")}>관리자로</button>
            </div>
            <p className="text-[0.78rem] text-muted">누를 때마다 임시 데모 계정을 새로 만듭니다. 데모 관리자는 조회만 가능하며 24시간 뒤 지워집니다.</p>

            <div className="mt-1 border border-line bg-neutral-50/80 p-3 text-xs leading-relaxed" data-testid="real-admin-guide">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-semibold text-fg">실제 관리자 계정 (Full CRUD 권한)</span>
                <button
                  type="button"
                  onClick={() => {
                    setIdValue("kim");
                    setPasswordValue("1234");
                  }}
                  className="border border-line-strong bg-bg px-2 py-0.5 text-[11px] font-medium text-fg hover:bg-neutral-100 transition cursor-pointer"
                >
                  kim / 1234 채우기
                </button>
              </div>
              <p className="font-mono text-[11px] text-fg">
                ID: <strong>kim</strong> · PW: <strong>1234</strong>
                <span className="ml-2 text-muted">(일반 회원: lee, park, choi / 1234)</span>
              </p>
              <p className="mt-1 text-[11px] text-muted">
                상품·카테고리·쿠폰·상점 설정 등 실제 DB 추가·수정·삭제가 모두 가능하며, 매일 새벽 04:05(KST) 백업 후 초기 시드 상태로 자동 리셋됩니다.
              </p>
            </div>

            <p className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs text-muted before:border-t before:border-line after:border-t after:border-line">또는</p>
          </section>
        )}
        <form action={onSubmit} className="grid gap-4">
        <label className="grid gap-1">
          <span className="label">아이디</span>
          <input
            name="id"
            autoComplete="username"
            value={idValue}
            onChange={(e) => setIdValue(e.target.value)}
            className={field}
          />
        </label>
        <label className="grid gap-1">
          <span className="label">비밀번호</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={passwordValue}
            onChange={(e) => setPasswordValue(e.target.value)}
            className={field}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
        </label>
        {error && <p id="login-error" role="alert" className="text-[0.82rem] text-danger">{error}</p>}
          <button type="submit" className="btn btn-primary w-full">로그인</button>
        </form>
        {/* useSearchParams는 Suspense 안에서 읽어야 정적 프리렌더가 막히지 않는다 */}
        <Suspense fallback={null}>
          <OAuthError />
        </Suspense>
        <form action={signInWithGithub}>
          <button type="submit" className="btn w-full">GitHub로 로그인</button>
        </form>
        <div className="mt-4 flex justify-between text-xs text-muted">
          <a href="/signup" className="underline hover:text-fg" data-testid="signup-link">
            회원가입
          </a>
          <a href="/guest/orders" className="underline hover:text-fg" data-testid="guest-orders-link">
            비회원 주문 조회
          </a>
        </div>
      </div>
    </main>
  );
}