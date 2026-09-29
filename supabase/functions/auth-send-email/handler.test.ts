import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { MessagingRegistry } from "../_shared/providers/messaging/registry.ts";
import type {
  EmailProvider,
  EmailSendRequest,
  SendResult,
} from "../_shared/providers/messaging/types.ts";
import { failure } from "../_shared/providers/messaging/types.ts";
import type { Logger } from "../_shared/types.ts";
import type { AuthSendEmailDeps } from "./handler.ts";
import { handleAuthSendEmail } from "./handler.ts";

const KEY_B64 = Buffer.from("test-signing-key-for-the-hook-0123456789").toString("base64");
const SECRET = `v1,whsec_${KEY_B64}`;
const NOW = new Date("2026-09-29T20:00:00Z");
const TS = String(Math.floor(NOW.getTime() / 1000));
const SITE = "https://heyloo-voice.vercel.app";
const HASH = "hash-value-123";
const FROM = "Heyloo <ms@heycuey.com>";

interface SignOptions {
  id?: string;
  timestamp?: string;
  secretB64?: string;
}

function signedRequest(rawBody: string, opts: SignOptions = {}) {
  const id = opts.id ?? "msg_abc";
  const timestamp = opts.timestamp ?? TS;
  const signature = createHmac("sha256", Buffer.from(opts.secretB64 ?? KEY_B64, "base64"))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  const headers: Record<string, string> = {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  };
  return {
    method: "POST",
    rawBody,
    header: (name: string) => headers[name.toLowerCase()] ?? null,
  };
}

function hookBody(type: string, over: { user?: object; data?: object } = {}): string {
  return JSON.stringify({
    user: { id: "user-1", email: "owner@example.com", ...over.user },
    email_data: {
      token: "",
      token_hash: HASH,
      token_new: "",
      token_hash_new: "",
      redirect_to: "",
      email_action_type: type,
      site_url: SITE,
      ...over.data,
    },
  });
}

function makeLogger() {
  const lines: Array<{ level: string; msg: string; fields: unknown }> = [];
  const log =
    (level: string) =>
    (msg: string, fields?: unknown): void => {
      lines.push({ level, msg, fields });
    };
  const logger: Logger = {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
  };
  return { logger, lines };
}

function makeProvider(
  respond: (request: EmailSendRequest, index: number) => SendResult | Promise<SendResult>,
) {
  const sent: EmailSendRequest[] = [];
  const provider: EmailProvider = {
    id: "microsoft_graph",
    capabilities: {
      sms: false,
      email: true,
      deliveryReceipts: false,
      syncWebhookReply: false,
      nativeOptOutHandling: false,
      senderKinds: [],
      senderRegistrationApi: false,
    },
    async sendEmail(request) {
      sent.push(request);
      return await respond(request, sent.length - 1);
    },
  };
  return { provider, sent };
}

const OK: SendResult = { ok: true, providerMessageId: "msgraph:1" };

function setup(
  respond: Parameters<typeof makeProvider>[0] = () => OK,
  over: Partial<AuthSendEmailDeps> = {},
  registryOver: Partial<Pick<MessagingRegistry, "resolveEmail" | "emailFromAddress">> = {},
) {
  const { provider, sent } = makeProvider(respond);
  const { logger, lines } = makeLogger();
  const deps: AuthSendEmailDeps = {
    hookSecret: SECRET,
    registry: {
      resolveEmail: () => ({ ok: true, provider }),
      emailFromAddress: FROM,
      missing: () => [],
      ...registryOver,
    },
    logger,
    now: () => NOW,
    ...over,
  };
  return { deps, sent, lines };
}

const run = (deps: AuthSendEmailDeps, request: ReturnType<typeof signedRequest>) =>
  handleAuthSendEmail(deps, request);

