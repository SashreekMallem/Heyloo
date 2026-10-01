import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { DispatchDeps } from "./handler.ts";
import {
  BOOKING_NOT_COMPLETED_MESSAGE,
  BOOKING_PENDING_MESSAGE,
  CREATE_BOOKING_BUDGET_MS,
  CREATE_BOOKING_VERIFY_MS,
  countsAsBreakerFailure,
  DEFAULT_TOOL_BUDGET_MS,
  DELIVERY_ADDRESS_TOOL_BUDGET_MS,
  dispatchTool,
  isKnownTool,
  resolveEnvelopeCallId,
  toolBudget,
} from "./handler.ts";

const logger = createLogger();

function makeDeps(callContextRow: unknown, extra: Record<string, unknown[]> = {}): DispatchDeps {
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    if (text.includes("from public.call_logs") && text.includes("retell_call_id")) {
      return Promise.resolve(callContextRow ? [callContextRow] : []);
    }
    for (const [key, rows] of Object.entries(extra)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return {
    sql,
    logger,
    paymentLink: {
      fetchImpl: () => Promise.reject(new Error("not used in this test")),
      stripeSecretKey: "sk_test",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    },
    dentalIntake: { appBaseUrl: "https://app.example.com" },
  };
}

describe("isKnownTool", () => {
  it("recognizes every spec'd tool name", () => {
    for (const name of [
      "check_availability",
      "create_booking",
      "update_booking",
      "cancel_booking",
      "lookup_customer",
      "take_message",
      "send_sms_confirmation",
      "create_order",
      "send_payment_link",
      "join_waitlist",
      "list_offerings",
      "check_delivery_address",
    ]) {
      expect(isKnownTool(name)).toBe(true);
    }
  });

  it("rejects an unrecognized tool name", () => {
    expect(isKnownTool("delete_everything")).toBe(false);
  });
});

describe("dispatchTool", () => {
  it("returns the graceful fallback when the call context cannot be resolved (never a raw error)", async () => {
    const deps = makeDeps(null);
    const result = await dispatchTool(deps, "call_missing", "check_availability", {
      date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    });
    expect(result).toEqual({
      result: { fallback: true, message: "I'll take your details and have someone confirm." },
    });
  });

  it("returns the graceful fallback for an unrecognized tool name rather than an error", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "not_a_real_tool", {});
    expect(result.result).toMatchObject({ fallback: true });
  });

  it("returns the graceful fallback when args fail Zod validation, never throwing", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "check_availability", {
      date_range: "not an object",
    });
    expect(result.result).toMatchObject({ fallback: true });
  });

  it("routes check_availability through to a real tool result on valid input", async () => {
    const deps = makeDeps(
      { id: "cl1", tenant_id: "t1", caller_number: "+15551234567" },
      { "from public.availability_slots": [] },
    );
    const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "check_availability", {
      date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    });
    expect(result.result).toMatchObject({ none_available: true });
  });

  it("routes lookup_customer through with the G6 caller-scope check intact", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "lookup_customer", {
      phone: "+15559998888",
    });
    expect(result).toEqual({ result: { error: "unauthorized_lookup" } });
  });

  it("routes join_waitlist through to a real tool result", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "join_waitlist", {
      customer: { name: "Jane Doe", phone: "not-a-phone" },
      preferred_window_start: "2026-01-01T00:00:00Z",
      preferred_window_end: "2026-01-02T00:00:00Z",
    });
    expect(result).toEqual({ result: { joined: false, reason: "invalid_phone" } });
  });

  it("CALL-2: fills deps.telemetry.tenantId with the resolved tenant, so tool_health rows are no longer always tenant_id: null", async () => {
    const deps = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const telemetry: { tenantId: string | null } = { tenantId: null };
    await dispatchTool({ ...deps, telemetry }, "call_0123456789abcdef01234567", "join_waitlist", {
      customer: { name: "Jane Doe", phone: "+15551234567" },
      preferred_window_start: "2026-01-01T00:00:00Z",
      preferred_window_end: "2026-01-02T00:00:00Z",
    });
    expect(telemetry.tenantId).toBe("t1");
  });

  it("CALL-2: leaves deps.telemetry.tenantId null when context never resolves (never a fabricated tenant)", async () => {
    const deps = makeDeps(null);
    const telemetry: { tenantId: string | null } = { tenantId: null };
    await dispatchTool({ ...deps, telemetry }, "call_missing", "check_availability", {
      date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    });
    expect(telemetry.tenantId).toBeNull();
  });

  it("CALL-2: resolves context from the tool payload's call.agent_id when no call_logs row exists, instead of always falling back", async () => {
    const deps = makeDeps(null, {
      "from public.agent_configs": [{ tenant_id: "t9", vertical: "auto" }],
      "insert into public.call_logs": [
        { id: "cl-new", tenant_id: "t9", caller_number: "+15550001111" },
      ],
    });
    const result = await dispatchTool(
      deps,
      "test_batch_call_1",
      "check_availability",
      { date_range: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" } },
      { agent_id: "agent_9" },
    );
    // Resolved a real tenant (t9) rather than the graceful fallback — the
    // exact CALL-1-traced bug (batch-test/chat sessions always getting the
    // fallback because no call_logs row exists for a synthetic call_id).
    expect(result.result).not.toMatchObject({ fallback: true });
  });

  // CALL-8 (docs/BUILD_PLAN.md) — `_shared/vertical-intake.ts` required-field
  // enforcement, applied via `applyIntakeGate` before create_booking/
  // create_order/take_message ever reach their real tool function.
  describe("CALL-8: required-intake-field enforcement", () => {
    it("blocks create_booking with a named-field error (never the generic fallback) when a vertical-required structured_payload field is missing, and never touches the DB beyond context resolution", async () => {
      let extraQueryRan = false;
      const deps = makeDeps({
        id: "cl1",
        tenant_id: "t1",
        caller_number: "+15551234567",
        vertical: "auto",
      });
      const sql = ((strings: TemplateStringsArray) => {
        const text = strings.join(" ");
        if (text.includes("from public.call_logs") && text.includes("retell_call_id")) {
          return Promise.resolve([
            { id: "cl1", tenant_id: "t1", caller_number: "+15551234567", vertical: "auto" },
          ]);
        }
        // create_booking's resolveBookingResourceId/offering lookups would
        // hit these — asserting they never run proves the gate short-
        // circuited BEFORE any tool-level DB work, not after a failed one.
        if (text.includes("from public.resources") || text.includes("from public.offerings")) {
          extraQueryRan = true;
        }
        return Promise.resolve([]);
      }) as SqlClient;
      const result = await dispatchTool(
        { ...deps, sql },
        "call_0123456789abcdef01234567",
        "create_booking",
        {
          resource_id: "r1",
          start: "2026-01-05T15:00:00Z",
          end: "2026-01-05T15:30:00Z",
          customer: { name: "Jamie Rivera", phone: "+15552010199" },
          // No structured_payload at all — every auto-specific field missing.
        },
      );
      expect(result.result).toMatchObject({ error: "missing_required_fields" });
      const body = result.result as { missing_fields: string[]; message: string };
      expect(body.missing_fields).toEqual(
        expect.arrayContaining([
          "structured_payload.vehicle_year",
          "structured_payload.vehicle_make",
          "structured_payload.vehicle_model",
          "structured_payload.symptom_category",
        ]),
      );
      expect(body.missing_fields).not.toContain("customer.name");
      expect(body.missing_fields).not.toContain("customer.phone");
      expect(body.message).toContain("vehicle");
      expect(extraQueryRan).toBe(false);
    });

    it("defaults customer.phone from ctx.callerNumber instead of blocking on it, per the 'default to caller number, only confirm, never re-ask' rule — vertical with no structured_payload requirements (generic minus the new 'reason' field) still blocks on the field it truly never got", async () => {
      const deps = makeDeps({
        id: "cl1",
        tenant_id: "t1",
        caller_number: "+15552010199",
        vertical: "generic",
      });
      const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "create_booking", {
        resource_id: "r1",
        start: "2026-01-05T15:00:00Z",
        end: "2026-01-05T15:30:00Z",
        customer: { name: "Jamie Rivera" }, // no phone — must default from caller id
        structured_payload: {},
      });
      expect(result.result).toMatchObject({ error: "missing_required_fields" });
      const body = result.result as { missing_fields: string[] };
      expect(body.missing_fields).not.toContain("customer.phone");
      expect(body.missing_fields).toContain("structured_payload.reason");
    });

    it("blocks take_message on legal's matter_type/opposing_party/urgency overlay (its own template's primary intake tool, not just an after-hours fallback) while never blocking on caller_phone once ctx.callerNumber covers it", async () => {
      const deps = makeDeps({
        id: "cl1",
        tenant_id: "t1",
        caller_number: "+15551234567",
        vertical: "legal",
      });
      const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "take_message", {
        caller_name: "Taylor Brooks",
        message_text: "Wants an intake callback.",
      });
      expect(result.result).toMatchObject({ error: "missing_required_fields" });
      const body = result.result as { missing_fields: string[] };
      expect(body.missing_fields).not.toContain("caller_phone");
      expect(body.missing_fields).toEqual(
        expect.arrayContaining([
          "structured_payload.matter_type",
          "structured_payload.opposing_party",
          "structured_payload.urgency",
        ]),
      );
    });

    it("lets take_message through to a real recorded result once every required field is present (auto's baseline: name/phone/message_text only)", async () => {
      const deps = makeDeps({
        id: "cl1",
        tenant_id: "t1",
        caller_number: "+15551234567",
        vertical: "auto",
      });
      const result = await dispatchTool(deps, "call_0123456789abcdef01234567", "take_message", {
        caller_name: "Pat Okafor",
        caller_phone: "+15552010177",
        message_text: "Car making a strange noise, call back please.",
      });
      expect(result).toEqual({ result: { recorded: true } });
    });

    it("blocks create_order on missing customer.name/phone (restaurant) without invoking the offerings lookup", async () => {
      let offeringsQueryRan = false;
      const sql = ((strings: TemplateStringsArray) => {
        const text = strings.join(" ");
        if (text.includes("from public.call_logs") && text.includes("retell_call_id")) {
          return Promise.resolve([
            { id: "cl1", tenant_id: "t1", caller_number: null, vertical: "restaurant" },
          ]);
        }
        if (text.includes("from public.offerings")) offeringsQueryRan = true;
        return Promise.resolve([]);
      }) as SqlClient;
      const deps = makeDeps(null);
      const result = await dispatchTool(
        { ...deps, sql },
        "call_0123456789abcdef01234567",
        "create_order",
        {
          items: [{ name: "Margherita pizza", qty: 1 }],
          fulfillment_type: "pickup",
          customer: {},
        },
      );
      expect(result.result).toMatchObject({ error: "missing_required_fields" });
      const body = result.result as { missing_fields: string[] };
      expect(body.missing_fields).toEqual(
        expect.arrayContaining(["customer.name", "customer.phone"]),
      );
      expect(offeringsQueryRan).toBe(false);
    });
  });
});

