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
