import { describe, expect, it } from "vitest";
import { decryptSecret } from "../_shared/crypto.ts";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { AdapterConnectDeps } from "./handler.ts";
import { handleAdapterConnect } from "./handler.ts";
import { signOAuthState } from "./state.ts";

const TEST_TOKEN_ENCRYPTION_KEY = btoa("abcdefghijklmnopqrstuvwxyz012345");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeSql(opts: {
  membership?: { tenant_id: string; role: string } | null;
  captureUpsert?: (values: unknown[]) => void;
  captureDisconnect?: (values: unknown[]) => void;
}): SqlClient {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("from public.memberships")) {
      return opts.membership === null || opts.membership === undefined ? [] : [opts.membership];
    }
    if (text.includes("insert into public.adapter_connections")) {
      opts.captureUpsert?.(values);
      return [];
    }
    if (text.includes("update public.adapter_connections")) {
      opts.captureDisconnect?.(values);
      return [];
    }
    return [];
  }) as unknown as SqlClient;
}

const BASE_DEPS: AdapterConnectDeps = {
  fetchImpl: (async () => jsonResponse({})) as unknown as typeof fetch,
  stateSecret: "state-secret",
  nonce: () => "fixed-nonce",
  square: {
    clientId: "sq_client",
    clientSecret: "sq_secret",
    redirectUri: "https://example.com/cb",
  },
  googleCalendar: {
    clientId: "g_client",
    clientSecret: "g_secret",
    redirectUri: "https://example.com/cb",
  },
  tokenEncryptionKey: TEST_TOKEN_ENCRYPTION_KEY,
  logger: createLogger(),
};

const OWNER_MEMBERSHIP = { tenant_id: "tenant_1", role: "owner" };

describe("handleAdapterConnect: auth/authorization", () => {
  it("rejects a request body that fails schema validation", async () => {
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const result = await handleAdapterConnect(sql, "user_1", { action: "bogus" }, BASE_DEPS);
    expect(result).toEqual({ ok: false, status: 400, error: "invalid_request" });
  });

  it("rejects a user with no owner/admin membership on any tenant", async () => {
    const sql = makeSql({ membership: null });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "initiate", provider: "square" },
      BASE_DEPS,
    );
    expect(result).toEqual({ ok: false, status: 403, error: "not_a_tenant_owner_or_admin" });
  });
});

describe("QA-1 BE-04: unset provider secrets degrade to 503 not_configured, per action", () => {
  const NO_SECRETS: AdapterConnectDeps = {
    fetchImpl: BASE_DEPS.fetchImpl,
    nonce: () => "n",
    logger: createLogger(),
  };

  it("still authorizes first: a non-owner gets 403, not a config error", async () => {
    const sql = makeSql({ membership: null });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "initiate", provider: "square" },
      NO_SECRETS,
    );
    expect(result).toEqual({ ok: false, status: 403, error: "not_a_tenant_owner_or_admin" });
  });

  it("initiate for a provider whose secrets are unset answers 503, other providers still work", async () => {
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const onlyGoogle: AdapterConnectDeps = {
      ...NO_SECRETS,
      stateSecret: "state-secret",
      googleCalendar: BASE_DEPS.googleCalendar,
    };
    const square = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "initiate", provider: "square" },
      onlyGoogle,
    );
    expect(square).toEqual({ ok: false, status: 503, error: "not_configured" });
    const google = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "initiate", provider: "google_calendar" },
      onlyGoogle,
    );
    expect(google.ok).toBe(true);
  });

  it("paste_key answers 503 for a missing or misshapen token encryption key, before any provider call", async () => {
    let fetched = 0;
    const deps: AdapterConnectDeps = {
      ...NO_SECRETS,
      fetchImpl: (async () => {
        fetched += 1;
        return jsonResponse({});
      }) as unknown as typeof fetch,
    };
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    for (const tokenEncryptionKey of [undefined, btoa("short")]) {
      const result = await handleAdapterConnect(
        sql,
        "user_1",
        { action: "paste_key", provider: "shopmonkey", api_key: "k" },
        { ...deps, tokenEncryptionKey },
      );
      expect(result).toEqual({ ok: false, status: 503, error: "not_configured" });
    }
    expect(fetched).toBe(0);
  });

  it("disconnect needs no provider secret at all", async () => {
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "disconnect", provider: "square" },
      NO_SECRETS,
    );
    expect(result.ok).toBe(true);
  });
});

