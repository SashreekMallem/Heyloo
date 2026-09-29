import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * scripts/enable-auth-email-hook.ts: dry-run by default, the exact Management
 * API calls and field names, ordering (function secret before the Auth
 * config), the safety checks, and that the signing secret is never printed or
 * leaked into an error.
 */

interface ScriptModule {
  LIVE_PROJECT_REF: string;
  hookUri(ref: string): string;
  generateHookSecret(random?: (n: number) => Uint8Array): string;
  buildHookPatch(ref: string, secret: string): Record<string, unknown>;
  completeProviders(names: ReadonlySet<string>): string[];
  enableAuthEmailHook(options: {
    ref: string;
    accessToken: string;
    fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
    log?: (line: string) => void;
    makeSecret?: () => string;
    rotate?: boolean;
  }): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }>;
  disableAuthEmailHook(options: {
    ref: string;
    accessToken: string;
    fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  }): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }>;
}

const scriptPath = resolve(import.meta.dirname, "../../../scripts/enable-auth-email-hook.ts");
// A variable specifier keeps the script outside this package's TypeScript project.
const mod = (await import(/* @vite-ignore */ scriptPath)) as ScriptModule;

const REF = "qulcubtwqsqgqpfgvorn";
const SECRET = "v1,whsec_TESTSECRETTESTSECRETTESTSECRETTESTSECRE=";
const GRAPH_SECRETS = [
  "MS_TENANT_ID",
  "MS_CLIENT_ID",
  "MS_CLIENT_SECRET",
  "EMAIL_FROM_ADDRESS",
].map((name) => ({ name, value: "digest" }));

interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
}

/** A tiny in-memory Management API. */
function fakeApi(
  state: {
    deployed?: boolean;
    secrets?: Array<{ name: string; value: string }>;
    auth?: Record<string, unknown>;
    failOn?: string;
  } = {},
) {
  const s = {
    deployed: true,
    secrets: [...GRAPH_SECRETS],
    auth: {} as Record<string, unknown>,
    ...state,
  };
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const path = url.replace("https://api.supabase.com", "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path,
      body,
      auth: new Headers(init.headers).get("authorization"),
    });
    const key = `${method} ${path}`;
    if (s.failOn === key) {
      return new Response(`boom ${JSON.stringify(body)}`, { status: 500 });
    }
    if (key === `GET /v1/projects/${REF}/functions/auth-send-email`) {
      return s.deployed
        ? Response.json({ slug: "auth-send-email" })
        : new Response("not found", { status: 404 });
    }
    if (key === `GET /v1/projects/${REF}/secrets`) return Response.json(s.secrets);
    if (key === `POST /v1/projects/${REF}/secrets`) {
      for (const item of body as Array<{ name: string; value: string }>) {
        s.secrets = [...s.secrets.filter((e) => e.name !== item.name), item];
      }
      return new Response(null, { status: 201 });
    }
    if (key === `GET /v1/projects/${REF}/config/auth`) return Response.json(s.auth);
    if (key === `PATCH /v1/projects/${REF}/config/auth`) {
      Object.assign(s.auth, body);
      return Response.json(s.auth);
    }
    return new Response("unexpected", { status: 500 });
  };
  return { calls, fetchImpl, state: s };
}

describe("hook secret", () => {
  it("has the Supabase format v1,whsec_<base64 of 32 bytes>", () => {
    const secret = mod.generateHookSecret();
    expect(secret).toMatch(/^v1,whsec_[A-Za-z0-9+/]{43}=$/);
    expect(mod.generateHookSecret()).not.toBe(secret);
  });

  it("is derived from injected bytes (deterministic in tests)", () => {
    expect(mod.generateHookSecret(() => new Uint8Array(32).fill(1))).toBe(
      `v1,whsec_${Buffer.alloc(32, 1).toString("base64")}`,
    );
  });
});

describe("request shapes", () => {
  it("targets the live project's auth-send-email function", () => {
    expect(mod.LIVE_PROJECT_REF).toBe(REF);
    expect(mod.hookUri(REF)).toBe(`https://${REF}.supabase.co/functions/v1/auth-send-email`);
  });

  it("PATCH body uses the documented field names", () => {
    expect(mod.buildHookPatch(REF, SECRET)).toEqual({
      hook_send_email_enabled: true,
      hook_send_email_uri: `https://${REF}.supabase.co/functions/v1/auth-send-email`,
      hook_send_email_secrets: SECRET,
    });
  });
});

