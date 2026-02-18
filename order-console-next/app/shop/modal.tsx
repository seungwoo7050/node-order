"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function keepTabInside(e: KeyboardEvent<HTMLDialogElement>) {
  if (e.key !== "Tab") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && (document.activeElement === first || !e.currentTarget.contains(document.activeElement))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

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
      onKeyDown={keepTabInside}
      onClick={(e) => { if (e.target === e.currentTarget) router.back(); }}
    >
      <p className="mb-4 text-right">
        <button type="button" className="btn" onClick={() => router.back()}>닫기</button>
      </p>
      {children}
    </dialog>
  );
}
