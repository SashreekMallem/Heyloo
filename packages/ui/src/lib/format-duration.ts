/**
 * Call duration for humans: under a minute shows whole seconds ("20s"), else
 * "Xm" / "Xm Ys" ("1m 2s"). The earlier `Math.round(seconds / 60)` rendered a
 * 20-second call as "0m" and a 62-second call as "1m" (QA-1 F-16). Returns an
 * em dash for a missing / invalid value.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
