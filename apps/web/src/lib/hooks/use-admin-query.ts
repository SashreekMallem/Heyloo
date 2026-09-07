"use client";

import { type UseQueryOptions, useQuery } from "@tanstack/react-query";

/** `['admin', resource, ...params]` query keys (FRONTEND_SPEC.md §0.3) + the shared 60s poll default for the no-realtime admin cockpit. */
export function useAdminQuery<TData>(
  resource: string,
  params: unknown[],
  path: string,
  options?: Partial<UseQueryOptions<TData>>,
) {
  return useQuery<TData>({
    queryKey: ["admin", resource, ...params],
    queryFn: async () => {
      const res = await fetch(`/api/admin/${path}`);
      if (!res.ok) throw new Error(`admin_query_failed:${res.status}`);
      return (await res.json()) as TData;
    },
    refetchInterval: 60_000,
    ...options,
  });
}
