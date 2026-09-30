import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../_shared/logger.ts";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import {
  createBooking,
  createBookingIdempotencyKey,
  findCommittedBooking,
  INVALID_TIME_MESSAGE,
  START_IN_PAST_MESSAGE,
  TOO_SOON_MESSAGE,
} from "./create_booking.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "generic",
  isTestCall: false,
};

// CALL-8: UUID-shaped (matching a real `resources.id`) so the exact-match
// tier is actually bound; a non-UUID value skips it (dedicated test below).
const RESOURCE_ID = "11111111-1111-1111-1111-111111111111";
const args = {
  resource_id: RESOURCE_ID,
  start: "2026-01-15T14:00:00.000Z",
  end: "2026-01-15T14:30:00.000Z",
  customer: { name: "Jordan Lee", phone: "555-123-4567" },
};
const WRONG_BUT_UUID_SHAPED_ID = "00000000-0000-0000-0000-000000000099";
const OFFERING_ID = "22222222-2222-2222-2222-222222222222";

/** What the preflight statement returns when nothing is special: no
 * replay, the exact resource matched, offering fine, start in the future. */
interface PreflightFixture {
  replay_id: string | null;
  replay_start: string | Date | null;
  replay_end: string | Date | null;
  exact_resource_id: string | null;
  first_available_resource_id: string | null;
  offering_ok: boolean;
  start_in_past: boolean;
  too_soon?: boolean;
  tz: string | null;
  deposit_overrides: Record<string, unknown> | null;
}

const PREFLIGHT_OK: PreflightFixture = {
  replay_id: null,
  replay_start: null,
  replay_end: null,
  exact_resource_id: RESOURCE_ID,
  first_available_resource_id: null,
  offering_ok: true,
  start_in_past: false,
  tz: null,
  deposit_overrides: null,
};

const WRITTEN = {
  id: "booking_1",
  start_at: args.start,
  end_at: args.end,
  customer_id: "customer_1",
  customer_metadata: {},
};

/**
 * Positions of the write statement's bound values (0-based), in the order
 * they appear in `create_booking:write`: the customer upsert's four values
 * plus the consent flag, then the booking insert's fourteen.
 */
const W = {
  consent: 3,
  hasConsent: 4,
  resourceId: 6,
  offeringId: 7,
  status: 10,
  idempotencyKey: 13,
  structuredPayload: 14,
  quotedRate: 15,
  holdExpiresAt: 16,
  isTest: 17,
} as const;

/** Positions of the preflight statement's bound values (0-based). */
const P = { exactResourceId: 2, lookupFirstAvailable: 5, isMotel: 32 } as const;

type Reply = { rows?: unknown[]; throws?: unknown };

interface Recorded {
  text: string;
  values: unknown[];
}

/**
 * Query-text-routed fake `sql`. Statements are identified by their marker
 * comment (`create_booking:preflight` / `:write` / `:verify`) or a
 * distinctive fragment; `routes` are checked in order and the first match
 * wins. Every call is recorded.
 */
