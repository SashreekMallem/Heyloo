import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../_shared/logger.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { createBooking } from "./create_booking.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "generic",
};

type Step = { rows?: unknown[]; throws?: unknown };

function makeStepSql(steps: Step[]): { sql: SqlClient; callCount: () => number } {
  let i = 0;
  const sql = (() => {
    const step = steps[i];
    i += 1;
    if (!step) return Promise.resolve([]);
    if (step.throws) return Promise.reject(step.throws);
    return Promise.resolve(step.rows ?? []);
  }) as SqlClient;
  return { sql, callCount: () => i };
}

const args = {
  resource_id: "res_1",
  start: "2026-01-15T14:00:00.000Z",
  end: "2026-01-15T14:30:00.000Z",
  customer: { name: "Jordan Lee", phone: "555-123-4567" },
};

const RESOURCE_FOUND: Step = { rows: [{ id: "res_1" }] };
const NO_ADAPTER_CONNECTIONS: Step = { rows: [] };

describe("createBooking", () => {
  it("rejects an unparseable phone number without touching the DB for the insert", async () => {
    const { sql } = makeStepSql([]);
    const result = await createBooking(sql, ctx, { ...args, customer: { phone: "12345" } });
    expect(result).toEqual({ confirmed: false, reason: "invalid_phone" });
  });

  it("EDGE_AUDIT B1: rejects a resource_id that doesn't belong to (or isn't active for) the caller's tenant, when no fallback resolves either", async () => {
    const { sql } = makeStepSql([
      { rows: [] }, // exact resource_id match: none
      { rows: [] }, // first-available fallback (no resource_name given): none open
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: false, reason: "resource_not_found" });
  });

  it("OPS-5: resolves a hallucinated resource_id server-side via resource_name when the exact id doesn't match", async () => {
    const warn = vi.fn();
    const { sql } = makeStepSql([
      { rows: [] }, // exact resource_id match: none (the model invented "res_bogus")
      { rows: [{ id: "res_real" }] }, // resource_name match: found
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }] }, // booking insert
      NO_ADAPTER_CONNECTIONS,
    ]);
    const result = await createBooking(
      sql,
      ctx,
      { ...args, resource_id: "res_bogus", resource_name: "Bay 2" },
      { logger: { ...createLogger(), warn }, appBaseUrl: "https://example.com" },
    );
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(warn).toHaveBeenCalledWith(
      "create_booking_resource_id_resolved_fallback",
      expect.objectContaining({
        requested_resource_id: "res_bogus",
        resolved_resource_id: "res_real",
      }),
    );
  });

  it("OPS-5: falls back to the first genuinely-available resource when the id is wrong and no resource_name was given", async () => {
    const { sql } = makeStepSql([
      { rows: [] }, // exact resource_id match: none
      { rows: [{ id: "res_open" }] }, // first-available fallback: one resource has an open slot
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }] }, // booking insert
      NO_ADAPTER_CONNECTIONS,
    ]);
    const result = await createBooking(sql, ctx, { ...args, resource_id: "res_bogus" });
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
  });

  it("EDGE_AUDIT B1: rejects an offering_id that doesn't belong to the caller's tenant", async () => {
    const { sql } = makeStepSql([
      RESOURCE_FOUND,
      { rows: [] }, // offering ownership check: no match
    ]);
    const result = await createBooking(sql, ctx, { ...args, offering_id: "off_other_tenant" });
    expect(result).toEqual({ confirmed: false, reason: "offering_not_found" });
  });

  it("returns the existing booking on an idempotent replay (same call_id + start)", async () => {
    const { sql } = makeStepSql([
      RESOURCE_FOUND,
      { rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }] }, // idempotency pre-check
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
  });

  it("creates a new booking end-to-end: customer upsert then insert", async () => {
    const { sql } = makeStepSql([
      RESOURCE_FOUND,
      { rows: [] }, // idempotency pre-check: none found
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }] }, // booking insert
      NO_ADAPTER_CONNECTIONS, // adapter-push producer: no connected adapter
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
  });

  it("EDGE_AUDIT B4: enqueues an adapter_push_queue booking entry per connected adapter", async () => {
    const enqueueCalls: unknown[] = [];
    let i = 0;
    const steps: Step[] = [
      RESOURCE_FOUND,
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }] }, // booking insert
      { rows: [{ provider: "shopmonkey" }] }, // adapter-push producer: one connected adapter
    ];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.send")) {
        enqueueCalls.push(values);
        return Promise.resolve([]);
      }
      const step = steps[i];
      i += 1;
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;

    const result = await createBooking(sql, ctx, args);
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(enqueueCalls).toHaveLength(1);
  });

  it("returns confirmed:false/slot_taken on an exclusion-constraint violation (23P01), never throwing", async () => {
    const { sql } = makeStepSql([
      RESOURCE_FOUND,
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { throws: { code: "23P01", message: "conflicting key value" } }, // booking insert races
      { rows: [] }, // race-winner re-check: nobody with this idempotency key
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: false, reason: "slot_taken" });
  });

  it("returns the race winner's booking when the concurrent insert was actually the same idempotency key", async () => {
    const { sql } = makeStepSql([
      RESOURCE_FOUND,
      { rows: [] },
      { rows: [{ id: "customer_1" }] },
      { throws: { code: "23505", message: "duplicate key" } },
      { rows: [{ id: "booking_won", start_at: args.start, end_at: args.end }] },
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      booking_id: "booking_won",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
  });

  it("re-throws an unrelated DB error rather than masking it as slot_taken", async () => {
    const { sql } = makeStepSql([
      RESOURCE_FOUND,
      { rows: [] },
      { rows: [{ id: "customer_1" }] },
      { throws: new Error("connection reset") },
    ]);
    await expect(createBooking(sql, ctx, args)).rejects.toThrow("connection reset");
  });
});

