import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.js";
import type { SqlClient } from "../_shared/types.js";
import type { AdapterConnectDeps } from "./handler.js";
import { handleAdapterConnect } from "./handler.js";
import { signOAuthState } from "./state.js";

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
  ezyvet: { clientId: "e_client", clientSecret: "e_secret", partnerId: "partner_1" },
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
      expect(url.searchParams.get("scope")).toContain("calendar");
    }
  });
});

describe("handleAdapterConnect: callback", () => {
  it("exchanges the code and upserts a connected Square connection", async () => {
    const state = await signOAuthState(BASE_DEPS.stateSecret, {
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
    expect(captured).toContain("at");
  });

  it("rejects a callback whose state was signed for a different tenant (fail closed)", async () => {
    const state = await signOAuthState(BASE_DEPS.stateSecret, {
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
    const state = await signOAuthState(BASE_DEPS.stateSecret, {
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
    expect(captured).toContain("sk_live_1");
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

  it("confirms ezyVet practice authorization via a live client-credentials mint before storing the connection", async () => {
    let captured: unknown[] = [];
    const sql = makeSql({ membership: OWNER_MEMBERSHIP, captureUpsert: (v) => (captured = v) });
    const deps: AdapterConnectDeps = {
      ...BASE_DEPS,
      fetchImpl: (async () =>
        jsonResponse({ access_token: "token", expires_in: 43200 })) as unknown as typeof fetch,
    };
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "paste_key", provider: "ezyvet", base_url: "https://clinic.ezyvet.com/api/v1" },
      deps,
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { connected: true, provider: "ezyvet" },
    });
    expect(captured).toContain("token");
  });

  it("rejects when the practice has not authorized our partner_id for that database", async () => {
    const sql = makeSql({ membership: OWNER_MEMBERSHIP });
    const deps: AdapterConnectDeps = {
      ...BASE_DEPS,
      fetchImpl: (async () =>
        jsonResponse({ error: "invalid_client" }, 401)) as unknown as typeof fetch,
    };
    const result = await handleAdapterConnect(
      sql,
      "user_1",
      { action: "paste_key", provider: "ezyvet", base_url: "https://clinic.ezyvet.com/api/v1" },
      deps,
    );
    expect(result).toEqual({ ok: false, status: 401, error: "ezyvet_practice_not_authorized" });
  });
});

describe("handleAdapterConnect: disconnect", () => {
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
});
