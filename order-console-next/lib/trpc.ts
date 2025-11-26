import { createTRPCClient, httpBatchLink, splitLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "order-api-nest/trpc";
import { API_URL, fetchWithAuth } from "./api-client";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.path.startsWith("me."),
        true: httpBatchLink({ url: `${API_URL}/trpc`, fetch: (url, init) => fetchWithAuth(String(url), init as RequestInit) }),
        false: httpBatchLink({ url: `${API_URL}/trpc` }),
      }),
    ],
  });
}