/** Query-text-routed mock for the branch-heavy scenarios below (motel
 * deposit hold, metadata merge, structured_booking_payload) — a fixed
 * positional step list is too brittle once behavior branches on vertical/
 * payload content. */
function makeRoutedSql(routes: { match: string; rows?: unknown[]; throws?: unknown }[]): {
  sql: SqlClient;
  queries: string[];
} {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    queries.push(text);
    for (const route of routes) {
      if (text.includes(route.match)) {
        if (route.throws) return Promise.reject(route.throws);
        return Promise.resolve(route.rows ?? []);
      }
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, queries };
}

describe("createBooking — motel deposit hold (GAP_REGISTER.md §2 Motel item 4)", () => {
  const motelCtx: CallContext = { ...ctx, vertical: "motel" };

  it("inserts status='scheduled' with a hold_expires_at when the tenant requires a deposit", async () => {
    let insertedStatus: unknown;
    let insertedHoldExpiresAt: unknown;
    const { sql } = (() => {
      const routed = makeRoutedSql([
        { match: "from public.resources", rows: [{ id: "res_1" }] },
        { match: "from public.bookings", rows: [] }, // idempotency pre-check
        { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
        {
          match: "from public.agent_configs",
          rows: [
            {
              dynamic_variable_overrides: {
                deposit_policy: { required: true, hold_window_hours: 48 },
              },
            },
          ],
        },
        { match: "from public.adapter_connections", rows: [] },
      ]);
      const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join(" ");
        if (text.includes("insert into public.bookings")) {
          insertedStatus = values[6];
          insertedHoldExpiresAt = values.at(-1);
          return Promise.resolve([{ id: "booking_1", start_at: args.start, end_at: args.end }]);
        }
        return (routed.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
          strings,
          ...values,
        );
      }) as SqlClient;
      return { sql };
    })();

    const result = await createBooking(sql, motelCtx, args);
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(insertedStatus).toBe("scheduled");
    expect(insertedHoldExpiresAt).toBeTruthy();
  });

  it("inserts status='confirmed' (unchanged) when no deposit policy is configured", async () => {
    let insertedStatus: unknown;
    const routed = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      { match: "from public.agent_configs", rows: [{ dynamic_variable_overrides: {} }] },
      { match: "from public.adapter_connections", rows: [] },
    ]);
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.bookings")) {
        insertedStatus = values[6];
        return Promise.resolve([{ id: "booking_1", start_at: args.start, end_at: args.end }]);
      }
      return (routed.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
        strings,
        ...values,
      );
    }) as SqlClient;

    const result = await createBooking(sql, motelCtx, args);
    expect(result).toMatchObject({ confirmed: true });
    expect(insertedStatus).toBe("confirmed");
  });

  it("20260910170000_motel_hold_exclusion.sql: rejects a second caller for the same resource/overlapping range while an unexpired deposit hold is active", async () => {
    // bookings_hold_exclusion (exclude using gist ... where status='scheduled'
    // and hold_expires_at is not null) raises the same 23P01 exclusion-
    // violation code as the confirmed-only constraint it sits alongside —
    // exercising the existing EXCLUSION_VIOLATION catch path, which is the
    // only place a second overlapping hold attempt can be rejected from.
    const routed = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] }, // idempotency pre-check: none found
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      {
        match: "from public.agent_configs",
        rows: [{ dynamic_variable_overrides: { deposit_policy: { required: true } } }],
      },
    ]);
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.bookings")) {
        return Promise.reject({
          code: "23P01",
          message: 'conflicting key value violates exclusion constraint "bookings_hold_exclusion"',
        });
      }
      if (text.includes("select id, start_at, end_at from public.bookings")) {
        // race-winner re-check by idempotency_key: this caller never won,
        // and the existing hold was inserted under a different call's key.
        return Promise.resolve([]);
      }
      return (routed.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
        strings,
        ...values,
      );
    }) as SqlClient;

    const result = await createBooking(sql, motelCtx, args);
    expect(result).toEqual({ confirmed: false, reason: "slot_taken" });
  });

  it("mirrors a valid quoted_rate_cents from structured_payload onto the bookings column", async () => {
    let insertedQuotedRate: unknown;
    const routed = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      { match: "from public.agent_configs", rows: [{ dynamic_variable_overrides: {} }] },
      { match: "from public.adapter_connections", rows: [] },
      { match: "update public.call_logs", rows: [] },
    ]);
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.bookings")) {
        insertedQuotedRate = values.at(-2);
        return Promise.resolve([{ id: "booking_1", start_at: args.start, end_at: args.end }]);
      }
      return (routed.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
        strings,
        ...values,
      );
    }) as SqlClient;

    const result = await createBooking(sql, motelCtx, {
      ...args,
      structured_payload: { room_type: "queen", quoted_rate_cents: 12900 },
    });
    expect(result).toMatchObject({ confirmed: true });
    expect(insertedQuotedRate).toBe(12900);
  });

  it("never mirrors quoted_rate_cents for a non-motel vertical", async () => {
    let insertedQuotedRate: unknown;
    const routed = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      { match: "from public.adapter_connections", rows: [] },
      { match: "update public.call_logs", rows: [] },
    ]);
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.bookings")) {
        insertedQuotedRate = values.at(-2);
        return Promise.resolve([{ id: "booking_1", start_at: args.start, end_at: args.end }]);
      }
      return (routed.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
        strings,
        ...values,
      );
    }) as SqlClient;

    const result = await createBooking(sql, ctx, {
      ...args,
      structured_payload: { quoted_rate_cents: 12900 },
    });
    expect(result).toMatchObject({ confirmed: true });
    expect(insertedQuotedRate).toBeNull();
  });
});

