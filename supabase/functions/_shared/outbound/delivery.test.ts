import { describe, expect, it, vi } from "vitest";
import { verifyStandardWebhook } from "../standard-webhooks.ts";
import type { Logger, SqlClient } from "../types.ts";
import {
  ABANDONED_DELIVERY_ERROR,
  type ClaimedDelivery,
  claimDeliveryById,
  claimDueDeliveries,
  countDueDeliveries,
  failAbandonedDeliveries,
  PROCESSING_ERROR,
  processClaimedDelivery,
  recordOutcome,
  runWebhookDeliveryWorker,
  sendSignedWebhook,
  type WebhookDeliveryDeps,
  webhookIdForEvent,
} from "./delivery.ts";

const TENANT = "0b6c2f3e-8f43-4a43-9d51-6a2d1c0e7f10";
const DEST = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const EVENT = "8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a";
const BOOKING = "4f1d6b7a-2c3e-4d5f-8a9b-0c1d2e3f4a5b";
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const NOW = new Date("2026-10-09T18:00:00.000Z");
const PUBLIC_DNS = async (_host: string, type: "A" | "AAAA") =>
  type === "A" ? ["93.184.216.34"] : [];

type Call = { text: string; values: unknown[] };
type Answer = unknown[] | ((values: unknown[]) => unknown[]) | Error;

/** Records every statement; answers by the first marker found in its text. */
function fakeSql(answers: Array<[string, Answer]> = []) {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [marker, answer] of answers) {
      if (!text.includes(marker)) continue;
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(typeof answer === "function" ? answer(values) : answer);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  const find = (marker: string) => calls.filter((c) => c.text.includes(marker));
  return { sql, calls, find };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies Logger;
}

function okTransport(
  status = 200,
  headers: Record<string, string> = {},
  body: BodyInit | null = "ok",
) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(body, { status, headers });
  });
}

function deps(overrides: Partial<WebhookDeliveryDeps> = {}): WebhookDeliveryDeps {
  return {
    appBaseUrl: "https://heyloo.app",
    logger: makeLogger(),
    transport: okTransport(),
    resolver: PUBLIC_DNS,
    now: () => NOW,
    random: () => 0.5,
    ...overrides,
  };
}

const STORED_PAYLOAD = {
  type: "booking.created",
  timestamp: "2026-10-09T18:00:00.000Z",
  business: { id: TENANT, name: "Joe's Garage" },
  data: { id: BOOKING },
};

function claimed(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  return {
    id: "d1",
    tenant_id: TENANT,
    destination_id: DEST,
    event_id: EVENT,
    attempt_count: 1,
    url: "https://hooks.zapier.com/hooks/catch/1/abc/",
    destination_name: "Zapier",
    destination_enabled: true,
    secret: SECRET,
    event_type: "booking.created",
    entity_type: "booking",
    entity_id: BOOKING,
    occurred_at: NOW,
    payload: STORED_PAYLOAD,
    ...overrides,
  };
}

const BOOKING_ROW = {
  id: BOOKING,
  status: "confirmed",
  start_at: new Date("2026-10-10T17:00:00Z"),
  end_at: new Date("2026-10-10T18:00:00Z"),
  party_size: null,
  notes: null,
  cancel_reason: null,
  source_call_id: null,
  created_at: NOW,
  tenant_name: "Joe's Garage",
  timezone: "America/Chicago",
  service: null,
  resource: "Bay 2",
  customer_name: "Jordan",
  customer_phone: "+15551234567",
  customer_email: null,
};

const ownerContact: Array<[string, Answer]> = [
  [
    "public.agent_configs ac",
    [{ transfer_number: "+15550001111", delivery: null, owner_email: "o@example.com" }],
  ],
  ["insert into public.messages_outbound", [{ id: "alert-1" }]],
];

