import { describe, expect, it, vi } from "vitest";
import { classifySmtpFailure, createSmtpEmailProvider, parseSmtpEnv, zSmtpConfig } from "./smtp.ts";
import { SmtpError } from "./smtp-client.ts";
import type { FakeSmtpOptions } from "./smtp-fake-server.ts";
import { FakeSmtpServer, inMemoryConnector } from "./smtp-fake-server.ts";
import { zSendResult } from "./types.ts";

const CONFIG = {
  host: "smtp.gmail.com",
  port: 465,
  username: "alerts@example.com",
  password: "abcdefghijklmnop",
};
const REQUEST = {
  to: "owner@example.com",
  from: "Heyloo <alerts@example.com>",
  subject: "New message from Ana",
  html: "<p>Ana called.</p>",
  text: "Ana called.",
  idempotencyKey: "0b5f4c1e-8a0f-4d7e-9f0e-3f6f2a1b9c11",
};
const FAST = { connectMs: 200, commandMs: 100, totalMs: 1_000 };

function provider(serverOptions: FakeSmtpOptions = {}) {
  const server = new FakeSmtpServer({
    credentials: { username: CONFIG.username, password: CONFIG.password },
    ...serverOptions,
  });
  const connect = vi.fn(inMemoryConnector(server));
  const smtp = createSmtpEmailProvider({
    config: CONFIG,
    connect,
    timeouts: FAST,
    now: () => new Date("2026-09-29T12:00:00.000Z"),
    boundary: () => "heyloo_test_boundary",
  });
  return { server, connect, smtp };
}

describe("parseSmtpEnv — fail closed, clear errors", () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];

  it("accepts a complete configuration and defaults the port to 465", () => {
    const parsed = parseSmtpEnv(
      env({ SMTP_HOST: "smtp.gmail.com", SMTP_USERNAME: "a@b.co", SMTP_PASSWORD: "pw" }),
    );
    expect(parsed).toEqual({
      ok: true,
      config: { host: "smtp.gmail.com", port: 465, username: "a@b.co", password: "pw" },
    });
  });

  it("names every unset variable", () => {
    expect(parseSmtpEnv(env({}))).toEqual({
      ok: false,
      missing: ["SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD"],
    });
    expect(parseSmtpEnv(env({ SMTP_HOST: "  ", SMTP_USERNAME: "u", SMTP_PASSWORD: "p" }))).toEqual({
      ok: false,
      missing: ["SMTP_HOST"],
    });
  });

  it.each([25, 587])(
    "rejects port %i, which Supabase Edge Functions block, with a clear reason",
    (port) => {
      const parsed = parseSmtpEnv(
        env({
          SMTP_HOST: "h.example.com",
          SMTP_PORT: String(port),
          SMTP_USERNAME: "u",
          SMTP_PASSWORD: "p",
        }),
      );
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.missing).toHaveLength(1);
      expect(parsed.missing[0]).toMatch(/^SMTP_PORT \(.*ports 25 and 587 are blocked.*465/);
    },
  );

  it("rejects a non-numeric or out-of-range port and a host that is not a bare host name", () => {
    const base = { SMTP_HOST: "h.example.com", SMTP_USERNAME: "u", SMTP_PASSWORD: "p" };
    for (const port of ["abc", "46.5", "0", "70000"]) {
      const parsed = parseSmtpEnv(env({ ...base, SMTP_PORT: port }));
      expect(parsed.ok, port).toBe(false);
    }
    for (const host of ["smtps://smtp.gmail.com", "smtp.gmail.com:465", "smtp gmail.com", "/x"]) {
      const parsed = parseSmtpEnv(env({ ...base, SMTP_HOST: host }));
      expect(parsed.ok, host).toBe(false);
    }
  });

  it("never puts the password in a validation message", () => {
    const parsed = parseSmtpEnv(
      env({
        SMTP_HOST: "h.example.com",
        SMTP_PORT: "587",
        SMTP_USERNAME: "u",
        SMTP_PASSWORD: "hunter2-secret",
      }),
    );
    expect(JSON.stringify(parsed)).not.toContain("hunter2-secret");
    expect(zSmtpConfig.safeParse({ ...CONFIG, port: 587 }).success).toBe(false);
  });
});

