import { OWNER_ALERT_KINDS as CANONICAL_KINDS } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import {
  enqueueOwnerAlert,
  enqueueOwnerAlertBestEffort,
  isOwnerAlertTemplate,
  OWNER_ALERT_TEMPLATE_BY_KIND,
} from "./owner-alerts.ts";
import { OWNER_ALERT_KINDS } from "./providers/messaging/types.ts";
import { renderTemplate } from "./templates.ts";
import type { Logger, SqlClient } from "./types.ts";

type Call = { text: string; values: unknown[] };

function makeSql(fixtures: Record<string, unknown[] | Error>): { sql: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key))
        return rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const CONTACT = {
  "public.agent_configs ac": [
    { transfer_number: "+15550001111", delivery: null, owner_email: "o@example.com" },
  ],
  "insert into public.messages_outbound": [{ id: "alert-1" }],
};

const errors: unknown[][] = [];
const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: (...a: unknown[]) => {
    errors.push(a);
  },
};

describe("owner alert kinds", () => {
  it("new_order is a kind on both sides of the canonical mirror, with a template that names the total and items", () => {
    expect(CANONICAL_KINDS).toContain("new_order");
    expect([...OWNER_ALERT_KINDS]).toEqual([...CANONICAL_KINDS]);
    expect(OWNER_ALERT_TEMPLATE_BY_KIND.new_order).toBe("owner_new_order");
    expect(isOwnerAlertTemplate("owner_new_order")).toBe(true);
    const rendered = renderTemplate("owner_new_order", {
      caller_name: "Jordan",
      caller_phone: "+15551234567",
      fulfillment_type: "dine_in",
      items_summary: "2x Burger",
      total_cents: 2450,
    });
    expect(rendered.subject).toBe("New order from Jordan");
    expect(rendered.body).toBe(
      "New order from Jordan (+15551234567) for dine-in: 2x Burger — total $24.50.",
    );
  });

  it("a new booking alert can carry a deposit note", () => {
    expect(
      renderTemplate("owner_new_booking", {
        caller_name: "Jordan",
        start_local: "Thu, Oct 1, 2:00 PM",
        note: "awaiting deposit",
      }).body,
    ).toBe("New booking from Jordan on Thu, Oct 1, 2:00 PM (awaiting deposit).");
  });
});

describe("enqueueOwnerAlert idempotency scope", () => {
  it("scopes the duplicate check to the booking when one is given, so two bookings on one call each alert", async () => {
    const { sql, calls } = makeSql(CONTACT);
    await enqueueOwnerAlert(sql, {
      tenantId: "t1",
      kind: "new_booking",
      payload: {},
      relatedCallId: "call-1",
      relatedBookingId: "booking-2",
    });
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.text).toContain("mo.related_booking_id");
    expect(insert?.values).toEqual(expect.arrayContaining(["call-1", "booking-2"]));
  });

  it("scopes it to the order for an order alert and to the call otherwise", async () => {
    const { sql, calls } = makeSql(CONTACT);
    await enqueueOwnerAlert(sql, {
      tenantId: "t1",
      kind: "new_order",
      payload: {},
      relatedCallId: "call-1",
      relatedOrderId: "order-1",
    });
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.values).toEqual(expect.arrayContaining(["order-1", "owner_new_order"]));
    expect(insert?.text).toContain("mo.related_order_id");
    expect(insert?.text).toContain("mo.related_call_id");
  });

  it("returns null and enqueues nothing when the insert is suppressed as a duplicate", async () => {
    const { sql, calls } = makeSql({ ...CONTACT, "insert into public.messages_outbound": [] });
    expect(
      await enqueueOwnerAlert(sql, {
        tenantId: "t1",
        kind: "new_booking",
        payload: {},
        relatedBookingId: "booking-1",
      }),
    ).toBeNull();
    expect(calls.some((c) => c.text.includes("pgmq.send"))).toBe(false);
  });
});

describe("enqueueOwnerAlertBestEffort", () => {
  it("never touches the database for a test call", async () => {
    const { sql, calls } = makeSql(CONTACT);
    const id = await enqueueOwnerAlertBestEffort(
      sql,
      logger,
      { tenantId: "t1", isTestCall: true },
      { kind: "message_taken", payload: {} },
    );
    expect(id).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("logs and returns null instead of throwing when the database fails", async () => {
    errors.length = 0;
    const { sql } = makeSql({ "public.agent_configs ac": new Error("boom") });
    const id = await enqueueOwnerAlertBestEffort(
      sql,
      logger,
      { tenantId: "t1", isTestCall: false },
      { kind: "message_taken", payload: {} },
    );
    expect(id).toBeNull();
    expect(errors[0]?.[0]).toBe("owner_alert_enqueue_failed");
    expect(errors[0]?.[1]).toMatchObject({ tenant_id: "t1", kind: "message_taken", error: "boom" });
  });

  it("returns the alert id on success", async () => {
    const { sql } = makeSql(CONTACT);
    expect(
      await enqueueOwnerAlertBestEffort(
        sql,
        logger,
        { tenantId: "t1", isTestCall: false },
        { kind: "message_taken", payload: {} },
      ),
    ).toBe("alert-1");
  });
});
