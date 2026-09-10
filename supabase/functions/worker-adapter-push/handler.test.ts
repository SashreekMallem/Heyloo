import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../_shared/crypto.ts";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { AdapterPushDeps } from "./handler.ts";
import { ADAPTER_PUSHERS, pollAdapterChanges, pushToAdapter } from "./handler.ts";

const TEST_TOKEN_ENCRYPTION_KEY = btoa("abcdefghijklmnopqrstuvwxyz012345");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const DEPS: AdapterPushDeps = {
  fetchImpl: (async () => jsonResponse({})) as unknown as typeof fetch,
  square: { clientId: "c1", clientSecret: "s1" },
  ezyvet: { clientId: "c1", clientSecret: "s1", partnerId: "p1" },
  googleCalendar: { clientId: "c1", clientSecret: "s1" },
  tokenEncryptionKey: TEST_TOKEN_ENCRYPTION_KEY,
};

/** A tiny query-router mock: each call inspects the joined template text
 * and returns the first matching handler's rows. Mirrors the pattern
 * already used by webhooks-pos/handler.test.ts. */
function makeSql(
  matchers: { when: string; rows: unknown[] | ((values: unknown[]) => unknown[]) }[],
): SqlClient {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    for (const m of matchers) {
      if (text.includes(m.when)) {
        return typeof m.rows === "function" ? m.rows(values) : m.rows;
      }
    }
    return [];
  }) as unknown as SqlClient;
}

describe("pushToAdapter dispatch", () => {
  it("returns false and logs a warning for an adapter with no registered pusher", async () => {
    const warnings: unknown[] = [];
    const logger = {
      ...createLogger(),
      warn: (msg: string, f?: unknown) => warnings.push({ msg, f }),
    };
    const sql = makeSql([]);
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "unknown_adapter",
        entity_type: "order",
        entity_id: "o1",
        idempotency_key: "k1",
        attempt: 0,
      },
      logger,
      DEPS,
    );
    expect(result).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it("registers a pusher for every T7 adapter", () => {
    expect(Object.keys(ADAPTER_PUSHERS).sort()).toEqual([
      "airtable",
      "ezyvet",
      "google_calendar",
      "shopmonkey",
      "square",
    ]);
  });
});