describe("classifySmtpFailure", () => {
  const err = (
    kind: SmtpError["kind"],
    code: number | null = null,
    enhanced: string | null = null,
  ) =>
    new SmtpError({
      kind,
      stage: "rcpt_to",
      message: `smtp_rcpt_to: ${code ?? "x"}`,
      code,
      enhanced,
    });

  it("maps every SMTP failure kind onto the canonical classes", () => {
    const table: Array<[SmtpError, string, string | null]> = [
      [err("auth", 535, "5.7.8"), "permanent", "smtp_auth_failed"],
      [err("permanent", 550, "5.1.1"), "permanent", "smtp_550"],
      [err("config"), "permanent", "smtp_config_error"],
      [err("quota", 550, "5.4.5"), "deferred", "smtp_550"],
      [err("transient", 451), "transient", "smtp_451"],
      [err("timeout"), "transient", "smtp_timeout"],
      [err("network"), "transient", "smtp_network_error"],
      [err("protocol"), "transient", "smtp_protocol_error"],
    ];
    for (const [error, failure, code] of table) {
      const result = classifySmtpFailure(error);
      expect(result, error.kind).toMatchObject({ ok: false, failure, errorCode: code });
      expect(zSendResult.safeParse(result).success).toBe(true);
    }
    expect(classifySmtpFailure(err("quota", 550))).toMatchObject({ retryAfterSeconds: 3600 });
  });

  it("treats an unexpected non-SMTP error as transient (never drops a message)", () => {
    expect(classifySmtpFailure(new TypeError("boom"))).toMatchObject({
      ok: false,
      failure: "transient",
      errorCode: "smtp_unexpected_error",
    });
  });
});

