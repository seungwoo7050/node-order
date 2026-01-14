"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { exchangeCode } from "@/lib/api-client";
import { endAuthjsSession } from "./actions";

export function ExchangeCode({ code }: { code: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await exchangeCode(code);
        await endAuthjsSession();
        queryClient.clear();
        router.replace("/shop");
      } catch (e) {
        setError(e instanceof Error ? e.message : "알 수 없는 오류");
      }
    })();
  }, [code, router, queryClient]);

  if (error) return <p role="alert" className="alert">로그인을 마무리하지 못했습니다. 다시 시도해 주세요. ({error})</p>;
  return <p role="status" className="text-sm text-muted">로그인을 마무리하는 중입니다.</p>;
}