describe("createBooking — customers.metadata vehicles/pets (GAP_REGISTER.md §1.8)", () => {
  it("auto: appends a new vehicle to customers.metadata.vehicles", async () => {
    let mergedMetadata: unknown;
    const routed = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      {
        match: "into public.customers",
        rows: [{ id: "customer_1", metadata: { vehicles: [{ make: "Toyota", model: "Camry" }] } }],
      },
      { match: "from public.adapter_connections", rows: [] },
      { match: "update public.call_logs", rows: [] },
    ]);
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.bookings")) {
        return Promise.resolve([{ id: "booking_1", start_at: args.start, end_at: args.end }]);
      }
      if (text.includes("update public.customers") && text.includes("metadata")) {
        mergedMetadata = values[0];
        return Promise.resolve([]);
      }
      return (routed.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
        strings,
        ...values,
      );
    }) as SqlClient;

    const autoCtx: CallContext = { ...ctx, vertical: "auto" };
    const result = await createBooking(sql, autoCtx, {
      ...args,
      structured_payload: { vehicle_year: 2019, vehicle_make: "Honda", vehicle_model: "Civic" },
    });
    expect(result).toMatchObject({ confirmed: true });
    // Regression (CALL-3 jsonb double-encoding fix): the metadata merge
    // value bound to the ::jsonb parameter must be the raw object, never a
    // caller-pre-stringified JSON string.
    expect(typeof mergedMetadata).not.toBe("string");
    expect(mergedMetadata).toEqual({
      vehicles: [
        { make: "Toyota", model: "Camry" },
        { year: 2019, make: "Honda", model: "Civic" },
      ],
    });
  });

  it("auto: never writes a duplicate vehicle already on file", async () => {
    let metadataWriteCount = 0;
    const routed = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      {
        match: "into public.customers",
        rows: [
          {
            id: "customer_1",
            metadata: { vehicles: [{ year: 2019, make: "Honda", model: "Civic" }] },
          },
        ],
      },
      { match: "from public.adapter_connections", rows: [] },
      { match: "update public.call_logs", rows: [] },
    ]);
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.bookings")) {
        return Promise.resolve([{ id: "booking_1", start_at: args.start, end_at: args.end }]);
      }
      if (text.includes("update public.customers") && text.includes("metadata")) {
        metadataWriteCount += 1;
        return Promise.resolve([]);
      }
      return (routed.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
        strings,
        ...values,
      );
    }) as SqlClient;

    const autoCtx: CallContext = { ...ctx, vertical: "auto" };
    await createBooking(sql, autoCtx, {
      ...args,
      structured_payload: { vehicle_year: 2019, vehicle_make: "Honda", vehicle_model: "Civic" },
    });
    expect(metadataWriteCount).toBe(0);
  });

  it("vet: appends a new pet to customers.metadata.pets", async () => {
    let mergedMetadata: unknown;
    const routed = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      { match: "from public.adapter_connections", rows: [] },
      { match: "update public.call_logs", rows: [] },
    ]);
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.bookings")) {
        return Promise.resolve([{ id: "booking_1", start_at: args.start, end_at: args.end }]);
      }
      if (text.includes("update public.customers") && text.includes("metadata")) {
        mergedMetadata = values[0];
        return Promise.resolve([]);
      }
      return (routed.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
        strings,
        ...values,
      );
    }) as SqlClient;

    const vetCtx: CallContext = { ...ctx, vertical: "vet" };
    await createBooking(sql, vetCtx, {
      ...args,
      structured_payload: { pet_name: "Rex", species: "dog", breed: "Lab" },
    });
    // Regression (CALL-3 jsonb double-encoding fix): the metadata merge
    // value bound to the ::jsonb parameter must be the raw object, never a
    // caller-pre-stringified JSON string.
    expect(typeof mergedMetadata).not.toBe("string");
    expect(mergedMetadata).toEqual({
      pets: [{ name: "Rex", species: "dog", breed: "Lab" }],
    });
  });
});

