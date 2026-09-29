import type { SmtpConnection, SmtpConnector } from "./smtp-client.ts";

/**
 * Test support for the SMTP adapter (imported only by `*.test.ts`): a
 * scripted SMTP server that speaks just enough RFC 5321/4954 to exercise
 * every branch of `smtp-client.ts`, independent of the transport. It is
 * driven by bytes in, bytes out, so the tests attach it either to an
 * in-memory pipe (`inMemoryConnector`, deterministic, used by most tests) or
 * to a real `node:tls` server (smtp-client.test.ts, a genuine TLS handshake
 * and socket).
 */

export type FakeStage =
  | "greeting"
  | "ehlo"
  | "auth"
  | "mail"
  | "rcpt"
  | "data"
  | "dataEnd"
  | "quit";

export interface FakeSmtpOptions {
  /** Lines the server advertises after EHLO's first line. */
  capabilities?: string[];
  /** Credentials it accepts (PLAIN and LOGIN). */
  credentials?: { username: string; password: string };
  /** Replace the server's reply at a stage (multi-line replies joined with `\r\n`). */
  replies?: Partial<Record<FakeStage, string>>;
  /** Never answer at this stage (the client's timeout must fire). */
  hangAt?: FakeStage;
  /** Drop the connection at this stage instead of answering. */
  closeAt?: FakeStage;
  /** Deliver each server write in slices of this many bytes (partial-read coverage). */
  sliceBytes?: number;
  /** Answer `AUTH PLAIN <initial-response>` with a 334 challenge first (a server that ignores the initial response). */
  challengeFirst?: boolean;
}

const DEFAULT_CAPABILITIES = ["PIPELINING", "SIZE 35882577", "8BITMIME", "AUTH PLAIN LOGIN"];

const enc = new TextEncoder();
const dec = new TextDecoder();

export class FakeSmtpServer {
  /** Every command line received, in order (AUTH payloads are recorded as `AUTH <mech> <redacted>`). */
  readonly commands: string[] = [];
  /** The DATA payload as the server reconstructs it (dot-unstuffed, without the terminator). */
  data: string | null = null;
  /** Credentials the client presented, decoded. */
  presented: { username: string; password: string } | null = null;
  closed = false;

  private send: (bytes: Uint8Array | null) => void = () => undefined;
  private buffer = "";
  private mode:
    | { kind: "command" }
    | { kind: "data" }
    | { kind: "plain" }
    | { kind: "login_user" }
    | { kind: "login_pass"; username: string } = { kind: "command" };

  constructor(private readonly options: FakeSmtpOptions = {}) {}

  /** Wires the server's output; called once when a client connects. Emits the greeting. */
  attach(send: (bytes: Uint8Array | null) => void): void {
    this.send = send;
    this.reply("greeting", "220 fake.example ESMTP ready");
  }

  private reply(stage: FakeStage, fallback: string): void {
    if (this.options.hangAt === stage) return;
    if (this.options.closeAt === stage) {
      this.closed = true;
      this.send(null);
      return;
    }
    const text = `${this.options.replies?.[stage] ?? fallback}\r\n`;
    const bytes = enc.encode(text);
    const slice = this.options.sliceBytes;
    if (!slice) {
      this.send(bytes);
      return;
    }
    for (let i = 0; i < bytes.length; i += slice) this.send(bytes.slice(i, i + slice));
  }

