"use client";

import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

export function OnlineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
  <p role="status" data-testid="offline-banner" className="border-y border-line bg-notice py-3 text-sm">
    <span className="page block">연결이 끊겼습니다. 마지막으로 받은 내용을 보여 주며, 다시 연결될 때까지 결제할 수 없습니다.</span>
  </p>
  );
}