import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUTBOUND_DELIVERY_STATUSES, OUTBOUND_EVENT_TYPES } from "../schemas/outbound-webhooks.ts";

// OUTBOUND-1: the migration was exercised against a throwaway Postgres 16
// (stubbed tenants/bookings/orders/call_logs + a Vault stub with the verified
// signatures; see docs/BUILD_NOTES.md). This pins the properties that matter
// so a later CREATE OR REPLACE / edit cannot silently drop them.
const sql = readFileSync(
  new URL("../../../migrations/20261009120000_outbound_webhooks.sql", import.meta.url),
  "utf8",
);

function fn(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("$$;", start));
}

describe("20261009120000_outbound_webhooks.sql", () => {
  it("enables RLS with a tenant-or-platform-admin SELECT policy and no write policy", () => {
    for (const table of ["outbound_destinations", "outbound_events", "outbound_deliveries"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(
        `create policy ${table}_select on public.${table} for select\n  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());`,
      );
      expect(sql).toContain(
        `revoke insert, update, delete, truncate on public.${table} from authenticated, anon;`,
      );
      expect(sql).toContain(`revoke select on public.${table} from anon;`);
      expect(sql).not.toMatch(
        new RegExp(`create policy \\w+ on public\\.${table} for (insert|update|delete|all)`),
      );
    }
  });

  it("never lets tenant sessions read the Vault secret id", () => {
    expect(sql).toContain("revoke select on public.outbound_destinations from authenticated;");
    const grant = sql.slice(
      sql.indexOf("grant select ("),
      sql.indexOf("to authenticated;", sql.indexOf("grant select (")),
    );
    expect(grant).toContain("last_error");
    expect(grant).not.toContain("signing_secret_id");
  });

  it("keeps the DB checks in step with the contract's event types and statuses", () => {
    for (const type of OUTBOUND_EVENT_TYPES) expect(sql).toContain(`'${type}'`);
    for (const status of OUTBOUND_DELIVERY_STATUSES) expect(sql).toContain(`'${status}'`);
    expect(sql).toContain("unique (destination_id, event_id)");
    expect(sql).toContain(
      "references public.outbound_destinations (id, tenant_id) on delete cascade",
    );
    expect(sql).toContain("references public.outbound_events (id, tenant_id) on delete cascade");
  });

  it("makes every privileged function SECURITY DEFINER with an empty search_path", () => {
    for (const name of [
      "fn_outbound_secret_create",
      "fn_outbound_secret_rotate",
      "fn_outbound_secret_read",
      "fn_outbound_destination_drop_secret",
      "fn_outbound_enqueue",
      "fn_outbound_on_booking",
      "fn_outbound_on_order",
      "fn_outbound_on_call_log",
    ]) {
      expect(fn(name), name).toMatch(/security definer\s+set search_path = ''/);
    }
  });

  it("keeps every function it creates away from browser roles (SEC-14: no anon-callable definer)", () => {
    for (const signature of [
      "fn_outbound_secret_create(text)",
      "fn_outbound_secret_rotate(uuid, text)",
      "fn_outbound_secret_read(uuid)",
      "fn_outbound_enqueue(uuid, text, text, uuid)",
      "fn_outbound_on_booking()",
      "fn_outbound_on_order()",
      "fn_outbound_on_call_log()",
      "fn_outbound_destination_drop_secret()",
      "fn_outbound_destinations_limit()",
    ]) {
      expect(sql).toContain(
        `revoke execute on function public.${signature} from public, anon, authenticated;`,
      );
    }
    // The helpers only ever touch secrets this feature created.
    expect(fn("fn_outbound_secret_read")).toContain("like 'outbound\\_webhook\\_%'");
    expect(fn("fn_outbound_secret_rotate")).toContain("like 'outbound\\_webhook\\_%'");
    expect(fn("fn_outbound_destination_drop_secret")).toContain("like 'outbound\\_webhook\\_%'");
    expect(fn("fn_outbound_secret_create")).toContain("'outbound_webhook_' || gen_random_uuid()");
  });

  it("skips test rows, never fails the business write, and does no HTTP", () => {
    expect(sql).toContain("when (new.is_test is not true)");
    expect(sql).toContain("when (new.is_test_call is not true and new.message_text is not null)");
    for (const name of [
      "fn_outbound_on_booking",
      "fn_outbound_on_order",
      "fn_outbound_on_call_log",
    ]) {
      const body = fn(name);
      expect(body, name).toContain("exception when others then");
      expect(body, name).toContain("raise warning");
    }
    expect(sql).not.toMatch(/net\.http_post|pg_net/);
  });

  it("treats a motel deposit hold as not-yet-real", () => {
    expect(fn("fn_outbound_on_booking")).toContain(
      "not (new.status = 'scheduled' and new.hold_expires_at is not null)",
    );
  });

  it("keeps the existing retention deletes when adding the outbound one", () => {
    const sweep = fn("fn_cron_internal_retention_sweep");
    expect(sweep).toContain(
      "delete from public.webhook_events where created_at < now() - interval '90 days';",
    );
    expect(sweep).toContain(
      "delete from public.tool_health where occurred_at < now() - interval '14 days';",
    );
    expect(sweep).toContain(
      "delete from public.outbound_events where created_at < now() - interval '30 days';",
    );
  });
});
