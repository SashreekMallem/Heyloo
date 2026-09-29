"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

interface TenantContextValue {
  tenantId: string;
  /** Owner/admin (or an impersonating platform admin) — the roles the RLS write policies and `requireTenantWriter` accept. */
  canWrite: boolean;
  /** The account owner specifically — team invites are owner-only in the backend (`api-team-invite`), stricter than `canWrite`. */
  isOwner: boolean;
}

const TenantContext = createContext<TenantContextValue | null>(null);

/**
 * Client-side access to the current tenant id (set once by the (tenant) layout server component, threaded down through `TenantShellClient`) — every client-component page under `/dashboard` reads this instead of re-fetching the session.
 *
 * QA-1 (F-5/SEC-07/AUTH-15): also carries `canWrite`, derived from the JWT's `role` claim in the layout, so settings pages can render read-only for a `member`. It is a UX hint only — RLS and `requireTenantWriter` stay the authority. Defaults to `true` so a provider mounted without it (tests, previews) behaves as before.
 */
export function TenantIdProvider({
  tenantId,
  canWrite = true,
  isOwner = canWrite,
  children,
}: {
  tenantId: string;
  canWrite?: boolean;
  isOwner?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ tenantId, canWrite, isOwner }), [tenantId, canWrite, isOwner]);
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useCurrentTenantId(): string | null {
  return useContext(TenantContext)?.tenantId ?? null;
}

/** False for a signed-in `member`: settings pages render read-only with {@link READ_ONLY_MESSAGE}. */
export function useCanWriteSettings(): boolean {
  return useContext(TenantContext)?.canWrite ?? true;
}

/** True only for the account owner (the sole role allowed to invite teammates). */
export function useIsTenantOwner(): boolean {
  return useContext(TenantContext)?.isOwner ?? true;
}

export const READ_ONLY_MESSAGE =
  "Only your account owner or an admin can change this. Ask them to update it for you.";
