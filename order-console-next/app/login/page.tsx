"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { login } from "@/lib/api-client";
import { signInWithGithub } from "./actions";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    try {
      await login(String(formData.get("id")), String(formData.get("password")));
      router.push("/shop");
    } catch (e) {
      setError(e instanceof Error ? e.message : "로그인 실패");
    }
  }

  return (
    <main>
      <h1>로그인</h1>
      <form action={onSubmit}>
        <input name="id" placeholder="id" defaultValue="kim" />
        <input name="password" type="password" placeholder="password" />
        <button type="submit">로그인</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <form action={signInWithGithub}>
        <button type="submit">GitHub로 로그인</button>
      </form>
    </main>
  );
}