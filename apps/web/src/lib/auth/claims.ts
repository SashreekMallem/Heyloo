import { type AppMetadataClaims, extractClaims } from "@heyloo/supabase-client";
import type { User } from "@supabase/supabase-js";

/** Reads the SAME `app_metadata` claims the backend's Custom Access Token Hook sets — one claim source for frontend guards and backend RLS (FRONTEND_SPEC.md §0.1). */
export function claimsFromUser(user: User | null | undefined): AppMetadataClaims {
  if (!user) return {};
  return extractClaims(user.app_metadata);
}

export type Aal = "aal1" | "aal2";

/** Supabase's built-in Authenticator Assurance Level claim (not a custom claim — set by GoTrue itself once an MFA factor is verified). Read from the user's session via `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` at call sites; this type alias just documents the shape. */
export interface AalStatus {
  currentLevel: Aal | null;
  nextLevel: Aal | null;
}
