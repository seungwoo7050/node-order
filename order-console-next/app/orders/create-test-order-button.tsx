"use client";

import { useState } from "react";
import { createTestOrder } from "./actions";

export function CreateTestOrderButton() {
  const [result, setResult] = useState<string | null>(null);

  return (
    <div>
      <button
        onClick={async () => {
          try {
            const order = await createTestOrder();
            setResult(`생성됨: #${order.id} ${order.user}`);
          } catch (e) {
            setResult(e instanceof Error ? e.message : "실패");
          }
        }}
      >
        테스트 주문 만들기
      </button>
      {result && <p>{result}</p>}
    </div>
  );
}