describe("pushToAdapter: square", () => {
  const CONNECTION_ROW = {
    id: "conn_1",
    status: "connected",
    access_token: "token",
    refresh_token: "refresh",
    expires_at: null,
    provider_account_id: "merchant_1",
    metadata: { locationId: "loc_1", defaultTeamMemberId: "team_1" },
  };
  const BOOKING_ROW = {
    id: "booking_1",
    start_at: "2026-09-10T14:00:00Z",
    end_at: "2026-09-10T14:30:00Z",
    notes: null,
    party_size: null,
    customer_name: "Jane Doe",
    customer_phone: "+15551234567",
    customer_email: null,
    offering_metadata: { adapter_external_id: { square: "svc_1" } },
    resource_metadata: {},
  };

  it("pushes a booking and records adapter_sync_state on success", async () => {
    const recordedSyncCalls: unknown[] = [];
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "from public.bookings b", rows: [BOOKING_ROW] },
      {
        when: "insert into public.adapter_sync_state",
        rows: (v) => {
          recordedSyncCalls.push(v);
          return [];
        },
      },
    ]);
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async () =>
        jsonResponse({ booking: { id: "sq_booking_1" } })) as unknown as typeof fetch,
    };

    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "square",
        entity_type: "booking",
        entity_id: "booking_1",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(true);
    expect(recordedSyncCalls).toHaveLength(1);
  });

  it("marks the connection disconnected and returns false on a 401 (auth_revoked)", async () => {
    let disconnectCalled = false;
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "from public.bookings b", rows: [BOOKING_ROW] },
      {
        when: "update public.adapter_connections",
        rows: () => {
          disconnectCalled = true;
          return [];
        },
      },
    ]);
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async () =>
        jsonResponse({ errors: [{ code: "UNAUTHORIZED" }] }, 401)) as unknown as typeof fetch,
    };

    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "square",
        entity_type: "booking",
        entity_id: "booking_1",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(false);
    expect(disconnectCalled).toBe(true);
  });

  it("returns false without calling Square at all when there is no connected connection", async () => {
    const sql = makeSql([{ when: "from public.adapter_connections", rows: [] }]);
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "square",
        entity_type: "booking",
        entity_id: "booking_1",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      DEPS,
    );
    expect(result).toBe(false);
  });

  it("returns false when the offering has no square catalog mapping (never invents a service id)", async () => {
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "from public.bookings b", rows: [{ ...BOOKING_ROW, offering_metadata: {} }] },
    ]);
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "square",
        entity_type: "booking",
        entity_id: "booking_1",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      DEPS,
    );
    expect(result).toBe(false);
  });

  it("pushes an order with a delivery fulfillment", async () => {
    const orderRow = {
      id: "order_1",
      items: [{ name: "Burger", qty: 1, unit_price_cents: 899 }],
      fulfillment_type: "delivery",
      delivery_address: { line1: "42 Oak St" },
      total_cents: 899,
      customer_name: "Jane Doe",
      customer_phone: "+15551234567",
    };
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "from public.orders o", rows: [orderRow] },
      { when: "insert into public.adapter_sync_state", rows: [] },
    ]);
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async () =>
        jsonResponse({ order: { id: "sq_order_1" } })) as unknown as typeof fetch,
    };
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "square",
        entity_type: "order",
        entity_id: "order_1",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(true);
  });

  describe("update/cancel semantics (GAP_REGISTER.md §4 Cluster C — FIX-1 disclosed this was CREATE-only)", () => {
    it("PUTs an update instead of re-creating when the booking was already synced and is not cancelled", async () => {
      const rescheduledBooking = {
        ...BOOKING_ROW,
        status: "confirmed",
        start_at: "2026-09-11T14:00:00Z",
      };
      const sql = makeSql([
        { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
        { when: "from public.bookings b", rows: [rescheduledBooking] },
        { when: "from public.adapter_sync_state", rows: [{ external_id: "sq_booking_1" }] },
        { when: "insert into public.adapter_sync_state", rows: [] },
      ]);
      const calls: { method: string | undefined; url: string }[] = [];
      const deps: AdapterPushDeps = {
        ...DEPS,
        fetchImpl: (async (url: string, init?: RequestInit) => {
          calls.push({ method: init?.method, url: String(url) });
          if (init?.method === "GET") return jsonResponse({ booking: { version: 3 } });
          return jsonResponse({ booking: { id: "sq_booking_1", version: 4 } });
        }) as unknown as typeof fetch,
      };
      const result = await pushToAdapter(
        sql,
        {
          tenant_id: "t1",
          adapter: "square",
          entity_type: "booking",
          entity_id: "booking_1",
          idempotency_key: "booking_1:update:x",
          attempt: 0,
        },
        createLogger(),
        deps,
      );
      expect(result).toBe(true);
      expect(
        calls.some((c) => c.method === "GET" && c.url.includes("/v2/bookings/sq_booking_1")),
      ).toBe(true);
      expect(
        calls.some((c) => c.method === "PUT" && c.url.includes("/v2/bookings/sq_booking_1")),
      ).toBe(true);
      // Never re-hits the CREATE endpoint (POST /v2/bookings) for an
      // already-synced booking.
      expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/v2/bookings"))).toBe(false);
    });

    it("POSTs a cancel instead of a create when the booking is cancelled and was already synced", async () => {
      const cancelledBooking = { ...BOOKING_ROW, status: "cancelled" };
      const sql = makeSql([
        { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
        { when: "from public.bookings b", rows: [cancelledBooking] },
        { when: "from public.adapter_sync_state", rows: [{ external_id: "sq_booking_1" }] },
        { when: "insert into public.adapter_sync_state", rows: [] },
      ]);
      const calls: { method: string | undefined; url: string }[] = [];
      const deps: AdapterPushDeps = {
        ...DEPS,
        fetchImpl: (async (url: string, init?: RequestInit) => {
          calls.push({ method: init?.method, url: String(url) });
          if (init?.method === "GET") return jsonResponse({ booking: { version: 3 } });
          return jsonResponse({ booking: { id: "sq_booking_1", status: "CANCELLED_BY_SELLER" } });
        }) as unknown as typeof fetch,
      };
      const result = await pushToAdapter(
        sql,
        {
          tenant_id: "t1",
          adapter: "square",
          entity_type: "booking",
          entity_id: "booking_1",
          idempotency_key: "booking_1:cancel",
          attempt: 0,
        },
        createLogger(),
        deps,
      );
      expect(result).toBe(true);
      expect(
        calls.some(
          (c) => c.method === "POST" && c.url.endsWith("/v2/bookings/sq_booking_1/cancel"),
        ),
      ).toBe(true);
    });

    it("cancelling a booking that was never synced to Square is a harmless no-op (never calls Square)", async () => {
      const cancelledBooking = { ...BOOKING_ROW, status: "cancelled" };
      const sql = makeSql([
        { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
        { when: "from public.bookings b", rows: [cancelledBooking] },
        { when: "from public.adapter_sync_state", rows: [] },
      ]);
      let fetchCalled = false;
      const deps: AdapterPushDeps = {
        ...DEPS,
        fetchImpl: (async () => {
          fetchCalled = true;
          return jsonResponse({});
        }) as unknown as typeof fetch,
      };
      const result = await pushToAdapter(
        sql,
        {
          tenant_id: "t1",
          adapter: "square",
          entity_type: "booking",
          entity_id: "booking_1",
          idempotency_key: "booking_1:cancel",
          attempt: 0,
        },
        createLogger(),
        deps,
      );
      expect(result).toBe(true);
      expect(fetchCalled).toBe(false);
    });
  });
});

describe("adapter_connections token encryption (DB-H2)", () => {
  const BOOKING_ROW = {
    id: "booking_1",
    start_at: "2026-09-10T14:00:00Z",
    end_at: "2026-09-10T14:30:00Z",
    notes: null,
    party_size: null,
    customer_name: "Jane Doe",
    customer_phone: "+15551234567",
    customer_email: null,
    offering_metadata: { adapter_external_id: { square: "svc_1" } },
    resource_metadata: {},
  };

  it("decrypts an encrypted access_token before using it against the provider", async () => {
    const encryptedAccessToken = await encryptSecret(
      "real_access_token",
      TEST_TOKEN_ENCRYPTION_KEY,
    );
    const connectionRow = {
      id: "conn_1",
      status: "connected",
      access_token: encryptedAccessToken,
      refresh_token: null,
      expires_at: null,
      provider_account_id: "merchant_1",
      metadata: { locationId: "loc_1", defaultTeamMemberId: "team_1" },
    };
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [connectionRow] },
      { when: "from public.bookings b", rows: [BOOKING_ROW] },
      { when: "insert into public.adapter_sync_state", rows: [] },
    ]);
    let capturedAuthHeader: string | null = null;
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        capturedAuthHeader = (init?.headers as Record<string, string>)?.["authorization"] ?? null;
        return jsonResponse({ booking: { id: "sq_booking_1" } });
      }) as unknown as typeof fetch,
    };

    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "square",
        entity_type: "booking",
        entity_id: "booking_1",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(true);
    expect(capturedAuthHeader).toBe("Bearer real_access_token");
  });

  it("still works against a legacy plaintext row written before encryption shipped", async () => {
    const connectionRow = {
      id: "conn_1",
      status: "connected",
      access_token: "legacy_plaintext_token",
      refresh_token: null,
      expires_at: null,
      provider_account_id: "merchant_1",
      metadata: { locationId: "loc_1", defaultTeamMemberId: "team_1" },
    };
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [connectionRow] },
      { when: "from public.bookings b", rows: [BOOKING_ROW] },
      { when: "insert into public.adapter_sync_state", rows: [] },
    ]);
    let capturedAuthHeader: string | null = null;
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        capturedAuthHeader = (init?.headers as Record<string, string>)?.["authorization"] ?? null;
        return jsonResponse({ booking: { id: "sq_booking_1" } });
      }) as unknown as typeof fetch,
    };

    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "square",
        entity_type: "booking",
        entity_id: "booking_1",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(true);
    expect(capturedAuthHeader).toBe("Bearer legacy_plaintext_token");
  });

  it("re-encrypts a refreshed access_token before writing it back (never plaintext at rest)", async () => {
    const expiredConnectionRow = {
      id: "conn_1",
      status: "connected",
      access_token: await encryptSecret("stale_access_token", TEST_TOKEN_ENCRYPTION_KEY),
      refresh_token: await encryptSecret("refresh_token_value", TEST_TOKEN_ENCRYPTION_KEY),
      expires_at: "2020-01-01T00:00:00Z", // long expired -> forces a refresh
      provider_account_id: "merchant_1",
      metadata: { locationId: "loc_1", defaultTeamMemberId: "team_1" },
    };
    let capturedUpdateValues: unknown[] = [];
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [expiredConnectionRow] },
      { when: "from public.bookings b", rows: [BOOKING_ROW] },
      { when: "insert into public.adapter_sync_state", rows: [] },
      {
        when: "set access_token",
        rows: (v) => {
          capturedUpdateValues = v;
          return [];
        },
      },
    ]);
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async (url: unknown) => {
        if (String(url).includes("oauth2/token"))
          return jsonResponse({ access_token: "fresh_access_token" });
        return jsonResponse({ booking: { id: "sq_booking_1" } });
      }) as unknown as typeof fetch,
    };

    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "square",
        entity_type: "booking",
        entity_id: "booking_1",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(true);
    const storedValue = capturedUpdateValues[0] as string;
    expect(storedValue).not.toBe("fresh_access_token");
    expect(storedValue.startsWith("v1:")).toBe(true);
    expect(await decryptSecret(storedValue, TEST_TOKEN_ENCRYPTION_KEY)).toBe("fresh_access_token");
  });
});