function makeSql(routes: { match: string; reply: Reply | ((values: unknown[]) => Reply) }[]): {
  sql: SqlClient;
  calls: Recorded[];
  textsMatching: (fragment: string) => Recorded[];
} {
  const calls: Recorded[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const route of routes) {
      if (text.includes(route.match)) {
        const reply = typeof route.reply === "function" ? route.reply(values) : route.reply;
        if (reply.throws) return Promise.reject(reply.throws);
        return Promise.resolve(reply.rows ?? []);
      }
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return {
    sql,
    calls,
    textsMatching: (fragment) => calls.filter((c) => c.text.includes(fragment)),
  };
}

function bookingRoutes(opts: {
  preflight?: Partial<PreflightFixture>;
  write?: Reply;
  extra?: { match: string; reply: Reply }[];
}) {
  return [
    {
      match: "create_booking:preflight",
      reply: { rows: [{ ...PREFLIGHT_OK, ...opts.preflight }] },
    },
    { match: "create_booking:write", reply: opts.write ?? { rows: [WRITTEN] } },
    ...(opts.extra ?? []),
  ];
}

const PREFLIGHT = "create_booking:preflight";

/** Deps whose `defer` only collects, so `calls` holds exactly the
 * statements issued before the answer. */
const DEFERRING_DEPS = {
  logger: createLogger(),
  appBaseUrl: "https://app.example.com",
  defer: () => {},
};
const WRITE = "create_booking:write";

describe("createBooking — HOTPATH statement shape", () => {
  it("the common path is exactly two statements before the answer: one preflight read, one atomic write", async () => {
    const deferred: { label: string; task: () => Promise<void> }[] = [];
    const { sql, calls } = makeSql(bookingRoutes({}));
    const result = await createBooking(sql, ctx, args, {
      logger: createLogger(),
      appBaseUrl: "https://app.example.com",
      defer: (label, task) => deferred.push({ label, task }),
    });
    expect(result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
    expect(
      calls.map((c) =>
        c.text.includes(PREFLIGHT) ? "preflight" : c.text.includes(WRITE) ? "write" : c.text,
      ),
    ).toEqual(["preflight", "write"]);
    // Side effects were handed to `defer`, not run before the answer.
    expect(deferred.map((d) => d.label)).toEqual(["create_booking_post_commit"]);
  });

  it("the write upserts the customer and inserts the booking in ONE statement (atomic: a constraint violation rolls both back)", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, args);
    const write = textsMatching(WRITE)[0]?.text ?? "";
    expect(write).toContain("insert into public.customers");
    expect(write).toContain("insert into public.bookings");
    expect(write).toContain("(select id from c)");
  });

  it("the preflight binds the idempotency key the timeout recovery looks up (one shared definition)", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, args);
    const key = createBookingIdempotencyKey(ctx, args);
    expect(key).toBe(`call_1:${args.start}`);
    expect(textsMatching(PREFLIGHT)[0]?.values).toContain(key);
    expect(textsMatching(WRITE)[0]?.values[W.idempotencyKey]).toBe(key);
  });

  it("fails loudly (never guesses) if the preflight returns no row", async () => {
    const { sql } = makeSql([{ match: PREFLIGHT, reply: { rows: [] } }]);
    await expect(createBooking(sql, ctx, args)).rejects.toThrow("create_booking_preflight_empty");
  });
});

describe("createBooking — input and ownership checks", () => {
  it("rejects an unparseable phone number without touching the DB", async () => {
    const { sql, calls } = makeSql([]);
    const result = await createBooking(sql, ctx, { ...args, customer: { phone: "12345" } });
    expect(result).toEqual({ confirmed: false, reason: "invalid_phone" });
    expect(calls).toHaveLength(0);
  });

  it("EDGE_AUDIT B1: rejects a resource_id that doesn't belong to (or isn't active for) the caller's tenant, when no fallback resolves either", async () => {
    const { sql, calls } = makeSql(
      bookingRoutes({ preflight: { exact_resource_id: null, first_available_resource_id: null } }),
    );
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: false, reason: "resource_not_found" });
    expect(calls.some((c) => c.text.includes(WRITE))).toBe(false);
  });

  it("EDGE_AUDIT B1: rejects an offering_id that doesn't belong to the caller's tenant", async () => {
    const { sql, calls } = makeSql(bookingRoutes({ preflight: { offering_ok: false } }));
    const result = await createBooking(sql, ctx, { ...args, offering_id: OFFERING_ID });
    expect(result).toEqual({ confirmed: false, reason: "offering_not_found" });
    expect(calls.some((c) => c.text.includes(WRITE))).toBe(false);
  });

  it("EDGE_AUDIT B1: a non-UUID offering_id can never be the tenant's — answered without binding it (a bind would throw)", async () => {
    const { sql, calls } = makeSql(bookingRoutes({}));
    const result = await createBooking(sql, ctx, { ...args, offering_id: "off_other_tenant" });
    expect(result).toEqual({ confirmed: false, reason: "offering_not_found" });
    expect(calls).toHaveLength(0);
  });

  it("binds the offering id for the ownership check and the insert when it is UUID-shaped", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, { ...args, offering_id: OFFERING_ID });
    expect(textsMatching(PREFLIGHT)[0]?.values).toContain(OFFERING_ID);
    expect(textsMatching(WRITE)[0]?.values[W.offeringId]).toBe(OFFERING_ID);
  });
});

