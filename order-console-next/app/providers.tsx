"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { StoreDesignId } from "@/designs/types";
import { ApiError } from "@/lib/api-client";
import { makeTrpcClient, TRPCProvider } from "@/lib/trpc";

const DefaultDesignContext = createContext<StoreDesignId>("editorial-atelier");

export function useDefaultDesign(): StoreDesignId {
  return useContext(DefaultDesignContext);
}

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

export function Providers({
  children,
  defaultDesign = "editorial-atelier",
}: {
  children: ReactNode;
  defaultDesign?: StoreDesignId;
}) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(makeTrpcClient);
  return (
    <DefaultDesignContext.Provider value={defaultDesign}>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          {children}
        </TRPCProvider>
      </QueryClientProvider>
    </DefaultDesignContext.Provider>
  );
}