describe("resolveEnvelopeCallId", () => {
  it("prefers a top-level call_id when present", () => {
    expect(resolveEnvelopeCallId({ call_id: "top", call: { call_id: "nested" } })).toBe("top");
  });

  it("falls back to call.call_id (the real Retell shape) when there is no top-level call_id", () => {
    expect(resolveEnvelopeCallId({ call: { call_id: "nested" } })).toBe("nested");
  });

  it("returns null when neither is present", () => {
    expect(resolveEnvelopeCallId({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HOTPATH (docs/BUILD_NOTES.md): per-tool budgets and create_booking's
// truthful deadline answer.
// ---------------------------------------------------------------------------

const REAL_CALL = "call_0123456789abcdef01234567";
const BOOKING_ARGS = {
  resource_id: "11111111-1111-1111-1111-111111111111",
  start: "2026-10-15T14:00:00.000Z",
  end: "2026-10-15T14:30:00.000Z",
  customer: { name: "Jordan Lee", phone: "+15552010199" },
  structured_payload: { reason: "checkup" },
};
const PREFLIGHT_ROW = {
  replay_id: null,
  replay_start: null,
  replay_end: null,
  exact_resource_id: BOOKING_ARGS.resource_id,
  first_available_resource_id: null,
  offering_ok: true,
  start_in_past: false,
  tz: null,
  deposit_overrides: null,
};
const BOOKED_ROW = {
  id: "booking_1",
  start_at: BOOKING_ARGS.start,
  end_at: BOOKING_ARGS.end,
  customer_id: "customer_1",
  customer_metadata: {},
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A fake `sql` that behaves like ONE Postgres connection: every statement
 * runs only after the previous one finished (FIFO), which is what the hot
 * path's single-connection pool guarantees. `bookingCommitted` flips when
 * the write statement completes, so the verify read sees exactly what a
 * real database would.
 */
function singleConnectionSql(opts: {
  preflightDelayMs?: number;
  writeDelayMs?: number;
  writeThrowsAfterCommit?: Error;
  verifyHangs?: boolean;
  contextDelayMs?: number;
}): {
  sql: SqlClient;
  texts: string[];
  bound: { text: string; values: unknown[] }[];
  state: { bookingCommitted: boolean };
} {
  const texts: string[] = [];
  const bound: { text: string; values: unknown[] }[] = [];
  const state = { bookingCommitted: false };
  let tail: Promise<unknown> = Promise.resolve();
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    texts.push(text);
    bound.push({ text, values });
    const run = async (): Promise<unknown[]> => {
      if (text.includes("from public.call_logs") && text.includes("retell_call_id")) {
        await sleep(opts.contextDelayMs ?? 0);
        return [
          {
            id: "cl1",
            tenant_id: "t1",
            caller_number: null,
            vertical: "generic",
            is_test_call: false,
          },
        ];
      }
      if (text.includes("create_booking:preflight")) {
        await sleep(opts.preflightDelayMs ?? 0);
        return [PREFLIGHT_ROW];
      }
      if (text.includes("create_booking:write")) {
        await sleep(opts.writeDelayMs ?? 0);
        state.bookingCommitted = true;
        if (opts.writeThrowsAfterCommit) throw opts.writeThrowsAfterCommit;
        return [BOOKED_ROW];
      }
      if (text.includes("create_booking:verify")) {
        if (opts.verifyHangs) await new Promise(() => {});
        return state.bookingCommitted
          ? [{ id: "booking_1", start_at: BOOKING_ARGS.start, end_at: BOOKING_ARGS.end, tz: null }]
          : [];
      }
      return [];
    };
    const p = tail.then(run);
    tail = p.catch(() => undefined);
    return p;
  }) as SqlClient;
  return { sql, texts, bound, state };
}

function bookingDeps(sql: SqlClient, extra: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    ...makeDeps(null),
    sql,
    // As in production (verify 1.5 s > the 1.2 s statement_timeout), the
    // verify window outlasts any single in-flight statement it queues behind.
    budget: { budgetMs: 40, verifyMs: 150, hardAbortMs: 400 },
    ...extra,
  };
}

describe("toolBudget (HOTPATH)", () => {
  // docs.retellai.com: custom tool `timeout_ms` defaults to 120,000 ms and no
  // compiled tool overrides it (docs/VERIFY.md HOTPATH).
  const RETELL_DEFAULT_TOOL_TIMEOUT_MS = 120_000;

  it("gives create_booking 4 s + 1.5 s verification + 0.5 s margin, every other tool the historical 1.5 s", () => {
    expect(toolBudget("create_booking")).toEqual({
      budgetMs: CREATE_BOOKING_BUDGET_MS,
      verifyMs: CREATE_BOOKING_VERIFY_MS,
      hardAbortMs: 6_000,
    });
    expect(CREATE_BOOKING_BUDGET_MS).toBe(4_000);
    expect(CREATE_BOOKING_VERIFY_MS).toBe(1_500);
    expect(toolBudget("check_availability")).toEqual({
      budgetMs: DEFAULT_TOOL_BUDGET_MS,
      verifyMs: 0,
      hardAbortMs: 1_500,
    });
  });

  it("a create_booking that ran out of time unverified counts against the circuit breaker; a verified one does not", () => {
    expect(countsAsBreakerFailure("booking_not_completed")).toBe(true);
    expect(countsAsBreakerFailure("booking_outcome_unknown")).toBe(true);
    expect(countsAsBreakerFailure("booking_verified_after_timeout")).toBe(false);
    expect(countsAsBreakerFailure("ok")).toBe(false);
    expect(countsAsBreakerFailure(undefined)).toBe(false);
  });

  it("DELIVERY-1: the two delivery-address tools get room for one 1.5 s geocoder wait", () => {
    for (const name of ["check_delivery_address", "create_order"]) {
      expect(toolBudget(name)).toEqual({
        budgetMs: DELIVERY_ADDRESS_TOOL_BUDGET_MS,
        verifyMs: 0,
        hardAbortMs: 3_500,
      });
    }
  });

  it("every budget sits far inside Retell's default tool timeout", () => {
    for (const name of [
      "check_delivery_address",
      "create_order",
      "create_booking",
      "check_availability",
      "lookup_customer",
      "take_message",
    ]) {
      expect(toolBudget(name).hardAbortMs).toBeLessThan(RETELL_DEFAULT_TOOL_TIMEOUT_MS);
    }
  });
});

describe("dispatchTool — create_booking deadline (HOTPATH)", () => {
  it("returns the real booking when the write finishes within the budget", async () => {
    const { sql } = singleConnectionSql({});
    const telemetry: NonNullable<DispatchDeps["telemetry"]> = { tenantId: null };
    const result = await dispatchTool(
      bookingDeps(sql, { telemetry }),
      REAL_CALL,
      "create_booking",
      BOOKING_ARGS,
    );
    expect(result.result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(telemetry.outcome).toBe("ok");
    expect(typeof telemetry.contextMs).toBe("number");
    expect(typeof telemetry.toolMs).toBe("number");
  });

  it("deadline hit while the write is in flight and the row COMMITS: answers confirmed with the committed booking (never 'someone will confirm')", async () => {
    const { sql, state } = singleConnectionSql({ writeDelayMs: 80 });
    const telemetry: NonNullable<DispatchDeps["telemetry"]> = { tenantId: null };
    const result = await dispatchTool(
      bookingDeps(sql, { telemetry }),
      REAL_CALL,
      "create_booking",
      BOOKING_ARGS,
    );
    expect(state.bookingCommitted).toBe(true);
    expect(result.result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: BOOKING_ARGS.start,
      end: BOOKING_ARGS.end,
    });
    expect(telemetry.outcome).toBe("booking_verified_after_timeout");
  });

  it("deadline hit BEFORE the write started: answers not_completed (retry-safe) and the write is never issued afterwards", async () => {
    const { sql, texts, state } = singleConnectionSql({ preflightDelayMs: 80 });
    const telemetry: NonNullable<DispatchDeps["telemetry"]> = { tenantId: null };
    const result = await dispatchTool(
      bookingDeps(sql, { telemetry }),
      REAL_CALL,
      "create_booking",
      BOOKING_ARGS,
    );
    expect(result.result).toEqual({
      confirmed: false,
      reason: "not_completed",
      retry_safe: true,
      message: BOOKING_NOT_COMPLETED_MESSAGE,
    });
    expect(telemetry.outcome).toBe("booking_not_completed");
    // Even after the in-flight preflight finishes, the abort flag keeps the
    // write from ever starting, so "not booked" stays true.
    await sleep(120);
    expect(texts.some((t) => t.includes("create_booking:write"))).toBe(false);
    expect(state.bookingCommitted).toBe(false);
  });

  it("a retry after not_completed is idempotent: the same call + start maps to the same key the write and the verify use", async () => {
    const first = singleConnectionSql({ preflightDelayMs: 80 });
    await dispatchTool(bookingDeps(first.sql), REAL_CALL, "create_booking", BOOKING_ARGS);
    const retry = singleConnectionSql({});
    const result = await dispatchTool(
      bookingDeps(retry.sql),
      REAL_CALL,
      "create_booking",
      BOOKING_ARGS,
    );
    expect(result.result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
  });

  it("when even the verification read cannot answer: confirmation_pending, never confirmed, and the late outcome is logged after the response", async () => {
    const error = vi.fn();
    const deferred: string[] = [];
    const { sql } = singleConnectionSql({ writeDelayMs: 60, verifyHangs: true });
    const telemetry: NonNullable<DispatchDeps["telemetry"]> = { tenantId: null };
    const result = await dispatchTool(
      bookingDeps(sql, {
        telemetry,
        logger: { ...createLogger(), error },
        defer: (label) => deferred.push(label),
      }),
      REAL_CALL,
      "create_booking",
      BOOKING_ARGS,
    );
    expect(result.result).toEqual({
      confirmed: false,
      reason: "confirmation_pending",
      retry_safe: true,
      message: BOOKING_PENDING_MESSAGE,
    });
    expect(telemetry.outcome).toBe("booking_outcome_unknown");
    expect(error).toHaveBeenCalledWith(
      "create_booking_outcome_unknown",
      expect.objectContaining({ idempotency_key: `${REAL_CALL}:${BOOKING_ARGS.start}` }),
    );
    expect(deferred).toContain("create_booking_late_outcome");
  });

  it("context resolution alone used the whole budget: answers not_completed without starting the booking at all", async () => {
    const { sql, texts } = singleConnectionSql({ contextDelayMs: 60 });
    const result = await dispatchTool(bookingDeps(sql), REAL_CALL, "create_booking", BOOKING_ARGS);
    expect(result.result).toMatchObject({ confirmed: false, reason: "not_completed" });
    expect(texts.some((t) => t.includes("create_booking:"))).toBe(false);
  });

  it("the write errors AFTER Postgres committed it (e.g. the reply was lost): answers from the database, confirmed", async () => {
    const { sql } = singleConnectionSql({ writeThrowsAfterCommit: new Error("connection reset") });
    const telemetry: NonNullable<DispatchDeps["telemetry"]> = { tenantId: null };
    const result = await dispatchTool(
      bookingDeps(sql, { telemetry }),
      REAL_CALL,
      "create_booking",
      BOOKING_ARGS,
    );
    expect(result.result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(telemetry.outcome).toBe("booking_verified_after_error");
  });

  it("the write errors and nothing committed: the error still surfaces (generic fallback + circuit breaker in index.ts)", async () => {
    const texts: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      texts.push(text);
      if (text.includes("from public.call_logs") && text.includes("retell_call_id")) {
        return Promise.resolve([
          {
            id: "cl1",
            tenant_id: "t1",
            caller_number: null,
            vertical: "generic",
            is_test_call: false,
          },
        ]);
      }
      if (text.includes("create_booking:preflight")) return Promise.resolve([PREFLIGHT_ROW]);
      if (text.includes("create_booking:write"))
        return Promise.reject(new Error("statement timeout"));
      return Promise.resolve([]);
    }) as SqlClient;
    await expect(
      dispatchTool(bookingDeps(sql), REAL_CALL, "create_booking", BOOKING_ARGS),
    ).rejects.toThrow("statement timeout");
    expect(texts.some((t) => t.includes("create_booking:verify"))).toBe(true);
  });
});

describe("dispatchTool — create_booking time arguments (HOTPATH-REVIEW)", () => {
  it("an unparseable start is answered invalid_time before any create_booking statement, so it never reaches the client-side serializer", async () => {
    const { sql, texts } = singleConnectionSql({});
    const telemetry: NonNullable<DispatchDeps["telemetry"]> = { tenantId: null };
    const result = await dispatchTool(
      bookingDeps(sql, { telemetry }),
      REAL_CALL,
      "create_booking",
      { ...BOOKING_ARGS, start: "tomorrow" },
    );
    expect(result.result).toMatchObject({ confirmed: false, reason: "invalid_time" });
    expect(texts.some((t) => t.includes("create_booking:"))).toBe(false);
    expect(telemetry.outcome).toBe("ok");
  });

  it("the deadline recovery looks up the SAME normalized key the write used, whatever format the start was written in", async () => {
    const { sql, bound, state } = singleConnectionSql({ writeDelayMs: 80 });
    const result = await dispatchTool(bookingDeps(sql), REAL_CALL, "create_booking", {
      ...BOOKING_ARGS,
      start: "2026-10-15T10:00:00-04:00",
      end: "2026-10-15T10:30:00-04:00",
    });
    expect(state.bookingCommitted).toBe(true);
    expect(result.result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    const key = `${REAL_CALL}:2026-10-15T14:00:00.000Z`;
    expect(bound.find((b) => b.text.includes("create_booking:write"))?.values).toContain(key);
    expect(bound.find((b) => b.text.includes("create_booking:verify"))?.values).toContain(key);
  });

  it("the pending answer never promises a specific confirmation channel nothing sends", () => {
    expect(BOOKING_PENDING_MESSAGE).not.toMatch(/by text|text message|sms/i);
    expect(BOOKING_PENDING_MESSAGE).toContain("do not tell the caller it is booked");
  });
});

describe("F1: dispatchTool reads offset-less times in the tenant timezone", () => {
  it("check_availability binds 09:00 Chicago as 14:00Z, not 09:00Z", async () => {
    const bound: unknown[][] = [];
    const base = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const inner = base.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("select timezone from public.tenants")) {
        return Promise.resolve([{ timezone: "America/Chicago" }]);
      }
      if (text.includes("from public.availability_slots")) bound.push(values);
      return inner(strings, ...values);
    }) as SqlClient;
    await dispatchTool({ ...base, sql }, "call_0123456789abcdef01234567", "check_availability", {
      date_range: { start: "2026-09-30T09:00:00", end: "2026-09-30T10:00:00" },
    });
    expect(bound[0]).toContain("2026-09-30T14:00:00.000Z");
    expect(bound[0]).toContain("2026-09-30T15:00:00.000Z");
  });
});

describe("F1: join_waitlist also reads naive times as the tenant's wall clock", () => {
  it("binds the window in the tenant timezone", async () => {
    const bound: unknown[][] = [];
    const base = makeDeps({ id: "cl1", tenant_id: "t1", caller_number: "+15551234567" });
    const inner = base.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("select timezone from public.tenants")) {
        return Promise.resolve([{ timezone: "America/Denver" }]);
      }
      if (text.includes("insert into public.customers")) return Promise.resolve([{ id: "c1" }]);
      if (text.includes("insert into public.waitlist_entries")) {
        bound.push(values);
        return Promise.resolve([{ id: "w1" }]);
      }
      return inner(strings, ...values);
    }) as SqlClient;
    await dispatchTool({ ...base, sql }, "call_0123456789abcdef01234567", "join_waitlist", {
      customer: { name: "Jane Doe", phone: "+15551234567" },
      preferred_window_start: "2026-10-01T12:00:00",
      preferred_window_end: "2026-10-01T17:00:00",
    });
    expect(bound[0]).toContain("2026-10-01T18:00:00.000Z");
    expect(bound[0]).toContain("2026-10-01T23:00:00.000Z");
  });
});

