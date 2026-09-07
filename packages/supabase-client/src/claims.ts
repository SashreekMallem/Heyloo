/**
 * The JWT `app_metadata` claim shape set by the backend's Custom Access
 * Token Hook (supabase/migrations/20260907131400_functions_triggers.sql) —
 * read here by frontend guards/middleware and nowhere else, so there is
 * exactly one definition of "who can see this" (FRONTEND_SPEC.md §0.1,
 * CLAUDE.md Rule 2).
 *
 * Real shape confirmed against the hook (NOT the illustrative role names in
 * FRONTEND_SPEC.md's guard table):
 *  - tenant member:  { tenant_id: string, role: "owner" | "admin" | "member" }
 *  - platform admin: { platform_admin: true }
 *  - referral partner: { referral_partner_id: string }
 * A single user can in principle carry more than one of these (e.g. a
 * platform admin who is also a tenant owner in a test tenant) — route
 * guards check the specific claim their route group needs, not an
 * exclusive "the" role.
 */
export interface AppMetadataClaims {
  tenant_id?: string;
  role?: "owner" | "admin" | "member";
  platform_admin?: boolean;
  referral_partner_id?: string;
}

export type TenantRole = NonNullable<AppMetadataClaims["role"]>;

/** FRONTEND_SPEC §0.1 calls these "tenant_owner"/"tenant_staff" — map onto the real `owner|admin|member` enum here, once, so the mapping isn't reinvented per call site. */
export function isTenantOwner(role: TenantRole | undefined): boolean {
  return role === "owner";
}

export function isTenantStaff(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

export function extractClaims(appMetadata: unknown): AppMetadataClaims {
  if (!appMetadata || typeof appMetadata !== "object") return {};
  const meta = appMetadata as Record<string, unknown>;
  const claims: AppMetadataClaims = {};
  // Bracket notation is required here, not stylistic: tsconfig.base.json's
  // `noPropertyAccessFromIndexSignature` forbids dot access on this
  // `Record<string, unknown>` cast, which otherwise conflicts with Biome's
  // `useLiteralKeys` rule (see docs/BUILD_NOTES.md T5 entry).
  if (typeof meta["tenant_id"] === "string") claims.tenant_id = meta["tenant_id"];
  if (meta["role"] === "owner" || meta["role"] === "admin" || meta["role"] === "member") {
    claims.role = meta["role"];
  }
  if (meta["platform_admin"] === true) claims.platform_admin = true;
  if (typeof meta["referral_partner_id"] === "string") {
    claims.referral_partner_id = meta["referral_partner_id"];
  }
  return claims;
}
