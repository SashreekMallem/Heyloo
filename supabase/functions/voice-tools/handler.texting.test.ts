import { findTextPromises } from "@heyloo/templates";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import { createMessagingRegistry } from "../_shared/providers/messaging/registry.ts";
import type { SmsProvider } from "../_shared/providers/messaging/types.ts";
import {
  SMS_UNAVAILABLE_CONFIRMATION_MESSAGE,
  SMS_UNAVAILABLE_PAYMENT_LINK_MESSAGE,
  WAITLIST_NO_TEXT_NOTE,
} from "../_shared/sms-availability.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { DispatchDeps } from "./handler.ts";
import { dispatchTool } from "./handler.ts";

/**
 * MSG-3: the dispatcher-level guarantee that a text-promising tool never
 * says "queued" (or hands out a link) unless the business can really text.
 * The launch state (owner decision): Retell-provided numbers, NO texting
 * provider, every tenant `a2p_status = 'pending_verification'`.
 */

const logger = createLogger();
const CALL_ID = "call_0123456789abcdef01234567";
const CONTEXT_ROW = {
  id: "cl1",
  tenant_id: "t1",
  caller_number: "+15551234567",
  vertical: "restaurant",
  is_test_call: false,
  manual_mode: false,
};

type SenderRow = {
  a2p_status: string | null;
  sms_provider: string | null;
  sender_e164: string | null;
  sender_provider: string | null;
  sender_status: string | null;
  primary_e164: string | null;
};

/** The launch state: a Retell number, no messaging sender, a2p pending. */
const NO_SENDER: SenderRow = {
  a2p_status: "pending_verification",
  sms_provider: null,
  sender_e164: null,
  sender_provider: null,
  sender_status: null,
  primary_e164: "+15559990000",
};
const VERIFIED_TELNYX: SenderRow = {
  a2p_status: "verified",
  sms_provider: null,
  sender_e164: "+18885550100",
  sender_provider: "telnyx",
  sender_status: "verified",
  primary_e164: "+15559990000",
};

const telnyx = { id: "telnyx" } as SmsProvider;

function registry(configured: boolean) {
  return createMessagingRegistry({
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
}

/** `configured`: a provider with secrets; `unconfigured`: the sender's provider has none; `absent`: no registry wired at all. */
function setup(
  sender: SenderRow | null,
  options: { registry?: "configured" | "unconfigured" | "absent" } = {},
) {
  const statements: string[] = [];
  const inserted: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    statements.push(text);
    if (text.includes("insert into public.messages_outbound")) inserted.push(text);
    if (text.includes("from public.call_logs") && text.includes("retell_call_id")) {
      return Promise.resolve([CONTEXT_ROW]);
    }
    if (text.includes("messaging_senders")) return Promise.resolve(sender ? [sender] : []);
    if (text.includes("insert into public.messages_outbound"))
      return Promise.resolve([{ id: "msg_1" }]);
    if (text.includes("insert into public.customers")) return Promise.resolve([{ id: "cust_1" }]);
    if (text.includes("insert into public.waitlist_entries"))
      return Promise.resolve([{ id: "wl_1" }]);
    return Promise.resolve([]);
  }) as SqlClient;
  const fetchImpl = vi.fn(() => Promise.reject(new Error("Stripe must not be called")));
  const deps: DispatchDeps = {
    sql,
    logger,
    paymentLink: {
      fetchImpl,
      stripeSecretKey: "sk_test",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    },
    dentalIntake: { appBaseUrl: "https://app.example.com" },
    ...(options.registry === "absent"
      ? {}
      : { sms: { registry: registry(options.registry !== "unconfigured") } }),
  };
  return { deps, statements, inserted, fetchImpl };
}

const CONFIRMATION = { phone: "555-123-4567", template_key: "booking_confirmation" };
const PAYMENT = { phone: "555-123-4567", purpose: "deposit", amount_cents: 2500 };
const WAITLIST = {
  customer: { name: "Jordan Lee", phone: "555-123-4567" },
  resource_type: "table",
  preferred_window_start: "2026-01-15T18:00:00.000Z",
  preferred_window_end: "2026-01-15T20:00:00.000Z",
};

function senderStatements(statements: string[]): number {
  return statements.filter((s) => s.includes("messaging_senders")).length;
}

