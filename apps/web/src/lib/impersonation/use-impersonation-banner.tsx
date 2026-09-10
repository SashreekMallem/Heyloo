"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import {
  clearImpersonation,
  type ImpersonationState,
  readImpersonationState,
  setEditMode,
} from "./state";

/**
 * Hook for the TENANT app tree to render `ImpersonationBanner`
 * (`@heyloo/ui`) when the current session was opened via an admin
 * impersonation link. Cluster-C-owned primitive — see
 * docs/audit/FIX_REQUESTS.md for the exact mount contract requested in the
 * `(tenant)` layout (cluster D's file).
 *
 * Usage:
 * ```tsx
 * const impersonation = useImpersonationBanner(tenant.id);
 * {impersonation && (
 *   <ImpersonationBanner
 *     tenantName={tenant.name}
 *     adminEmail={impersonation.adminEmail}
 *     expiresAt={impersonation.expiresAt}
 *     editMode={impersonation.editMode}
 *     onEnd={impersonation.onEnd}
 *     onToggleEdit={impersonation.onToggleEdit}
 *   />
 * )}
 * ```
 */
export function useImpersonationBanner(
  tenantId: string,
): (ImpersonationState & { onEnd: () => void; onToggleEdit: () => void }) | null {
  // Lazy initializer reads the browser-only localStorage flag exactly once
  // per mount (never during SSR — `readImpersonationState` catches the
  // `localStorage is not defined` reference error there and returns null),
  // avoiding a setState-inside-effect render cascade for what is a plain
  // synchronous read, not an external-system subscription.
  const [state, setState] = useState<ImpersonationState | null>(() =>
    readImpersonationState(tenantId),
  );

  const onEnd = useCallback(() => {
    clearImpersonation();
    setState(null);
    void fetch(`/api/admin/admin-tenants/${tenantId}/impersonate-end`, { method: "POST" }).catch(
      () => {
        // Best-effort second audit entry — signing out below is the real
        // end of the session regardless of whether this call lands.
      },
    );
    void supabaseBrowserClient.auth.signOut().then(() => {
      window.location.href = "/login";
    });
  }, [tenantId]);

  // Real server call, not an optimistic flip — `impersonation_sessions.
  // edit_enabled` (supabase/migrations/20260910110000_impersonation_claim.
  // sql) is what every tenant-write RLS policy actually checks, so the
  // locally-displayed `editMode` only ever changes once the server confirms
  // it. A failure (e.g. this proxy 403ing — see docs/BUILD_NOTES.md's
  // "Repair — Impersonation server-enforced read-only/edit boundary" entry
  // for the known cross-tab-cookie cause) surfaces a toast instead of
  // silently pretending edits are now allowed.
  const onToggleEdit = useCallback(() => {
    void fetch(`/api/admin/admin-tenants/${tenantId}/impersonate/edit-mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
      .then((res) => {
        if (!res.ok) {
          toast.error("Couldn't enable edits — please try again.");
          return;
        }
        const next = setEditMode(tenantId, true);
        if (next) setState(next);
      })
      .catch(() => {
        toast.error("Couldn't enable edits — please try again.");
      });
  }, [tenantId]);

  if (!state) return null;
  return { ...state, onEnd, onToggleEdit };
}
