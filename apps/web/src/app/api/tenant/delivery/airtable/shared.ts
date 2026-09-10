import crypto, { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Airtable OAuth2 + PKCE (BACKEND_SPEC §10.3, FRONTEND_SPEC §6.8). Airtable's
 * own developer docs (airtable.com/developers, support.airtable.com) are
 * egress-blocked in this environment (CLAUDE.md Rule 1.2) — endpoints/scopes/
 * token-request shape below are reconstructed from Airtable's public
 * OAuth reference as summarized by third-party integration write-ups
 * (community.airtable.com threads on the /token endpoint's Basic-auth +
 * code_verifier contract, and prismatic.io/docs.arcade.dev's scope lists),
 * NOT read directly from airtable.com — logged in docs/VERIFY.md for
 * confirmation against the live docs before this ships to a real Airtable
 * OAuth app registration.
 */
export const AIRTABLE_AUTHORIZE_URL = "https://airtable.com/oauth2/v1/authorize";
export const AIRTABLE_TOKEN_URL = "https://airtable.com/oauth2/v1/token";
export const AIRTABLE_BASES_URL = "https://api.airtable.com/v0/meta/bases";
export const AIRTABLE_SCOPES = "data.records:read data.records:write schema.bases:read";

/**
 * Meta API "list tables for a base" (AIRTABLE-VERIFY-1 in docs/VERIFY.md
 * extends here) — used once, right after connect, to pick the base's first
 * table as the push target (`adapter_connections.metadata.tableIdOrName`,
 * read by `worker-adapter-push/handler.ts`'s `pushToAirtable`). A real
 * multi-table picker UI is a follow-up (flagged in docs/BUILD_NOTES.md);
 * auto-picking the first table mirrors the existing "auto-connect the one
 * base" behavior below rather than leaving the connection half-configured.
 */
export function airtableTablesUrl(baseId: string): string {
  return `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`;
}

export const AIRTABLE_STATE_COOKIE = "heyloo_airtable_oauth";

export const AirtableTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

export const AirtableBasesResponseSchema = z.object({
  bases: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const AirtableTablesResponseSchema = z.object({
  tables: z.array(z.object({ id: z.string(), name: z.string() })),
});

export function base64url(input: Buffer): string {
  return input.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return base64url(crypto.randomBytes(16));
}

function requireEnv(name: string): string | null {
  return process.env[name] ?? null;
}

export function airtableOAuthConfig(): {
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
} | null {
  const clientId = requireEnv("AIRTABLE_OAUTH_CLIENT_ID");
  const redirectUri = requireEnv("AIRTABLE_OAUTH_REDIRECT_URI");
  if (!clientId || !redirectUri) return null;
  return { clientId, clientSecret: requireEnv("AIRTABLE_OAUTH_CLIENT_SECRET"), redirectUri };
}

export interface AirtableOAuthState {
  tenantId: string;
  state: string;
  verifier: string;
}

function oauthStateSecret(): string {
  const value = process.env["AIRTABLE_OAUTH_STATE_SECRET"];
  if (!value) throw new Error("Missing required env var: AIRTABLE_OAUTH_STATE_SECRET");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", oauthStateSecret()).update(payload).digest("hex");
}

/**
 * Signed, short-lived cookie carrying the in-flight OAuth state + PKCE
 * verifier + the tenant that started the flow (same signed-cookie pattern
 * as `lib/signup/draft-cookie.ts` — avoids needing a dedicated DB table for
 * a few-minutes-lived OAuth handshake).
 */
export function encodeOAuthState(value: AirtableOAuthState): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeOAuthState(cookieValue: string | undefined): AirtableOAuthState | null {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as AirtableOAuthState;
  } catch {
    return null;
  }
}

/**
 * FIX-1: `packages/supabase-client/src/database.types.ts` has since been
 * regenerated (docs/audit/FIX_REQUESTS.md's ask) and now DOES type
 * `adapter_connections`/`airtable_sync_state`/`fn_enqueue_adapter_push`.
 * These two helpers are kept anyway as the narrow boundary this file's
 * routes already call through — swapping every call site to the typed
 * client directly is a mechanical, low-risk follow-up, not done here to
 * keep this integration pass's diff to the actual bug it was fixing
 * (fn_enqueue_message_outbound's service-role gap); every runtime call
 * through these helpers is still the real PostgREST request either way,
 * just untyped at the TS layer.
 */
// biome-ignore lint/suspicious/noExplicitAny: generated-types drift escape hatch, see docstring above.
export function untypedTable(client: unknown, table: string): any {
  return (client as { from: (table: string) => unknown }).from(table);
}

// biome-ignore lint/suspicious/noExplicitAny: generated-types drift escape hatch, see docstring above.
export function untypedRpc(client: unknown, fn: string, args?: unknown): any {
  return (client as { rpc: (fn: string, args?: unknown) => unknown }).rpc(fn, args);
}

export function popupResultHtml(payload: { ok: boolean; error?: string }): string {
  const json = JSON.stringify(payload).replaceAll("<", "\\u003c");
  return `<!doctype html><html><body><script>
    if (window.opener) {
      window.opener.postMessage(
        Object.assign({ source: "heyloo-airtable-oauth" }, ${json}),
        window.location.origin
      );
    }
    window.close();
  </script></body></html>`;
}
