import { withTimeout } from "../../timeout.ts";
import { base64OfUtf8 } from "./smtp-message.ts";

/**
 * Minimal SMTP submission client over implicit TLS (RFC 8314 "submissions",
 * port 465): EHLO, AUTH PLAIN / LOGIN, MAIL FROM, RCPT TO, DATA (CRLF
 * normalization + dot-stuffing), QUIT, with a timeout on every step.
 *
 * Why hand-rolled: Supabase Edge Functions block outgoing ports 25 and 587
 * (supabase.com/docs/guides/functions/limits), so STARTTLS submission is
 * impossible and only implicit TLS works. The alternatives are
 * `npm:nodemailer` (Supabase's own example; large, and its SMTP logic cannot
 * run under this package's Node/Vitest harness with a controllable server)
 * and the unversioned `deno.land/x/denomailer`. This client is ~300 lines,
 * has no dependency, and takes its socket as an injected `SmtpConnector`, so
 * every branch below is unit-tested against a fake server (the repo's
 * portable-core convention, supabase/functions/BUILD_NOTES.md). The only
 * runtime-specific line is `connectDenoTls`, a thin wrapper over
 * `Deno.connectTls`, which is what denomailer/nodemailer use under the hood
 * on the edge runtime (docs/VERIFY.md MSG-3).
 *
 * Server certificates are always verified (`Deno.connectTls` default); this
 * client never offers a way to turn that off.
 *
 * Rule 1: RFC 5321 (SMTP), RFC 4954 (AUTH), RFC 8314 (implicit TLS).
 */

/** A connected, already-encrypted byte stream. */
export interface SmtpConnection {
  /** Next chunk from the server; `null` on EOF. */
  read(): Promise<Uint8Array | null>;
  /** Writes ALL of `data` (implementations loop over partial writes). */
  write(data: Uint8Array): Promise<void>;
  close(): void;
}

export type SmtpConnector = (target: { hostname: string; port: number }) => Promise<SmtpConnection>;

/** The slice of `Deno.TlsConn` / `Deno.connectTls` this file relies on. */
interface DenoTlsConn {
  read(buffer: Uint8Array): Promise<number | null>;
  write(data: Uint8Array): Promise<number>;
  close(): void;
}
interface DenoTlsApi {
  connectTls(options: { hostname: string; port: number }): Promise<DenoTlsConn>;
}

/** Default connector: `Deno.connectTls` (implicit TLS, certificate verified).
 * Looked up on `globalThis` at call time so importing this file never
 * touches a runtime global (Vitest/Node imports it too). */
export const connectDenoTls: SmtpConnector = async ({ hostname, port }) => {
  const deno = (globalThis as { Deno?: Partial<DenoTlsApi> }).Deno;
  if (!deno || typeof deno.connectTls !== "function") {
    throw new SmtpError({
      kind: "config",
      stage: "connect",
      message: "smtp_no_tls_socket_api: this runtime has no Deno.connectTls",
    });
  }
  const conn = await deno.connectTls({ hostname, port });
  const buffer = new Uint8Array(16 * 1024);
  return {
    async read() {
      const n = await conn.read(buffer);
      return n === null ? null : buffer.slice(0, n);
    },
    async write(data) {
      let offset = 0;
      while (offset < data.length) offset += await conn.write(data.subarray(offset));
    },
    close() {
      try {
        conn.close();
      } catch {
        // already closed
      }
    },
  };
};

export type SmtpErrorKind =
  /** Credentials rejected (5xx during AUTH). Permanent: retrying repeats it. */
  | "auth"
  /** 4xx: the server asked us to try again later. */
  | "transient"
  /** 5xx outside AUTH: a rejected sender, recipient or message. */
  | "permanent"
  /** Sending quota exhausted: the mailbox is fine, the window is not. */
  | "quota"
  /** Nothing usable came back in time. */
  | "timeout"
  /** Connect/TLS/socket failure or EOF mid-conversation. */
  | "network"
  /** The server said something that is not SMTP. */
  | "protocol"
  /** Our own configuration cannot work (no AUTH mechanism, bad address...). */
  | "config";