describe("createBooking — OPS-5 / CALL-8 resource resolution", () => {
  it("OPS-5: resolves a hallucinated resource_id via resource_name when the exact id doesn't match", async () => {
    const warn = vi.fn();
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        preflight: { exact_resource_id: null },
        extra: [{ match: "name ilike", reply: { rows: [{ id: "res_real" }] } }],
      }),
    );
    const result = await createBooking(
      sql,
      ctx,
      { ...args, resource_id: WRONG_BUT_UUID_SHAPED_ID, resource_name: "Bay 2" },
      { logger: { ...createLogger(), warn }, appBaseUrl: "https://example.com" },
    );
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(textsMatching(WRITE)[0]?.values[W.resourceId]).toBe("res_real");
    expect(warn).toHaveBeenCalledWith(
      "create_booking_resource_id_resolved_fallback",
      expect.objectContaining({
        requested_resource_id: WRONG_BUT_UUID_SHAPED_ID,
        resolved_resource_id: "res_real",
      }),
    );
    // With a resource_name the preflight does not compute tier 3.
    expect(textsMatching(PREFLIGHT)[0]?.values[P.lookupFirstAvailable]).toBe(false);
  });

  it("OPS-5: after a resource_name miss, falls through to the first genuinely-available resource", async () => {
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        preflight: { exact_resource_id: null },
        extra: [
          { match: "name ilike", reply: { rows: [] } },
          { match: "from public.availability_slots", reply: { rows: [{ id: "res_open" }] } },
        ],
      }),
    );
    const result = await createBooking(sql, ctx, { ...args, resource_name: "Nope" });
    expect(result).toMatchObject({ confirmed: true });
    expect(textsMatching(WRITE)[0]?.values[W.resourceId]).toBe("res_open");
  });

  it("OPS-5: with no resource_name, uses the first-available resource the preflight already computed (no extra statement)", async () => {
    const { sql, calls, textsMatching } = makeSql(
      bookingRoutes({
        preflight: { exact_resource_id: null, first_available_resource_id: "res_open" },
      }),
    );
    const result = await createBooking(
      sql,
      ctx,
      { ...args, resource_id: WRONG_BUT_UUID_SHAPED_ID },
      DEFERRING_DEPS,
    );
    expect(result).toMatchObject({ confirmed: true });
    expect(textsMatching(WRITE)[0]?.values[W.resourceId]).toBe("res_open");
    expect(calls).toHaveLength(2);
    // The preflight was asked to compute tier 3.
    expect(textsMatching(PREFLIGHT)[0]?.values[P.lookupFirstAvailable]).toBe(true);
  });

  it("CALL-8: resource_id OMITTED entirely binds NULL for the exact-match tier (never undefined)", async () => {
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        preflight: { exact_resource_id: null, first_available_resource_id: "res_open" },
      }),
    );
    const { resource_id: _omit, ...withoutResourceId } = args;
    const result = await createBooking(sql, ctx, withoutResourceId as typeof args);
    expect(result).toMatchObject({ confirmed: true });
    const values = textsMatching(PREFLIGHT)[0]?.values ?? [];
    expect(values).not.toContain(undefined);
    expect(values[P.exactResourceId]).toBeNull();
  });

  it("CALL-8: a non-UUID resource_id like the live-observed 'default' is never bound (Postgres would throw invalid input syntax for type uuid)", async () => {
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        preflight: { exact_resource_id: null, first_available_resource_id: "res_open" },
      }),
    );
    const result = await createBooking(sql, ctx, { ...args, resource_id: "default" });
    expect(result).toMatchObject({ confirmed: true });
    expect(textsMatching(PREFLIGHT)[0]?.values).not.toContain("default");
  });
});

describe("createBooking — idempotency, races and errors", () => {
  it("returns the existing booking on an idempotent replay (same call_id + start), before any other check", async () => {
    const { sql, calls } = makeSql(
      bookingRoutes({
        preflight: {
          replay_id: "booking_1",
          replay_start: args.start,
          replay_end: args.end,
          // A replay's own slot is no longer open and the start may even
          // have passed by now — neither may refuse the replay.
          exact_resource_id: null,
          start_in_past: true,
        },
      }),
    );
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
    expect(calls).toHaveLength(1);
  });

  it("returns confirmed:false/slot_taken on an exclusion-constraint violation (23P01), never throwing", async () => {
    const { sql } = makeSql(
      bookingRoutes({
        write: { throws: { code: "23P01", message: "conflicting key value" } },
        extra: [{ match: "select id, start_at, end_at from public.bookings", reply: { rows: [] } }],
      }),
    );
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: false, reason: "slot_taken" });
  });

  it("returns the race winner's booking when the concurrent insert was actually the same idempotency key", async () => {
    const { sql } = makeSql(
      bookingRoutes({
        write: { throws: { code: "23505", message: "duplicate key" } },
        extra: [
          {
            match: "select id, start_at, end_at from public.bookings",
            reply: { rows: [{ id: "booking_won", start_at: args.start, end_at: args.end }] },
          },
        ],
      }),
    );
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      booking_id: "booking_won",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
  });

  it("re-throws an unrelated DB error rather than masking it as slot_taken", async () => {
    const { sql } = makeSql(bookingRoutes({ write: { throws: new Error("connection reset") } }));
    await expect(createBooking(sql, ctx, args)).rejects.toThrow("connection reset");
  });

  it("HOTPATH: a time the server rejects (Postgres 22007) is still an actionable invalid_time answer, not a generic failure", async () => {
    const { sql } = makeSql([
      {
        match: PREFLIGHT,
        reply: { throws: { code: "22007", message: "invalid input syntax for type timestamp" } },
      },
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      confirmed: false,
      reason: "invalid_time",
      message: INVALID_TIME_MESSAGE,
    });
  });
});