describe("completeProviders", () => {
  it("recognises complete provider sets by name", () => {
    expect(mod.completeProviders(new Set(GRAPH_SECRETS.map((s) => s.name)))).toEqual([
      "microsoft_graph",
    ]);
    expect(mod.completeProviders(new Set(["RESEND_API_KEY", "RESEND_FROM_ADDRESS"]))).toEqual([
      "resend",
    ]);
    expect(mod.completeProviders(new Set(["MS_TENANT_ID", "MS_CLIENT_ID"]))).toEqual([]);
  });
});

describe("enableAuthEmailHook", () => {
  it("sets the function secret BEFORE enabling the hook, with the same value in both", async () => {
    const api = fakeApi();
    const lines: string[] = [];
    const result = await mod.enableAuthEmailHook({
      ref: REF,
      accessToken: "sbp_token",
      fetchImpl: api.fetchImpl,
      makeSecret: () => SECRET,
      log: (l) => lines.push(l),
    });
    expect(result).toEqual({ ok: true, changed: true });

    const writes = api.calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST /v1/projects/${REF}/secrets`,
      `PATCH /v1/projects/${REF}/config/auth`,
    ]);
    expect(writes[0]?.body).toEqual([{ name: "SEND_EMAIL_HOOK_SECRET", value: SECRET }]);
    expect(writes[1]?.body).toEqual({
      hook_send_email_enabled: true,
      hook_send_email_uri: `https://${REF}.supabase.co/functions/v1/auth-send-email`,
      hook_send_email_secrets: SECRET,
    });
    expect(api.calls.every((c) => c.auth === "Bearer sbp_token")).toBe(true);
    // Never printed.
    expect(lines.join("\n")).not.toContain("TESTSECRET");
  });

  it("refuses when the function is not deployed, changing nothing", async () => {
    const api = fakeApi({ deployed: false });
    const result = await mod.enableAuthEmailHook({
      ref: REF,
      accessToken: "t",
      fetchImpl: api.fetchImpl,
      makeSecret: () => SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("supabase functions deploy auth-send-email");
    expect(api.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("refuses when no email provider is fully configured (it would break signup mail)", async () => {
    const api = fakeApi({ secrets: [{ name: "MS_TENANT_ID", value: "d" }] });
    const result = await mod.enableAuthEmailHook({
      ref: REF,
      accessToken: "t",
      fetchImpl: api.fetchImpl,
      makeSecret: () => SECRET,
    });
    expect(result.ok).toBe(false);
    expect(api.calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("does nothing when the hook is already on, unless asked to rotate", async () => {
    const api = fakeApi({
      secrets: [...GRAPH_SECRETS, { name: "SEND_EMAIL_HOOK_SECRET", value: "d" }],
      auth: {
        hook_send_email_enabled: true,
        hook_send_email_uri: `https://${REF}.supabase.co/functions/v1/auth-send-email`,
      },
    });
    const first = await mod.enableAuthEmailHook({
      ref: REF,
      accessToken: "t",
      fetchImpl: api.fetchImpl,
      makeSecret: () => SECRET,
    });
    expect(first).toEqual({ ok: true, changed: false });
    expect(api.calls.filter((c) => c.method !== "GET")).toHaveLength(0);

    const rotated = await mod.enableAuthEmailHook({
      ref: REF,
      accessToken: "t",
      fetchImpl: api.fetchImpl,
      makeSecret: () => SECRET,
      rotate: true,
    });
    expect(rotated).toEqual({ ok: true, changed: true });
  });

  it("never leaks the secret through an API error", async () => {
    const api = fakeApi({ failOn: `PATCH /v1/projects/${REF}/config/auth` });
    const result = await mod.enableAuthEmailHook({
      ref: REF,
      accessToken: "t",
      fetchImpl: api.fetchImpl,
      makeSecret: () => SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("500");
      expect(result.error).not.toContain("TESTSECRET");
      expect(result.error).toContain("[redacted]");
    }
  });

  it("fails if the read-back does not show the hook enabled", async () => {
    const api = fakeApi();
    const original = api.fetchImpl;
    // Swallow the PATCH so nothing sticks.
    const fetchImpl = async (url: string, init?: RequestInit) =>
      init?.method === "PATCH" ? Response.json({}) : original(url, init);
    const result = await mod.enableAuthEmailHook({
      ref: REF,
      accessToken: "t",
      fetchImpl,
      makeSecret: () => SECRET,
    });
    expect(result.ok).toBe(false);
  });
});

describe("disableAuthEmailHook", () => {
  it("PATCHes hook_send_email_enabled=false and confirms", async () => {
    const api = fakeApi({ auth: { hook_send_email_enabled: true } });
    const result = await mod.disableAuthEmailHook({
      ref: REF,
      accessToken: "t",
      fetchImpl: api.fetchImpl,
    });
    expect(result).toEqual({ ok: true, changed: true });
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      hook_send_email_enabled: false,
    });
  });
});