describe("signature verification (raw body, fail closed)", () => {
  it("accepts a valid signature: 200 with an empty JSON object, one email sent", async () => {
    const { deps, sent } = setup();
    const res = await run(deps, signedRequest(hookBody("signup")));
    expect(res).toEqual({ status: 200, body: {} });
    expect(sent).toHaveLength(1);
  });

  it("rejects a tampered body with 401 and sends nothing", async () => {
    const { deps, sent } = setup();
    const request = signedRequest(hookBody("signup"));
    const tampered = { ...request, rawBody: hookBody("signup", { user: { email: "evil@x.com" } }) };
    const res = await run(deps, tampered);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { http_code: 401, message: "Invalid webhook signature." } });
    expect(sent).toHaveLength(0);
  });

  it("rejects a signature made with another secret", async () => {
    const { deps, sent } = setup();
    const other = Buffer.from("some-other-secret-value-0000000000").toString("base64");
    const res = await run(deps, signedRequest(hookBody("signup"), { secretB64: other }));
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("rejects missing signature headers and stale timestamps", async () => {
    const { deps, sent } = setup();
    const noHeaders = { method: "POST", rawBody: hookBody("signup"), header: () => null };
    expect((await run(deps, noHeaders)).status).toBe(401);
    const stale = signedRequest(hookBody("signup"), { timestamp: String(Number(TS) - 3600) });
    expect((await run(deps, stale)).status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("fails CLOSED when SEND_EMAIL_HOOK_SECRET is missing, even for a well-formed request", async () => {
    for (const hookSecret of [undefined, "", "   "]) {
      const { deps, sent, lines } = setup(() => OK, { hookSecret });
      const res = await run(deps, signedRequest(hookBody("signup")));
      expect(res.status).toBe(500);
      expect(sent).toHaveLength(0);
      expect(lines.some((l) => l.msg === "auth_send_email_not_configured")).toBe(true);
    }
  });

  it("accepts the previous secret during rotation", async () => {
    const { deps } = setup(() => OK, { hookSecret: `v1,whsec_QUJD|${SECRET}` });
    expect((await run(deps, signedRequest(hookBody("signup")))).status).toBe(200);
  });

  it("only allows POST", async () => {
    const { deps } = setup();
    const res = await run(deps, { ...signedRequest(hookBody("signup")), method: "GET" });
    expect(res.status).toBe(405);
  });
});

describe("what gets sent", () => {
  it("passes from, recipient, subject, both bodies and a per-message idempotency key", async () => {
    const { deps, sent } = setup();
    await run(deps, signedRequest(hookBody("recovery"), { id: "msg_xyz" }));
    expect(sent[0]).toMatchObject({
      to: "owner@example.com",
      from: FROM,
      subject: "Reset your Heyloo password",
      idempotencyKey: "auth-email:msg_xyz:primary",
    });
    expect(sent[0]?.html).toContain("Choose a new password");
    expect(sent[0]?.text).toContain(
      `${SITE}/auth/confirm?token_hash=${HASH}&type=recovery&next=/reset-password/confirm`,
    );
  });

  it.each([
    ["signup", "type=email&next=/signup/resume"],
    ["recovery", "type=recovery&next=/reset-password/confirm"],
    ["invite", "type=invite&next=/dashboard"],
    ["magiclink", "type=magiclink&next=/dashboard"],
  ])("%s carries the documented verifyOtp type", async (type, expected) => {
    const { deps, sent } = setup();
    expect((await run(deps, signedRequest(hookBody(type)))).status).toBe(200);
    expect(sent[0]?.text).toContain(`token_hash=${HASH}&${expected}`);
  });

  it("reauthentication sends the code and no link", async () => {
    const { deps, sent } = setup();
    await run(deps, signedRequest(hookBody("reauthentication", { data: { token: "246810" } })));
    expect(sent[0]?.text).toContain("246810");
    expect(sent[0]?.html).not.toContain("/auth/confirm");
  });

  it("Secure Email Change sends two emails, each with its own hash, and 200s only when both succeed", async () => {
    const { deps, sent } = setup();
    const body = hookBody("email_change", {
      user: { email: "old@example.com", new_email: "new@example.com" },
      data: { token: "111111", token_hash: "H_NEW", token_new: "222222", token_hash_new: "H_CUR" },
    });
    const res = await run(deps, signedRequest(body, { id: "msg_ec" }));
    expect(res.status).toBe(200);
    expect(sent.map((s) => [s.to, s.idempotencyKey])).toEqual([
      ["old@example.com", "auth-email:msg_ec:current"],
      ["new@example.com", "auth-email:msg_ec:new"],
    ]);
    expect(sent[0]?.text).toContain("token_hash=H_CUR&");
    expect(sent[1]?.text).toContain("token_hash=H_NEW&");
  });

  it("rejects an unknown email_action_type or an unusable payload with 400, sending nothing", async () => {
    const { deps, sent } = setup();
    expect((await run(deps, signedRequest(hookBody("teleport")))).status).toBe(400);
    expect((await run(deps, signedRequest("not json"))).status).toBe(400);
    expect((await run(deps, signedRequest(JSON.stringify({ hello: "world" })))).status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe("provider failure mapping", () => {
  const perm = failure("permanent", 403, "ms_forbidden", "Microsoft refused to send as x");
  const deferred = failure("deferred", 429, "ms_throttled", "throttled", 17);
  const transient = failure("transient", 502, "ms_temporary_failure", "bad gateway");

  it("permanent -> 500 with the documented error JSON and a generic message", async () => {
    const { deps, lines } = setup(() => perm);
    const res = await run(deps, signedRequest(hookBody("signup")));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { http_code: 500, message: "The email could not be sent." },
    });
    // The owner-facing reason is logged, not shown to the end user.
    const logged = lines.find((l) => l.msg === "auth_send_email_failed");
    expect(logged?.level).toBe("error");
    expect(JSON.stringify(logged?.fields)).toContain("Microsoft refused to send as x");
    expect(JSON.stringify(res.body)).not.toContain("Microsoft");
  });

  it("deferred (throttling) -> 429 with Retry-After", async () => {
    const { deps } = setup(() => deferred);
    const res = await run(deps, signedRequest(hookBody("signup")));
    expect(res.status).toBe(429);
    expect(res.headers).toEqual({ "retry-after": "17" });
    expect(res.body).toMatchObject({ error: { http_code: 429 } });
  });

  it("transient -> 503 (Auth retries it)", async () => {
    const { deps } = setup(() => transient);
    const res = await run(deps, signedRequest(hookBody("signup")));
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: { http_code: 503 } });
  });

  it("with two emails, one failing fails the hook and the worst class wins", async () => {
    const body = hookBody("email_change", {
      user: { email: "old@example.com", new_email: "new@example.com" },
      data: { token_hash: "H_NEW", token_hash_new: "H_CUR" },
    });
    const { deps } = setup((_req, i) => (i === 0 ? transient : perm));
    expect((await run(deps, signedRequest(body))).status).toBe(500);
    const { deps: deps2 } = setup((_req, i) => (i === 0 ? OK : deferred));
    expect((await run(deps2, signedRequest(body))).status).toBe(429);
  });

  it("a provider that throws is a 503, not a crash", async () => {
    const { deps, lines } = setup(() => {
      throw new Error("boom");
    });
    const res = await run(deps, signedRequest(hookBody("signup")));
    expect(res.status).toBe(503);
    expect(lines.some((l) => l.msg === "auth_send_email_send_error")).toBe(true);
  });

  it("a provider slower than the hook budget is a 503", async () => {
    const { deps } = setup(() => new Promise<SendResult>(() => {}), { sendDeadlineMs: 20 });
    const res = await run(deps, signedRequest(hookBody("signup")));
    expect(res.status).toBe(503);
  });

  it("an unconfigured provider fails closed with 500 and names what is missing in the log", async () => {
    const { deps, sent, lines } = setup(
      () => OK,
      {},
      {
        resolveEmail: () => ({
          ok: false,
          reason: "provider_not_configured",
          providerId: "microsoft_graph",
          missing: ["MS_CLIENT_SECRET"],
        }),
      },
    );
    const res = await run(deps, signedRequest(hookBody("signup")));
    expect(res.status).toBe(500);
    expect(sent).toHaveLength(0);
    const logged = lines.find((l) => l.msg === "auth_send_email_provider_not_configured");
    expect(JSON.stringify(logged?.fields)).toContain("MS_CLIENT_SECRET");
  });

  it("a missing from address also fails closed", async () => {
    const { deps, sent } = setup(() => OK, {}, { emailFromAddress: null });
    expect((await run(deps, signedRequest(hookBody("signup")))).status).toBe(500);
    expect(sent).toHaveLength(0);
  });
});

describe("logging", () => {
  it("never logs the token hash, code or link", async () => {
    const { deps, lines } = setup(() => failure("permanent", 403, "ms_forbidden", "denied"));
    await run(
      deps,
      signedRequest(hookBody("email", { data: { token: "987654", token_hash: HASH } })),
    );
    const all = JSON.stringify(lines);
    expect(all).not.toContain(HASH);
    expect(all).not.toContain("987654");
    expect(all).not.toContain("/auth/confirm");
    vi.restoreAllMocks();
  });
});