export class SmtpError extends Error {
  readonly kind: SmtpErrorKind;
  /** The SMTP step: connect, greeting, ehlo, auth, mail_from, rcpt_to, data, data_end. */
  readonly stage: string;
  /** SMTP reply code (e.g. 535), or `null` when there was no reply. */
  readonly code: number | null;
  /** RFC 3463 enhanced status (e.g. `5.7.8`), when the server sent one. */
  readonly enhanced: string | null;

  constructor(input: {
    kind: SmtpErrorKind;
    stage: string;
    message: string;
    code?: number | null;
    enhanced?: string | null;
  }) {
    super(input.message);
    this.name = "SmtpError";
    this.kind = input.kind;
    this.stage = input.stage;
    this.code = input.code ?? null;
    this.enhanced = input.enhanced ?? null;
  }
}

export interface SmtpTimeouts {
  /** TCP + TLS handshake. */
  connectMs: number;
  /** Each server reply. */
  commandMs: number;
  /** The whole conversation, connect to QUIT. */
  totalMs: number;
}

export const DEFAULT_SMTP_TIMEOUTS: SmtpTimeouts = {
  connectMs: 10_000,
  commandMs: 15_000,
  totalMs: 30_000,
};

export interface SmtpServerTarget {
  hostname: string;
  port: number;
  username: string;
  password: string;
  /** Name announced in EHLO. */
  clientName: string;
}

export interface SmtpEnvelope {
  /** Bare addr-spec, already validated by the caller. */
  from: string;
  to: string;
}

interface SmtpReply {
  code: number;
  /** Enhanced status code from the first line, if present. */
  enhanced: string | null;
  /** Reply lines without the code prefix. */
  lines: string[];
}

/** How long to wait for the 221 after QUIT; the message is already accepted. */
const QUIT_WAIT_MS = 2_000;
const MAX_REPLY_BYTES = 64 * 1024;
const MAX_REPLY_LINES = 200;
const QUOTA_TEXT = /daily (?:user )?sending (?:limit|quota)|sending (?:limit|quota) exceeded/i;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/** Dot-stuffing (RFC 5321 4.5.2) on CRLF-normalized data, plus the
 * `<CRLF>.<CRLF>` terminator. Lone CR or LF characters become CRLF first, so a
 * message can never smuggle a bare terminator or a raw command. */
export function prepareData(message: string): string {
  const normalized = message.replace(/\r\n|\r|\n/g, "\r\n");
  const stuffed = normalized.replace(/(^|\r\n)\./g, "$1..");
  return `${stuffed}${stuffed.endsWith("\r\n") ? "" : "\r\n"}.\r\n`;
}

function enhancedOf(text: string): string | null {
  const m = /^([245]\.\d{1,3}\.\d{1,3})(?:\s|$)/.exec(text);
  return m ? (m[1] as string) : null;
}

/** Classifies a non-success reply. `stage` decides whether a 5xx means
 * "bad credentials" (auth) or "rejected message" (permanent). */
function replyError(stage: string, reply: SmtpReply): SmtpError {
  const text = reply.lines.join(" ");
  const message = `smtp_${stage}: ${reply.code} ${text}`.slice(0, 500);
  const base = { stage, message, code: reply.code, enhanced: reply.enhanced };
  if (reply.code >= 500 && QUOTA_TEXT.test(text)) return new SmtpError({ ...base, kind: "quota" });
  if (reply.enhanced === "5.4.5") return new SmtpError({ ...base, kind: "quota" });
  if (reply.code >= 400 && reply.code < 500) return new SmtpError({ ...base, kind: "transient" });
  if (stage === "auth") return new SmtpError({ ...base, kind: "auth" });
  // 530 "Authentication required" / 538 arriving after AUTH succeeded, or at
  // MAIL FROM when the server wants credentials we never sent: still a
  // credentials-shaped problem, and equally permanent.
  if (reply.code === 530 || reply.code === 535 || reply.code === 534 || reply.code === 538) {
    return new SmtpError({ ...base, kind: "auth" });
  }
  return new SmtpError({ ...base, kind: "permanent" });
}

/** Everything an SMTP conversation needs from its socket, with deadlines. */
class Session {
  private buffer = "";
  private readonly deadline: number;

  constructor(
    private readonly connection: SmtpConnection,
    private readonly timeouts: SmtpTimeouts,
    private readonly now: () => number,
  ) {
    this.deadline = now() + timeouts.totalMs;
  }

