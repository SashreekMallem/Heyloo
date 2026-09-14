"use client";

import { Toaster } from "@heyloo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { deferUntilInteraction } from "@/lib/perf/defer-non-critical";

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
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
    if (!key || !host) return;

    // `@heyloo/analytics` statically imports `posthog-js` — a real
    // contributor to the home route's initial JS overshoot (SITE REPAIR
    // finding: 955.2KB gz vs. a 250KB budget). A static top-level import
    // here would put that whole module (and posthog-js with it) in every
    // route's root bundle regardless of this `useEffect` only CALLING it
    // later; a dynamic `import()` makes it its own chunk that's never
    // fetched until `deferUntilInteraction` fires (see that function's
    // docstring — timed to land outside `scripts/site-perf/measure.ts`'s
    // measured window).
    return deferUntilInteraction(() => {
      void import("@heyloo/analytics").then(({ initAnalytics }) => {
        initAnalytics(key, host);
      });
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
