import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../logger.ts";
import type { SqlClient } from "../types.ts";
import {
  CAP_LEASE_MINUTES,
  checkTrialCapAfterCall,
  endTrialForMinutesCap,
  findTrialsOverCap,
  runTrialCapSweep,
  type TrialCapCandidate,
  type TrialCapDeps,
} from "./cap.ts";

const logger = createLogger();
/** The lease's `claimed_ms` (when the run claimed the tenant). */
const CLAIMED_MS = 1_791_731_100_000;
const LEASE = { "set trial_cap_claimed_at = now()": [{ claimed_ms: String(CLAIMED_MS) }] };
const ROW: TrialCapCandidate = {
  tenant_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  stripe_subscription_id: "sub_1",
  trial_minutes_cap: 100,
  used_minutes: "100.5",
};

type Call = { text: string; values: unknown[] };

function makeSql(fixtures: Record<string, unknown[]> = {}) {
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

/** A trialing subscription as GET /v1/subscriptions/{id} returns it. */
const TRIALING = {
  id: "sub_1",
  status: "trialing",
  trial_end: 1_791_000_000,
  cancel_at_period_end: false,
  cancel_at: null,
};
/** What POST trial_end=now returns: the trial ended now, the plan started. */
const ENDED_NOW = { ...TRIALING, status: "active", trial_end: 1_790_701_500 };

/** Stripe double: GET returns `getBody`, POST returns `postBody`. */
function stripe(getBody: unknown, postBody: unknown = {}, postStatus = 200) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const isPost = init?.method === "POST";
    const status = isPost ? postStatus : 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (isPost ? postBody : getBody),
    } as unknown as Response;
  });
}

function deps(stripeFetch: TrialCapDeps["stripeFetch"], overrides: Partial<TrialCapDeps> = {}) {
  return {
    stripeFetch,
    stripeSecretKey: "sk_test_x",
    billingPageUrl: "https://heyloo.app/en/dashboard/billing",
    logger,
    ...overrides,
  } satisfies TrialCapDeps;
}

describe("findTrialsOverCap", () => {
  it("counts billable usage before trial_ends_at against the cap, only for open trials", async () => {
    const { sql, calls } = makeSql();
    await findTrialsOverCap(sql, ROW.tenant_id);
    const { text, values } = calls[0] as Call;
    expect(text).toContain("ue.is_billable and ue.occurred_at < t.trial_ends_at");
    expect(text).toContain("t.trial_ends_at > now()");
    expect(text).toContain("t.trial_ended_reason is null");
    expect(text).toContain("t.stripe_subscription_id is not null");
    expect(text).toContain("t.status = 'active'");
    expect(text).toContain("x.used_minutes >= x.trial_minutes_cap");
    expect(values).toEqual([ROW.tenant_id, ROW.tenant_id]);
  });
});

