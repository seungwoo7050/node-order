"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { exchangeCode } from "@/lib/api-client";
import { endAuthjsSession } from "./actions";

export function ExchangeCode({ code }: { code: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await exchangeCode(code);
        await endAuthjsSession();
        router.replace("/shop");
      } catch (e) {
        setError(e instanceof Error ? e.message : "알 수 없는 오류");
      }
    })();
  }, [code, router]);

  if (error) return <p role="alert">로그인을 마무리하지 못했습니다: {error}</p>;
  return <p>로그인을 마무리하는 중...</p>;
}
