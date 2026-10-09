/**
 * The tenant-facing Integrations surface (FRONTEND_AUDIT/E2E_FLOWS_AUDIT
 * Flow 9/10 gap — "no 'Connect <adapter>' UI in the tenant dashboard at
 * all") is a thin, tenant-scoped proxy in front of the REAL
 * `api-adapter-connect` edge function (BACKEND_SPEC §7.6) — this file just
 * mirrors that function's own OWN request contract (`schema.ts`) so this
 * cluster's routes stay in lockstep with it without importing across the
 * Deno/Node boundary (same split every other `supabase/functions` seam
 * documents, e.g. `api/checkout/session/build-request.ts`).
 */
export const OAUTH_PROVIDERS = ["square", "google_calendar"] as const;
export const PASTE_KEY_PROVIDERS = ["shopmonkey", "ezyvet"] as const;
export const ADAPTER_PROVIDERS = [...OAUTH_PROVIDERS, ...PASTE_KEY_PROVIDERS] as const;
export type AdapterProvider = (typeof ADAPTER_PROVIDERS)[number];

export const ADAPTER_DISPLAY_NAMES: Record<AdapterProvider, string> = {
  square: "Square",
  google_calendar: "Google Calendar",
  shopmonkey: "Shopmonkey",
  ezyvet: "ezyVet",
};

export function isOAuthProvider(provider: string): provider is (typeof OAUTH_PROVIDERS)[number] {
  return (OAUTH_PROVIDERS as readonly string[]).includes(provider);
}

export function isPasteKeyProvider(
  provider: string,
): provider is (typeof PASTE_KEY_PROVIDERS)[number] {
  return (PASTE_KEY_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * CONNECT-SAFE-1: providers whose sync is not proven end to end, so a new
 * connection is not offered (the connect route answers 409
 * `provider_coming_soon`). Square pushes silently do nothing (the OAuth
 * callback never stores the `locationId` they need); none of the four has
 * run against a live account (docs/VERIFY.md T7); ezyVet's connect sent our
 * partner secret to a tenant-typed host. An EXISTING connection stays
 * visible and can still be disconnected. Remove a provider once it works.
 */
export const COMING_SOON_PROVIDERS: ReadonlySet<AdapterProvider> = new Set<AdapterProvider>([
  "square",
  "google_calendar",
  "shopmonkey",
  "ezyvet",
]);

export function isComingSoon(provider: string): boolean {
  return (COMING_SOON_PROVIDERS as ReadonlySet<string>).has(provider);
}

/** What `api-adapter-connect` writes to `last_error` when the owner disconnects on purpose. */
export const TENANT_DISCONNECT_SENTINEL = "tenant-initiated disconnect";

export type ConnectionDisplayStatus = "connected" | "disconnected" | "error";

/**
 * CONNECT-SAFE-1: no writer ever sets `status = 'error'`; a revoked or failing
 * connection is written as `disconnected` plus a `last_error` reason (worker
 * refresh failures, the POS `auth_revoked` webhook). Shown as "Needs
 * reconnect" so the owner learns sync stopped. The owner's own disconnect
 * carries the sentinel reason and stays a plain "Not connected".
 */
export function connectionDisplayStatus(
  row: { status: string; last_error: string | null } | undefined,
): ConnectionDisplayStatus {
  if (!row) return "disconnected";
  if (row.status === "connected") return "connected";
  if (row.status === "error") return "error";
  if (row.last_error && row.last_error !== TENANT_DISCONNECT_SENTINEL) return "error";
  return "disconnected";
}

/** Same popup-postMessage contract every OAuth-connect popup in this app
 * uses (`airtable/shared.ts`'s `popupResultHtml`, kept function-local here
 * for the same reason `session.ts` does) — a distinct `source` tag
 * (`heyloo-adapter-oauth`) so a listener can tell this popup family apart
 * from Airtable's. */
export function popupResultHtml(payload: {
  ok: boolean;
  provider?: string;
  error?: string;
}): string {
  const json = JSON.stringify(payload).replaceAll("<", "\\u003c");
  return `<!doctype html><html><body><script>
    if (window.opener) {
      window.opener.postMessage(
        Object.assign({ source: "heyloo-adapter-oauth" }, ${json}),
        window.location.origin
      );
    }
    window.close();
  </script></body></html>`;
}

export function htmlResponseInit(status = 200): ResponseInit {
  return { status, headers: { "content-type": "text/html" } };
}

/**
 * `packages/supabase-client/src/database.types.ts` (generated types)
 * predates `adapter_connections` entirely (docs/audit/FIX_REQUESTS.md
 * already flags this against the same table for the Airtable delivery
 * routes) — same untyped-escape-hatch pattern as
 * `api/tenant/delivery/airtable/shared.ts`'s own `untypedTable`, kept
 * function-local rather than importing across cluster ownership.
 */
// biome-ignore lint/suspicious/noExplicitAny: generated-types drift escape hatch, see docstring above.
export function untypedTable(client: unknown, table: string): any {
  return (client as { from: (table: string) => unknown }).from(table);
}