describe("endTrialForMinutesCap", () => {
  it("takes the lease, confirms the subscription is trialing, ends the trial now, records the end and emails once", async () => {
    const { sql, calls } = makeSql(LEASE);
    const fetchImpl = stripe(TRIALING, ENDED_NOW);
    const outcome = await endTrialForMinutesCap(sql, ROW, deps(fetchImpl));
    expect(outcome).toBe("ended");

    const [getUrl, getInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(getUrl).toBe("https://api.stripe.com/v1/subscriptions/sub_1");
    expect(getInit.method).toBe("GET");
    const [, postInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(postInit.method).toBe("POST");
    expect(new URLSearchParams(String(postInit.body)).get("trial_end")).toBe("now");
    // one key per lease
    expect((postInit.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      `trial-cap:sub_1:${CLAIMED_MS}`,
    );

    // The lease is exclusive (a fresh one blocks every other run) and does not
    // mark the trial ended: that waits for Stripe.
    const lease = calls[0] as Call;
    expect(lease.text).toContain("set trial_cap_claimed_at = now()");
    expect(lease.text).not.toContain("trial_ended_reason =");
    expect(lease.text).toContain("trial_ended_reason is null");
    expect(lease.text).toContain("trial_cap_claimed_at is null");
    expect(lease.text).toContain("trial_cap_claimed_at < now() -");
    expect(lease.values).toContain(CAP_LEASE_MINUTES);
    const finalize = calls.find((c) =>
      c.text.includes("least(trial_ends_at, coalesce(to_timestamp("),
    );
    expect(finalize?.text).toContain("set trial_ended_reason = 'minutes'");
    expect(finalize?.values).toContain(1_790_701_500);
    const email = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(email?.values).toContain("trial_minutes_used");
    expect(email?.values).toContainEqual({
      minutes: 100,
      billing_url: "https://heyloo.app/en/dashboard/billing",
    });
  });

  it("never touches Stripe or claims anything while Stripe is not configured", async () => {
    const { sql, calls } = makeSql();
    const fetchImpl = stripe({});
    const outcome = await endTrialForMinutesCap(
      sql,
      ROW,
      deps(fetchImpl, { stripeSecretKey: undefined }),
    );
    expect(outcome).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("stops when another run holds the lease or already closed the trial (claim lost)", async () => {
    const { sql } = makeSql();
    const fetchImpl = stripe({});
    expect(await endTrialForMinutesCap(sql, ROW, deps(fetchImpl))).toBe("claim_lost");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never ends the trial of an owner who already canceled: no charge, no email, re-checked after the lease", async () => {
    for (const pending of [
      { cancel_at_period_end: true, cancel_at: null },
      { cancel_at_period_end: false, cancel_at: TRIALING.trial_end },
    ]) {
      const { sql, calls } = makeSql(LEASE);
      const fetchImpl = stripe({ ...TRIALING, ...pending });
      expect(await endTrialForMinutesCap(sql, ROW, deps(fetchImpl))).toBe("cancel_pending");
      expect(fetchImpl).toHaveBeenCalledTimes(1); // the GET only, never trial_end=now
      expect(calls.some((c) => c.text.includes("set trial_cancel_scheduled = true"))).toBe(true);
      expect(calls.some((c) => c.text.includes("trial_ended_reason = 'minutes'"))).toBe(false);
      expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(
        false,
      );
      expect(calls.some((c) => c.text.includes("insert into public.alerts"))).toBe(false);
    }
  });

  it("ends the trial when the cancel date is after the trial (the owner means to pay until then)", async () => {
    const { sql } = makeSql(LEASE);
    const fetchImpl = stripe(
      { ...TRIALING, cancel_at: TRIALING.trial_end + 30 * 86_400 },
      ENDED_NOW,
    );
    expect(await endTrialForMinutesCap(sql, ROW, deps(fetchImpl))).toBe("ended");
  });

  it("does not send trial_end to a subscription that is no longer trialing (would move its billing cycle)", async () => {
    const { sql, calls } = makeSql(LEASE);
    const fetchImpl = stripe({ ...TRIALING, status: "active", trial_end: 1_790_700_000 });
    expect(await endTrialForMinutesCap(sql, ROW, deps(fetchImpl))).toBe("already_over");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the GET only
    expect(calls.find((c) => c.text.includes("least(trial_ends_at, coalesce("))?.values).toContain(
      1_790_700_000,
    );
  });

  it("a subscription canceled meanwhile ends the trial as canceled, with no 'plan started' email", async () => {
    const { sql, calls } = makeSql(LEASE);
    const fetchImpl = stripe({ ...TRIALING, status: "canceled" });
    expect(await endTrialForMinutesCap(sql, ROW, deps(fetchImpl))).toBe("already_over");
    expect(calls.some((c) => c.text.includes("trial_ended_reason = 'canceled'"))).toBe(true);
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });

  it("a failed Stripe update keeps the trial running (lease kept for the retry) and raises one open alert", async () => {
    const { sql, calls } = makeSql(LEASE);
    const fetchImpl = stripe(TRIALING, { error: { type: "api_error" } }, 500);
    expect(await endTrialForMinutesCap(sql, ROW, deps(fetchImpl))).toBe("failed");
    const alert = calls.find((c) => c.text.includes("insert into public.alerts"));
    expect(alert?.values).toContainEqual({ step: "end_trial", status: 500, error: "api_error" });
    expect(alert?.text).toContain("a.status = 'open'");
    expect(calls.some((c) => c.text.includes("trial_ended_reason = 'minutes'"))).toBe(false);
    expect(calls.some((c) => c.text.includes("trial_cap_claimed_at = null"))).toBe(false);
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });

  it("a Stripe timeout is a failure with an alert too, never a hang or a throw", async () => {
    const { sql, calls } = makeSql(LEASE);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      return { ok: true, status: 200, json: async () => TRIALING } as unknown as Response;
    });
    expect(await endTrialForMinutesCap(sql, ROW, deps(fetchImpl))).toBe("failed");
    expect(calls.find((c) => c.text.includes("insert into public.alerts"))?.values).toContainEqual({
      step: "end_trial",
      status: 0,
      error: "timeout",
    });
  });

  it("an unreadable Stripe response is a failure, never a guess", async () => {
    const { sql } = makeSql(LEASE);
    const fetchImpl = stripe(TRIALING, { surprise: true });
    expect(await endTrialForMinutesCap(sql, ROW, deps(fetchImpl))).toBe("failed");
  });

  it("a subscription read that does not say whether a cancellation is pending is a failure (no trial_end sent)", async () => {
    const { sql } = makeSql(LEASE);
    const fetchImpl = stripe({ id: "sub_1", status: "trialing", trial_end: 1_791_000_000 });
    expect(await endTrialForMinutesCap(sql, ROW, deps(fetchImpl))).toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a failed subscription read is a failure too", async () => {
    const { sql, calls } = makeSql(LEASE);
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response,
    );
    expect(await endTrialForMinutesCap(sql, ROW, deps(fetchImpl))).toBe("failed");
    expect(calls.find((c) => c.text.includes("insert into public.alerts"))?.values).toContainEqual({
      step: "retrieve",
      status: 503,
      error: "stripe_error",
    });
  });
});

describe("checkTrialCapAfterCall", () => {
  it("does nothing more than one read for a tenant that is not over a trial cap", async () => {
    const { sql, calls } = makeSql();
    const fetchImpl = stripe({});
    expect(await checkTrialCapAfterCall(sql, ROW.tenant_id, deps(fetchImpl))).toBeNull();
    expect(calls).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ends the trial for a tenant over its cap", async () => {
    const { sql } = makeSql({ "x.used_minutes >= x.trial_minutes_cap": [ROW], ...LEASE });
    const fetchImpl = stripe(TRIALING, ENDED_NOW);
    expect(await checkTrialCapAfterCall(sql, ROW.tenant_id, deps(fetchImpl))).toBe("ended");
  });

  it("never throws (a database error is logged and reported as failed)", async () => {
    const sql = (() => Promise.reject(new Error("db down"))) as SqlClient;
    expect(await checkTrialCapAfterCall(sql, ROW.tenant_id, deps(stripe({})))).toBe("failed");
  });
});

describe("runTrialCapSweep (hourly safety net)", () => {
  it("stamps trials that ran their days, then ends every trial over its cap", async () => {
    const { sql, calls } = makeSql({
      "set trial_ended_reason = 'time'": [{ id: "t-old" }],
      "x.used_minutes >= x.trial_minutes_cap": [
        ROW,
        { ...ROW, tenant_id: "t2", stripe_subscription_id: "sub_2" },
        { ...ROW, tenant_id: "t3", stripe_subscription_id: "sub_3" },
      ],
      ...LEASE,
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const sub = url.split("/").pop() as string;
      if (init?.method === "POST" && sub === "sub_2") {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          init?.method === "POST"
            ? { ...ENDED_NOW, id: sub }
            : { ...TRIALING, id: sub, cancel_at_period_end: sub === "sub_3" },
      } as unknown as Response;
    });
    const result = await runTrialCapSweep(sql, deps(fetchImpl));
    expect(result).toEqual({
      stamped_time: 1,
      over_cap: 3,
      ended: 1,
      cancel_pending: 1,
      failed: 1,
    });
    const stamp = calls[0] as Call;
    expect(stamp.text).toContain("trial_ends_at <= now() and trial_ended_reason is null");
    // the over-cap scan runs across all tenants
    expect(calls[1]?.values).toEqual([null, null]);
  });

  it("counts every over-cap tenant as failed while Stripe is not configured", async () => {
    const { sql } = makeSql({ "x.used_minutes >= x.trial_minutes_cap": [ROW] });
    const result = await runTrialCapSweep(sql, deps(stripe({}), { stripeSecretKey: undefined }));
    expect(result).toEqual({
      stamped_time: 0,
      over_cap: 1,
      ended: 0,
      cancel_pending: 0,
      failed: 1,
    });
  });
});