describe("send_sms_confirmation", () => {
  it("launch state (no sender, a2p pending): queues nothing and says texting is unavailable", async () => {
    const { deps, inserted } = setup(NO_SENDER);
    const { result } = await dispatchTool(deps, CALL_ID, "send_sms_confirmation", CONFIRMATION);
    expect(result).toEqual({
      queued: false,
      reason: "sms_unavailable",
      texting_available: false,
      message: SMS_UNAVAILABLE_CONFIRMATION_MESSAGE,
    });
    expect(inserted).toHaveLength(0);
  });

  it("no messaging registry wired at all fails closed (unavailable, never queued)", async () => {
    const { deps, inserted } = setup(VERIFIED_TELNYX, { registry: "absent" });
    const { result } = await dispatchTool(deps, CALL_ID, "send_sms_confirmation", CONFIRMATION);
    expect(result).toMatchObject({ queued: false, reason: "sms_unavailable" });
    expect(inserted).toHaveLength(0);
  });

  it("a verified sender whose provider has no secrets is still unavailable (the worker would only park it)", async () => {
    const { deps, inserted } = setup(VERIFIED_TELNYX, { registry: "unconfigured" });
    const { result } = await dispatchTool(deps, CALL_ID, "send_sms_confirmation", CONFIRMATION);
    expect(result).toMatchObject({ queued: false, reason: "sms_unavailable" });
    expect(inserted).toHaveLength(0);
  });

  it("a sender that carriers have not approved yet is unavailable", async () => {
    const pending = {
      ...VERIFIED_TELNYX,
      a2p_status: "pending_verification",
      sender_status: "in_review",
    };
    const { deps, inserted } = setup(pending);
    const { result } = await dispatchTool(deps, CALL_ID, "send_sms_confirmation", CONFIRMATION);
    expect(result).toMatchObject({ queued: false, reason: "sms_unavailable" });
    expect(inserted).toHaveLength(0);
  });

  it("a verified sender with a configured provider queues the text as before", async () => {
    const { deps, inserted } = setup(VERIFIED_TELNYX);
    const { result } = await dispatchTool(deps, CALL_ID, "send_sms_confirmation", CONFIRMATION);
    expect(result).toEqual({ queued: true, message_id: "msg_1" });
    expect(inserted).toHaveLength(1);
  });

  it("costs one indexed sender lookup, and only when a text-promising tool runs", async () => {
    const { deps, statements } = setup(VERIFIED_TELNYX);
    await dispatchTool(deps, CALL_ID, "send_sms_confirmation", CONFIRMATION);
    expect(senderStatements(statements)).toBe(1);

    const other = setup(VERIFIED_TELNYX);
    await dispatchTool(other.deps, CALL_ID, "check_availability", {
      date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    });
    expect(senderStatements(other.statements)).toBe(0);
  });
});

describe("send_payment_link", () => {
  it("with no usable sender creates no Stripe session, no row, and says no link was sent", async () => {
    const { deps, inserted, fetchImpl } = setup(NO_SENDER);
    const { result } = await dispatchTool(deps, CALL_ID, "send_payment_link", PAYMENT);
    expect(result).toEqual({
      queued: false,
      reason: "sms_unavailable",
      texting_available: false,
      message: SMS_UNAVAILABLE_PAYMENT_LINK_MESSAGE,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("the answer never leads the model to say a link is on its way", () => {
    expect(SMS_UNAVAILABLE_PAYMENT_LINK_MESSAGE).toMatch(/NO payment link was created or sent/);
    expect(findTextPromises(SMS_UNAVAILABLE_PAYMENT_LINK_MESSAGE)).toEqual([]);
  });
});

describe("join_waitlist", () => {
  it("still joins the waitlist, but tells the model not to promise a text", async () => {
    const { deps } = setup(NO_SENDER);
    const { result } = await dispatchTool(deps, CALL_ID, "join_waitlist", WAITLIST);
    expect(result).toEqual({
      joined: true,
      waitlist_entry_id: "wl_1",
      texting_available: false,
      note: WAITLIST_NO_TEXT_NOTE,
    });
  });

  it("adds nothing when the business can text", async () => {
    const { deps } = setup(VERIFIED_TELNYX);
    const { result } = await dispatchTool(deps, CALL_ID, "join_waitlist", WAITLIST);
    expect(result).toEqual({ joined: true, waitlist_entry_id: "wl_1" });
  });
});
