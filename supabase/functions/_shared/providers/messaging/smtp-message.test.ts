import { describe, expect, it } from "vitest";
import {
  buildMimeMessage,
  encodeQuotedPrintable,
  encodeWords,
  formatMailbox,
  formatRfc5322Date,
  headerLine,
  isSafeAddress,
  messageIdFor,
  parseMailbox,
} from "./smtp-message.ts";

/** Test-side RFC 2045 decoder: the round trip proves the encoder, not itself. */
function decodeQuotedPrintable(text: string): string {
  const joined = text.replace(/=\r\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    if (joined[i] === "=") {
      bytes.push(Number.parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(joined.charCodeAt(i));
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

function decodeWords(header: string): string {
  const words = header.replace(/\r\n /g, " ").match(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/g) ?? [];
  return words
    .map((w) => {
      const b64 = w.slice("=?UTF-8?B?".length, -2);
      return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    })
    .join("");
}

describe("addresses", () => {
  it("accepts plain ASCII addr-specs and rejects everything that could break a command or header", () => {
    expect(isSafeAddress("alerts@example.com")).toBe(true);
    expect(isSafeAddress("first.last+tag@mail.example.co.uk")).toBe(true);
    for (const bad of [
      "no-at-sign",
      "@example.com",
      "a@b",
      "a@exa mple.com",
      "a b@example.com",
      "a@example.com\r\nRCPT TO:<x@y.com>",
      "a@example.com>",
      "ünï@example.com",
      "a@exämple.com",
      "a..b@example.com",
      ".a@example.com",
      `${"x".repeat(65)}@example.com`,
    ]) {
      expect(isSafeAddress(bad), bad).toBe(false);
    }
  });

  it("parses bare, named and quoted-name mailboxes", () => {
    expect(parseMailbox("alerts@example.com")).toEqual({
      name: null,
      address: "alerts@example.com",
    });
    expect(parseMailbox("Heyloo <alerts@example.com>")).toEqual({
      name: "Heyloo",
      address: "alerts@example.com",
    });
    expect(parseMailbox('"Acme, Inc." <alerts@example.com>')).toEqual({
      name: "Acme, Inc.",
      address: "alerts@example.com",
    });
    expect(parseMailbox("<alerts@example.com>")).toEqual({
      name: null,
      address: "alerts@example.com",
    });
    expect(parseMailbox("Heyloo <not an address>")).toBeNull();
    expect(parseMailbox("")).toBeNull();
  });

  it("strips control characters from a display name", () => {
    expect(parseMailbox("Evil\r\nBcc: x@y.com <alerts@example.com>")?.name).toBe(
      "Evil Bcc: x@y.com",
    );
  });

  it("formats names as atoms, quoted-strings or encoded words", () => {
    expect(formatMailbox({ name: "Heyloo Alerts", address: "a@example.com" })).toBe(
      "Heyloo Alerts <a@example.com>",
    );
    expect(formatMailbox({ name: 'Acme, "Inc."', address: "a@example.com" })).toBe(
      '"Acme, \\"Inc.\\"" <a@example.com>',
    );
    expect(formatMailbox({ name: null, address: "a@example.com" })).toBe("<a@example.com>");
    const spanish = formatMailbox({ name: "Peluquería Ñandú", address: "a@example.com" });
    expect(spanish).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeWords(spanish.replace(/ <a@example.com>$/, ""))).toBe("Peluquería Ñandú");
  });
});

describe("headers", () => {
  it("collapses CR/LF (header injection) into spaces", () => {
    const line = headerLine("Subject", "Hello\r\nBcc: attacker@evil.com\nX-Evil: 1");
    expect(line.split("\r\n")).toHaveLength(1);
    expect(line).toBe("Subject: Hello Bcc: attacker@evil.com X-Evil: 1");
  });

  it("folds long ASCII subjects at whitespace, every line under 78 characters", () => {
    const subject = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const line = headerLine("Subject", subject);
    const lines = line.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(78);
    expect(line.replace(/\r\n /g, " ")).toBe(`Subject: ${subject}`);
  });

  it("RFC 2047 encodes non-ASCII subjects in words of at most 75 characters", () => {
    const subject = "Nuevo mensaje: ¿Podemos confirmar la cita de mañana? 🦷 ".repeat(4).trim();
    const line = headerLine("Subject", subject);
    for (const l of line.split("\r\n")) expect(l.length).toBeLessThanOrEqual(78);
    expect(decodeWords(line.slice("Subject: ".length))).toBe(subject);
    // eslint-style guarantee: the header itself is pure ASCII.
    expect(/^[\x20-\x7e\r\n]*$/.test(line)).toBe(true);
  });

  it("never splits a multi-byte character across encoded words", () => {
    const text = "🦷".repeat(40);
    for (const word of encodeWords(text).split("\r\n ")) {
      const b64 = word.slice("=?UTF-8?B?".length, -2);
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      );
      expect(decoded).toMatch(/^(🦷)+$/u);
    }
  });

  it("handles a subject longer than the 998-octet line limit", () => {
    const line = headerLine("Subject", "x".repeat(990));
    for (const l of line.split("\r\n")) expect(l.length).toBeLessThanOrEqual(998);
  });
});

describe("Message-ID and Date", () => {
  it("is deterministic in the idempotency key (a retry carries the same id)", () => {
    const uuid = "0b5f4c1e-8a0f-4d7e-9f0e-3f6f2a1b9c11";
    expect(messageIdFor(uuid, "example.com")).toBe(`<${uuid}@example.com>`);
    expect(messageIdFor(uuid, "example.com")).toBe(messageIdFor(uuid, "example.com"));
  });

  it("sanitizes unsafe characters but keeps different keys different", () => {
    const a = messageIdFor("outreach_demo_followup:abc", "example.com");
    const b = messageIdFor("outreach_demo_followup-abc", "example.com");
    expect(a).toMatch(/^<[A-Za-z0-9._-]+@example\.com>$/);
    expect(a).not.toBe(b);
  });

  it("formats RFC 5322 dates in UTC", () => {
    expect(formatRfc5322Date(new Date("2026-09-29T08:05:09.000Z"))).toBe(
      "Tue, 29 Sep 2026 08:05:09 +0000",
    );
    expect(formatRfc5322Date(new Date("2027-01-01T00:00:00.000Z"))).toBe(
      "Fri, 01 Jan 2027 00:00:00 +0000",
    );
  });
});

describe("quoted-printable", () => {
  const SAMPLES = [
    "plain ascii",
    "equals = sign and =3D literal",
    "trailing spaces   \nand a tab\t\nend",
    "línea con acentos: mañana, ¿confirmación?",
    "emoji 🦷 and CJK 歯医者",
    `${"a".repeat(200)} long line`,
    `${"é".repeat(120)}`,
    "blank\n\n\nlines",
    ".leading dot\n..two dots",
    "",
  ];

  it.each(SAMPLES)("round-trips %j with every line within 76 characters", (sample) => {
    const encoded = encodeQuotedPrintable(sample);
    for (const line of encoded.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(/^[\x20-\x7e\r\n]*$/.test(encoded)).toBe(true);
    expect(decodeQuotedPrintable(encoded)).toBe(
      sample.replace(/\r\n|\r/g, "\n").replace(/\n/g, "\r\n"),
    );
  });

  it("encodes whitespace at the end of a line so it survives transport", () => {
    expect(encodeQuotedPrintable("end \nnext")).toBe("end=20\r\nnext");
  });
});

describe("buildMimeMessage", () => {
  const base = {
    from: { name: "Heyloo", address: "alerts@example.com" },
    to: { name: null, address: "owner@example.com" },
    subject: "New message from Ana",
    text: "Ana called.\nCall her back.",
    html: "<p>Ana called.<br>Call her back.</p>",
    messageId: "<msg1@example.com>",
    date: new Date("2026-09-29T12:00:00.000Z"),
    boundary: "heyloo_boundary_1",
  };

  it("emits multipart/alternative with text first, then HTML, all CRLF and pure ASCII", () => {
    const message = buildMimeMessage(base);
    expect(message.startsWith("Date: Tue, 29 Sep 2026 12:00:00 +0000\r\n")).toBe(true);
    expect(message).toContain("From: Heyloo <alerts@example.com>\r\n");
    expect(message).toContain("To: <owner@example.com>\r\n");
    expect(message).toContain("Subject: New message from Ana\r\n");
    expect(message).toContain("Message-ID: <msg1@example.com>\r\n");
    expect(message).toContain("MIME-Version: 1.0\r\n");
    expect(message).toContain("Auto-Submitted: auto-generated\r\n");
    expect(message).toContain('Content-Type: multipart/alternative; boundary="heyloo_boundary_1"');
    expect(message.indexOf("text/plain")).toBeLessThan(message.indexOf("text/html"));
    expect(message.endsWith("--heyloo_boundary_1--\r\n")).toBe(true);
    expect(/^[\x20-\x7e\r\n]*$/.test(message)).toBe(true);
    expect(/(?<!\r)\n/.test(message)).toBe(false);
    for (const line of message.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
  });

  it("carries Reply-To and decodes back to the original bodies", () => {
    const message = buildMimeMessage({
      ...base,
      replyTo: { name: null, address: "reply@example.com" },
      text: "Confirmación: mañana a las 10.",
    });
    expect(message).toContain("Reply-To: <reply@example.com>\r\n");
    const textPartBody = message
      .split("--heyloo_boundary_1")[1]
      ?.split("\r\n\r\n")
      .slice(1)
      .join("\r\n\r\n")
      .replace(/\r\n$/, "");
    expect(decodeQuotedPrintable(textPartBody ?? "")).toBe("Confirmación: mañana a las 10.");
  });

  it("sends a single part when only one body exists, and refuses an empty message", () => {
    const textOnly = buildMimeMessage({ ...base, html: "" });
    expect(textOnly).not.toContain("multipart");
    expect(textOnly).toContain("Content-Type: text/plain; charset=utf-8\r\n");
    expect(textOnly.endsWith("Call her back.\r\n")).toBe(true);
    const htmlOnly = buildMimeMessage({ ...base, text: "  " });
    expect(htmlOnly).toContain("Content-Type: text/html; charset=utf-8\r\n");
    expect(() => buildMimeMessage({ ...base, text: "", html: "" })).toThrow("empty_message_body");
  });

  it("cannot be used to inject headers through the subject or the display name", () => {
    const message = buildMimeMessage({
      ...base,
      from: { name: "Heyloo\r\nBcc: x@evil.com", address: "alerts@example.com" },
      subject: "Hi\r\nBcc: attacker@evil.com",
    });
    const headerBlock = message.split("\r\n\r\n")[0] ?? "";
    expect(headerBlock.split("\r\n").filter((l) => l.toLowerCase().startsWith("bcc:"))).toEqual([]);
  });
});
