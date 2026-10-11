import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CAL-1 / CAL-1b: static guards on the two calendar migrations, so a later
// edit cannot silently drop the properties the code relies on.
const MIGRATIONS = new URL("../../../migrations/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, MIGRATIONS), "utf8");

const BUSY = read("20261011120000_external_busy_blocks.sql");
const WAITLIST_FILE = "20261011120200_waitlist_notify_skips_calendar_busy.sql";
const WAITLIST = read(WAITLIST_FILE);
const PREVIOUS_WAITLIST = read("20260929163000_waitlist_notify_enqueue.sql");

/** The `$$ ... $$` body of the migration's function. */
function functionBody(sql: string): string {
  const start = sql.indexOf("as $$");
  const end = sql.indexOf("$$;", start + 5);
  return sql.slice(start + 5, end);
}

const BUSY_FILTER = `
        and not exists (
          select 1 from public.external_busy_blocks x
          where x.tenant_id = new.tenant_id
            and (x.resource_id is null or x.resource_id = new.resource_id)
            and x.busy && new.during
        )`;

describe("20261011120000_external_busy_blocks.sql (CAL-1b columns)", () => {
  it("adds the push-only request, coverage, backoff and watch-channel columns", () => {
    for (const column of [
      "busy_sync_requested_at timestamptz",
      "busy_synced_at timestamptz",
      "busy_synced_until timestamptz",
      "busy_sync_attempted_at timestamptz",
      "busy_sync_failures integer not null default 0",
      "watch_channel_id text",
      "watch_resource_id text",
      "watch_token_hash text",
      "watch_expires_at timestamptz",
      "watch_failures integer not null default 0",
      "watch_retry_at timestamptz",
    ]) {
      expect(BUSY).toContain(`add column ${column}`);
    }
    expect(BUSY).toContain("check (busy_sync_failures >= 0)");
    expect(BUSY).toContain("check (watch_failures >= 0)");
  });

  it("documents every new adapter_connections column", () => {
    const added = [...BUSY.matchAll(/add column (\w+)/g)].map((m) => m[1]);
    expect(added.length).toBeGreaterThanOrEqual(13);
    for (const column of added) {
      expect(BUSY).toContain(`comment on column public.adapter_connections.${column} is`);
    }
  });

  it("stores only a SHA-256 hex of the channel token (no plaintext token column)", () => {
    expect(BUSY).toContain("watch_token_hash ~ '^[0-9a-f]{64}$'");
    expect(BUSY).not.toMatch(/add column watch_token\b(?!_hash)/);
    // Google's documented channel id limit
    expect(BUSY).toContain("char_length(watch_channel_id) between 1 and 64");
  });

  it("browser roles may read busy_synced_at only — never the watch_* columns or the bookkeeping", () => {
    const grants = BUSY.match(
      /grant select \(([^)]*)\) on public\.adapter_connections to authenticated/g,
    );
    expect(grants).toEqual([
      "grant select (busy_synced_at) on public.adapter_connections to authenticated",
    ]);
    expect(BUSY).not.toMatch(/^grant[^;]*watch_/m);
  });

  it("a notification resolves to at most one connection by its channel id", () => {
    expect(BUSY).toMatch(
      /create unique index uq_adapter_connections_watch_channel on public\.adapter_connections\s+\(watch_channel_id\)\s+where watch_channel_id is not null;/,
    );
  });

  it("existing connected Google connections get one initial read; old disconnects never alert", () => {
    expect(BUSY).toMatch(
      /set busy_sync_requested_at = now\(\)\s+where provider = 'google_calendar' and status = 'connected';/,
    );
    expect(BUSY).toContain("set owner_alerted_at = coalesce(disconnected_at, now())");
  });

  it("documents push-only reads (no periodic cadence left in the comments)", () => {
    expect(BUSY).not.toMatch(/every ~?5 minutes|5-minute cadence|~5 min cadence/);
    expect(BUSY).toContain("never a periodic re-read");
  });
});

describe(`${WAITLIST_FILE} (CAL-1b waitlist filter)`, () => {
  it("is timestamped after 20261011120100 and is the latest migration defining the function", () => {
    const definers = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) =>
        read(f).includes("create or replace function public.fn_notify_waitlist_on_cancellation()"),
      )
      .sort();
    expect(definers.at(-1)).toBe(WAITLIST_FILE);
    expect(WAITLIST_FILE.slice(0, 14) > "20261011120100").toBe(true);
  });

  it("replaces the function with the CURRENT body plus only the busy-block filter", () => {
    const current = functionBody(PREVIOUS_WAITLIST);
    const next = functionBody(WAITLIST);
    expect(next).toContain(BUSY_FILTER);
    expect(next.replace(BUSY_FILTER, "")).toBe(current);
  });

  it("keeps NUMBERS-1's properties (queued insert + enqueue, definer, empty search_path, own tenant)", () => {
    expect(WAITLIST).toMatch(/security definer\s+set search_path = ''/);
    expect(WAITLIST).toContain("'queued'");
    expect(WAITLIST).toContain("pgmq.send");
    expect(WAITLIST).toContain("'messages_outbound_queue'");
    expect(WAITLIST).toContain("c.tenant_id = new.tenant_id");
    expect(WAITLIST).not.toMatch(/\bfrom (waitlist_entries|customers|external_busy_blocks)\b/);
  });

  it("is additive: CREATE OR REPLACE only, the trigger binding is untouched", () => {
    expect(WAITLIST).toContain(
      "create or replace function public.fn_notify_waitlist_on_cancellation()",
    );
    expect(WAITLIST).not.toMatch(/drop (trigger|function)/i);
    expect(WAITLIST).not.toMatch(/create trigger/i);
  });
});