describe("createBooking — call_logs.structured_booking_payload (GAP_REGISTER.md §1.7)", () => {
  it("writes the captured payload onto call_logs when present", async () => {
    let wrote = false;
    const routed = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      { match: "from public.adapter_connections", rows: [] },
    ]);
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.bookings")) {
        return Promise.resolve([{ id: "booking_1", start_at: args.start, end_at: args.end }]);
      }
      if (text.includes("update public.call_logs") && text.includes("structured_booking_payload")) {
        wrote = true;
        return Promise.resolve([]);
      }
      return (routed.sql as unknown as (s: TemplateStringsArray) => unknown)(strings);
    }) as SqlClient;

    await createBooking(
      sql,
      { ...ctx, vertical: "legal" },
      {
        ...args,
        structured_payload: { matter_type: "contract_review" },
      },
    );
    expect(wrote).toBe(true);
  });

  it("never writes call_logs.structured_booking_payload when nothing was captured", async () => {
    let wrote = false;
    const routed = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      { match: "from public.adapter_connections", rows: [] },
    ]);
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.bookings")) {
        return Promise.resolve([{ id: "booking_1", start_at: args.start, end_at: args.end }]);
      }
      if (text.includes("update public.call_logs") && text.includes("structured_booking_payload")) {
        wrote = true;
        return Promise.resolve([]);
      }
      return (routed.sql as unknown as (s: TemplateStringsArray) => unknown)(strings);
    }) as SqlClient;

    await createBooking(sql, ctx, args);
    expect(wrote).toBe(false);
  });
});