describe("pushToAdapter: ezyvet", () => {
  const CONNECTION_ROW = {
    id: "conn_2",
    status: "connected",
    access_token: "token",
    refresh_token: null,
    expires_at: "2099-01-01T00:00:00Z",
    provider_account_id: null,
    metadata: { baseUrl: "https://clinic.ezyvet.com/api/v1" },
  };
  const BOOKING_ROW = {
    id: "booking_2",
    start_at: "2026-09-10T14:00:00Z",
    end_at: "2026-09-10T14:30:00Z",
    notes: null,
    party_size: null,
    customer_name: "Jane Doe",
    customer_phone: "+15551234567",
    customer_email: null,
    offering_metadata: {},
    resource_metadata: {},
  };

  it("finds an existing contact and creates the appointment", async () => {
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "from public.bookings b", rows: [BOOKING_ROW] },
      { when: "insert into public.adapter_sync_state", rows: [] },
    ]);
    let call = 0;
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async (url: unknown) => {
        call += 1;
        const path = String(url);
        if (path.includes("/contact?")) return jsonResponse({ items: [{ id: 42 }] });
        return jsonResponse({ id: 99 });
      }) as unknown as typeof fetch,
    };

    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "ezyvet",
        entity_type: "booking",
        entity_id: "booking_2",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(true);
    expect(call).toBe(2);
  });

  it("rejects a non-booking entity type (ezyVet has no order concept)", async () => {
    const result = await pushToAdapter(
      makeSql([]),
      {
        tenant_id: "t1",
        adapter: "ezyvet",
        entity_type: "order",
        entity_id: "o1",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      DEPS,
    );
    expect(result).toBe(false);
  });
});

