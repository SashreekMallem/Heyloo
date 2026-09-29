import { beforeEach, describe, expect, it } from "vitest";
import type { GraphTokenCache, MsGraphConfig } from "./microsoft-graph.ts";
import {
  classifyGraphSendFailure,
  clearGraphTokenCache,
  createMicrosoftGraphEmailProvider,
  MS_GRAPH_SCOPE,
  parseMsGraphEnv,
  parseRetryAfter,
  TOKEN_EXPIRY_SKEW_MS,
} from "./microsoft-graph.ts";
import type { EmailSendRequest, SendResult } from "./types.ts";

const SECRET = "Zx9~secret-value-that-must-never-leak_1234567890";
const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const CONFIG: MsGraphConfig = {
  tenantId: TENANT,
  clientId: CLIENT,
  clientSecret: SECRET,
  mailbox: "ms@heycuey.com",
  displayName: null,
};

const REQUEST: EmailSendRequest = {
  to: "owner@example.com",
  from: "Heyloo <ms@heycuey.com>",
  subject: "Hello",
  html: "<p>Hi there</p>",
  text: "Hi there",
  idempotencyKey: "k-1",
};

interface Call {
  url: string;
  init: RequestInit;
}

type Responder = (call: Call, index: number) => Response | Promise<Response>;

function scriptedFetch(responder: Responder) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const call = { url, init };
    calls.push(call);
    return await responder(call, calls.length - 1);
  };
  return { calls, fetchImpl };
}