describe("dispatchTool — check_delivery_address (DELIVERY-1)", () => {
  const REAL_CALL_ID = "call_30d9a235551f7b5bd80364cab4b";
  const callRow = {
    id: "cl1",
    tenant_id: "t1",
    caller_number: "+15551234567",
    vertical: "restaurant",
  };

  it("routes to the tool with the resolved tenant and call, never a tenant from args", async () => {
    const values: unknown[][] = [];
    const base = makeDeps(callRow);
    const sql = ((strings: TemplateStringsArray, ...v: unknown[]) => {
      const text = strings.join(" ");
      values.push(v);
      if (text.includes("delivery_radius_miles")) {
        return Promise.resolve([
          {
            business_street: "400 N Greenville Ave",
            business_city: "Richardson",
            business_state: "TX",
            business_zip: "75081",
            business_lat: 32.95,
            business_lng: -96.73,
            business_location_matched: "400 N GREENVILLE AVE, RICHARDSON, TX, 75081",
            business_location_key: "400 n greenville ave|richardson|tx|75081",
            business_located_at: null,
            delivery_radius_miles: "5",
            delivery_fee_base_cents: 0,
            delivery_fee_per_mile_cents: null,
            delivery_fee_included_miles: null,
            delivery_min_order_cents: null,
          },
        ]);
      }
      return base.sql(strings, ...v);
    }) as SqlClient;
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          result: {
            addressMatches: [
              {
                matchedAddress: "12 ELM ST, RICHARDSON, TX, 75081",
                coordinates: { x: -96.73, y: 32.96 },
                addressComponents: {},
              },
            ],
          },
        }),
        { status: 200 },
      );
    const result = await dispatchTool(
      { ...base, sql, census: { fetchImpl } },
      REAL_CALL_ID,
      "check_delivery_address",
      { street: "12 Elm St", city: "Richardson", tenant_id: "evil" },
    );
    expect(result.result).toMatchObject({
      status: "in_range",
      matched_address: "12 ELM ST, RICHARDSON, TX, 75081",
    });
    expect(values.flat()).not.toContain("evil");
    expect(values.flat()).toContain("t1");
  });

  it("answers lookup_unavailable (never an error) when no geocoder is wired", async () => {
    const result = await dispatchTool(makeDeps(callRow), REAL_CALL_ID, "check_delivery_address", {
      street: "12 Elm St",
    });
    expect(result.result).toMatchObject({ status: "lookup_unavailable" });
  });

  it("invalid arguments get the generic fallback", async () => {
    const result = await dispatchTool(makeDeps(callRow), REAL_CALL_ID, "check_delivery_address", {
      city: "Richardson",
    });
    expect(result.result).toMatchObject({ fallback: true });
  });
});
