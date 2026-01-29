import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { headers } from "next/headers";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt", maxAge: 5 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async jwt({ token, account }) {
      if (account?.provider === "github" && account.access_token) {
        const forwardedFor = (await headers()).get("x-forwarded-for");
        const res = await fetch(`${API_URL}/auth/github`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}) },
          body: JSON.stringify({ accessToken: account.access_token }),
        });
        if (!res.ok) throw new Error(`백엔드가 GitHub 로그인을 거절했습니다(${res.status})`);
        token.exchangeCode = ((await res.json()) as { code: string }).code;
      }
      return token;
    },
    session({ session, token }) {
      session.exchangeCode = token.exchangeCode;
      return session;
    },
  },
});