const tokenBody = (token = "tok-1", expiresIn = 3599) => ({
  token_type: "Bearer",
  expires_in: expiresIn,
  access_token: token,
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const accepted = () => new Response(null, { status: 202, headers: { "request-id": "req-abc" } });
const isToken = (c: Call) => c.url.includes("/oauth2/v2.0/token");
const authOf = (c: Call | undefined) => new Headers(c?.init.headers).get("authorization");

let cache: GraphTokenCache;
beforeEach(() => {
  cache = { tokens: new Map(), pending: new Map() };
});

function provider(
  responder: Responder,
  extra: Partial<Parameters<typeof createMicrosoftGraphEmailProvider>[0]> = {},
) {
  const scripted = scriptedFetch(responder);
  return {
    calls: scripted.calls,
    provider: createMicrosoftGraphEmailProvider({
      fetchImpl: scripted.fetchImpl,
      config: CONFIG,
      cache,
      requestId: () => "client-req-1",
      ...extra,
    }),
  };
}

function assertFailure(result: SendResult): Extract<SendResult, { ok: false }> {
  if (result.ok) throw new Error("expected a failure");
  return result;
}

describe("parseMsGraphEnv", () => {
  const good: Record<string, string> = {
    MS_TENANT_ID: TENANT,
    MS_CLIENT_ID: CLIENT,
    MS_CLIENT_SECRET: SECRET,
    EMAIL_FROM_ADDRESS: "Heyloo <ms@heycuey.com>",
  };
  const envOf = (values: Record<string, string>) => (name: string) => values[name];

  it("accepts a full configuration and keeps the display name", () => {
    expect(parseMsGraphEnv(envOf(good))).toEqual({
      ok: true,
      config: {
        tenantId: TENANT,
        clientId: CLIENT,
        clientSecret: SECRET,
        mailbox: "ms@heycuey.com",
        displayName: "Heyloo",
      },
    });
  });

  it("accepts a verified domain as the tenant and RESEND_FROM_ADDRESS as the mailbox fallback", () => {
    const { EMAIL_FROM_ADDRESS: _unused, ...rest } = good;
    const parsed = parseMsGraphEnv(
      envOf({
        ...rest,
        MS_TENANT_ID: "heycuey.onmicrosoft.com",
        RESEND_FROM_ADDRESS: "ms@heycuey.com",
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("reports every unset variable by name (never a value)", () => {
    expect(parseMsGraphEnv(envOf({}))).toEqual({
      ok: false,
      missing: ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "EMAIL_FROM_ADDRESS"],
    });
  });

  it("rejects a mailbox that is not an address", () => {
    const parsed = parseMsGraphEnv(envOf({ ...good, EMAIL_FROM_ADDRESS: "not an address" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.missing.join(" ")).toContain("EMAIL_FROM_ADDRESS");
  });

  it("rejects malformed ids without echoing the secret", () => {
    const parsed = parseMsGraphEnv(
      envOf({ ...good, MS_TENANT_ID: "../../evil", MS_CLIENT_ID: "not-a-guid" }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.missing.some((m) => m.startsWith("MS_TENANT_ID ("))).toBe(true);
      expect(parsed.missing.some((m) => m.startsWith("MS_CLIENT_ID ("))).toBe(true);
      expect(JSON.stringify(parsed)).not.toContain(SECRET);
    }
  });
});

describe("parseRetryAfter", () => {
  it("reads delay-seconds, HTTP-dates, and clamps", () => {
    expect(parseRetryAfter("10", 0)).toBe(10);
    expect(parseRetryAfter("0", 0)).toBe(1);
    expect(parseRetryAfter("999999", 0)).toBe(3600);
    expect(parseRetryAfter(new Date(30_000).toUTCString(), 0)).toBe(30);
    expect(parseRetryAfter("soon", 0)).toBeUndefined();
    expect(parseRetryAfter(null, 0)).toBeUndefined();
  });
});

describe("Microsoft Graph adapter: request shapes", () => {
  it("gets a client-credentials token, then POSTs sendMail as the mailbox", async () => {
    const { provider: p, calls } = provider((call) =>
      isToken(call) ? json(tokenBody()) : accepted(),
    );
    expect(await p.sendEmail(REQUEST)).toEqual({ ok: true, providerMessageId: "msgraph:req-abc" });

    const [tokenCall, sendCall] = calls as [Call, Call];
    expect(tokenCall.url).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    expect(tokenCall.init.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(String(tokenCall.init.body)))).toEqual({
      client_id: CLIENT,
      scope: MS_GRAPH_SCOPE,
      client_secret: SECRET,
      grant_type: "client_credentials",
    });
    expect(JSON.stringify(tokenCall.init.headers)).not.toContain(SECRET);

    expect(sendCall.url).toBe("https://graph.microsoft.com/v1.0/users/ms%40heycuey.com/sendMail");
    const headers = sendCall.init.headers as Record<string, string>;
    expect(authOf(sendCall)).toBe("Bearer tok-1");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["client-request-id"]).toBe("client-req-1");
    expect(JSON.parse(String(sendCall.init.body))).toEqual({
      message: {
        subject: "Hello",
        body: { contentType: "HTML", content: "<p>Hi there</p>" },
        toRecipients: [{ emailAddress: { address: "owner@example.com" } }],
        from: { emailAddress: { address: "ms@heycuey.com", name: "Heyloo" } },
      },
      saveToSentItems: false,
    });
  });

  it("uses the configured display name and passes reply-to through", async () => {
    const { provider: p, calls } = provider(
      (call) => (isToken(call) ? json(tokenBody()) : accepted()),
      { config: { ...CONFIG, displayName: "Heyloo Alerts" } },
    );
    await p.sendEmail({ ...REQUEST, from: "ms@heycuey.com", replyTo: "help@example.com" });
    const message = JSON.parse(String(calls[1]?.init.body)).message;
    expect(message.from).toEqual({
      emailAddress: { address: "ms@heycuey.com", name: "Heyloo Alerts" },
    });
    expect(message.replyTo).toEqual([{ emailAddress: { address: "help@example.com" } }]);
  });

  it("falls back to a Text body when there is no HTML", async () => {
    const { provider: p, calls } = provider((call) =>
      isToken(call) ? json(tokenBody()) : accepted(),
    );
    await p.sendEmail({ ...REQUEST, html: "  ", text: "plain words" });
    expect(JSON.parse(String(calls[1]?.init.body)).message.body).toEqual({
      contentType: "Text",
      content: "plain words",
    });
  });

  it("refuses to send as any mailbox other than the configured one", async () => {
    const { provider: p, calls } = provider(() => accepted());
    const result = assertFailure(await p.sendEmail({ ...REQUEST, from: "ceo@heycuey.com" }));
    expect(result).toMatchObject({ failure: "permanent", errorCode: "from_not_sending_mailbox" });
    expect(calls).toHaveLength(0);
  });

  it("rejects an invalid request before any network call", async () => {
    const { provider: p, calls } = provider(() => accepted());
    const result = assertFailure(await p.sendEmail({ ...REQUEST, to: "nope" }));
    expect(result).toMatchObject({ failure: "permanent", errorCode: "invalid_request" });
    expect(calls).toHaveLength(0);
  });
});

describe("Microsoft Graph adapter: token caching", () => {
  it("reuses the token across sends, and refreshes 5 minutes before expiry", async () => {
    let now = 1_000_000;
    let issued = 0;
    const { provider: p, calls } = provider(
      (call) => (isToken(call) ? json(tokenBody(`tok-${++issued}`, 3600)) : accepted()),
      { now: () => now },
    );
    await p.sendEmail(REQUEST);
    await p.sendEmail(REQUEST);
    expect(calls.filter(isToken)).toHaveLength(1);

    // Still inside the usable window (expiry minus the 5 minute skew).
    now += 3600 * 1000 - TOKEN_EXPIRY_SKEW_MS - 1000;
    await p.sendEmail(REQUEST);
    expect(calls.filter(isToken)).toHaveLength(1);

    // Past it: a new token, and the send uses it.
    now += 2000;
    await p.sendEmail(REQUEST);
    expect(calls.filter(isToken)).toHaveLength(2);
    expect(authOf(calls.at(-1))).toBe("Bearer tok-2");
  });

  it("does not cache a token that lives less than the skew", async () => {
    const { provider: p, calls } = provider((call) =>
      isToken(call) ? json(tokenBody("short", 120)) : accepted(),
    );
    await p.sendEmail(REQUEST);
    await p.sendEmail(REQUEST);
    expect(calls.filter(isToken)).toHaveLength(2);
  });

  it("shares one token request between concurrent sends", async () => {
    const { provider: p, calls } = provider(async (call) => {
      if (isToken(call)) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(tokenBody());
      }
      return accepted();
    });
    await Promise.all([p.sendEmail(REQUEST), p.sendEmail(REQUEST), p.sendEmail(REQUEST)]);
    expect(calls.filter(isToken)).toHaveLength(1);
  });

  it("clearGraphTokenCache empties a cache", () => {
    cache.tokens.set("k", { accessToken: "t", usableUntil: 1 });
    clearGraphTokenCache(cache);
    expect(cache.tokens.size).toBe(0);
  });
});

describe("Microsoft Graph adapter: 401 handling", () => {
  it("refreshes the token once on 401 and then succeeds", async () => {
    let issued = 0;
    let sends = 0;
    const { provider: p, calls } = provider((call) => {
      if (isToken(call)) return json(tokenBody(`tok-${++issued}`));
      sends += 1;
      return sends === 1
        ? json({ error: { code: "InvalidAuthenticationToken" } }, 401)
        : accepted();
    });
    expect((await p.sendEmail(REQUEST)).ok).toBe(true);
    expect(calls.filter(isToken)).toHaveLength(2);
    const sendCalls = calls.filter((c) => !isToken(c));
    expect(authOf(sendCalls[0])).toBe("Bearer tok-1");
    expect(authOf(sendCalls[1])).toBe("Bearer tok-2");
  });

  it("gives up after one refresh: permanent, exactly two sends", async () => {
    const { provider: p, calls } = provider((call) =>
      isToken(call)
        ? json(tokenBody())
        : json({ error: { code: "InvalidAuthenticationToken" } }, 401),
    );
    const result = assertFailure(await p.sendEmail(REQUEST));
    expect(result).toMatchObject({
      failure: "permanent",
      httpStatus: 401,
      errorCode: "ms_unauthorized",
    });
    expect(calls.filter((c) => !isToken(c))).toHaveLength(2);
    expect(calls.filter(isToken)).toHaveLength(2);
  });
});

describe("Microsoft Graph adapter: send failure mapping", () => {
  const sendWith = async (response: Response) => {
    const { provider: p } = provider((call) => (isToken(call) ? json(tokenBody()) : response));
    return assertFailure(await p.sendEmail(REQUEST));
  };

  it("403 is permanent with an owner-facing reason naming Mail.Send and the RBAC scope", async () => {
    const result = await sendWith(
      json({ error: { code: "ErrorAccessDenied", message: "Access is denied." } }, 403),
    );
    expect(result).toMatchObject({
      failure: "permanent",
      httpStatus: 403,
      errorCode: "ms_forbidden",
    });
    expect(result.detail).toContain("Mail.Send");
    expect(result.detail).toContain("ms@heycuey.com");
    expect(result.detail).toContain("RBAC");
    expect(result.detail).toContain("ErrorAccessDenied");
  });

  it("404 is permanent (mailbox not found)", async () => {
    const result = await sendWith(json({ error: { code: "ErrorInvalidUser" } }, 404));
    expect(result).toMatchObject({ failure: "permanent", errorCode: "ms_mailbox_not_found" });
  });

  it("429 is deferred for Retry-After seconds", async () => {
    const result = await sendWith(
      json({ error: { code: "TooManyRequests" } }, 429, { "retry-after": "17" }),
    );
    expect(result).toMatchObject({
      failure: "deferred",
      httpStatus: 429,
      errorCode: "ms_throttled",
      retryAfterSeconds: 17,
    });
  });

  it("503 is deferred, defaulting to 60 s without Retry-After", async () => {
    const result = await sendWith(json({ error: { code: "ServiceUnavailable" } }, 503));
    expect(result).toMatchObject({ failure: "deferred", httpStatus: 503, retryAfterSeconds: 60 });
  });

  it("other 5xx are transient", async () => {
    for (const status of [500, 502, 504]) {
      const result = await sendWith(json({ error: { code: "x" } }, status));
      expect(result).toMatchObject({ failure: "transient", httpStatus: status });
    }
  });

  it("400 and unknown 4xx are permanent", async () => {
    for (const status of [400, 413, 422]) {
      const result = await sendWith(json({ error: { code: "ErrorInvalidRecipients" } }, status));
      expect(result).toMatchObject({ failure: "permanent", httpStatus: status });
    }
  });

  it("tolerates a non-JSON error body", async () => {
    const result = await sendWith(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(result).toMatchObject({ failure: "transient", httpStatus: 502 });
  });

  it("classifyGraphSendFailure maps the same statuses standalone", () => {
    expect(classifyGraphSendFailure(429, null, "5", 0, "ms@heycuey.com")).toMatchObject({
      failure: "deferred",
      retryAfterSeconds: 5,
    });
  });
});

describe("Microsoft Graph adapter: token failure mapping", () => {
  const sendWithTokenResponse = async (response: Response) => {
    const { provider: p, calls } = provider((call) => (isToken(call) ? response : accepted()));
    const result = assertFailure(await p.sendEmail(REQUEST));
    expect(calls.filter((c) => !isToken(c))).toHaveLength(0);
    return result;
  };

  it("invalid_client is permanent, tells the owner what to fix, and never echoes the secret", async () => {
    const result = await sendWithTokenResponse(
      json(
        {
          error: "invalid_client",
          error_description: `AADSTS7000215: Invalid client secret provided (${SECRET}).\r\nTrace ID: 1`,
          error_codes: [7000215],
        },
        401,
      ),
    );
    expect(result).toMatchObject({ failure: "permanent", errorCode: "ms_invalid_client" });
    expect(result.detail).toContain("MS_CLIENT_SECRET");
    expect(result.detail).toContain("AADSTS7000215");
    expect(result.detail).not.toContain(SECRET);
    expect(result.detail).not.toContain("Trace ID");
  });

  it("an expired secret is called out", async () => {
    const result = await sendWithTokenResponse(
      json({ error: "invalid_client", error_codes: [7000222] }, 401),
    );
    expect(result).toMatchObject({ failure: "permanent", errorCode: "ms_secret_expired" });
  });

  it("an unknown tenant is permanent", async () => {
    const result = await sendWithTokenResponse(
      json({ error: "invalid_request", error_codes: [90002] }, 400),
    );
    expect(result).toMatchObject({ failure: "permanent", errorCode: "ms_tenant_not_found" });
  });

  it("token endpoint 429 is deferred; 5xx is transient; garbage 200 is transient", async () => {
    expect(await sendWithTokenResponse(json({}, 429, { "retry-after": "9" }))).toMatchObject({
      failure: "deferred",
      retryAfterSeconds: 9,
    });
    expect(await sendWithTokenResponse(json({}, 500))).toMatchObject({ failure: "transient" });
    expect(await sendWithTokenResponse(json({ hello: "world" }, 200))).toMatchObject({
      failure: "transient",
      errorCode: "ms_token_malformed",
    });
  });
});

describe("Microsoft Graph adapter: network behaviour", () => {
  const hangUntilAborted = (call: Call) =>
    new Promise<Response>((_resolve, reject) => {
      (call.init.signal as AbortSignal).addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });

  it("a send that outlives the timeout aborts and is transient", async () => {
    const { provider: p } = provider(
      (call) => (isToken(call) ? json(tokenBody()) : hangUntilAborted(call)),
      { timeouts: { tokenMs: 50, sendMs: 20 } },
    );
    expect(assertFailure(await p.sendEmail(REQUEST))).toMatchObject({
      failure: "transient",
      errorCode: "ms_timeout",
    });
  });

  it("a token request that times out is transient", async () => {
    const { provider: p } = provider((call) => hangUntilAborted(call), {
      timeouts: { tokenMs: 20, sendMs: 20 },
    });
    expect(assertFailure(await p.sendEmail(REQUEST))).toMatchObject({
      failure: "transient",
      errorCode: "ms_token_timeout",
    });
  });

  it("a network error is transient and cannot leak the secret or token", async () => {
    const { provider: p } = provider((call) => {
      if (isToken(call)) return json(tokenBody("tok-secret-token-value"));
      throw new Error(`socket hang up while sending Bearer tok-secret-token-value with ${SECRET}`);
    });
    const result = assertFailure(await p.sendEmail(REQUEST));
    expect(result).toMatchObject({ failure: "transient", errorCode: "ms_network_error" });
    expect(result.detail).not.toContain(SECRET);
    expect(result.detail).not.toContain("tok-secret-token-value");
  });
});
