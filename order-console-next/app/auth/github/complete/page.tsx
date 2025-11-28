import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ExchangeCode } from "./exchange-code";

export default async function GithubCompletePage() {
  const session = await auth();
  if (!session?.exchangeCode) redirect("/login");
  return (
    <main>
      <h1>GitHub 로그인</h1>
      <ExchangeCode code={session.exchangeCode} />
    </main>
  );
}