describe("pushToAdapter: google_calendar", () => {
  const CONNECTION_ROW = {
    id: "conn_3",
    status: "connected",
    access_token: "token",
    refresh_token: "refresh",
    expires_at: null,
    provider_account_id: null,
    metadata: { calendarId: "primary" },
  };
  const BOOKING_ROW = {
    id: "booking_3",
    start_at: "2026-09-10T14:00:00Z",
    end_at: "2026-09-10T14:30:00Z",
    notes: null,
    party_size: null,
    customer_name: "Jane Doe",
    customer_phone: "+15551234567",
    customer_email: null,
    offering_metadata: {},
    resource_metadata: {},
  };

  it("inserts a calendar event and records the sync state", async () => {
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "from public.bookings b", rows: [BOOKING_ROW] },
      { when: "insert into public.adapter_sync_state", rows: [] },
    ]);
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async () => jsonResponse({ id: "evt_1" })) as unknown as typeof fetch,
    };
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "google_calendar",
        entity_type: "booking",
        entity_id: "booking_3",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(true);
  });

  it("treats a 409 as an idempotent dedup (fetches the existing event, still succeeds)", async () => {
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "from public.bookings b", rows: [BOOKING_ROW] },
      { when: "insert into public.adapter_sync_state", rows: [] },
    ]);
    let call = 0;
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async () => {
        call += 1;
        if (call === 1) return jsonResponse({ error: "exists" }, 409);
        return jsonResponse({ id: "evt_existing" });
      }) as unknown as typeof fetch,
    };
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "google_calendar",
        entity_type: "booking",
        entity_id: "booking_3",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(true);
    expect(call).toBe(2);
  });

  describe("update/cancel semantics (GAP_REGISTER.md §4 Cluster C — FIX-1 disclosed this was CREATE-only)", () => {
    it("PATCHes the existing event instead of inserting a new one on a reschedule", async () => {
      const rescheduledBooking = {
        ...BOOKING_ROW,
        status: "confirmed",
        start_at: "2026-09-11T14:00:00Z",
      };
      const sql = makeSql([
        { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
        { when: "from public.bookings b", rows: [rescheduledBooking] },
        { when: "from public.adapter_sync_state", rows: [{ external_id: "evt_1" }] },
        { when: "insert into public.adapter_sync_state", rows: [] },
      ]);
      const calls: { method: string | undefined; url: string }[] = [];
      const deps: AdapterPushDeps = {
        ...DEPS,
        fetchImpl: (async (url: string, init?: RequestInit) => {
          calls.push({ method: init?.method, url: String(url) });
          return jsonResponse({ id: "evt_1" });
        }) as unknown as typeof fetch,
      };
      const result = await pushToAdapter(
        sql,
        {
          tenant_id: "t1",
          adapter: "google_calendar",
          entity_type: "booking",
          entity_id: "booking_3",
          idempotency_key: "booking_3:update:x",
          attempt: 0,
        },
        createLogger(),
        deps,
      );
      expect(result).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("PATCH");
      expect(calls[0]?.url).toContain("/events/evt_1");
    });

    it("DELETEs the existing event when the booking is cancelled", async () => {
      const cancelledBooking = { ...BOOKING_ROW, status: "cancelled" };
      const sql = makeSql([
        { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
        { when: "from public.bookings b", rows: [cancelledBooking] },
        { when: "from public.adapter_sync_state", rows: [{ external_id: "evt_1" }] },
        { when: "insert into public.adapter_sync_state", rows: [] },
      ]);
      const calls: { method: string | undefined; url: string }[] = [];
      const deps: AdapterPushDeps = {
        ...DEPS,
        fetchImpl: (async (url: string, init?: RequestInit) => {
          calls.push({ method: init?.method, url: String(url) });
          return new Response(null, { status: 204 });
        }) as unknown as typeof fetch,
      };
      const result = await pushToAdapter(
        sql,
        {
          tenant_id: "t1",
          adapter: "google_calendar",
          entity_type: "booking",
          entity_id: "booking_3",
          idempotency_key: "booking_3:cancel",
          attempt: 0,
        },
        createLogger(),
        deps,
      );
      expect(result).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("DELETE");
    });

    it("treats a 404 on delete as already-gone success, never a failure", async () => {
      const cancelledBooking = { ...BOOKING_ROW, status: "cancelled" };
      const sql = makeSql([
        { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
        { when: "from public.bookings b", rows: [cancelledBooking] },
        { when: "from public.adapter_sync_state", rows: [{ external_id: "evt_1" }] },
        { when: "insert into public.adapter_sync_state", rows: [] },
      ]);
      const deps: AdapterPushDeps = {
        ...DEPS,
        fetchImpl: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
      };
      const result = await pushToAdapter(
        sql,
        {
          tenant_id: "t1",
          adapter: "google_calendar",
          entity_type: "booking",
          entity_id: "booking_3",
          idempotency_key: "booking_3:cancel",
          attempt: 0,
        },
        createLogger(),
        deps,
      );
      expect(result).toBe(true);
    });

    it("cancelling a booking that was never synced is a harmless no-op (never calls Google)", async () => {
      const cancelledBooking = { ...BOOKING_ROW, status: "cancelled" };
      const sql = makeSql([
        { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
        { when: "from public.bookings b", rows: [cancelledBooking] },
        { when: "from public.adapter_sync_state", rows: [] },
      ]);
      let fetchCalled = false;
      const deps: AdapterPushDeps = {
        ...DEPS,
        fetchImpl: (async () => {
          fetchCalled = true;
          return jsonResponse({});
        }) as unknown as typeof fetch,
      };
      const result = await pushToAdapter(
        sql,
        {
          tenant_id: "t1",
          adapter: "google_calendar",
          entity_type: "booking",
          entity_id: "booking_3",
          idempotency_key: "booking_3:cancel",
          attempt: 0,
        },
        createLogger(),
        deps,
      );
      expect(result).toBe(true);
      expect(fetchCalled).toBe(false);
    });
  });
});

describe("pushToAdapter: airtable", () => {
  const CONNECTION_ROW = {
    id: "conn_5",
    status: "connected",
    access_token: "at_token",
    refresh_token: null,
    expires_at: null,
    provider_account_id: null,
    metadata: { baseId: "app123", tableIdOrName: "Bookings" },
  };
  const BOOKING_ROW = {
    id: "booking_5",
    start_at: "2026-09-10T14:00:00Z",
    end_at: "2026-09-10T14:30:00Z",
    notes: null,
    party_size: null,
    customer_name: "Jane Doe",
    customer_phone: "+15551234567",
    customer_email: null,
    offering_metadata: {},
    resource_metadata: {},
  };

  it("creates an Airtable record for a booking push and records the sync state", async () => {
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "from public.bookings b", rows: [BOOKING_ROW] },
      { when: "insert into public.adapter_sync_state", rows: [] },
    ]);
    let capturedUrl = "";
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async (url: unknown) => {
        capturedUrl = String(url);
        return jsonResponse({ id: "rec123" });
      }) as unknown as typeof fetch,
    };
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "airtable",
        entity_type: "booking",
        entity_id: "booking_5",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(true);
    expect(capturedUrl).toContain("app123");
    expect(capturedUrl).toContain("Bookings");
  });

  it("pushes an order to Airtable too (a generic base supports both entity types)", async () => {
    const orderRow = {
      id: "order_5",
      items: [{ name: "Burger", qty: 1, unit_price_cents: 899 }],
      fulfillment_type: "pickup",
      delivery_address: null,
      total_cents: 899,
      customer_name: "Jane Doe",
      customer_phone: "+15551234567",
    };
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "from public.orders o", rows: [orderRow] },
      { when: "insert into public.adapter_sync_state", rows: [] },
    ]);
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async () => jsonResponse({ id: "rec456" })) as unknown as typeof fetch,
    };
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "airtable",
        entity_type: "order",
        entity_id: "order_5",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(true);
  });

  it("returns false and never invents a base/table mapping when connection metadata is missing it", async () => {
    const sql = makeSql([
      {
        when: "from public.adapter_connections",
        rows: [{ ...CONNECTION_ROW, metadata: {} }],
      },
    ]);
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "airtable",
        entity_type: "booking",
        entity_id: "booking_5",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      DEPS,
    );
    expect(result).toBe(false);
  });

  it("marks the connection disconnected on a 401", async () => {
    let disconnectCalled = false;
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "from public.bookings b", rows: [BOOKING_ROW] },
      {
        when: "update public.adapter_connections",
        rows: () => {
          disconnectCalled = true;
          return [];
        },
      },
    ]);
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async () =>
        jsonResponse({ error: "unauthorized" }, 401)) as unknown as typeof fetch,
    };
    const result = await pushToAdapter(
      sql,
      {
        tenant_id: "t1",
        adapter: "airtable",
        entity_type: "booking",
        entity_id: "booking_5",
        idempotency_key: "k1",
        attempt: 0,
      },
      createLogger(),
      deps,
    );
    expect(result).toBe(false);
    expect(disconnectCalled).toBe(true);
  });
});