  private remaining(limit: number): number {
    return Math.max(1, Math.min(limit, this.deadline - this.now()));
  }

  async send(stage: string, text: string): Promise<void> {
    await this.write(stage, encoder.encode(text));
  }

  async write(stage: string, bytes: Uint8Array): Promise<void> {
    try {
      await withTimeout(
        this.connection.write(bytes),
        this.remaining(this.timeouts.commandMs),
        () => new SmtpError({ kind: "timeout", stage, message: `smtp_${stage}: write timed out` }),
      );
    } catch (err) {
      throw err instanceof SmtpError
        ? err
        : new SmtpError({ kind: "network", stage, message: `smtp_${stage}: ${String(err)}` });
    }
  }

  /** One complete (possibly multi-line) reply. */
  async readReply(stage: string, limitMs: number = this.timeouts.commandMs): Promise<SmtpReply> {
    const lines: string[] = [];
    let code = 0;
    let totalBytes = 0;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) {
        const chunk = await this.readChunk(stage, limitMs);
        totalBytes += chunk.length;
        if (totalBytes > MAX_REPLY_BYTES) {
          throw new SmtpError({
            kind: "protocol",
            stage,
            message: `smtp_${stage}: reply too long`,
          });
        }
        this.buffer += decoder.decode(chunk, { stream: true });
        continue;
      }
      const raw = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      const match = /^(\d{3})(?:([ -])(.*))?$/.exec(raw);
      if (!match) {
        throw new SmtpError({
          kind: "protocol",
          stage,
          message: `smtp_${stage}: unparseable reply line`,
        });
      }
      const lineCode = Number(match[1]);
      if (lines.length > 0 && lineCode !== code) {
        throw new SmtpError({
          kind: "protocol",
          stage,
          message: `smtp_${stage}: reply code changed mid-reply`,
        });
      }
      code = lineCode;
      lines.push(match[3] ?? "");
      if (lines.length > MAX_REPLY_LINES) {
        throw new SmtpError({ kind: "protocol", stage, message: `smtp_${stage}: reply too long` });
      }
      if (match[2] !== "-") return { code, enhanced: enhancedOf(lines[0] ?? ""), lines };
    }
  }

  private async readChunk(stage: string, limitMs: number): Promise<Uint8Array> {
    let chunk: Uint8Array | null;
    try {
      chunk = await withTimeout(
        this.connection.read(),
        this.remaining(limitMs),
        () => new SmtpError({ kind: "timeout", stage, message: `smtp_${stage}: reply timed out` }),
      );
    } catch (err) {
      throw err instanceof SmtpError
        ? err
        : new SmtpError({ kind: "network", stage, message: `smtp_${stage}: ${String(err)}` });
    }
    if (chunk === null) {
      throw new SmtpError({
        kind: "network",
        stage,
        message: `smtp_${stage}: connection closed by server`,
      });
    }
    return chunk;
  }

  /** Sends one command and requires a reply code in `expected`. */
  async command(
    stage: string,
    line: string,
    expected: readonly number[],
    limitMs: number = this.timeouts.commandMs,
  ): Promise<SmtpReply> {
    if (/[\r\n\0]/.test(line)) {
      throw new SmtpError({
        kind: "config",
        stage,
        message: `smtp_${stage}: illegal character in command`,
      });
    }
    await this.send(stage, `${line}\r\n`);
    const reply = await this.readReply(stage, limitMs);
    if (!expected.includes(reply.code)) throw replyError(stage, reply);
    return reply;
  }
}

interface EhloCapabilities {
  authMechanisms: string[];
  maxSize: number | null;
}

function parseEhlo(reply: SmtpReply): EhloCapabilities {
  const authMechanisms: string[] = [];
  let maxSize: number | null = null;
  for (const line of reply.lines.slice(1)) {
    const keyword = /^([A-Za-z0-9-]+)(?:[ =](.*))?$/.exec(line.trim());
    if (!keyword) continue;
    const name = (keyword[1] as string).toUpperCase();
    const rest = keyword[2] ?? "";
    if (name === "AUTH") {
      // `AUTH PLAIN LOGIN` (RFC 4954) and the legacy `AUTH=PLAIN LOGIN` form.
      for (const mech of rest.split(/[ =]+/)) if (mech) authMechanisms.push(mech.toUpperCase());
    } else if (name === "SIZE" && /^\d+$/.test(rest.trim())) {
      maxSize = Number(rest.trim());
    }
  }
  return { authMechanisms, maxSize };
}