  /** Bytes from the client. */
  receive(bytes: Uint8Array): void {
    this.buffer += dec.decode(bytes);
    for (;;) {
      if (this.mode.kind === "data") {
        const end = this.buffer.indexOf("\r\n.\r\n");
        if (end === -1) return;
        const raw = this.buffer.slice(0, end + 2); // keep the last CRLF of the message
        this.buffer = this.buffer.slice(end + 5);
        this.data = raw.replace(/(^|\r\n)\.\./g, "$1.");
        this.mode = { kind: "command" };
        this.reply("dataEnd", "250 2.0.0 OK queued as fake-1");
        continue;
      }
      const newline = this.buffer.indexOf("\r\n");
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 2);
      this.handleLine(line);
    }
  }

  private authResult(username: string, password: string): void {
    this.presented = { username, password };
    const ok =
      this.options.credentials?.username === username &&
      this.options.credentials?.password === password;
    this.reply(
      "auth",
      ok ? "235 2.7.0 Authentication successful" : "535 5.7.8 Username and Password not accepted",
    );
  }

  private handleLine(line: string): void {
    const b64 = (text: string) => dec.decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));

    if (this.mode.kind === "plain") {
      this.commands.push("AUTH-PAYLOAD <redacted>");
      this.mode = { kind: "command" };
      const [, username = "", password = ""] = b64(line).split("\u0000");
      this.authResult(username, password);
      return;
    }
    if (this.mode.kind === "login_user") {
      this.commands.push("AUTH-PAYLOAD <redacted>");
      this.mode = { kind: "login_pass", username: b64(line) };
      this.reply("auth", "334 UGFzc3dvcmQ6");
      return;
    }
    if (this.mode.kind === "login_pass") {
      this.commands.push("AUTH-PAYLOAD <redacted>");
      const username = this.mode.username;
      this.mode = { kind: "command" };
      this.authResult(username, b64(line));
      return;
    }

    const upper = line.toUpperCase();
    if (upper.startsWith("AUTH ")) {
      const [, mech = "", initial] = line.split(" ");
      this.commands.push(`AUTH ${mech.toUpperCase()} ${initial ? "<redacted>" : ""}`.trim());
      if (mech.toUpperCase() === "PLAIN") {
        if (initial && !this.options.challengeFirst) {
          const [, username = "", password = ""] = b64(initial).split("\u0000");
          this.authResult(username, password);
        } else {
          this.mode = { kind: "plain" };
          this.reply("auth", "334 ");
        }
      } else if (mech.toUpperCase() === "LOGIN") {
        this.mode = { kind: "login_user" };
        this.reply("auth", "334 VXNlcm5hbWU6");
      } else {
        this.reply("auth", "504 5.5.4 Unrecognized authentication type");
      }
      return;
    }

    this.commands.push(line);
    if (upper.startsWith("EHLO")) {
      const caps = this.options.capabilities ?? DEFAULT_CAPABILITIES;
      const lines = ["fake.example greets client", ...caps];
      this.reply(
        "ehlo",
        lines.map((l, i) => `250${i === lines.length - 1 ? " " : "-"}${l}`).join("\r\n"),
      );
    } else if (upper.startsWith("MAIL FROM:")) this.reply("mail", "250 2.1.0 Sender OK");
    else if (upper.startsWith("RCPT TO:")) this.reply("rcpt", "250 2.1.5 Recipient OK");
    else if (upper === "DATA") {
      this.mode = { kind: "data" };
      this.reply("data", "354 Start mail input; end with <CRLF>.<CRLF>");
      // A refusal at DATA means no payload follows.
      if (!(this.options.replies?.data ?? "354").startsWith("354")) this.mode = { kind: "command" };
    } else if (upper === "QUIT") {
      this.reply("quit", "221 2.0.0 Bye");
      this.closed = true;
      this.send(null);
    } else this.reply("mail", "500 5.5.1 Command unrecognized");
  }
}

/** A connector whose "server" is an in-memory `FakeSmtpServer`. */
export function inMemoryConnector(server: FakeSmtpServer): SmtpConnector {
  return async () => {
    const queue: Array<Uint8Array | null> = [];
    let waiter: ((chunk: Uint8Array | null) => void) | null = null;
    let clientClosed = false;
    const deliver = (chunk: Uint8Array | null) => {
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(chunk);
      } else queue.push(chunk);
    };
    server.attach(deliver);
    const connection: SmtpConnection & { clientClosed: () => boolean } = {
      read: () =>
        queue.length > 0
          ? Promise.resolve(queue.shift() as Uint8Array | null)
          : new Promise((resolve) => {
              waiter = resolve;
            }),
      write: (data) => {
        if (!clientClosed) server.receive(data);
        return Promise.resolve();
      },
      close: () => {
        clientClosed = true;
        if (waiter) {
          const w = waiter;
          waiter = null;
          w(null);
        }
      },
      clientClosed: () => clientClosed,
    };
    return connection;
  };
}
