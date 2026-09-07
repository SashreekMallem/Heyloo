import "server-only";

import { env } from "./env";

/**
 * Fetches a Supabase Edge Function directly (server-side only — the
 * function's own secrets/HMAC never reach the browser, per
 * FRONTEND_STACK.md's "Retell secret never in browser" rule generalized to
 * every provider-touching endpoint). `verify_jwt: false` functions (voice/
 * demo/webhooks) don't need an Authorization header; `verify_jwt: true`
 * ones (admin-*) take the caller's own access token, forwarded by the
 * Route Handler that calls this.
 */
export async function callEdgeFunction<TBody>(
  name: string,
  init: { method: "GET" | "POST" | "PATCH"; body?: unknown; accessToken?: string },
): Promise<{ status: number; body: TBody }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.accessToken) headers["authorization"] = `Bearer ${init.accessToken}`;

  const res = await fetch(`${env.supabaseFunctionsUrl}/${name}`, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const body = (await res.json().catch(() => ({}))) as TBody;
  return { status: res.status, body };
}