describe("handleAdapterConnect: initiate", () => {
  it("returns a Square authorize URL carrying a signed, tenant-bound state", async () => {
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "initiate", provider: "square" },
      BASE_DEPS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(result.body["authorize_url"] as string);
      expect(url.hostname).toBe("connect.squareup.com");
      expect(url.searchParams.get("client_id")).toBe("sq_client");
      expect(url.searchParams.get("state")).toBeTruthy();
    }
  });

  it("returns a Google authorize URL requesting offline access (refresh token)", async () => {
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "initiate", provider: "google_calendar" },
      BASE_DEPS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(result.body["authorize_url"] as string);
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("prompt")).toBe("consent");
      // CAL-1: exactly the two narrow scopes, never the broad auth/calendar.
      expect(url.searchParams.get("scope")?.split(" ")).toEqual([
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.freebusy",
      ]);
      expect(url.searchParams.get("scope")?.split(" ")).not.toContain(
        "https://www.googleapis.com/auth/calendar",
      );
    }
  });
});

describe("handleAdapterConnect: Google Calendar callback (CAL-1)", () => {
  const SCOPES =
    "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy";

  async function googleCallback(tokenBody: unknown, status = 200) {
    const state = await signOAuthState("state-secret", {
      tenantId: "tenant_1",
      provider: "google_calendar",
      nonce: "n1",
    });
    let upserted: unknown[] | null = null;
    let upsertText = "";
    const base = makeSql({ membership: OWNER_MEMBERSHIP });
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("?").includes("insert into public.adapter_connections")) {
        upserted = values;
        upsertText = strings.join("?");
        return [];
      }
      return base(strings, ...values);
    }) as unknown as SqlClient;
    let tokenRequest: URLSearchParams | undefined;
    const deps: AdapterConnectDeps = {
      ...BASE_DEPS,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        tokenRequest = new URLSearchParams(String(init?.body));
        return jsonResponse(tokenBody, status);
      }) as unknown as typeof fetch,
    };
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "callback", provider: "google_calendar", code: "code_1", state },
      deps,
    );
    return { result, upserted: upserted as unknown[] | null, upsertText, tokenRequest };
  }

  it("stores a validated token response (encrypted) and asks for an immediate busy-time sync", async () => {
    const { result, upserted, upsertText, tokenRequest } = await googleCallback({
      access_token: "ya29.access",
      expires_in: 3599,
      refresh_token: "1//refresh",
      scope: SCOPES,
      token_type: "Bearer",
    });
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { connected: true, provider: "google_calendar" },
    });
    expect(tokenRequest?.get("grant_type")).toBe("authorization_code");
    expect(tokenRequest?.get("redirect_uri")).toBe("https://example.com/cb");
    expect(upserted).not.toContain("ya29.access");
    expect(upserted).not.toContain("1//refresh");
    const secrets = (upserted ?? []).filter(
      (v): v is string => typeof v === "string" && v.startsWith("v1:"),
    );
    expect(
      await Promise.all(secrets.map((v) => decryptSecret(v, TEST_TOKEN_ENCRYPTION_KEY))),
    ).toEqual(["ya29.access", "1//refresh"]);
    expect(upsertText).toContain("busy_sync_attempted_at = null");
    // a reconnect starts a fresh failure window (owner alert after 3 h) and backoff
    expect(upsertText).toContain("busy_sync_failing_since = null");
    expect(upsertText).toContain("busy_sync_failures = 0");
    // CAL-1b: one busy-time read is requested now (push-only: nothing re-reads on a timer)...
    expect(upsertText).toContain("busy_sync_requested_at");
    expect(upsertText).toMatch(/case when \?::boolean then now\(\) end/);
    expect(upsertText).toContain(
      "busy_sync_requested_at = coalesce(excluded.busy_sync_requested_at",
    );
    // ...and a fresh push channel is forced (any older channel is replaced and stopped)
    expect(upsertText).toMatch(/watch_expires_at = case when \?::boolean then null/);
    // ...right away: a channel backoff left from before the reconnect is cleared
    expect(upsertText).toMatch(/watch_failures = case when \?::boolean then 0/);
    expect(upsertText).toMatch(/watch_retry_at = case when \?::boolean then null/);
    expect(upserted).toContain(true);
  });

  it("CAL-1b: a non-calendar connect requests no busy-time read and keeps any channel state", async () => {
    let upserted: unknown[] = [];
    const sql = makeSql({ membership: OWNER_MEMBERSHIP, captureUpsert: (v) => (upserted = v) });
    const deps: AdapterConnectDeps = {
      ...BASE_DEPS,
      fetchImpl: (async () => jsonResponse({ id: "user_1" })) as unknown as typeof fetch,
    };
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "paste_key", provider: "shopmonkey", api_key: "sm_key" },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(upserted).not.toContain(true);
    expect(upserted).toContain(false);
  });

  it("refuses (and stores nothing) when the owner unticked a permission on Google's consent screen", async () => {
    const { result, upserted } = await googleCallback({
      access_token: "ya29.access",
      expires_in: 3599,
      refresh_token: "1//refresh",
      scope: "https://www.googleapis.com/auth/calendar.events",
    });
    expect(result).toEqual({ ok: false, status: 400, error: "google_scopes_not_granted" });
    expect(upserted).toBeNull();
  });

  it("an older broad-scope grant is accepted", async () => {
    const { result } = await googleCallback({
      access_token: "a",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/calendar",
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["a body without access_token", { expires_in: 3600, scope: SCOPES }, 200],
    ["a non-numeric expires_in", { access_token: "a", expires_in: "soon", scope: SCOPES }, 200],
    ["Google's own error answer", { error: "invalid_grant" }, 400],
  ])(
    "answers 502 google_token_exchange_failed for %s (Zod at the boundary)",
    async (_l, body, status) => {
      const { result, upserted } = await googleCallback(body, status);
      expect(result).toEqual({ ok: false, status: 502, error: "google_token_exchange_failed" });
      expect(upserted).toBeNull();
    },
  );
});

