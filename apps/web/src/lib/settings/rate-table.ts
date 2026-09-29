import { formatDollars, parseDollarsToCents } from "./format";

/**
 * SETTINGS-1: the motel rate table as owners think about it — one
 * "Room type: $89" per line — stored as integer cents
 * (`overrides.rate_table[].nightly_rate_cents`, CLAUDE.md Rule 2). The old
 * editor made owners type cents ("Standard: 8900") and silently dropped any
 * line it couldn't parse.
 */

export interface RateEntry {
  room_type: string;
  nightly_rate_cents: number;
}

export function rateTableToText(entries: RateEntry[] | undefined | null): string {
  return (entries ?? [])
    .map((entry) => `${entry.room_type}: ${formatDollars(entry.nightly_rate_cents)}`)
    .join("\n");
}

export function parseRateTable(text: string): { entries: RateEntry[]; errors: string[] } {
  const entries: RateEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0) return;
    const colon = line.lastIndexOf(":");
    const roomType = colon > 0 ? line.slice(0, colon).trim() : "";
    const cents = colon > 0 ? parseDollarsToCents(line.slice(colon + 1)) : null;
    if (!roomType || cents === null) {
      errors.push(`Line ${index + 1}: write it like “Standard: $89”.`);
      return;
    }
    if (seen.has(roomType.toLowerCase())) {
      errors.push(`Line ${index + 1}: “${roomType}” is listed twice.`);
      return;
    }
    seen.add(roomType.toLowerCase());
    entries.push({ room_type: roomType.slice(0, 100), nightly_rate_cents: cents });
  });
  return { entries, errors };
}
