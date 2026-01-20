"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "./auth-store";
import { useTRPC } from "./trpc";

export function useProfile() {
  const trpc = useTRPC();
  const loggedIn = useAuthStore((s) => s.accessToken !== null);
  return useQuery({ ...trpc.me.profile.queryOptions(), enabled: loggedIn });
}

export function useIsAdmin() {
  const loggedIn = useAuthStore((s) => s.accessToken !== null);
  const { data } = useProfile();
  return loggedIn && data?.role === "admin";
}