describe("claiming", () => {
  it("leases due rows in one statement with skip locked, recovering expired leases", async () => {
    const { sql, calls } = fakeSql([["with due as", [claimed()]]]);
    const rows = await claimDueDeliveries(sql, 7);
    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const text = calls[0]?.text ?? "";
    expect(text).toContain("for update of od skip locked");
    expect(text).toContain("od.status in ('pending', 'retrying') and od.next_attempt_at <= now()");
    expect(text).toContain("od.status = 'sending' and od.locked_until < now()");
    expect(text).toContain("attempt_count = od.attempt_count + 1");
    expect(text).toContain("locked_until = now() + interval '2 minutes'");
    // Joined rows must belong to the delivery's own tenant.
    expect(text).toContain("d.tenant_id = od.tenant_id");
    expect(text).toContain("e.tenant_id = od.tenant_id");
    expect(text).toContain("public.fn_outbound_secret_read(d.signing_secret_id)");
    expect(calls[0]?.values).toEqual([8, 7]);
  });

  it("re-claims an expired lease only while an attempt is left, never for a test ping", async () => {
    const { sql, calls } = fakeSql();
    await claimDueDeliveries(sql);
    const text = calls[0]?.text ?? "";
    expect(text).toContain(
      "od.status = 'sending' and od.locked_until < now()\n             and od.attempt_count < ",
    );
    expect(text).toContain("and e.event_type <> 'test.ping')");
    // The pending/retrying branch has no attempt cap: an owner's manual retry
    // of a failed delivery still gets its extra attempt.
    expect(text).toContain(
      "where (od.status in ('pending', 'retrying') and od.next_attempt_at <= now())\n",
    );
    expect(text).toContain(
      "join public.outbound_events e on e.id = od.event_id and e.tenant_id = od.tenant_id",
    );
    expect(calls[0]?.values).toEqual([8, 10]);
  });

  it("leases one pending delivery by id, scoped to the tenant", async () => {
    const { sql, calls } = fakeSql([["update public.outbound_deliveries od", [claimed()]]]);
    expect(await claimDeliveryById(sql, TENANT, "d1")).toMatchObject({ id: "d1" });
    expect(calls[0]?.values).toEqual(["d1", TENANT]);
    expect(calls[0]?.text).toContain("od.status = 'pending'");
    expect(await claimDeliveryById(fakeSql().sql, TENANT, "d1")).toBeNull();
  });
});

