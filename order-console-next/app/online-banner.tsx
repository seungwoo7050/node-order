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
  return <p role="status" data-testid="offline-banner">오프라인 - 마지막으로 받은 내용을 보여 주며 결제는 할 수 없습니다</p>;
}