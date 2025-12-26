"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api-client";
import { makeTrpcClient, TRPCProvider } from "@/lib/trpc";

function isUnauthorized(error: unknown) {
  if (error instanceof ApiError) return error.status === 401;
  if (error instanceof TRPCClientError) return error.data?.httpStatus === 401;
  return false;
}

let browserQueryClient: QueryClient | undefined;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => !isUnauthorized(error) && failureCount < 1,
      },
    },
  });
}

function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(makeTrpcClient);
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}