describe("sendSignedWebhook", () => {
  const body = JSON.stringify(STORED_PAYLOAD);
  const params = {
    url: "https://hooks.example.com/in",
    webhookId: webhookIdForEvent(EVENT),
    body,
    secret: SECRET,
  };

  it("POSTs the exact body with Standard Webhooks headers that verify", async () => {
    const transport = okTransport();
    const outcome = await sendSignedWebhook(params, deps({ transport }));
    expect(outcome).toEqual({ kind: "delivered", statusCode: 200 });
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/in");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect(init.redirect).toBe("manual");
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("user-agent")).toBe("Heyloo-Webhooks/1");
    expect(headers.get("webhook-id")).toBe(`evt_${EVENT.replace(/-/g, "")}`);
    expect(headers.get("webhook-timestamp")).toBe(String(NOW.getTime() / 1000));
    const verified = await verifyStandardWebhook({
      rawBody: body,
      header: (name) => headers.get(name),
      secret: SECRET,
      now: NOW,
    });
    expect(verified).toEqual({ valid: true });
  });

  it("judges by status only: an odd content type or a big body still counts as delivered", async () => {
    const transport = okTransport(
      202,
      { "content-type": "application/xml" },
      "x".repeat(6_000_000),
    );
    expect(await sendSignedWebhook(params, deps({ transport }))).toEqual({
      kind: "delivered",
      statusCode: 202,
    });
    const empty = okTransport(200, {}, null);
    expect(await sendSignedWebhook(params, deps({ transport: empty }))).toEqual({
      kind: "delivered",
      statusCode: 200,
    });
  });

  it("never follows a redirect (Standard Webhooks: 3xx is a failure)", async () => {
    const transport = okTransport(302, { location: "https://elsewhere.example/" }, null);
    expect(await sendSignedWebhook(params, deps({ transport }))).toEqual({
      kind: "retry",
      statusCode: null,
      error: "The address redirects (use the final URL instead)",
      retryAfterSeconds: null,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("classifies 410 as gone and keeps Retry-After on 503", async () => {
    expect(await sendSignedWebhook(params, deps({ transport: okTransport(410) }))).toMatchObject({
      kind: "gone",
      statusCode: 410,
    });
    expect(
      await sendSignedWebhook(
        params,
        deps({ transport: okTransport(503, { "retry-after": "120" }) }),
      ),
    ).toEqual({ kind: "retry", statusCode: 503, error: "HTTP 503", retryAfterSeconds: 120 });
  });

  it("never calls the transport for a private address, plain http or a bad secret", async () => {
    const transport = okTransport();
    const privateDns = async (_h: string, type: "A" | "AAAA") => (type === "A" ? ["10.0.0.5"] : []);
    expect(
      await sendSignedWebhook(params, deps({ transport, resolver: privateDns })),
    ).toMatchObject({ kind: "retry", error: expect.stringContaining("isn't allowed") });
    expect(
      await sendSignedWebhook(
        { ...params, url: "https://169.254.169.254/latest" },
        deps({ transport }),
      ),
    ).toMatchObject({ kind: "retry", error: expect.stringContaining("isn't allowed") });
    expect(
      await sendSignedWebhook(
        { ...params, url: "http://hooks.example.com/in" },
        deps({ transport }),
      ),
    ).toMatchObject({ kind: "retry", error: expect.stringContaining("isn't allowed") });
    expect(await sendSignedWebhook({ ...params, secret: "" }, deps({ transport }))).toMatchObject({
      kind: "retry",
      error: "Signing secret missing",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("times out a receiver that never answers", async () => {
    const hanging = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    expect(
      await sendSignedWebhook(params, deps({ transport: hanging, timeoutMs: 30 })),
    ).toMatchObject({ kind: "retry", statusCode: null, error: "Timed out after 0s" });
  });

  it("reports a connection failure without leaking its message", async () => {
    const failing = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 93.184.216.34:443");
    });
    expect(await sendSignedWebhook(params, deps({ transport: failing }))).toEqual({
      kind: "retry",
      statusCode: null,
      error: "Could not connect",
      retryAfterSeconds: null,
    });
  });
});

describe("recordOutcome", () => {
  it("delivered: marks the delivery (lease-guarded) and resets destination health", async () => {
    const { sql, find } = fakeSql([["set status = 'delivered'", [{ id: "d1" }]]]);
    const result = await recordOutcome(
      sql,
      claimed({ attempt_count: 3 }),
      { kind: "delivered", statusCode: 204 },
      deps(),
    );
    expect(result).toEqual({ status: "delivered", statusCode: 204 });
    const update = find("set status = 'delivered'")[0];
    expect(update?.text).toContain("status = 'sending' and attempt_count =");
    expect(update?.values).toEqual([204, "d1", TENANT, 3]);
    const health = find("consecutive_failures = 0, last_success_at = now()")[0];
    expect(health?.values).toEqual([DEST, TENANT]);
  });

  it("a lost lease never overwrites the newer attempt or touches destination health", async () => {
    const { sql, find } = fakeSql();
    expect(
      await recordOutcome(sql, claimed(), { kind: "delivered", statusCode: 200 }, deps()),
    ).toEqual({ status: "cancelled", reason: "lease_lost" });
    expect(find("public.outbound_destinations")).toHaveLength(0);
  });

  it("retry: schedules the next attempt per backoff and counts the failure", async () => {
    const { sql, find } = fakeSql([["set status = 'retrying'", [{ id: "d1" }]]]);
    const result = await recordOutcome(
      sql,
      claimed({ attempt_count: 2 }),
      { kind: "retry", statusCode: 500, error: "HTTP 500", retryAfterSeconds: null },
      deps(),
    );
    expect(result).toEqual({
      status: "retrying",
      statusCode: 500,
      error: "HTTP 500",
      delaySeconds: 300,
    });
    const update = find("set status = 'retrying'")[0];
    expect(update?.text).toContain("make_interval(secs =>");
    expect(update?.values).toEqual([300, 500, "HTTP 500", "d1", TENANT, 2]);
    const health = find("consecutive_failures = consecutive_failures + 1")[0];
    expect(health?.values).toEqual(["HTTP 500", DEST, TENANT]);
    expect(find("last_alerted_at")).toHaveLength(0);
  });

  it("honors a longer Retry-After", async () => {
    const { sql } = fakeSql([["set status = 'retrying'", [{ id: "d1" }]]]);
    const result = await recordOutcome(
      sql,
      claimed({ attempt_count: 1 }),
      { kind: "retry", statusCode: 429, error: "HTTP 429", retryAfterSeconds: 900 },
      deps(),
    );
    expect(result).toMatchObject({ status: "retrying", delaySeconds: 900 });
  });

  it("final attempt: fails and alerts the owner once per 24 h", async () => {
    const { sql, find } = fakeSql([
      ["set status = 'failed'", [{ id: "d1" }]],
      ["set last_alerted_at = now()", [{ name: "Kitchen Zap" }]],
      ...ownerContact,
    ]);
    const result = await recordOutcome(
      sql,
      claimed({ attempt_count: 8, event_type: "order.created", entity_type: "order" }),
      { kind: "retry", statusCode: null, error: "Timed out after 5s", retryAfterSeconds: null },
      deps(),
    );
    expect(result).toEqual({
      status: "failed",
      statusCode: null,
      error: "Timed out after 5s",
      destinationDisabled: false,
    });
    const throttle = find("set last_alerted_at = now()")[0];
    expect(throttle?.text).toContain("d.last_alerted_at < now() - interval '24 hours'");
    expect(throttle?.values).toEqual([DEST, TENANT, DEST, TENANT]);
    const alert = find("insert into public.messages_outbound")[0];
    expect(alert?.values).toEqual(expect.arrayContaining([TENANT, "owner_webhook_failing"]));
    expect(alert?.values).toContainEqual({
      destination_name: "Kitchen Zap",
      event_type: "order.created",
      event_label: "a new order",
      disabled: false,
    });
  });

  it("does not alert again inside the 24 h window", async () => {
    const { sql, find } = fakeSql([["set status = 'failed'", [{ id: "d1" }]], ...ownerContact]);
    await recordOutcome(
      sql,
      claimed({ attempt_count: 8 }),
      { kind: "retry", statusCode: 500, error: "HTTP 500", retryAfterSeconds: null },
      deps(),
    );
    expect(find("set last_alerted_at = now()")).toHaveLength(1);
    expect(find("insert into public.messages_outbound")).toHaveLength(0);
  });

  it("410: fails at once, turns the destination off (gone_410) and alerts", async () => {
    const { sql, find } = fakeSql([
      ["set status = 'failed'", [{ id: "d1" }]],
      ["set last_alerted_at = now()", [{ name: "Make" }]],
      ...ownerContact,
    ]);
    const result = await recordOutcome(
      sql,
      claimed({ attempt_count: 1 }),
      { kind: "gone", statusCode: 410, error: "HTTP 410: gone" },
      deps(),
    );
    expect(result).toMatchObject({ status: "failed", statusCode: 410, destinationDisabled: true });
    const disable = find("disabled_reason = 'gone_410'")[0];
    expect(disable?.text).toContain("enabled = false");
    expect(disable?.values).toEqual(["HTTP 410: gone", DEST, TENANT]);
    expect(find("insert into public.messages_outbound")[0]?.values).toContainEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it("a test ping is a single attempt and never alerts", async () => {
    const { sql, find } = fakeSql([["set status = 'failed'", [{ id: "d1" }]]]);
    const result = await recordOutcome(
      sql,
      claimed({ attempt_count: 1, event_type: "test.ping", entity_type: "test", entity_id: null }),
      { kind: "retry", statusCode: 404, error: "HTTP 404", retryAfterSeconds: null },
      deps(),
    );
    expect(result).toMatchObject({ status: "failed", statusCode: 404 });
    expect(find("last_alerted_at")).toHaveLength(0);
  });

  it("gives the 24 h window back when the alert cannot be queued", async () => {
    const logger = makeLogger();
    const claimedAt = "2026-10-09 18:00:00.123456+00";
    const { sql, find } = fakeSql([
      ["set status = 'failed'", [{ id: "d1" }]],
      [
        "set last_alerted_at = now()",
        [{ name: "Kitchen Zap", previous_alerted_at: null, claimed_alerted_at: claimedAt }],
      ],
      ownerContact[0] as [string, Answer],
      ["insert into public.messages_outbound", new Error("pgmq down")],
    ]);
    await expect(
      recordOutcome(
        sql,
        claimed({ attempt_count: 8 }),
        { kind: "retry", statusCode: 500, error: "HTTP 500", retryAfterSeconds: null },
        deps({ logger }),
      ),
    ).resolves.toMatchObject({ status: "failed" });
    expect(logger.error).toHaveBeenCalledWith("outbound_webhook_alert_failed", expect.any(Object));
    const release = find("set last_alerted_at = ")[1];
    // Text in and out: a timestamptz parameter would lose its microseconds.
    expect(release?.text).toContain("::text::timestamptz");
    // Only undoes its own claim: a newer alert's timestamp is left alone.
    expect(release?.text).toContain("and last_alerted_at::text = ");
    expect(release?.values).toEqual([null, DEST, TENANT, claimedAt]);
  });

  it("an alert failure is logged, never thrown", async () => {
    const logger = makeLogger();
    const { sql } = fakeSql([
      ["set status = 'failed'", [{ id: "d1" }]],
      ["set last_alerted_at = now()", new Error("db down")],
    ]);
    await expect(
      recordOutcome(
        sql,
        claimed({ attempt_count: 8 }),
        { kind: "retry", statusCode: 500, error: "HTTP 500", retryAfterSeconds: null },
        deps({ logger }),
      ),
    ).resolves.toMatchObject({ status: "failed" });
    expect(logger.error).toHaveBeenCalledWith("outbound_webhook_alert_failed", expect.any(Object));
  });

  it("a failed claim has nothing to give back", async () => {
    const { sql, find } = fakeSql([
      ["set status = 'failed'", [{ id: "d1" }]],
      ["set last_alerted_at = now()", new Error("db down")],
    ]);
    await recordOutcome(
      sql,
      claimed({ attempt_count: 8 }),
      { kind: "retry", statusCode: 500, error: "HTTP 500", retryAfterSeconds: null },
      deps(),
    );
    expect(find("::text::timestamptz")).toHaveLength(0);
  });
});

describe("failAbandonedDeliveries", () => {
  it("fails expired leases with no attempt left, lease-locked, and alerts the owner", async () => {
    const logger = makeLogger();
    const { sql, find } = fakeSql([
      [
        "with stale as",
        [
          {
            id: "d1",
            tenant_id: TENANT,
            destination_id: DEST,
            attempt_count: 8,
            event_type: "order.created",
          },
        ],
      ],
      [
        "set last_alerted_at = now()",
        [{ name: "Kitchen Zap", previous_alerted_at: null, claimed_alerted_at: "x" }],
      ],
      ...ownerContact,
    ]);
    expect(await failAbandonedDeliveries(sql, logger)).toBe(1);
    const sweep = find("with stale as")[0];
    expect(sweep?.text).toContain("od.status = 'sending' and od.locked_until < now()");
    expect(sweep?.text).toContain("od.attempt_count >= ");
    expect(sweep?.text).toContain("or e.event_type = 'test.ping')");
    expect(sweep?.text).toContain("for update of od skip locked");
    expect(sweep?.text).toContain("set status = 'failed', locked_until = null");
    expect(sweep?.text).toContain("e.tenant_id = od.tenant_id");
    expect(sweep?.values).toEqual([8, 50, ABANDONED_DELIVERY_ERROR]);
    expect(logger.warn).toHaveBeenCalledWith(
      "outbound_webhook_delivery_abandoned",
      expect.objectContaining({ delivery_id: "d1", attempt: 8 }),
    );
    expect(find("insert into public.messages_outbound")[0]?.values).toContainEqual(
      expect.objectContaining({ destination_name: "Kitchen Zap", event_label: "a new order" }),
    );
    // The attempt never finished: the receiver's health is not touched.
    expect(find("consecutive_failures")).toHaveLength(0);
  });

  it("never alerts for an abandoned test ping", async () => {
    const { sql, find } = fakeSql([
      [
        "with stale as",
        [
          {
            id: "d1",
            tenant_id: TENANT,
            destination_id: DEST,
            attempt_count: 1,
            event_type: "test.ping",
          },
        ],
      ],
    ]);
    expect(await failAbandonedDeliveries(sql, makeLogger())).toBe(1);
    expect(find("last_alerted_at")).toHaveLength(0);
  });

  it("counts the due backlog with a cap", async () => {
    const { sql, calls } = fakeSql([["select count(*)::int as n from (", [{ n: 42 }]]]);
    expect(await countDueDeliveries(sql)).toBe(42);
    expect(calls[0]?.text).toContain(
      "od.status in ('pending', 'retrying') and od.next_attempt_at <= now()",
    );
    expect(calls[0]?.values).toEqual([10_000]);
  });
});

describe("processClaimedDelivery", () => {
  it("cancels a delivery whose destination was turned off, without sending", async () => {
    const transport = okTransport();
    const { sql, find } = fakeSql();
    const result = await processClaimedDelivery(
      sql,
      claimed({ destination_enabled: false }),
      deps({ transport }),
    );
    expect(result).toEqual({ status: "cancelled", reason: "destination_disabled" });
    expect(find("set status = 'cancelled'")[0]?.values).toEqual([
      "Destination turned off",
      "d1",
      TENANT,
      1,
    ]);
    expect(transport).not.toHaveBeenCalled();
  });

  it("still sends a test ping to a turned-off destination", async () => {
    const transport = okTransport();
    const { sql } = fakeSql([["set status = 'delivered'", [{ id: "d1" }]]]);
    const result = await processClaimedDelivery(
      sql,
      claimed({
        destination_enabled: false,
        event_type: "test.ping",
        entity_type: "test",
        entity_id: null,
      }),
      deps({ transport }),
    );
    expect(result).toEqual({ status: "delivered", statusCode: 200 });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("builds the payload once, stores it, and sends exactly what was stored", async () => {
    const transport = okTransport();
    const stored = { ...STORED_PAYLOAD, data: { id: BOOKING, from: "db" } };
    const { sql, find } = fakeSql([
      ["from public.bookings b", [BOOKING_ROW]],
      ["set payload =", [{ payload: stored }]],
      ["set status = 'delivered'", [{ id: "d1" }]],
    ]);
    const result = await processClaimedDelivery(
      sql,
      claimed({ payload: null }),
      deps({ transport }),
    );
    expect(result.status).toBe("delivered");
    const store = find("set payload =")[0];
    expect(store?.text).toContain("::jsonb");
    expect(store?.text).toContain("payload is null");
    expect(store?.values.slice(1)).toEqual([EVENT, TENANT]);
    expect((transport.mock.calls[0] as [string, RequestInit])[1].body).toBe(JSON.stringify(stored));
  });

  it("reuses a concurrent builder's stored payload when it lost the race", async () => {
    const transport = okTransport();
    const winner = { ...STORED_PAYLOAD, data: { id: BOOKING, winner: true } };
    const { sql } = fakeSql([
      ["from public.bookings b", [BOOKING_ROW]],
      ["set payload =", []],
      ["select payload from public.outbound_events", [{ payload: winner }]],
      ["set status = 'delivered'", [{ id: "d1" }]],
    ]);
    await processClaimedDelivery(sql, claimed({ payload: null }), deps({ transport }));
    expect((transport.mock.calls[0] as [string, RequestInit])[1].body).toBe(JSON.stringify(winner));
  });

  it("re-sends a stored payload byte-for-byte without rebuilding", async () => {
    const transport = okTransport();
    const { sql, find } = fakeSql([["set status = 'delivered'", [{ id: "d1" }]]]);
    await processClaimedDelivery(sql, claimed({ attempt_count: 4 }), deps({ transport }));
    expect(find("from public.bookings b")).toHaveLength(0);
    expect((transport.mock.calls[0] as [string, RequestInit])[1].body).toBe(
      JSON.stringify(STORED_PAYLOAD),
    );
  });

  it("cancels when the booking no longer exists", async () => {
    const transport = okTransport();
    const { sql, find } = fakeSql();
    const result = await processClaimedDelivery(
      sql,
      claimed({ payload: null }),
      deps({ transport }),
    );
    expect(result).toEqual({ status: "cancelled", reason: "entity_missing" });
    expect(find("set status = 'cancelled'")).toHaveLength(1);
    expect(transport).not.toHaveBeenCalled();
  });

  it("retries without sending when the Vault secret is missing", async () => {
    const transport = okTransport();
    const logger = makeLogger();
    const { sql } = fakeSql([["set status = 'retrying'", [{ id: "d1" }]]]);
    const result = await processClaimedDelivery(
      sql,
      claimed({ secret: null }),
      deps({ transport, logger }),
    );
    expect(result).toMatchObject({ status: "retrying", error: "Signing secret missing" });
    expect(transport).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "outbound_webhook_secret_missing",
      expect.any(Object),
    );
  });

  it("never sends an off-contract payload: logs and retries instead", async () => {
    const transport = okTransport();
    const logger = makeLogger();
    const { sql } = fakeSql([
      ["from public.bookings b", [{ ...BOOKING_ROW, status: "teleported" }]],
      ["set status = 'retrying'", [{ id: "d1" }]],
    ]);
    const result = await processClaimedDelivery(
      sql,
      claimed({ payload: null }),
      deps({ transport, logger }),
    );
    expect(result).toMatchObject({
      status: "retrying",
      error: "Heyloo couldn't prepare this event",
    });
    expect(transport).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "outbound_webhook_payload_invalid",
      expect.any(Object),
    );
  });

  it("never logs the secret or the body", async () => {
    const logger = makeLogger();
    const { sql } = fakeSql([["set status = 'delivered'", [{ id: "d1" }]]]);
    await processClaimedDelivery(sql, claimed(), deps({ logger }));
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.error.mock.calls]);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("Joe's Garage");
  });
});

describe("runWebhookDeliveryWorker", () => {
  it("builds an event shared by two destinations once and sends both the same bytes", async () => {
    const transport = okTransport();
    const stored = { ...STORED_PAYLOAD, data: { id: BOOKING, built: 1 } };
    const rows = [
      claimed({ id: "d1", payload: null }),
      claimed({ id: "d2", destination_id: "e8f9a0b1-c2d3-4e4f-8a5b-6c7d8e9f0a1b", payload: null }),
    ];
    const { sql, find } = fakeSql([
      ["with due as", rows],
      ["from public.bookings b", [BOOKING_ROW]],
      ["set payload =", [{ payload: stored }]],
      ["set status = 'delivered'", [{ id: "x" }]],
    ]);
    const result = await runWebhookDeliveryWorker(sql, deps({ transport }));
    expect(result).toEqual({
      claimed: 2,
      delivered: 2,
      retrying: 0,
      failed: 0,
      cancelled: 0,
      errors: 0,
      abandoned: 0,
      rounds: 1,
      backlog: 0,
    });
    expect(find("from public.bookings b")).toHaveLength(1);
    const bodies = transport.mock.calls.map((c) => (c as [string, RequestInit])[1].body);
    expect(bodies).toEqual([JSON.stringify(stored), JSON.stringify(stored)]);
  });

  it("counts each outcome and keeps going after a row's database error", async () => {
    const logger = makeLogger();
    const transport = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("down") ? new Response(null, { status: 500 }) : new Response("ok"),
    );
    const rows = [
      claimed({ id: "ok" }),
      claimed({ id: "down", url: "https://down.example/hook" }),
      claimed({ id: "off", destination_enabled: false }),
      claimed({ id: "boom", url: "https://boom.example/hook" }),
    ];
    const { sql, find } = fakeSql([
      ["with due as", rows],
      [
        "set status = 'delivered'",
        (values) => {
          if (values.includes("boom")) throw new Error("connection reset");
          return [{ id: "x" }];
        },
      ],
      ["set status = 'retrying'", [{ id: "x" }]],
    ]);
    const result = await runWebhookDeliveryWorker(sql, deps({ transport, logger, concurrency: 2 }));
    expect(result).toEqual({
      claimed: 4,
      delivered: 1,
      retrying: 1,
      failed: 0,
      cancelled: 1,
      errors: 1,
      abandoned: 0,
      rounds: 1,
      backlog: 0,
    });
    expect(logger.error).toHaveBeenCalledWith(
      "outbound_webhook_delivery_error",
      expect.objectContaining({ delivery_id: "boom" }),
    );
    // The erroring row is recorded like a failed attempt (backoff), not left `sending`.
    const recorded = find("set status = 'retrying'").filter((c) => c.values.includes("boom"));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.values).toContain(PROCESSING_ERROR);
  });

  it("a row that throws on its final attempt ends failed, with the owner alert", async () => {
    const { sql, find } = fakeSql([
      ["with stale as", []],
      ["with due as", [claimed({ attempt_count: 8, payload: null })]],
      ["from public.bookings b", new Error("relation lock timeout")],
      ["set status = 'failed'", [{ id: "d1" }]],
      [
        "set last_alerted_at = now()",
        [{ name: "Zapier", previous_alerted_at: null, claimed_alerted_at: "x" }],
      ],
      ...ownerContact,
    ]);
    const result = await runWebhookDeliveryWorker(sql, deps());
    expect(result).toMatchObject({ claimed: 1, errors: 1, failed: 0 });
    const failed = find("set status = 'failed'").filter((c) => c.values.includes("d1"));
    expect(failed[0]?.values).toContain(PROCESSING_ERROR);
    expect(find("insert into public.messages_outbound")).toHaveLength(1);
  });

  it("keeps the lease when even recording the error fails (re-claimed or abandoned later)", async () => {
    const logger = makeLogger();
    const { sql } = fakeSql([
      ["with due as", [claimed({ payload: null })]],
      ["from public.bookings b", new Error("db down")],
      ["set status = 'retrying'", new Error("db down")],
    ]);
    const result = await runWebhookDeliveryWorker(sql, deps({ logger }));
    expect(result).toMatchObject({ claimed: 1, errors: 1 });
    expect(logger.error).toHaveBeenCalledWith(
      "outbound_webhook_record_failed",
      expect.objectContaining({ delivery_id: "d1" }),
    );
  });

  it("sweeps abandoned leases before claiming, and a sweep failure never blocks delivery", async () => {
    const logger = makeLogger();
    const { sql, calls } = fakeSql([
      ["with stale as", new Error("sweep broke")],
      ["with due as", [claimed()]],
      ["set status = 'delivered'", [{ id: "d1" }]],
    ]);
    const result = await runWebhookDeliveryWorker(sql, deps({ logger }));
    expect(result).toMatchObject({ claimed: 1, delivered: 1, abandoned: 0 });
    const order = calls.map((c) =>
      c.text.includes("with stale as") ? "sweep" : c.text.includes("with due as") ? "claim" : null,
    );
    expect(order.filter(Boolean).slice(0, 2)).toEqual(["sweep", "claim"]);
    expect(logger.error).toHaveBeenCalledWith(
      "outbound_webhook_abandoned_sweep_failed",
      expect.any(Object),
    );
  });

  it("claims again while batches come back full, and stops on a short one", async () => {
    const batches = [
      [claimed({ id: "a1" }), claimed({ id: "a2" })],
      [claimed({ id: "b1" }), claimed({ id: "b2" })],
      [claimed({ id: "c1" })],
    ];
    let round = 0;
    const { sql, find } = fakeSql([
      ["with due as", () => batches[round++] ?? []],
      ["set status = 'delivered'", [{ id: "x" }]],
    ]);
    const result = await runWebhookDeliveryWorker(sql, deps({ batchSize: 2 }));
    expect(result).toMatchObject({ claimed: 5, delivered: 5, rounds: 3, backlog: 0 });
    expect(find("with due as")).toHaveLength(3);
    expect(find("select count(*)::int as n from (")).toHaveLength(0);
  });

  it("stops starting rounds after the deadline and reports the backlog", async () => {
    const logger = makeLogger();
    let elapsedMs = 0;
    // Each send takes "3 s": round 1 ends at 6 s, past the 5.5 s deadline.
    const transport = vi.fn(async () => {
      elapsedMs += 3_000;
      return new Response("ok");
    });
    let n = 0;
    const { sql, find } = fakeSql([
      ["with due as", () => [claimed({ id: `r${n++}` }), claimed({ id: `r${n++}` })]],
      ["set status = 'delivered'", [{ id: "x" }]],
      ["select count(*)::int as n from (", [{ n: 37 }]],
    ]);
    const result = await runWebhookDeliveryWorker(
      sql,
      deps({
        transport,
        logger,
        batchSize: 2,
        concurrency: 1,
        now: () => new Date(NOW.getTime() + elapsedMs),
      }),
    );
    expect(result).toMatchObject({ rounds: 1, claimed: 2, delivered: 2, backlog: 37 });
    expect(find("with due as")).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "outbound_webhook_backlog",
      expect.objectContaining({ due: 37, rounds: 1 }),
    );
  });

  it("never runs more than maxRounds rounds", async () => {
    let n = 0;
    const { sql, find } = fakeSql([
      ["with due as", () => [claimed({ id: `r${n++}` })]],
      ["set status = 'delivered'", [{ id: "x" }]],
    ]);
    const result = await runWebhookDeliveryWorker(sql, deps({ batchSize: 1, maxRounds: 3 }));
    expect(result).toMatchObject({ rounds: 3, claimed: 3, delivered: 3, backlog: 0 });
    expect(find("with due as")).toHaveLength(3);
    expect(find("select count(*)::int as n from (")).toHaveLength(1);
  });

  it("does nothing when nothing is due", async () => {
    const transport = okTransport();
    expect(await runWebhookDeliveryWorker(fakeSql().sql, deps({ transport }))).toEqual({
      claimed: 0,
      delivered: 0,
      retrying: 0,
      failed: 0,
      cancelled: 0,
      errors: 0,
      abandoned: 0,
      rounds: 1,
      backlog: 0,
    });
    expect(transport).not.toHaveBeenCalled();
  });
});
