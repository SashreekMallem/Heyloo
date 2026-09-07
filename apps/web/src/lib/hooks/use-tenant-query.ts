"use client";

import { type UseQueryOptions, useQuery } from "@tanstack/react-query";

/** Namespaces every tenant-scoped query key `['tenant', tenantId, resource, ...params]` (FRONTEND_SPEC.md §0.3) — never a bare resource name, so cache collisions across tenants are structurally impossible. */
export function tenantQueryKey(tenantId: string, resource: string, ...params: unknown[]) {
  return ["tenant", tenantId, resource, ...params] as const;
}

export function useTenantQuery<TData>(
  tenantId: string,
  resource: string,
  params: unknown[],
  queryFn: () => Promise<TData>,
  options?: Partial<UseQueryOptions<TData>>,
) {
  return useQuery({
    queryKey: tenantQueryKey(tenantId, resource, ...params),
    queryFn,
    ...options,
  });
}
