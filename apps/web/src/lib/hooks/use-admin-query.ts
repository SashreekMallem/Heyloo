"use client";

import { type UseQueryOptions, useQuery } from "@tanstack/react-query";

/**
 * A failed `/api/admin/*` read. `message` is what `DataState` prints, so it is
 * written for a human (COCKPIT-F17: the raw `admin_query_failed:404` text used
 * to reach the page verbatim); `status` keeps the HTTP code for callers/tests.
 */
export class AdminQueryError extends Error {
  readonly status: number;
  /** `DataState` shows this message (see `UserFacingError`). */
  readonly userFacing = true;

  constructor(status: number) {
    super(adminQueryErrorMessage(status));
    this.name = "AdminQueryError";
    this.status = status;
  }
}

export function adminQueryErrorMessage(status: number): string {
  if (status === 404) return "Not found.";
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You don't have access to this.";
  if (status === 400 || status === 422) return "That request isn't valid.";
  if (status === 501) return "This isn't set up for this deployment yet.";
  return "Something went wrong. Please retry.";
}

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
      if (!res.ok) throw new AdminQueryError(res.status);
      return (await res.json()) as TData;
    },
    refetchInterval: 60_000,
    ...options,
  });
}