describe("handleAdapterConnect: callback", () => {
  it("exchanges the code and upserts a connected Square connection", async () => {
    const state = await signOAuthState("state-secret", {
      tenantId: "tenant_1",
      provider: "square",
      nonce: "n1",
    });
    let captured: unknown[] = [];
    const sql = makeSql({ membership: OWNER_MEMBERSHIP, captureUpsert: (v) => (captured = v) });
    const deps: AdapterConnectDeps = {
      ...BASE_DEPS,
      fetchImpl: (async () =>
        jsonResponse({
          access_token: "at",
          refresh_token: "rt",
          merchant_id: "merchant_1",
        })) as unknown as typeof fetch,
    };

    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "callback", provider: "square", code: "code_1", state },
      deps,
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { connected: true, provider: "square" },
    });
    expect(captured).toContain("tenant_1");
    // DB-H2: the access token is written encrypted, never as plaintext.
    expect(captured).not.toContain("at");
    const storedAccessToken = captured.find(
      (v) => typeof v === "string" && v.startsWith("v1:"),
    ) as string;
    expect(storedAccessToken).toBeDefined();
    expect(await decryptSecret(storedAccessToken, TEST_TOKEN_ENCRYPTION_KEY)).toBe("at");
  });

  it("rejects a callback whose state was signed for a different tenant (fail closed)", async () => {
    const state = await signOAuthState("state-secret", {
      tenantId: "some_other_tenant",
      provider: "square",
      nonce: "n1",
    });
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "callback", provider: "square", code: "code_1", state },
      BASE_DEPS,
    );
    expect(result).toEqual({ ok: false, status: 401, error: "state_tenant_mismatch" });
  });

  it("rejects a callback with a tampered state", async () => {
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "callback", provider: "square", code: "code_1", state: "garbage.garbage" },
      BASE_DEPS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("surfaces a 502 when the provider's token exchange itself fails", async () => {
    const state = await signOAuthState("state-secret", {
      tenantId: "tenant_1",
      provider: "square",
      nonce: "n1",
    });
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const deps: AdapterConnectDeps = {
      ...BASE_DEPS,
      fetchImpl: (async () =>
        jsonResponse({ type: "invalid_grant" }, 400)) as unknown as typeof fetch,
    };
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "callback", provider: "square", code: "bad_code", state },
      deps,
    );
    expect(result).toEqual({ ok: false, status: 502, error: "square_token_exchange_failed" });
  });
});