describe("createBooking — owner minimum notice (VOICE-ALERTS-1 review)", () => {
  it("refuses a start inside the owner-set minimum notice and never writes", async () => {
    const { sql, calls } = makeSql(bookingRoutes({ preflight: { too_soon: true } }));
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      confirmed: false,
      reason: "too_soon",
      message: TOO_SOON_MESSAGE,
    });
    expect(calls.some((c) => c.text.includes(WRITE))).toBe(false);
  });

  it("computes the notice in the same preflight statement, from an optional column, only when the owner set one", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, args);
    const text = textsMatching(PREFLIGHT)[0]?.text ?? "";
    expect(text).toContain("to_jsonb(t) ->> 'booking_min_notice_minutes'");
    expect(text).toContain("(select notice from tn) is null then false");
    expect(text).not.toMatch(/t\.booking_min_notice_minutes/);
  });
});

describe("createBooking — HOTPATH past starts and timeout safety", () => {
  it("rejects a start that has already passed (preflight start_in_past) and never writes", async () => {
    const { sql, calls } = makeSql(bookingRoutes({ preflight: { start_in_past: true } }));
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      confirmed: false,
      reason: "start_in_past",
      message: START_IN_PAST_MESSAGE,
    });
    expect(calls.some((c) => c.text.includes(WRITE))).toBe(false);
  });

  it("the past check is computed in the database against now() and the tenant timezone (day-length bookings compare against local midnight)", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, args);
    const text = textsMatching(PREFLIGHT)[0]?.text ?? "";
    expect(text).toContain("< now()");
    // HOTPATH-REVIEW: 23 hours, so the 23-hour spring-forward motel night
    // still counts as a day-length booking.
    expect(text).toContain(">= interval '23 hours'");
    expect(text).not.toContain("interval '1 day'");
    expect(text).toContain("date_trunc('day', now() at time zone (select timezone from tn))");
  });

  it("never starts the write once the dispatcher has aborted (deadline passed)", async () => {
    let aborted = false;
    const { sql, calls } = makeSql([
      {
        match: PREFLIGHT,
        reply: () => {
          // The deadline fires while the preflight is in flight.
          aborted = true;
          return { rows: [PREFLIGHT_OK] };
        },
      },
      { match: WRITE, reply: { rows: [WRITTEN] } },
    ]);
    const result = await createBooking(sql, ctx, args, {
      logger: createLogger(),
      appBaseUrl: "https://app.example.com",
      isAborted: () => aborted,
    });
    expect(result).toEqual({ confirmed: false, reason: "not_completed" });
    expect(calls.some((c) => c.text.includes(WRITE))).toBe(false);
  });

  it("renders the booked times in the tenant's timezone with an explicit offset", async () => {
    const { sql } = makeSql(
      bookingRoutes({
        preflight: { tz: "America/New_York" },
        write: {
          rows: [
            {
              ...WRITTEN,
              start_at: new Date("2026-01-15T14:00:00.000Z"),
              end_at: new Date("2026-01-15T14:30:00.000Z"),
            },
          ],
        },
      }),
    );
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: "2026-01-15T09:00:00-05:00",
      end: "2026-01-15T09:30:00-05:00",
    });
  });
});

describe("createBooking — writes", () => {
  it("CALL-6: writes bookings.is_test from ctx.isTestCall (true for a test/placeholder call)", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, { ...ctx, isTestCall: true }, args);
    expect(textsMatching(WRITE)[0]?.values[W.isTest]).toBe(true);
  });

  it("CALL-6: writes bookings.is_test=false for a real (non-test) call", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, { ...ctx, isTestCall: false }, args);
    expect(textsMatching(WRITE)[0]?.values[W.isTest]).toBe(false);
  });

  it("captures the consent answer in the same write, bound as a raw object (never pre-stringified)", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, { ...args, consent: { sms: true } });
    const values = textsMatching(WRITE)[0]?.values ?? [];
    expect(values[W.hasConsent]).toBe(true);
    expect(typeof values[W.consent]).toBe("object");
    expect(values[W.consent]).toMatchObject({ sms: true, call: false, call_id: "call_1" });
  });

  it("leaves an existing consent untouched when the caller gave no answer this call", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, args);
    const values = textsMatching(WRITE)[0]?.values ?? [];
    expect(values[W.hasConsent]).toBe(false);
    expect(values[W.consent]).toBeNull();
  });
});

