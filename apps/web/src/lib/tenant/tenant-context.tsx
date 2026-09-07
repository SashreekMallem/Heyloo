"use client";

import { createContext, type ReactNode, useContext } from "react";

const TenantContext = createContext<string | null>(null);

/** Client-side access to the current tenant id (set once by the (tenant) layout server component, threaded down through `TenantShellClient`) — every client-component page under `/dashboard` reads this instead of re-fetching the session. */
export function TenantIdProvider({
  tenantId,
  children,
}: {
  tenantId: string;
  children: ReactNode;
}) {
  return <TenantContext.Provider value={tenantId}>{children}</TenantContext.Provider>;
}

export function useCurrentTenantId(): string | null {
  return useContext(TenantContext);
}
