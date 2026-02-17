"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => opener?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="product-title"
      className="m-auto max-h-[85vh] w-[min(640px,calc(100%-32px))] overflow-auto border border-line-strong bg-bg p-6 text-fg backdrop:bg-black/40"
      onClose={() => router.back()}
      onClick={(e) => { if (e.target === e.currentTarget) router.back(); }}
    >
      <p className="mb-4 text-right">
        <button type="button" className="btn" onClick={() => router.back()}>닫기</button>
      </p>
      {children}
    </dialog>
  );
}