describe("createBooking — post-commit side effects", () => {
  it("EDGE_AUDIT B4: enqueues an adapter_push_queue booking entry per connected adapter (inline when no defer is given)", async () => {
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        extra: [
          {
            match: "from public.adapter_connections",
            reply: { rows: [{ provider: "shopmonkey" }] },
          },
        ],
      }),
    );
    const result = await createBooking(sql, ctx, args);
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(textsMatching("pgmq.send")).toHaveLength(1);
  });

  it("with defer, nothing post-commit runs until the deferred task does", async () => {
    const deferred: (() => Promise<void>)[] = [];
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        extra: [
          {
            match: "from public.adapter_connections",
            reply: { rows: [{ provider: "shopmonkey" }] },
          },
        ],
      }),
    );
    await createBooking(sql, ctx, args, {
      logger: createLogger(),
      appBaseUrl: "https://app.example.com",
      defer: (_label, task) => deferred.push(task),
    });
    expect(textsMatching("pgmq.send")).toHaveLength(0);
    for (const task of deferred) await task();
    expect(textsMatching("pgmq.send")).toHaveLength(1);
  });

  it("a failing side effect never turns a committed booking into a failure — it is logged instead", async () => {
    const error = vi.fn();
    const logger: Logger = { ...createLogger(), error };
    const { sql } = makeSql(
      bookingRoutes({
        extra: [
          { match: "update public.call_logs", reply: { throws: new Error("call_logs down") } },
          { match: "from public.adapter_connections", reply: { throws: new Error("queue down") } },
        ],
      }),
    );
    const result = await createBooking(
      sql,
      { ...ctx, vertical: "legal" },
      { ...args, structured_payload: { matter_type: "contract_review" } },
      { logger, appBaseUrl: "https://app.example.com" },
    );
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(error).toHaveBeenCalledWith(
      "create_booking_post_commit_failed",
      expect.objectContaining({ effect: "call_logs_structured_payload" }),
    );
    expect(error).toHaveBeenCalledWith(
      "create_booking_post_commit_failed",
      expect.objectContaining({ effect: "adapter_push" }),
    );
  });
});

describe("createBooking — motel deposit hold (GAP_REGISTER.md §2 Motel item 4)", () => {
  const motelCtx: CallContext = { ...ctx, vertical: "motel" };

  it("fetches the deposit overrides inside the preflight only for a motel (no extra statement)", async () => {
    const { sql, calls, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, motelCtx, args, DEFERRING_DEPS);
    expect(calls).toHaveLength(2);
    expect(textsMatching(PREFLIGHT)[0]?.text).toContain("from public.agent_configs");
    expect(textsMatching(PREFLIGHT)[0]?.values[P.isMotel]).toBe(true);
    const nonMotel = makeSql(bookingRoutes({}));
    await createBooking(nonMotel.sql, ctx, args);
    expect(nonMotel.textsMatching(PREFLIGHT)[0]?.values[P.isMotel]).toBe(false);
  });

  it("inserts status='scheduled' with a hold_expires_at when the tenant requires a deposit", async () => {
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        preflight: {
          deposit_overrides: { deposit_policy: { required: true, hold_window_hours: 48 } },
        },
      }),
    );
    const result = await createBooking(sql, motelCtx, args);
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    const values = textsMatching(WRITE)[0]?.values ?? [];
    expect(values[W.status]).toBe("scheduled");
    expect(values[W.holdExpiresAt]).toBeTruthy();
  });

  it("inserts status='confirmed' (unchanged) when no deposit policy is configured", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({ preflight: { deposit_overrides: {} } }));
    const result = await createBooking(sql, motelCtx, args);
    expect(result).toMatchObject({ confirmed: true });
    expect(textsMatching(WRITE)[0]?.values[W.status]).toBe("confirmed");
    expect(textsMatching(WRITE)[0]?.values[W.holdExpiresAt]).toBeNull();
  });

  it("20260910170000_motel_hold_exclusion.sql: rejects a second caller for the same resource/overlapping range while an unexpired deposit hold is active", async () => {
    const { sql } = makeSql(
      bookingRoutes({
        preflight: { deposit_overrides: { deposit_policy: { required: true } } },
        write: {
          throws: {
            code: "23P01",
            message:
              'conflicting key value violates exclusion constraint "bookings_hold_exclusion"',
          },
        },
        extra: [{ match: "select id, start_at, end_at from public.bookings", reply: { rows: [] } }],
      }),
    );
    const result = await createBooking(sql, motelCtx, args);
    expect(result).toEqual({ confirmed: false, reason: "slot_taken" });
  });

  it("mirrors a valid quoted_rate_cents from structured_payload onto the bookings column", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    const result = await createBooking(sql, motelCtx, {
      ...args,
      structured_payload: { room_type: "queen", quoted_rate_cents: 12900 },
    });
    expect(result).toMatchObject({ confirmed: true });
    expect(textsMatching(WRITE)[0]?.values[W.quotedRate]).toBe(12900);
  });

  it("never mirrors quoted_rate_cents for a non-motel vertical", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    const result = await createBooking(sql, ctx, {
      ...args,
      structured_payload: { quoted_rate_cents: 12900 },
    });
    expect(result).toMatchObject({ confirmed: true });
    expect(textsMatching(WRITE)[0]?.values[W.quotedRate]).toBeNull();
  });
});