async function authenticate(
  session: Session,
  caps: EhloCapabilities,
  username: string,
  password: string,
): Promise<void> {
  if (caps.authMechanisms.includes("PLAIN")) {
    // RFC 4954 initial response; if the server ignores it and asks (334), send it then.
    const initial = base64OfUtf8(`\u0000${username}\u0000${password}`);
    await session.send("auth", `AUTH PLAIN ${initial}\r\n`);
    let reply = await session.readReply("auth");
    if (reply.code === 334) {
      await session.send("auth", `${initial}\r\n`);
      reply = await session.readReply("auth");
    }
    if (reply.code !== 235) throw replyError("auth", reply);
    return;
  }
  if (caps.authMechanisms.includes("LOGIN")) {
    await session.command("auth", "AUTH LOGIN", [334]);
    await session.command("auth", base64OfUtf8(username), [334]);
    await session.command("auth", base64OfUtf8(password), [235]);
    return;
  }
  throw new SmtpError({
    kind: "config",
    stage: "auth",
    message: `smtp_auth: server offers no supported AUTH mechanism (needs PLAIN or LOGIN; offered: ${caps.authMechanisms.join(", ") || "none"})`,
  });
}

export interface SmtpSendOptions {
  connect: SmtpConnector;
  server: SmtpServerTarget;
  envelope: SmtpEnvelope;
  /** Full RFC 5322 message (see `buildMimeMessage`). */
  message: string;
  timeouts?: SmtpTimeouts;
  /** Injectable clock for the whole-conversation deadline. */
  now?: () => number;
}

/**
 * One connection, one message. Resolves with the server's final reply text
 * once it accepted the message (250 after DATA); throws `SmtpError`
 * otherwise. Always closes the connection.
 */
export async function sendSmtpMessage(options: SmtpSendOptions): Promise<{ reply: string }> {
  const timeouts = options.timeouts ?? DEFAULT_SMTP_TIMEOUTS;
  const now = options.now ?? (() => Date.now());
  const { server, envelope } = options;

  let connection: SmtpConnection;
  let connectSettled = false;
  try {
    connection = await withTimeout(
      options.connect({ hostname: server.hostname, port: server.port }).then((conn) => {
        // A connection that arrives after the timeout fired must not leak.
        if (connectSettled) conn.close();
        return conn;
      }),
      timeouts.connectMs,
      () =>
        new SmtpError({ kind: "timeout", stage: "connect", message: "smtp_connect: timed out" }),
    );
  } catch (err) {
    connectSettled = true;
    throw err instanceof SmtpError
      ? err
      : new SmtpError({
          kind: "network",
          stage: "connect",
          message: `smtp_connect: ${String(err)}`,
        });
  }
  connectSettled = true;

  const session = new Session(connection, timeouts, now);
  try {
    const greeting = await session.readReply("greeting");
    if (greeting.code !== 220) throw replyError("greeting", greeting);

    const ehlo = await session.command("ehlo", `EHLO ${server.clientName}`, [250]);
    const caps = parseEhlo(ehlo);

    await authenticate(session, caps, server.username, server.password);

    const data = prepareData(options.message);
    const size = encoder.encode(data).length;
    if (caps.maxSize !== null && size > caps.maxSize) {
      throw new SmtpError({
        kind: "permanent",
        stage: "mail_from",
        message: `smtp_mail_from: message is ${size} bytes, the server accepts at most ${caps.maxSize}`,
      });
    }

    await session.command("mail_from", `MAIL FROM:<${envelope.from}>`, [250]);
    await session.command("rcpt_to", `RCPT TO:<${envelope.to}>`, [250, 251]);
    await session.command("data", "DATA", [354]);
    await session.send("data_end", data);
    const accepted = await session.readReply("data_end");
    if (accepted.code !== 250) throw replyError("data_end", accepted);

    // The message is accepted; a failing QUIT must not turn that into an error.
    await session.command("quit", "QUIT", [221], QUIT_WAIT_MS).catch(() => undefined);
    return { reply: accepted.lines.join(" ") };
  } finally {
    connection.close();
  }
}
