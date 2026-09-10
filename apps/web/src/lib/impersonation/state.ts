/**
 * Admin impersonation client-side state (FRONTEND_SPEC.md §7.2,
 * FRONTEND_AUDIT.md H8). The admin cockpit's "Start impersonation" mints a
 * real Supabase magic link scoped to the tenant owner's own account
 * (`admin/handler.ts`'s `POST /admin-tenants/:id/impersonate` —
 * `generateMagicLink`) and opens it in a NEW browser tab, so the resulting
 * `/dashboard` session is a genuinely real, independently-authenticated
 * session — never a simulated one. `localStorage` is same-origin-shared
 * across tabs (both `/cockpit` and `/dashboard` are served from this one
 * Next.js app's origin), so this module writes the impersonation banner's
 * display state there for the NEW tab to read on mount.
 *
 * `editMode` here is a DISPLAY mirror of the real, server-enforced state —
 * not the source of truth. The actual boundary is `impersonation_sessions.
 * edit_enabled` (`supabase/migrations/20260910110000_impersonation_claim.
 * sql`): `custom_access_token_hook` stamps it into the JWT's `app_metadata`
 * as `impersonated_by`/`impersonation_edit_enabled`, and every tenant-write
 * RLS policy requires `not fn_jwt_is_impersonating() or
 * fn_jwt_impersonation_edit_enabled()`. `setEditMode` below is called ONLY
 * after the "Enable edits" toggle's `POST .../impersonate/edit-mode` call
 * actually succeeds (`use-impersonation-banner.tsx`'s `onToggleEdit`) — it
 * must never be called optimistically, or this display value would drift
 * from what RLS actually allows.
 */
const STORAGE_KEY = "heyloo_impersonation";

export interface ImpersonationState {
  tenantId: string;
  tenantName: string;
  adminEmail: string;
  expiresAt: string;
  editMode: boolean;
}

export function startImpersonation(state: ImpersonationState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing / storage blocked — the new tab simply won't show a
    // banner; the real session and the audit trail are unaffected.
  }
}

export function readImpersonationState(tenantId: string): ImpersonationState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImpersonationState;
    if (parsed.tenantId !== tenantId) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setEditMode(tenantId: string, editMode: boolean): ImpersonationState | null {
  const current = readImpersonationState(tenantId);
  if (!current) return null;
  const next = { ...current, editMode };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignored — see startImpersonation
  }
  return next;
}

export function clearImpersonation(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignored — see startImpersonation
  }
}