describe("createBooking — customers.metadata vehicles/pets (GAP_REGISTER.md §1.8)", () => {
  it("auto: appends a new vehicle to customers.metadata.vehicles", async () => {
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        write: {
          rows: [
            { ...WRITTEN, customer_metadata: { vehicles: [{ make: "Toyota", model: "Camry" }] } },
          ],
        },
      }),
    );
    const result = await createBooking(
      sql,
      { ...ctx, vertical: "auto" },
      {
        ...args,
        structured_payload: { vehicle_year: 2019, vehicle_make: "Honda", vehicle_model: "Civic" },
      },
    );
    expect(result).toMatchObject({ confirmed: true });
    const merged = textsMatching("update public.customers")[0]?.values[0];
    // Regression (CALL-3 jsonb double-encoding fix): bound as the raw object.
    expect(typeof merged).not.toBe("string");
    expect(merged).toEqual({
      vehicles: [
        { make: "Toyota", model: "Camry" },
        { year: 2019, make: "Honda", model: "Civic" },
      ],
    });
  });

  it("auto: never writes a duplicate vehicle already on file", async () => {
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        write: {
          rows: [
            {
              ...WRITTEN,
              customer_metadata: { vehicles: [{ year: 2019, make: "Honda", model: "Civic" }] },
            },
          ],
        },
      }),
    );
    await createBooking(
      sql,
      { ...ctx, vertical: "auto" },
      {
        ...args,
        structured_payload: { vehicle_year: 2019, vehicle_make: "Honda", vehicle_model: "Civic" },
      },
    );
    expect(textsMatching("update public.customers")).toHaveLength(0);
  });

  it("vet: appends a new pet to customers.metadata.pets", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(
      sql,
      { ...ctx, vertical: "vet" },
      { ...args, structured_payload: { pet_name: "Rex", species: "dog", breed: "Lab" } },
    );
    const merged = textsMatching("update public.customers")[0]?.values[0];
    expect(typeof merged).not.toBe("string");
    expect(merged).toEqual({ pets: [{ name: "Rex", species: "dog", breed: "Lab" }] });
  });
});

describe("createBooking — call_logs.structured_booking_payload (GAP_REGISTER.md §1.7)", () => {
  it("merges the captured payload onto call_logs when present", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(
      sql,
      { ...ctx, vertical: "legal" },
      { ...args, structured_payload: { matter_type: "contract_review" } },
    );
    const update = textsMatching("update public.call_logs")[0];
    expect(update?.text).toContain("coalesce(structured_booking_payload, '{}'::jsonb) ||");
    expect(update?.values[0]).toEqual({ matter_type: "contract_review" });
  });

  it("never writes call_logs.structured_booking_payload when nothing was captured", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, args);
    expect(textsMatching("update public.call_logs")).toHaveLength(0);
  });
});

