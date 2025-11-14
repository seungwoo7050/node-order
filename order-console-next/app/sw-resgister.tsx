"use client"

import { useEffect } from "react";
import { API_URL } from "@/lib/api-client";

export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?api=${encodeURIComponent(API_URL)}`).catch((err) => console.error("서비스 워커 등록 실패:", err));
  }, []);
  return null;
}