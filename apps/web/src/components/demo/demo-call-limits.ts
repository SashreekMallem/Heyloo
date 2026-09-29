/**
 * Limits on a public demo call (DEMO-2: 30 seconds). `DEMO_CALL_MAX_MS`
 * mirrors `DEMO_MAX_CALL_MS` in `supabase/functions/api-demo-agent/handler.ts`,
 * which the edge function returns as `max_call_ms`. The browser is what ends a
 * normal call: it hangs up `DEMO_CALL_MARGIN_MS` before the ceiling (at 28 s),
 * so a visitor sees a countdown from 0:30 and a clean "time's up", not a
 * cut-off mid-sentence. Retell's own `max_call_duration_ms` can only be set to
 * 60 s or more (docs.retellai.com/api-references/create-web-call), so that is
 * just the backstop for a tab that never hangs up.
 */
export const DEMO_CALL_MAX_MS = 30_000;
export const DEMO_CALL_MARGIN_MS = 2_000;

export interface DemoCallLimits {
  /** The limit the visitor is told about and the countdown starts from. */
  ceilingMs: number;
  /** How long into the call the browser hangs up. */
  hangupMs: number;
}

/**
 * The limits for one call. The server's ceiling is honored when it is lower
 * than ours, never when it is higher: an older edge build that still says 120 s
 * must not stretch a "30 second" demo.
 */
export function demoCallLimits(serverMaxMs?: number): DemoCallLimits {
  const ceiling =
    serverMaxMs && serverMaxMs > 0 ? Math.min(serverMaxMs, DEMO_CALL_MAX_MS) : DEMO_CALL_MAX_MS;
  const ceilingMs = Math.max(10_000, ceiling);
  return { ceilingMs, hangupMs: ceilingMs - DEMO_CALL_MARGIN_MS };
}