describe("createBooking — dental intake token (FIX_REQUESTS.md)", () => {
  const dentalCtx: CallContext = { ...ctx, vertical: "dental" };
  const deps = { logger: createLogger(), appBaseUrl: "https://app.example.com" };

  it("issues a dental intake token + SMS after a successful dental booking when deps are given", async () => {
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        extra: [{ match: "into public.intake_tokens", reply: { rows: [{ id: "intake_1" }] } }],
      }),
    );
    await createBooking(sql, dentalCtx, args, deps);
    expect(textsMatching("into public.intake_tokens")).toHaveLength(1);
    expect(
      textsMatching("into public.messages_outbound").some((c) =>
        c.text.includes("related_booking_id"),
      ),
    ).toBe(true);
  });

  it("skips the intake-token step for a non-dental vertical even when deps are given", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, args, deps);
    expect(textsMatching("into public.intake_tokens")).toHaveLength(0);
  });

  it("skips the intake-token step (and never throws) when deps are omitted, even for a dental tenant", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    const result = await createBooking(sql, dentalCtx, args);
    expect(result.confirmed).toBe(true);
    expect(textsMatching("into public.intake_tokens")).toHaveLength(0);
  });

  it("never blocks/throws the booking when the intake-token insert itself fails (logged under its historical event name)", async () => {
    const error = vi.fn();
    const { sql } = makeSql(
      bookingRoutes({
        extra: [{ match: "into public.intake_tokens", reply: { throws: new Error("db down") } }],
      }),
    );
    const result = await createBooking(sql, dentalCtx, args, {
      ...deps,
      logger: { ...createLogger(), error },
    });
    expect(result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
    expect(error).toHaveBeenCalledWith(
      "dental_intake_token_issue_failed",
      expect.objectContaining({ booking_id: "booking_1" }),
    );
  });
});

describe("createBooking — structured_payload runtime validation (GAP_REGISTER.md §1.7)", () => {
  it("auto: sanitizes a malformed field (non-numeric vehicle_year) rather than persisting it verbatim", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    const result = await createBooking(
      sql,
      { ...ctx, vertical: "auto" },
      {
        ...args,
        structured_payload: {
          vehicle_year: "not_a_number",
          vehicle_make: "Honda",
          drop_off_or_wait: "not_a_valid_enum_value",
        },
      },
    );
    expect(result).toMatchObject({ confirmed: true });
    const inserted = textsMatching(WRITE)[0]?.values[W.structuredPayload];
    // Regression (CALL-3 jsonb double-encoding fix): bound as the raw object.
    expect(typeof inserted).not.toBe("string");
    expect(inserted).toEqual({ vehicle_make: "Honda" });
  });
});

