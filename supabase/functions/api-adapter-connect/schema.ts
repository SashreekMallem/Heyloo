import { z } from "zod";

/**
 * `/api-adapter-connect` request (BACKEND_SPEC §7.6/task item 3 — "OAuth
 * initiate/callback for OAuth adapters; paste-key validation for key-based
 * ones"). The authenticated user's id comes from the verified JWT
 * (`verify_jwt: true`), never trusted from the body; their tenant_id is
 * resolved server-side from `memberships` (owner/admin only — a `member`
 * role cannot connect/disconnect integrations, matching BACKEND_SPEC §11.1's
 * role scoping).
 */
export const OAUTH_PROVIDERS = ["square", "google_calendar"] as const;
export const PASTE_KEY_PROVIDERS = ["shopmonkey", "ezyvet"] as const;
export const ADAPTER_PROVIDERS = [...OAUTH_PROVIDERS, ...PASTE_KEY_PROVIDERS] as const;

// NOTE: `z.discriminatedUnion` requires every variant's discriminator value
// to be unique across the WHOLE array — it can't disambiguate the two
// `action: "paste_key"` variants below by their different `provider`
// literal (zod v4 throws "Duplicate discriminator value" at schema-build
// time, not at parse time, so this isn't a runtime edge case to guard
// against — it simply cannot be a discriminatedUnion). A plain `z.union`
// trades the discriminated union's fast-path dispatch for correctness here;
// this endpoint's request volume (tenant-initiated connect actions) never
// remotely approaches where that would matter.
export const AdapterConnectRequestSchema = z.union([
  z.object({
    action: z.literal("initiate"),
    provider: z.enum(OAUTH_PROVIDERS),
  }),
  z.object({
    action: z.literal("callback"),
    provider: z.enum(OAUTH_PROVIDERS),
    code: z.string().min(1),
    state: z.string().min(1),
  }),
  z.object({
    action: z.literal("paste_key"),
    provider: z.literal("shopmonkey"),
    api_key: z.string().min(1),
  }),
  z.object({
    action: z.literal("paste_key"),
    provider: z.literal("ezyvet"),
    base_url: z.string().url(),
  }),
  z.object({
    action: z.literal("disconnect"),
    provider: z.enum(ADAPTER_PROVIDERS),
  }),
]);

export type AdapterConnectRequest = z.infer<typeof AdapterConnectRequestSchema>;
