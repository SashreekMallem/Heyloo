import { describe, expect, it } from "vitest";
import {
  enqueueOwnerAlert,
  isOwnerAlertTemplate,
  OWNER_ALERT_TEMPLATE_BY_KIND,
  parseOwnerAlertContact,
} from "./owner-alerts.ts";
import { renderTemplate } from "./templates.ts";
import type { SqlClient } from "./types.ts";

type Call = { text: string; values: unknown[] };

function makeSql(fixtures: Record<string, unknown[]>): { sql: SqlClient; calls: Call[] } {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

describe("parseOwnerAlertContact", () => {
  it("defaults both channels on, falling back to the transfer number and sign-in email", () => {
    expect(
      parseOwnerAlertContact({
        delivery: null,
        transferNumber: "+15550001111",
        ownerEmail: "owner@example.com",
      }),
    ).toEqual({
      smsEnabled: true,
      emailEnabled: true,
      alertPhone: "+15550001111",
      email: "owner@example.com",
    });
  });

  it("prefers the owner's explicit alert phone and notification email, normalized", () => {
    expect(
      parseOwnerAlertContact({
        delivery: {
          sms_enabled: false,
          email_enabled: true,
          alert_phone: "(555) 222-3333",
          notification_email: " desk@example.com ",
        },
        transferNumber: "+15550001111",
        ownerEmail: "owner@example.com",
      }),
    ).toEqual({
      smsEnabled: false,
      emailEnabled: true,
      alertPhone: "+15552223333",
      email: "desk@example.com",
    });
  });

  it("ignores malformed values field by field instead of disabling alerts", () => {
    const contact = parseOwnerAlertContact({
      delivery: { sms_enabled: "yes", notification_email: "not-an-email", alert_phone: "12" },
      transferNumber: null,
      ownerEmail: "owner@example.com",
    });
    expect(contact).toEqual({
      smsEnabled: true,
      emailEnabled: true,
      alertPhone: null,
      email: "owner@example.com",
    });
  });
});

describe("owner alert templates", () => {
  it("every kind maps to a template that renders a subject and a body", () => {
    for (const template of Object.values(OWNER_ALERT_TEMPLATE_BY_KIND)) {
      expect(isOwnerAlertTemplate(template)).toBe(true);
      const rendered = renderTemplate(template, {
        caller_name: "Jordan",
        caller_phone: "+15551234567",
        message_text: "Call me",
        summary: "Brakes failing",
      });
      expect(rendered.subject, template).toBeTruthy();
      expect(rendered.body, template).toContain("Jordan");
    }
    expect(isOwnerAlertTemplate("booking_confirmation")).toBe(false);
  });
});

describe("enqueueOwnerAlert", () => {
  it("inserts one alert aimed at the alert phone and enqueues it", async () => {
    const { sql, calls } = makeSql({
      "public.agent_configs ac": [
        { transfer_number: "+15550001111", delivery: null, owner_email: "o@example.com" },
      ],
      "insert into public.messages_outbound": [{ id: "alert-1" }],
    });
    const id = await enqueueOwnerAlert(sql, {
      tenantId: "t1",
      kind: "urgent_call",
      payload: { caller_name: "Jordan" },
      relatedCallId: "call-1",
    });
    expect(id).toBe("alert-1");
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.values).toEqual(
      expect.arrayContaining(["t1", "sms", "+15550001111", "owner_urgent_call", "call-1"]),
    );
    // Idempotent per (call, template): a redelivered webhook never alerts twice.
    expect(insert?.text).toContain("not exists");
    const enqueue = calls.find((c) => c.text.includes("pgmq.send"));
    expect(enqueue?.values[1]).toEqual({ message_id: "alert-1" });
  });

  it("aims at email when texting alerts are off", async () => {
    const { sql, calls } = makeSql({
      "public.agent_configs ac": [
        {
          transfer_number: "+15550001111",
          delivery: { sms_enabled: false },
          owner_email: "o@example.com",
        },
      ],
      "insert into public.messages_outbound": [{ id: "alert-2" }],
    });
    await enqueueOwnerAlert(sql, { tenantId: "t1", kind: "new_booking", payload: {} });
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.values).toEqual(expect.arrayContaining(["email", "o@example.com"]));
  });

  it("enqueues nothing when the owner has no reachable destination", async () => {
    const { sql, calls } = makeSql({
      "public.agent_configs ac": [{ transfer_number: null, delivery: null, owner_email: null }],
    });
    expect(
      await enqueueOwnerAlert(sql, { tenantId: "t1", kind: "missed_transfer", payload: {} }),
    ).toBeNull();
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });
});