describe("handleAdapterConnect: paste_key", () => {
  it("validates and stores a Shopmonkey API key", async () => {
    let captured: unknown[] = [];
    const sql = makeSql({ membership: OWNER_MEMBERSHIP, captureUpsert: (v) => (captured = v) });
    const deps: AdapterConnectDeps = {
      ...BASE_DEPS,
      fetchImpl: (async () => jsonResponse({ id: "user_1" })) as unknown as typeof fetch,
    };
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "paste_key", provider: "shopmonkey", api_key: "sk_live_1" },
      deps,
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { connected: true, provider: "shopmonkey" },
    });
    expect(captured).not.toContain("sk_live_1");
    const storedApiKey = captured.find(
      (v) => typeof v === "string" && v.startsWith("v1:"),
    ) as string;
    expect(await decryptSecret(storedApiKey, TEST_TOKEN_ENCRYPTION_KEY)).toBe("sk_live_1");
  });

  it("rejects an invalid Shopmonkey API key without storing anything", async () => {
    let called = false;
    const sql = makeSql({
      membership: OWNER_MEMBERSHIP,
      captureUpsert: () => {
        called = true;
      },
    });
    const deps: AdapterConnectDeps = {
      ...BASE_DEPS,
      fetchImpl: (async () =>
        jsonResponse({ error: "unauthorized" }, 401)) as unknown as typeof fetch,
    };
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "paste_key", provider: "shopmonkey", api_key: "bad_key" },
      deps,
    );
    expect(result).toEqual({ ok: false, status: 401, error: "shopmonkey_api_key_invalid" });
    expect(called).toBe(false);
  });
});

describe("handleAdapterConnect: ezyVet is refused (CONNECT-SAFE-1)", () => {
  it("answers 409 provider_unavailable for an ezyVet paste_key without fetching or storing anything", async () => {
    let fetched = 0;
    let stored = false;
    const sql = makeSql({
      membership: OWNER_MEMBERSHIP,
      captureUpsert: () => {
        stored = true;
      },
    });
    const deps: AdapterConnectDeps = {
      ...BASE_DEPS,
      fetchImpl: (async () => {
        fetched += 1;
        return jsonResponse({ access_token: "token", expires_in: 43200 });
      }) as unknown as typeof fetch,
    };
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "paste_key", provider: "ezyvet", base_url: "https://api.ezyvet.com/v1" },
      deps,
    );
    expect(result).toEqual({ ok: false, status: 409, error: "provider_unavailable" });
    expect(fetched).toBe(0);
    expect(stored).toBe(false);
  });

  it("refuses it even when no secrets are configured (no 503 that would invite a retry)", async () => {
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "paste_key", provider: "ezyvet", base_url: "https://api.ezyvet.com/v1" },
      { fetchImpl: BASE_DEPS.fetchImpl, nonce: () => "n", logger: createLogger() },
    );
    expect(result).toEqual({ ok: false, status: 409, error: "provider_unavailable" });
  });

  it("still authorizes first: a non-owner gets 403", async () => {
    const sql = makeSql({ membership: null });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "paste_key", provider: "ezyvet", base_url: "https://api.ezyvet.com/v1" },
      BASE_DEPS,
    );
    expect(result).toEqual({ ok: false, status: 403, error: "not_a_tenant_owner_or_admin" });
  });

  it("rejects a non-ezyVet base_url as invalid_request before anything else", async () => {
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "paste_key", provider: "ezyvet", base_url: "https://evil.example.com" },
      BASE_DEPS,
    );
    expect(result).toEqual({ ok: false, status: 400, error: "invalid_request" });
  });

  it("an existing ezyVet connection can still be disconnected", async () => {
    let captured: unknown[] = [];
    let fetched = false;
    const sql = makeSql({ membership: OWNER_MEMBERSHIP, captureDisconnect: (v) => (captured = v) });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "disconnect", provider: "ezyvet" },
      {
        ...BASE_DEPS,
        fetchImpl: (async () => {
          fetched = true;
          return jsonResponse({});
        }) as unknown as typeof fetch,
      },
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { disconnected: true, provider: "ezyvet" },
    });
    expect(captured).toEqual(["tenant_1", "ezyvet"]);
    expect(fetched).toBe(false);
  });
});