describe("createBooking — dental intake token (FIX_REQUESTS.md)", () => {
  const dentalCtx: CallContext = { ...ctx, vertical: "dental" };
  const deps = { logger: createLogger(), appBaseUrl: "https://app.example.com" };

  it("issues a dental intake token + SMS after a successful dental booking when deps are given", async () => {
    const { sql, queries } = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      {
        match: "insert into public.bookings",
        rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }],
      },
      { match: "into public.intake_tokens", rows: [{ id: "intake_1" }] },
      { match: "from public.adapter_connections", rows: [] },
    ]);
    await createBooking(sql, dentalCtx, args, deps);
    expect(queries.some((q) => q.includes("into public.intake_tokens"))).toBe(true);
    expect(
      queries.some(
        (q) => q.includes("into public.messages_outbound") && q.includes("related_booking_id"),
      ),
    ).toBe(true);
  });

  it("skips the intake-token step for a non-dental vertical even when deps are given", async () => {
    const { sql, queries } = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      {
        match: "insert into public.bookings",
        rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }],
      },
      { match: "from public.adapter_connections", rows: [] },
    ]);
    await createBooking(sql, ctx, args, deps);
    expect(queries.some((q) => q.includes("into public.intake_tokens"))).toBe(false);
  });

  it("skips the intake-token step (and never throws) when deps are omitted, even for a dental tenant", async () => {
    const { sql, queries } = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      {
        match: "insert into public.bookings",
        rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }],
      },
      { match: "from public.adapter_connections", rows: [] },
    ]);
    const result = await createBooking(sql, dentalCtx, args);
    expect(result.confirmed).toBe(true);
    expect(queries.some((q) => q.includes("into public.intake_tokens"))).toBe(false);
  });

  it("never blocks/throws the booking when the intake-token insert itself fails", async () => {
    const { sql } = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      {
        match: "insert into public.bookings",
        rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }],
      },
      { match: "into public.intake_tokens", throws: new Error("db down") },
      { match: "from public.adapter_connections", rows: [] },
    ]);
    const result = await createBooking(sql, dentalCtx, args, deps);
    expect(result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
  });
});

describe("createBooking — structured_payload runtime validation (GAP_REGISTER.md §1.7)", () => {
  it("auto: sanitizes a malformed field (non-numeric vehicle_year) rather than persisting it verbatim", async () => {
    let insertedStructuredPayload: unknown;
    const routed = makeRoutedSql([
      { match: "from public.resources", rows: [{ id: "res_1" }] },
      { match: "from public.bookings", rows: [] },
      { match: "into public.customers", rows: [{ id: "customer_1", metadata: {} }] },
      { match: "from public.adapter_connections", rows: [] },
      { match: "update public.call_logs", rows: [] },
    ]);
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.bookings")) {
        insertedStructuredPayload = values[10];
        return Promise.resolve([{ id: "booking_1", start_at: args.start, end_at: args.end }]);
      }
      return (routed.sql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
        strings,
        ...values,
      );
    }) as SqlClient;

    const autoCtx: CallContext = { ...ctx, vertical: "auto" };
    const result = await createBooking(sql, autoCtx, {
      ...args,
      structured_payload: {
        vehicle_year: "not_a_number",
        vehicle_make: "Honda",
        drop_off_or_wait: "not_a_valid_enum_value",
      },
    });
    expect(result).toMatchObject({ confirmed: true });
    // Regression (CALL-3 jsonb double-encoding fix): the structured_payload
    // value bound to the ::jsonb parameter must be the raw object, never a
    // caller-pre-stringified JSON string.
    expect(typeof insertedStructuredPayload).not.toBe("string");
    expect(insertedStructuredPayload).toEqual({ vehicle_make: "Honda" });
  });
});
