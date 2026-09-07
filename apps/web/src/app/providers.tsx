"use client";

import { initAnalytics } from "@heyloo/analytics";
import { Toaster } from "@heyloo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

/**
 * TanStack Query client (module-instance-per-tab via `useState` lazy init,
 * the documented Next.js App Router pattern — never a module-scope
 * singleton, which would leak state across users on the server) + the
 * shared `<Toaster>` (FRONTEND_SPEC.md §9.4).
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
      initAnalytics(process.env.NEXT_PUBLIC_POSTHOG_KEY, process.env.NEXT_PUBLIC_POSTHOG_HOST);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
