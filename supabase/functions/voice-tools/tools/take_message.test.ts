import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { takeMessage } from "./take_message.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "legal",
};

const args = {
  caller_phone: "555-123-4567",
  message_text: "Please call me back",
};

describe("takeMessage", () => {
  it("records the message and returns recorded:true", async () => {
    const sql = (async () => []) as SqlClient;
    const result = await takeMessage(sql, ctx, args);
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
    await takeMessage(sql, ctx, {
      ...args,
      structured_payload: { matter_type: "contract_review" },
    });
    // Regression (CALL-3 jsonb double-encoding fix): the structured
    // payload bound to the ::jsonb parameter must be the raw object, never
    // a caller-pre-stringified JSON string.
    expect(typeof capturedPayload).not.toBe("string");
    expect(capturedPayload).toEqual({ matter_type: "contract_review" });
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
    await takeMessage(sql, ctx, {
      ...args,
      structured_payload: { matter_type: "contract_review" },
      callback_window: "weekday afternoons",
    });
    // Regression (CALL-3 jsonb double-encoding fix): the structured
    // payload bound to the ::jsonb parameter must be the raw object, never
    // a caller-pre-stringified JSON string.
    expect(typeof capturedPayload).not.toBe("string");
    expect(capturedPayload).toEqual({
      matter_type: "contract_review",
      callback_window: "weekday afternoons",
    });
  });

  it("writes an empty jsonb object (not null) when no structured_payload was given", async () => {
    let capturedPayload: unknown;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("update public.call_logs")) {
        capturedPayload = values[1];
      }
      return Promise.resolve([]);
    }) as SqlClient;
    await takeMessage(sql, ctx, args);
    // Regression (CALL-3 jsonb double-encoding fix): the structured
    // payload bound to the ::jsonb parameter must be the raw object, never
    // a caller-pre-stringified JSON string.
    expect(typeof capturedPayload).not.toBe("string");
    expect(capturedPayload).toEqual({});
  });

  it("enqueues a staff notification when the tenant has a transfer_number configured", async () => {
    const enqueueCalls: unknown[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.send")) {
        enqueueCalls.push(values);
        return Promise.resolve([]);
      }
      if (text.includes("insert into public.messages_outbound")) {
        return Promise.resolve([{ id: "msg_1" }]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    await takeMessage(sql, ctx, args);
    expect(enqueueCalls).toHaveLength(1);
  });
});