describe("SMTP EmailProvider", () => {
  it("delivers a multipart message and returns the Message-ID derived from the idempotency key", async () => {
    const { server, smtp } = provider();
    const result = await smtp.sendEmail(REQUEST);
    expect(result).toEqual({
      ok: true,
      providerMessageId: `<${REQUEST.idempotencyKey}@example.com>`,
    });
    expect(zSendResult.safeParse(result).success).toBe(true);
    expect(server.commands).toContain("EHLO example.com");
    expect(server.commands).toContain("MAIL FROM:<alerts@example.com>");
    expect(server.commands).toContain("RCPT TO:<owner@example.com>");

    const data = server.data ?? "";
    expect(data).toContain("From: Heyloo <alerts@example.com>\r\n");
    expect(data).toContain("To: <owner@example.com>\r\n");
    expect(data).toContain("Subject: New message from Ana\r\n");
    expect(data).toContain(`Message-ID: <${REQUEST.idempotencyKey}@example.com>\r\n`);
    expect(data).toContain("Date: Tue, 29 Sep 2026 12:00:00 +0000\r\n");
    expect(data).toContain('boundary="heyloo_test_boundary"');
    expect(data).toContain("Content-Type: text/plain; charset=utf-8");
    expect(data).toContain("Content-Type: text/html; charset=utf-8");
    expect(data).toContain("Ana called.");
  });

  it("uses the same Message-ID on a retry, so the receiving mailbox can drop a duplicate", async () => {
    const first = await provider().smtp.sendEmail(REQUEST);
    const second = await provider().smtp.sendEmail(REQUEST);
    expect(first).toEqual(second);
    const other = await provider().smtp.sendEmail({ ...REQUEST, idempotencyKey: "another" });
    expect(other).not.toEqual(first);
  });

  it("carries Reply-To and non-ASCII text (Spanish alerts) intact", async () => {
    const { server, smtp } = provider();
    const result = await smtp.sendEmail({
      ...REQUEST,
      replyTo: "front-desk@example.com",
      subject: "Nuevo mensaje de Peña: ¿confirmamos mañana?",
      text: "Ana llamó: quiere confirmar la cita de mañana.",
    });
    expect(result.ok).toBe(true);
    const data = server.data ?? "";
    expect(data).toContain("Reply-To: <front-desk@example.com>\r\n");
    expect(data).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(/^[\x20-\x7e\r\n]*$/.test(data)).toBe(true);
    expect(data).toContain("Ana llam=C3=B3: quiere confirmar la cita de ma=C3=B1ana.");
  });

  it("cannot be used to inject headers or SMTP commands through subject, body or addresses", async () => {
    const { server, smtp } = provider();
    const result = await smtp.sendEmail({
      ...REQUEST,
      subject: "Hi\r\nBcc: attacker@evil.com",
      text: "hello\r\n.\r\nRCPT TO:<attacker@evil.com>\r\nQUIT",
    });
    expect(result.ok).toBe(true);
    expect(server.commands.filter((c) => c.startsWith("RCPT TO"))).toEqual([
      "RCPT TO:<owner@example.com>",
    ]);
    const headerBlock = (server.data ?? "").split("\r\n\r\n")[0] ?? "";
    expect(headerBlock.toLowerCase()).not.toMatch(/\r\nbcc:/);
  });

  it("refuses without connecting when the request or the from address is unusable (permanent)", async () => {
    const { connect, smtp } = provider();
    for (const bad of [
      { ...REQUEST, from: "not an address" },
      { ...REQUEST, from: "Heyloo <alerts@exämple.com>" },
      { ...REQUEST, to: "not-an-email" },
      { ...REQUEST, text: "", html: "" },
    ]) {
      const result = await smtp.sendEmail(bad);
      expect(result, JSON.stringify(bad.from + bad.to)).toMatchObject({
        ok: false,
        failure: "permanent",
      });
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it("wrong credentials: permanent smtp_auth_failed, and the row fails fast instead of retrying", async () => {
    const { smtp } = provider({ credentials: { username: CONFIG.username, password: "other" } });
    const result = await smtp.sendEmail(REQUEST);
    expect(result).toMatchObject({
      ok: false,
      failure: "permanent",
      httpStatus: 535,
      errorCode: "smtp_auth_failed",
    });
    expect(JSON.stringify(result)).not.toContain(CONFIG.password);
  });

  it("4xx is transient, 5xx recipient rejection is permanent, quota is deferred", async () => {
    expect(
      await provider({ replies: { rcpt: "451 4.3.0 try later" } }).smtp.sendEmail(REQUEST),
    ).toMatchObject({
      failure: "transient",
      httpStatus: 451,
    });
    expect(
      await provider({ replies: { rcpt: "550 5.1.1 no such user" } }).smtp.sendEmail(REQUEST),
    ).toMatchObject({
      failure: "permanent",
      errorCode: "smtp_550",
    });
    expect(
      await provider({
        replies: { dataEnd: "550 5.4.5 Daily user sending limit exceeded" },
      }).smtp.sendEmail(REQUEST),
    ).toMatchObject({ failure: "deferred", retryAfterSeconds: 3600 });
  });

  it("a hung server and a dropped connection are transient, never thrown", async () => {
    expect(await provider({ hangAt: "greeting" }).smtp.sendEmail(REQUEST)).toMatchObject({
      failure: "transient",
      errorCode: "smtp_timeout",
    });
    expect(await provider({ closeAt: "data" }).smtp.sendEmail(REQUEST)).toMatchObject({
      failure: "transient",
      errorCode: "smtp_network_error",
    });
  });

  it("without a TLS socket API (no Deno.connectTls) it fails permanently and honestly", async () => {
    const smtp = createSmtpEmailProvider({ config: CONFIG, timeouts: FAST });
    const result = await smtp.sendEmail(REQUEST);
    expect(result).toMatchObject({
      ok: false,
      failure: "permanent",
      errorCode: "smtp_config_error",
    });
  });

  it("declares email-only capabilities", () => {
    expect(provider().smtp.id).toBe("smtp");
    expect(provider().smtp.capabilities).toMatchObject({ email: true, sms: false });
  });
});
