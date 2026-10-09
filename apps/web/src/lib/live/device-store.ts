/**
 * Per-device live-screen settings and acknowledgements (LIVE-1), kept in
 * `localStorage`. They are conveniences for one counter screen only: every
 * read and write is wrapped because storage can be missing or throw
 * (private mode, blocked site data), and the screen works without it.
 */

const PREFIX = "heyloo.live";
/** Acknowledgements older than this are dropped; the screen only shows the last 24 h. */
const ACK_TTL_MS = 48 * 3_600_000;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the setting just won't survive a reload.
  }
}

export type LivePref = "sound" | "autoPrint";

const PREF_DEFAULTS: Record<LivePref, boolean> = { sound: true, autoPrint: false };

export function readPref(pref: LivePref): boolean {
  const raw = read(`${PREFIX}.${pref}`);
  return raw === null ? PREF_DEFAULTS[pref] : raw === "1";
}

export function writePref(pref: LivePref, value: boolean): void {
  write(`${PREFIX}.${pref}`, value ? "1" : "0");
}

function acksKey(tenantId: string): string {
  return `${PREFIX}.${tenantId}.acks`;
}

/** Acknowledged booking / message keys (e.g. `booking:<id>`) mapped to when they were acknowledged. */
export function readAcks(tenantId: string, now: number = Date.now()): Record<string, number> {
  const raw = read(acksKey(tenantId));
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, at] of Object.entries(parsed)) {
      if (typeof at === "number" && now - at < ACK_TTL_MS) out[key] = at;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeAcks(tenantId: string, acks: Record<string, number>): void {
  write(acksKey(tenantId), JSON.stringify(acks));
}