describe("createBooking — HOTPATH-REVIEW time arguments", () => {
  it("answers invalid_time for a start JavaScript cannot parse, before ANY statement (the stock serializer would throw inside the client)", async () => {
    const { sql, calls } = makeSql(bookingRoutes({}));
    for (const start of ["tomorrow", "10:30 AM", "Sep 29 2026 10am"]) {
      const result = await createBooking(sql, ctx, { ...args, start });
      expect(result).toEqual({
        confirmed: false,
        reason: "invalid_time",
        message: INVALID_TIME_MESSAGE,
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("answers invalid_time for an unparseable end, a backwards range, and a zero-length booking (which would never collide in the exclusion constraint)", async () => {
    const { sql, calls } = makeSql(bookingRoutes({}));
    for (const bad of [
      { start: args.start, end: "later" },
      { start: args.end, end: args.start },
      { start: args.start, end: args.start },
    ]) {
      const result = await createBooking(sql, ctx, { ...args, ...bad });
      expect(result).toMatchObject({ confirmed: false, reason: "invalid_time" });
    }
    expect(calls).toHaveLength(0);
  });

  it("binds the normalized instant (what postgres.js would send anyway) in the preflight and the write, never the raw string", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, {
      ...args,
      start: "2026-01-15T09:00:00-05:00",
      end: "2026-01-15T09:30:00-05:00",
    });
    const preflight = textsMatching(PREFLIGHT)[0]?.values ?? [];
    expect(preflight).toContain("2026-01-15T14:00:00.000Z");
    expect(preflight).not.toContain("2026-01-15T09:00:00-05:00");
    const write = textsMatching(WRITE)[0]?.values ?? [];
    expect(write).toContain("2026-01-15T14:00:00.000Z");
    expect(write).toContain("2026-01-15T14:30:00.000Z");
    expect(write).not.toContain("2026-01-15T09:00:00-05:00");
  });

  it("the idempotency key is the same for the same instant however it is written, so a reformatted retry is a replay (live-reproduced before: slot_taken for the caller's own booking, or a second booking on another resource)", () => {
    const local = createBookingIdempotencyKey(ctx, { start: "2026-01-15T09:00:00-05:00" });
    expect(createBookingIdempotencyKey(ctx, { start: "2026-01-15T14:00:00Z" })).toBe(local);
    expect(createBookingIdempotencyKey(ctx, { start: "2026-01-15T14:00:00.000Z" })).toBe(local);
    // Unchanged for the UTC form check_availability used to return, so keys
    // written before this change still match.
    expect(local).toBe("call_1:2026-01-15T14:00:00.000Z");
    // Different instant, different key.
    expect(createBookingIdempotencyKey(ctx, { start: "2026-01-15T09:00:00-04:00" })).not.toBe(
      local,
    );
  });

  it("a retry with the same instant in another format finds the first booking in the preflight replay and never writes again", async () => {
    const firstKey = createBookingIdempotencyKey(ctx, { start: "2026-01-15T09:00:00-05:00" });
    const { sql, calls } = makeSql([
      {
        match: PREFLIGHT,
        reply: (values) => ({
          rows: [
            values.includes(firstKey)
              ? {
                  ...PREFLIGHT_OK,
                  replay_id: "booking_1",
                  replay_start: args.start,
                  replay_end: args.end,
                }
              : PREFLIGHT_OK,
          ],
        }),
      },
      { match: WRITE, reply: { rows: [WRITTEN] } },
    ]);
    const result = await createBooking(sql, ctx, { ...args, resource_id: undefined });
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(calls.some((c) => c.text.includes(WRITE))).toBe(false);
  });
});

describe("findCommittedBooking (HOTPATH timeout recovery read)", () => {
  it("returns the committed booking in the same shape as a successful createBooking", async () => {
    const { sql, calls } = makeSql([
      {
        match: "create_booking:verify",
        reply: {
          rows: [
            {
              id: "booking_9",
              start_at: new Date("2026-01-15T14:00:00.000Z"),
              end_at: new Date("2026-01-15T14:30:00.000Z"),
              tz: "America/Chicago",
            },
          ],
        },
      },
    ]);
    const found = await findCommittedBooking(sql, ctx, "call_1:2026-01-15T14:00:00.000Z");
    expect(found).toEqual({
      booking_id: "booking_9",
      confirmed: true,
      start: "2026-01-15T08:00:00-06:00",
      end: "2026-01-15T08:30:00-06:00",
    });
    // Tenant-scoped, keyed by the idempotency key.
    expect(calls[0]?.values).toEqual(["tenant_1", "tenant_1", "call_1:2026-01-15T14:00:00.000Z"]);
  });

  it("returns null when nothing committed under the key", async () => {
    const { sql } = makeSql([{ match: "create_booking:verify", reply: { rows: [] } }]);
    expect(await findCommittedBooking(sql, ctx, "k")).toBeNull();
  });
});

describe("createBooking — F-OFFERING-1: the offering and its price reach the row", () => {
  const GUESSED = "33333333-3333-3333-3333-333333333333";

  it("resolves the offering server-side from the visit reason when the model sent no offering_id, and quotes its price", async () => {
    const { sql, textsMatching } = makeSql(
      bookingRoutes({
        preflight: { offering_guess_id: GUESSED, offering_guess_price_cents: 6500 } as never,
      }),
    );
    const result = await createBooking(sql, ctx, {
      ...args,
      structured_payload: { visit_reason: "Wellness exam" },
    });
    expect(result).toMatchObject({ confirmed: true });
    const pre = textsMatching(PREFLIGHT)[0];
    expect(pre?.values).toContain("Wellness exam");
    const write = textsMatching(WRITE)[0]?.values ?? [];
    expect(write[W.offeringId]).toBe(GUESSED);
    expect(write[W.quotedRate]).toBe(6500);
  });

  it("uses the model's own offering_id and that offering's price when it sent one", async () => {
    const { sql, textsMatching } = makeSql(
      bookingRoutes({ preflight: { offering_price_cents: 4200 } as never }),
    );
    await createBooking(sql, ctx, { ...args, offering_id: OFFERING_ID });
    const write = textsMatching(WRITE)[0]?.values ?? [];
    expect(write[W.offeringId]).toBe(OFFERING_ID);
    expect(write[W.quotedRate]).toBe(4200);
  });

  it("writes no offering and no rate when nothing matched (never a guess between two)", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, {
      ...args,
      structured_payload: { visit_reason: "Something odd" },
    });
    const write = textsMatching(WRITE)[0]?.values ?? [];
    expect(write[W.offeringId]).toBeNull();
    expect(write[W.quotedRate]).toBeNull();
  });

  it("an exact-name match is the only kind: the guess statement compares lower(name) for this tenant's active offerings", async () => {
    const { sql, textsMatching } = makeSql(bookingRoutes({}));
    await createBooking(sql, ctx, args);
    const text = textsMatching(PREFLIGHT)[0]?.text ?? "";
    expect(text).toContain("case when count(*) = 1 then (array_agg(o.id))[1] end");
    expect(text).toContain("lower(o.name) in (");
    expect(text).toContain("o.tenant_id =");
  });
});
