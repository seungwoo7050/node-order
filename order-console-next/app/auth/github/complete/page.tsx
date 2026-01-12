import { redirect } from "next/navigation";
import { connection } from 'next/server';
import { auth } from "@/auth";
import { ExchangeCode } from "./exchange-code";

export default async function GithubCompletePage() {
  await connection();
  const session = await auth();
  if (!session?.exchangeCode) redirect("/login");
  return (
    <main className="page flex-1 pb-12">
      <h1 className="title mb-8 mt-8">GitHub 로그인</h1>
      <ExchangeCode code={session.exchangeCode} />
    </main>
  );
}
