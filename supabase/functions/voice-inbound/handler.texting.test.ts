import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import { createMessagingRegistry } from "../_shared/providers/messaging/registry.ts";
import type { SmsProvider } from "../_shared/providers/messaging/types.ts";
import { VoiceInboundResponseSchema } from "../_shared/schemas/voice-inbound.ts";
import { TEXTING_POLICY_OFF, TEXTING_POLICY_ON } from "../_shared/sms-availability.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleVoiceInbound, SMS_LOOKUP_TIMEOUT_MS } from "./handler.ts";

/**
 * MSG-3: `/voice-inbound` resolves, per call, whether this business can text
 * and sends `{{sms_enabled}}` / `{{texting_policy_text}}`. The compiled
 * agent's owner-info block shows the model "Text messages right now: ..."
 * from these, so an agent can never promise a text the business cannot send.
 */

const NOW = new Date("2026-01-12T14:00:00.000Z");
const logger = createLogger();

const ROW = {
  tenant_id: "tenant_1",
  business_name: "Acme Auto Repair",
  vertical: "auto",
  timezone: "America/New_York",
  business_hours: { mon: [{ open: "08:00", close: "18:00" }] },
  hours_exceptions: [],
  manual_mode: false,
  language_primary: "en",
  assistant_name: "Riley",
  special_instructions: null,
  dynamic_variable_overrides: {},
  retell_agent_id: "agent_abc",
  disclosure_line: "Hi, this is Riley — this call may be recorded.",
  transfer_number: "+15550001111",
};

const REQUEST = {
  event: "call_inbound",
  call_inbound: { from_number: "+15551234567", to_number: "+15559998888" },
};

const NO_SENDER = {
  a2p_status: "pending_verification",
  sms_provider: null,
  sender_e164: null,
  sender_provider: null,
  sender_status: null,
  primary_e164: "+15559998888",
};
const VERIFIED = {
  a2p_status: "verified",
  sms_provider: null,
  sender_e164: "+18885550100",
  sender_provider: "telnyx",
  sender_status: "verified",
  primary_e164: "+15559998888",
};

const telnyx = { id: "telnyx" } as SmsProvider;
const registry = (configured: boolean) =>
  createMessagingRegistry({
    smsDefault: "telnyx",
    emailDefault: "smtp",
    sms: {
      telnyx: configured
        ? { configured, provider: telnyx }
        : { configured, missing: ["TELNYX_API_KEY"] },
    },
    email: {},
    emailFromAddress: null,
  });

function makeSql(options: { sender: unknown; senderThrows?: boolean }) {
  const statements: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    statements.push(text);
    if (text.includes("from public.phone_numbers pn")) return Promise.resolve([ROW]);
    if (text.includes("messaging_senders")) {
      return options.senderThrows
        ? Promise.reject(new Error("connection reset"))
        : Promise.resolve(options.sender ? [options.sender] : []);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, statements };
}

async function variables(
  sqlOptions: Parameters<typeof makeSql>[0],
  sms?: { registry: ReturnType<typeof registry> },
) {
  const { sql, statements } = makeSql(sqlOptions);
  const result = await handleVoiceInbound({
    sql,
    request: REQUEST,
    logger,
    now: NOW,
    ...(sms ? { sms } : {}),
  });
  if (result.status !== 200) throw new Error("expected 200");
  return { vars: result.body.call_inbound.dynamic_variables, statements, body: result.body };
}

describe("voice-inbound: per-call texting variables (MSG-3)", () => {
  it("launch state (no SMS sender, a2p pending): texting is OFF and the agent is told not to promise a text", async () => {
    const { vars } = await variables({ sender: NO_SENDER }, { registry: registry(true) });
    expect(vars.sms_enabled).toBe("false");
    expect(vars.texting_policy_text).toBe(TEXTING_POLICY_OFF);
  });

  it("a carrier-verified sender with a configured provider turns texting ON", async () => {
    const { vars } = await variables({ sender: VERIFIED }, { registry: registry(true) });
    expect(vars.sms_enabled).toBe("true");
    expect(vars.texting_policy_text).toBe(TEXTING_POLICY_ON);
  });

  it("a verified sender whose provider has no secrets is OFF (nothing could be sent)", async () => {
    const { vars } = await variables({ sender: VERIFIED }, { registry: registry(false) });
    expect(vars.sms_enabled).toBe("false");
  });

  it("without a registry it fails closed to OFF and does not even query senders", async () => {
    const { vars, statements } = await variables({ sender: VERIFIED });
    expect(vars.sms_enabled).toBe("false");
    expect(statements.some((s) => s.includes("messaging_senders"))).toBe(false);
  });

  it("a failing sender lookup never fails or delays the call: it reads as OFF", async () => {
    const { vars } = await variables(
      { sender: VERIFIED, senderThrows: true },
      { registry: registry(true) },
    );
    expect(vars.sms_enabled).toBe("false");
    expect(vars.business_name).toBe("Acme Auto Repair");
  });

  it("a hung sender lookup cannot hold the call: after the cap it reads as OFF and the call proceeds", async () => {
    vi.useFakeTimers();
    try {
      const sql = ((strings: TemplateStringsArray) => {
        const text = strings.join(" ");
        if (text.includes("from public.phone_numbers pn")) return Promise.resolve([ROW]);
        if (text.includes("messaging_senders")) return new Promise(() => {}); // never settles
        return Promise.resolve([]);
      }) as SqlClient;
      const pending = handleVoiceInbound({
        sql,
        request: REQUEST,
        logger,
        now: NOW,
        sms: { registry: registry(true) },
      });
      await vi.advanceTimersByTimeAsync(SMS_LOOKUP_TIMEOUT_MS + 1);
      const result = await pending;
      if (result.status !== 200) throw new Error("expected 200");
      expect(result.body.call_inbound.dynamic_variables.sms_enabled).toBe("false");
      expect(result.body.call_inbound.dynamic_variables.business_name).toBe("Acme Auto Repair");
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds exactly one indexed statement, issued alongside the customer lookup", async () => {
    const { statements } = await variables({ sender: VERIFIED }, { registry: registry(true) });
    expect(statements.filter((s) => s.includes("messaging_senders"))).toHaveLength(1);
    // Dispatched right after the number lookup, before the customer read.
    const order = statements.map((s) =>
      s.includes("phone_numbers pn")
        ? "number"
        : s.includes("messaging_senders")
          ? "sender"
          : s.includes("public.customers")
            ? "customer"
            : "other",
    );
    expect(order.indexOf("sender")).toBeLessThan(order.indexOf("customer"));
  });

  it("the response still satisfies the Retell-facing schema", async () => {
    const { body } = await variables({ sender: NO_SENDER }, { registry: registry(true) });
    expect(VoiceInboundResponseSchema.safeParse(body).success).toBe(true);
  });
});