describe("pollAdapterChanges (two-way sync conflict path, G11)", () => {
  const CONNECTION_ROW = {
    id: "conn_4",
    status: "connected",
    access_token: "token",
    refresh_token: null,
    expires_at: null,
    provider_account_id: null,
    metadata: { baseUrl: "https://clinic.ezyvet.com/api/v1" },
  };

  it("flags sync_conflict for a pulled change that Heyloo already pushed, and updates the poll cursor", async () => {
    const conflictCalls: unknown[] = [];
    const cursorUpdates: unknown[] = [];
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      {
        when: "select entity_type, entity_id, sync_conflict",
        rows: [{ entity_type: "booking", entity_id: "booking_1", sync_conflict: false }],
      },
      {
        when: "update public.adapter_sync_state",
        rows: (v) => {
          conflictCalls.push(v);
          return [];
        },
      },
      {
        when: "update public.adapter_connections",
        rows: (v) => {
          cursorUpdates.push(v);
          return [];
        },
      },
    ]);
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async () => jsonResponse({ items: [{ id: 55 }] })) as unknown as typeof fetch,
    };

    const result = await pollAdapterChanges(sql, "t1", "ezyvet", createLogger(), deps);
    expect(result).toEqual({ pulled: 1, conflictsFlagged: 1 });
    expect(conflictCalls).toHaveLength(1);
    expect(cursorUpdates).toHaveLength(1);
  });

  it("does not re-flag a change already marked as a conflict", async () => {
    const conflictCalls: unknown[] = [];
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      {
        when: "select entity_type, entity_id, sync_conflict",
        rows: [{ entity_type: "booking", entity_id: "booking_1", sync_conflict: true }],
      },
      {
        when: "update public.adapter_sync_state",
        rows: (v) => {
          conflictCalls.push(v);
          return [];
        },
      },
    ]);
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async () => jsonResponse({ items: [{ id: 55 }] })) as unknown as typeof fetch,
    };
    const result = await pollAdapterChanges(sql, "t1", "ezyvet", createLogger(), deps);
    expect(result.conflictsFlagged).toBe(0);
    expect(conflictCalls).toHaveLength(0);
  });

  it("returns zero pulled/flagged when there is no connected connection (never throws)", async () => {
    const sql = makeSql([{ when: "from public.adapter_connections", rows: [] }]);
    const result = await pollAdapterChanges(sql, "t1", "shopmonkey", createLogger(), DEPS);
    expect(result).toEqual({ pulled: 0, conflictsFlagged: 0 });
  });

  it("records an unmapped pulled change (no matching adapter_sync_state row) without flagging a conflict", async () => {
    const sql = makeSql([
      { when: "from public.adapter_connections", rows: [CONNECTION_ROW] },
      { when: "select entity_type, entity_id, sync_conflict", rows: [] },
      { when: "update public.adapter_connections", rows: [] },
    ]);
    const deps: AdapterPushDeps = {
      ...DEPS,
      fetchImpl: (async () => jsonResponse({ items: [{ id: 999 }] })) as unknown as typeof fetch,
    };
    const result = await pollAdapterChanges(sql, "t1", "ezyvet", createLogger(), deps);
    expect(result).toEqual({ pulled: 1, conflictsFlagged: 0 });
  });
});
