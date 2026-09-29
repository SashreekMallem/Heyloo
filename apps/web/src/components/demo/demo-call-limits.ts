/**
 * Limits on a public demo call. `DEMO_CALL_MAX_MS` mirrors `DEMO_MAX_CALL_MS`
 * in `supabase/functions/api-demo-agent/handler.ts`, which hands the same
 * number to Retell as `max_call_duration_ms` (Retell itself ends the call).
 * The browser hangs up `DEMO_CALL_MARGIN_MS` earlier so a visitor sees a
 * countdown and a clean "time's up", not a cut-off mid-sentence.
 */
export const DEMO_CALL_MAX_MS = 120_000;
export const DEMO_CALL_MARGIN_MS = 4_000;

/** How long the browser lets a demo call run, given the server's ceiling when it sent one. */
export function demoCallLimitMs(serverMaxMs?: number): number {
  const ceiling = serverMaxMs && serverMaxMs > 0 ? serverMaxMs : DEMO_CALL_MAX_MS;
  return Math.max(10_000, ceiling - DEMO_CALL_MARGIN_MS);
}
