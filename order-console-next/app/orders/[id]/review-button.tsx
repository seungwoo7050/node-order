"use client";

import { useState } from "react";

export function ReviewButton({ orderId }: { orderId: number }) {
  const [reviewed, setReviewed] = useState(false);
  return (
    <button onClick={() => setReviewed((v) => !v)}>
      {reviewed ? "검토 완료 취소" : "검토 완료로 표시"} (#{orderId})
    </button>
  );
}
