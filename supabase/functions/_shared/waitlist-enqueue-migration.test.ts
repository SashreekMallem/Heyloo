import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// NUMBERS-1: the SQL itself was exercised against a throwaway Postgres 16
// (see docs/BUILD_NOTES.md); this guards the properties that matter so a
// later CREATE OR REPLACE cannot silently drop them.
const sql = readFileSync(
  new URL("../../migrations/20260929163000_waitlist_notify_enqueue.sql", import.meta.url),
  "utf8",
);

describe("fn_notify_waitlist_on_cancellation migration", () => {
  it("inserts the waitlist message as 'queued' and enqueues it on the outbound queue", () => {
    expect(sql).toContain("'queued'");
    expect(sql).toContain("pgmq.send");
    expect(sql).toContain("'messages_outbound_queue'");
    expect(sql).toContain("returning id into v_message_id");
  });

  it("is SECURITY DEFINER with an empty search_path and only schema-qualified references", () => {
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
    expect(sql).not.toMatch(/\bfrom (waitlist_entries|customers)\b/);
  });

  it("only ever messages a customer of the cancelled booking's own tenant", () => {
    expect(sql).toContain("c.tenant_id = new.tenant_id");
  });
});
