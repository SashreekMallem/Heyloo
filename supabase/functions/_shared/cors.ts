/**
 * CORS headers for PUBLIC, token-authenticated edge functions that a browser
 * calls directly (`supabaseBrowserClient.functions.invoke`), e.g. `api-intake`
 * (QA-1 F-05: an OPTIONS preflight used to fall through to the 405 branch
 * with no `Access-Control-Allow-Origin`, so a browser POST could never
 * reach the function).
 *
 * The request Origin is echoed rather than `*` (same choice as
 * `api-text-chat`) because the real access boundary is the opaque
 * single-use token in the path, not CORS, and no credentialed (cookie)
 * request is ever made. Allowed request headers are the ones
 * supabase-js's `functions.invoke` sends: `authorization`, `apikey`,
 * `content-type`, `x-client-info`.
 */
export function publicCorsHeaders(
  req: Request,
  methods = "GET, POST, OPTIONS",
): Record<string, string> {
  return {
    "access-control-allow-origin": req.headers.get("origin") ?? "*",
    "access-control-allow-methods": methods,
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
