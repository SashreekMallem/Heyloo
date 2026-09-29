import { describe, expect, it } from "vitest";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { takeMessage } from "./take_message.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "legal",
  isTestCall: false,
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
const deps = (defer?: (label: string, task: () => Promise<void>) => void) => ({ logger, defer });

type Row = Record<string, unknown>;
/** Records every statement; answers by a marker found in the statement text. */
function recordingSql(answers: Record<string, Row[]>) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [marker, rows] of Object.entries(answers)) {
      if (text.includes(marker)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const OWNER_CONTACT = {
  "public.agent_configs ac": [
    { transfer_number: null, delivery: null, owner_email: "o@example.com" },
  ],
  "insert into public.messages_outbound": [{ id: "msg_1" }],
};

const args = {
  caller_phone: "555-123-4567",
  message_text: "Please call me back",
};

describe("takeMessage", () => {
  it("records the message and returns recorded:true", async () => {
    const sql = (async () => []) as SqlClient;
    const result = await takeMessage(sql, ctx, args, deps());
    expect(result).toEqual({ recorded: true });
  });

  it("merges structured_payload into call_logs.structured_booking_payload (GAP_REGISTER.md §2 Legal item 4)", async () => {
    let capturedPayload: unknown;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("update public.call_logs")) {
        capturedPayload = values[1];
      }
      return Promise.resolve([]);
    }) as SqlClient;
    await takeMessage(
      sql,
      ctx,
      {
        ...args,
        structured_payload: { matter_type: "contract_review" },
      },
      deps(),
    );
    // Regression (CALL-3 jsonb double-encoding fix): the structured
    // payload bound to the ::jsonb parameter must be the raw object, never
    // a caller-pre-stringified JSON string.
    expect(typeof capturedPayload).not.toBe("string");
    // CALL-8: caller_phone (normalized) is always folded in too — see the
    // dedicated test below for the full caller_name/caller_phone case.
    expect(capturedPayload).toEqual({
      matter_type: "contract_review",
      caller_phone: "+15551234567",
    });
  });

  it("merges callback_window into structured_booking_payload so it's visible on the Call Detail page without depending on the Messages UI", async () => {
    let capturedPayload: unknown;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("update public.call_logs")) {
        capturedPayload = values[1];
      }
      return Promise.resolve([]);
    }) as SqlClient;
    await takeMessage(
      sql,
      ctx,
      {
        ...args,
        structured_payload: { matter_type: "contract_review" },
        callback_window: "weekday afternoons",
      },
      deps(),
    );
    // Regression (CALL-3 jsonb double-encoding fix): the structured
    // payload bound to the ::jsonb parameter must be the raw object, never
    // a caller-pre-stringified JSON string.
    expect(typeof capturedPayload).not.toBe("string");
    expect(capturedPayload).toEqual({
      matter_type: "contract_review",
      callback_window: "weekday afternoons",
      caller_phone: "+15551234567",
    });
  });

  it("writes only caller_phone (never null) when no structured_payload/caller_name was given", async () => {
    let capturedPayload: unknown;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("update public.call_logs")) {
        capturedPayload = values[1];
      }
      return Promise.resolve([]);
    }) as SqlClient;
    await takeMessage(sql, ctx, args, deps());
    // Regression (CALL-3 jsonb double-encoding fix): the structured
    // payload bound to the ::jsonb parameter must be the raw object, never
    // a caller-pre-stringified JSON string.
    expect(typeof capturedPayload).not.toBe("string");
    expect(capturedPayload).toEqual({ caller_phone: "+15551234567" });
  });

  it("CALL-8: durably folds caller_name/caller_phone into structured_booking_payload — required so a required-field check (voice-tools/handler.ts) can ever be satisfied regardless of whether agent_configs.transfer_number is configured", async () => {
    let capturedPayload: unknown;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("update public.call_logs")) {
        capturedPayload = values[1];
      }
      return Promise.resolve([]);
    }) as SqlClient;
    await takeMessage(sql, ctx, { ...args, caller_name: "Jamie Rivera" }, deps());
    expect(capturedPayload).toEqual({
      caller_name: "Jamie Rivera",
      caller_phone: "+15551234567",
    });
  });

  it("VOICE-ALERTS-1: alerts the owner even when the tenant has NO transfer_number (0 of 10 live had one) - by email when no phone is known", async () => {
    const { sql, calls } = recordingSql(OWNER_CONTACT);
    await takeMessage(sql, ctx, { ...args, caller_name: "Jamie" }, deps());
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.values).toEqual(
      expect.arrayContaining(["tenant_1", "email", "o@example.com", "take_message", "cl_1"]),
    );
    expect(insert?.values[4]).toMatchObject({
      caller_name: "Jamie",
      caller_phone: "+15551234567",
      message_text: "Please call me back",
    });
    const enqueued = calls.filter((c) => c.text.includes("pgmq.send"));
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.values[1]).toEqual({ message_id: "msg_1" });
  });

  it("texts the transfer number by default when one is configured, and email-only tenants get email", async () => {
    const { sql, calls } = recordingSql({
      ...OWNER_CONTACT,
      "public.agent_configs ac": [
        { transfer_number: "+15550009999", delivery: null, owner_email: "o@example.com" },
      ],
    });
    await takeMessage(sql, ctx, args, deps());
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.values).toEqual(expect.arrayContaining(["sms", "+15550009999"]));
  });

  it("runs the alert after the response when a defer hook is given (hot path), not inline", async () => {
    const { sql, calls } = recordingSql(OWNER_CONTACT);
    const deferred: { label: string; task: () => Promise<void> }[] = [];
    const result = await takeMessage(
      sql,
      ctx,
      args,
      deps((label, task) => deferred.push({ label, task })),
    );
    expect(result).toEqual({ recorded: true });
    expect(calls.some((c) => c.text.includes("messages_outbound"))).toBe(false);
    expect(deferred).toHaveLength(1);
    await deferred[0]?.task();
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(true);
    expect(calls.some((c) => c.text.includes("pgmq.send"))).toBe(true);
  });

  it("an alert failure is logged and never fails the tool", async () => {
    errors.length = 0;
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("public.agent_configs ac")) return Promise.reject(new Error("db down"));
      return Promise.resolve([]);
    }) as SqlClient;
    const result = await takeMessage(sql, ctx, args, deps());
    expect(result).toEqual({ recorded: true });
    expect(errors[0]?.[0]).toBe("owner_alert_enqueue_failed");
  });

  it("never alerts the owner for a test call", async () => {
    const { sql, calls } = recordingSql(OWNER_CONTACT);
    await takeMessage(sql, { ...ctx, isTestCall: true }, args, deps());
    expect(calls.some((c) => c.text.includes("messages_outbound"))).toBe(false);
    expect(calls.some((c) => c.text.includes("update public.call_logs"))).toBe(true);
  });

  it("enqueues nothing when the owner has no reachable destination (still recorded on call_logs)", async () => {
    const { sql, calls } = recordingSql({
      "public.agent_configs ac": [{ transfer_number: null, delivery: null, owner_email: null }],
    });
    const result = await takeMessage(sql, ctx, args, deps());
    expect(result).toEqual({ recorded: true });
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });
});