describe("handleAdapterConnect: disconnect", () => {
  it("CAL-1: the owner's disconnect also deletes what Heyloo read from that calendar, in the same statement", async () => {
    const texts: string[] = [];
    const base = makeSql({ membership: OWNER_MEMBERSHIP });
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      texts.push(strings.join(" "));
      return base(strings, ...values);
    }) as unknown as SqlClient;
    await handleAdapterConnect(
      sql,
      "user_1",
      { action: "disconnect", provider: "google_calendar" },
      BASE_DEPS,
    );
    const statement = texts.find((t) => t.includes("update public.adapter_connections")) ?? "";
    expect(statement).toContain("last_error = 'tenant-initiated disconnect'");
    expect(statement).toContain("delete from public.external_busy_blocks x");
    expect(statement).toContain("x.connection_id = d.id and x.tenant_id = d.tenant_id");
    // CAL-1b: the push channel is forgotten in the same statement (its
    // notifications are then refused as an unknown channel)
    expect(statement).toContain(
      "watch_channel_id = null, watch_resource_id = null, watch_token_hash = null",
    );
    // the previous channel is read under the row lock, so a renewal that
    // committed just before is the one that gets stopped
    expect(statement).toContain("for update");
  });

  it("marks the connection disconnected for the caller's own tenant", async () => {
    let captured: unknown[] = [];
    const sql = makeSql({ membership: OWNER_MEMBERSHIP, captureDisconnect: (v) => (captured = v) });
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "disconnect", provider: "square" },
      BASE_DEPS,
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { disconnected: true, provider: "square" },
    });
    expect(captured).toContain("tenant_1");
  });

  describe("CAL-1b: stops the Google push channel", () => {
    async function disconnectGoogle(
      previous: Record<string, unknown> | null,
      opts: { deps?: Partial<AdapterConnectDeps>; respond?: (url: string) => Response } = {},
    ) {
      const base = makeSql({ membership: OWNER_MEMBERSHIP });
      const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join(" ").includes("update public.adapter_connections")) {
          return previous ? [previous] : [];
        }
        return base(strings, ...values);
      }) as unknown as SqlClient;
      const calls: { url: string; body: string; authorization: string | undefined }[] = [];
      const deps: AdapterConnectDeps = {
        ...BASE_DEPS,
        fetchImpl: (async (url: string, init?: RequestInit) => {
          calls.push({
            url,
            body: String(init?.body ?? ""),
            authorization: (init?.headers as Record<string, string> | undefined)?.["authorization"],
          });
          if (opts.respond) return opts.respond(url);
          if (url.includes("oauth2.googleapis.com/token")) {
            return jsonResponse({ access_token: "fresh-access", expires_in: 3600 });
          }
          return new Response(null, { status: 204 });
        }) as unknown as typeof fetch,
        ...opts.deps,
      };
      const result = await handleAdapterConnect(
        sql,
        "user_1",
        { action: "disconnect", provider: "google_calendar" },
        deps,
      );
      return { result, calls };
    }

    async function previousRow(overrides: Record<string, unknown> = {}) {
      const { encryptSecret } = await import("../_shared/crypto.ts");
      return {
        watch_channel_id: "chan-1",
        watch_resource_id: "res-1",
        access_token: await encryptSecret("stored-access", TEST_TOKEN_ENCRYPTION_KEY),
        refresh_token: await encryptSecret("stored-refresh", TEST_TOKEN_ENCRYPTION_KEY),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        blocks_removed: 2,
        ...overrides,
      };
    }

    it("calls channels.stop with the stored (still valid) access token after disconnecting", async () => {
      const { result, calls } = await disconnectGoogle(await previousRow());
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://www.googleapis.com/calendar/v3/channels/stop");
      expect(calls[0]?.authorization).toBe("Bearer stored-access");
      expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ id: "chan-1", resourceId: "res-1" });
    });

    it("refreshes an expired access token once (not stored) to stop the channel", async () => {
      const { calls } = await disconnectGoogle(
        await previousRow({ expires_at: new Date(Date.now() - 1000).toISOString() }),
      );
      expect(calls.map((c) => c.url)).toEqual([
        "https://oauth2.googleapis.com/token",
        "https://www.googleapis.com/calendar/v3/channels/stop",
      ]);
      expect(calls[1]?.authorization).toBe("Bearer fresh-access");
    });

    it("a failing stop never fails the owner's disconnect", async () => {
      const { result } = await disconnectGoogle(await previousRow(), {
        respond: () => jsonResponse({}, 500),
      });
      expect(result).toEqual({
        ok: true,
        status: 200,
        body: { disconnected: true, provider: "google_calendar" },
      });
    });

    it("a refresh that fails means no stop call (the channel runs out by itself)", async () => {
      const { result, calls } = await disconnectGoogle(await previousRow({ expires_at: null }), {
        respond: () => jsonResponse({ error: "invalid_grant" }, 400),
      });
      expect(result.ok).toBe(true);
      expect(calls.map((c) => c.url)).toEqual(["https://oauth2.googleapis.com/token"]);
    });

    it("no channel registered: no Google call at all", async () => {
      const { calls } = await disconnectGoogle(
        await previousRow({ watch_channel_id: null, watch_resource_id: null }),
      );
      expect(calls).toHaveLength(0);
    });

    it("no connection row: nothing to stop", async () => {
      const { result, calls } = await disconnectGoogle(null);
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(0);
    });

    it("without the token key the stop is skipped (disconnect still succeeds)", async () => {
      const { result, calls } = await disconnectGoogle(await previousRow(), {
        deps: { tokenEncryptionKey: undefined },
      });
      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });
});
