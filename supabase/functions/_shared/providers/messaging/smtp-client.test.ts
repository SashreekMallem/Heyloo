import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmtpConnection, SmtpConnector, SmtpSendOptions } from "./smtp-client.ts";
import { connectDenoTls, prepareData, SmtpError, sendSmtpMessage } from "./smtp-client.ts";
import type { FakeSmtpOptions } from "./smtp-fake-server.ts";
import { FakeSmtpServer, inMemoryConnector } from "./smtp-fake-server.ts";

const CREDENTIALS = { username: "alerts@example.com", password: "s3cret-app-pass" };
const MESSAGE = "Subject: Hi\r\nTo: <owner@example.com>\r\n\r\nHello there.\r\n";
const FAST = { connectMs: 200, commandMs: 100, totalMs: 1_000 };

function options(
  connect: SmtpConnector,
  overrides: Partial<SmtpSendOptions> = {},
): SmtpSendOptions {
  return {
    connect,
    server: { hostname: "smtp.example.com", port: 465, ...CREDENTIALS, clientName: "example.com" },
    envelope: { from: "alerts@example.com", to: "owner@example.com" },
    message: MESSAGE,
    timeouts: FAST,
    ...overrides,
  };
}

async function run(
  serverOptions: FakeSmtpOptions = { credentials: CREDENTIALS },
  overrides: Partial<SmtpSendOptions> = {},
) {
  const server = new FakeSmtpServer({ credentials: CREDENTIALS, ...serverOptions });
  const result = await sendSmtpMessage(options(inMemoryConnector(server), overrides));
  return { server, result };
}

async function failure(
  serverOptions: FakeSmtpOptions = {},
  overrides: Partial<SmtpSendOptions> = {},
): Promise<{ server: FakeSmtpServer; error: SmtpError }> {
  const server = new FakeSmtpServer({ credentials: CREDENTIALS, ...serverOptions });
  const error = await sendSmtpMessage(options(inMemoryConnector(server), overrides)).then(
    () => {
      throw new Error("expected the send to fail");
    },
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(SmtpError);
  return { server, error: error as SmtpError };
}

describe("prepareData (dot-stuffing and framing)", () => {
  it("normalizes lone CR/LF to CRLF and stuffs every leading dot", () => {
    expect(prepareData("a\nb\r.c\r\n.\r\n..d")).toBe("a\r\nb\r\n..c\r\n..\r\n...d\r\n.\r\n");
  });

  it("adds the missing final CRLF before the terminator and never doubles it", () => {
    expect(prepareData("x")).toBe("x\r\n.\r\n");
    expect(prepareData("x\r\n")).toBe("x\r\n.\r\n");
  });
});

describe("sendSmtpMessage — the happy path", () => {
  it("speaks EHLO, AUTH PLAIN, MAIL FROM, RCPT TO, DATA, QUIT in order and delivers the message", async () => {
    const { server, result } = await run();
    expect(server.commands).toEqual([
      "EHLO example.com",
      "AUTH PLAIN <redacted>",
      "MAIL FROM:<alerts@example.com>",
      "RCPT TO:<owner@example.com>",
      "DATA",
      "QUIT",
    ]);
    expect(server.presented).toEqual(CREDENTIALS);
    expect(server.data).toBe(MESSAGE);
    expect(result.reply).toContain("queued as fake-1");
    expect(server.closed).toBe(true);
  });

  it("survives replies delivered one byte at a time and multi-line EHLO replies", async () => {
    const { server } = await run({ sliceBytes: 1 });
    expect(server.data).toBe(MESSAGE);
  });

  it("falls back to AUTH LOGIN when PLAIN is not offered", async () => {
    const { server } = await run({ capabilities: ["AUTH LOGIN"] });
    expect(server.commands.slice(1, 2)).toEqual(["AUTH LOGIN"]);
    expect(server.presented).toEqual(CREDENTIALS);
    expect(server.data).toBe(MESSAGE);
  });

  it("understands the legacy AUTH=PLAIN advertisement", async () => {
    const { server } = await run({ capabilities: ["AUTH=PLAIN LOGIN"] });
    expect(server.commands[1]).toBe("AUTH PLAIN <redacted>");
  });

  it("answers a 334 challenge to AUTH PLAIN by sending the credentials again", async () => {
    const { server } = await run({ challengeFirst: true });
    expect(server.presented).toEqual(CREDENTIALS);
    expect(server.data).toBe(MESSAGE);
  });

  it("never lets message content end the DATA phase early or run a command (dot-stuffing)", async () => {
    const hostile =
      "Subject: x\r\n\r\n.starts with a dot\r\n.\r\nMAIL FROM:<evil@example.com>\r\nRSET\r\n..two\r\n";
    const { server } = await run({}, { message: hostile });
    expect(server.data).toBe(hostile);
    expect(server.commands.filter((c) => c.startsWith("MAIL FROM"))).toHaveLength(1);
    expect(server.commands).not.toContain("RSET");
  });

  it("normalizes bare LF line endings on the wire", async () => {
    const { server } = await run({}, { message: "Subject: x\n\nbody\n" });
    expect(server.data).toBe("Subject: x\r\n\r\nbody\r\n");
  });

  it("does not turn a failing QUIT into a failed send", async () => {
    const { result } = await run({ replies: { quit: "421 4.4.2 timeout" } });
    expect(result.reply).toContain("queued");
  });
});

describe("sendSmtpMessage — failure classification", () => {
  it("credentials rejected -> auth (permanent), without echoing the password anywhere", async () => {
    const { server, error } = await failure({
      credentials: { username: "alerts@example.com", password: "different" },
    });
    expect(error.kind).toBe("auth");
    expect(error.code).toBe(535);
    expect(error.enhanced).toBe("5.7.8");
    expect(error.message).toContain("535 5.7.8 Username and Password not accepted");
    expect(error.message).not.toContain(CREDENTIALS.password);
    expect(server.commands.join("\n")).not.toContain(CREDENTIALS.password);
    expect(server.commands).not.toContain("MAIL FROM:<alerts@example.com>");
  });

  it("an app-password-required refusal (534) is an auth failure too", async () => {
    const { error } = await failure({
      replies: { auth: "534-5.7.9 Application-specific password required\r\n534 5.7.9 more" },
    });
    expect(error.kind).toBe("auth");
    expect(error.code).toBe(534);
  });

  it("a temporary authentication problem (454) is transient, not permanent", async () => {
    const { error } = await failure({ replies: { auth: "454 4.7.0 Too many login attempts" } });
    expect(error.kind).toBe("transient");
  });

  it("a server that offers no usable AUTH mechanism is a permanent configuration error", async () => {
    const none = await failure({ capabilities: ["PIPELINING"] });
    expect(none.error.kind).toBe("config");
    expect(none.error.message).toContain("offered: none");
    const exotic = await failure({ capabilities: ["AUTH CRAM-MD5 XOAUTH2"] });
    expect(exotic.error.kind).toBe("config");
    expect(exotic.error.message).toContain("CRAM-MD5");
  });

  it("4xx replies are transient at every step", async () => {
    for (const [stage, reply] of [
      ["greeting", "421 4.3.2 Service not available"],
      ["ehlo", "451 4.3.0 Local error"],
      ["mail", "451 4.7.1 Greylisted"],
      ["rcpt", "450 4.2.1 Mailbox busy"],
      ["data", "451 4.3.0 Try later"],
      ["dataEnd", "452 4.5.3 Insufficient storage"],
    ] as const) {
      const { error } = await failure({ replies: { [stage]: reply } });
      expect(error.kind, stage).toBe("transient");
      expect(error.stage, stage).toBe(
        {
          greeting: "greeting",
          ehlo: "ehlo",
          mail: "mail_from",
          rcpt: "rcpt_to",
          data: "data",
          dataEnd: "data_end",
        }[stage],
      );
    }
  });

  it("5xx replies outside AUTH are permanent", async () => {
    for (const [stage, reply] of [
      ["greeting", "554 5.3.2 No SMTP service here"],
      ["mail", "553 5.7.1 Sender address rejected: not owned by user"],
      ["rcpt", "550 5.1.1 No such user"],
      ["data", "554 5.6.0 Message rejected"],
      ["dataEnd", "550 5.7.1 Message content rejected"],
    ] as const) {
      const { error } = await failure({ replies: { [stage]: reply } });
      expect(error.kind, stage).toBe("permanent");
      expect(error.code).toBeGreaterThanOrEqual(500);
    }
  });

  it("recognizes an exhausted daily sending limit (Gmail 550 5.4.5) as a quota problem", async () => {
    const { error } = await failure({
      replies: {
        dataEnd:
          "550-5.4.5 Daily user sending limit exceeded. For more information\r\n550 5.4.5 see https://support.google.com",
      },
    });
    expect(error.kind).toBe("quota");
    expect(error.enhanced).toBe("5.4.5");
  });

  it("rejects a message larger than the server's advertised SIZE before MAIL FROM", async () => {
    const { server, error } = await failure({ capabilities: ["SIZE 20", "AUTH PLAIN"] });
    expect(error.kind).toBe("permanent");
    expect(error.message).toContain("at most 20");
    expect(server.commands.some((c) => c.startsWith("MAIL FROM"))).toBe(false);
  });

  it("garbage instead of an SMTP reply is a protocol error", async () => {
    const { error } = await failure({ replies: { greeting: "HTTP/1.1 400 Bad Request" } });
    expect(error.kind).toBe("protocol");
  });

  it("a connection dropped mid-conversation is a network error", async () => {
    const { error } = await failure({ closeAt: "rcpt" });
    expect(error.kind).toBe("network");
    expect(error.stage).toBe("rcpt_to");
  });
});

describe("sendSmtpMessage — timeouts", () => {
  it("a server that never speaks times out and the connection is closed", async () => {
    const server = new FakeSmtpServer({ hangAt: "greeting" });
    const inner = inMemoryConnector(server);
    let closes = 0;
    const connect: SmtpConnector = async (target) => {
      const connection = await inner(target);
      return {
        ...connection,
        close: () => {
          closes += 1;
          connection.close();
        },
      };
    };
    const error = await sendSmtpMessage(options(connect)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmtpError);
    expect((error as SmtpError).kind).toBe("timeout");
    expect((error as SmtpError).stage).toBe("greeting");
    expect(closes).toBe(1);
  });

  it("stalling after AUTH times out at the step that stalled", async () => {
    const { error } = await failure({ hangAt: "rcpt" });
    expect(error.kind).toBe("timeout");
    expect(error.stage).toBe("rcpt_to");
  });

  it("the whole-conversation deadline caps a slow server even when every step is within its own limit", async () => {
    let clock = 0;
    const server = new FakeSmtpServer({ credentials: CREDENTIALS, hangAt: "ehlo" });
    const error = await sendSmtpMessage(
      options(inMemoryConnector(server), {
        timeouts: { connectMs: 200, commandMs: 10_000, totalMs: 50 },
        // The clock jumps past the deadline as soon as the greeting was read.
        now: () => {
          clock += 40;
          return clock;
        },
      }),
    ).catch((e: unknown) => e);
    expect((error as SmtpError).kind).toBe("timeout");
  });

  it("a connect that never completes times out, and a late connection is closed, not leaked", async () => {
    let release: ((c: SmtpConnection) => void) | undefined;
    const late: SmtpConnection = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      close: vi.fn(),
    };
    const connect: SmtpConnector = () =>
      new Promise<SmtpConnection>((resolve) => {
        release = resolve;
      });
    const error = await sendSmtpMessage(options(connect)).catch((e: unknown) => e);
    expect((error as SmtpError).kind).toBe("timeout");
    expect((error as SmtpError).stage).toBe("connect");
    release?.(late);
    await Promise.resolve();
    await Promise.resolve();
    expect(late.close).toHaveBeenCalled();
  });

  it("a refused/failed connect is a network error", async () => {
    const connect: SmtpConnector = () => Promise.reject(new Error("ECONNREFUSED"));
    const error = await sendSmtpMessage(options(connect)).catch((e: unknown) => e);
    expect((error as SmtpError).kind).toBe("network");
    expect((error as SmtpError).message).toContain("ECONNREFUSED");
  });
});

describe("connectDenoTls (the one runtime-specific line)", () => {
  const original = (globalThis as { Deno?: unknown }).Deno;
  afterEach(() => {
    (globalThis as { Deno?: unknown }).Deno = original;
  });

  it("fails as a configuration error when the runtime has no Deno.connectTls", async () => {
    (globalThis as { Deno?: unknown }).Deno = undefined;
    await expect(connectDenoTls({ hostname: "h", port: 465 })).rejects.toMatchObject({
      name: "SmtpError",
      kind: "config",
    });
  });

  it("adapts a Deno TlsConn: copies read buffers, loops over partial writes, closes safely", async () => {
    const written: number[][] = [];
    const conn = {
      read: vi.fn(async (buf: Uint8Array) => {
        buf.set([65, 66, 67]);
        return 3;
      }),
      write: vi.fn(async (data: Uint8Array) => {
        const n = Math.min(2, data.length); // partial write
        written.push([...data.subarray(0, n)]);
        return n;
      }),
      close: vi.fn(() => {
        throw new Error("BadResource");
      }),
    };
    const connectTls = vi.fn(async (_o: { hostname: string; port: number }) => conn);
    (globalThis as { Deno?: unknown }).Deno = { connectTls };

    const connection = await connectDenoTls({ hostname: "smtp.example.com", port: 465 });
    expect(connectTls).toHaveBeenCalledWith({ hostname: "smtp.example.com", port: 465 });
    const first = await connection.read();
    const second = await connection.read();
    expect([...(first ?? [])]).toEqual([65, 66, 67]);
    expect(first).not.toBe(second); // a fresh copy each time, not the shared buffer
    await connection.write(Uint8Array.from([1, 2, 3, 4, 5]));
    expect(written).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => connection.close()).not.toThrow();
    conn.read.mockResolvedValueOnce(null as unknown as number);
    expect(await connection.read()).toBeNull();
  });
});

// A genuine TLS handshake and socket against a local server, so the client's
// stream handling is proven on real TLS records (the in-memory pipe above is
// deterministic but never fragments or coalesces like a socket). The
// certificate is generated with the `openssl` CLI at test time, so no key
// material is committed; the test is skipped only where openssl is absent.
const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;

describe.skipIf(!hasOpenssl)("sendSmtpMessage over a real TLS socket", () => {
  it("completes an authenticated send against a local TLS server", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heyloo-smtp-"));
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "ec",
          "-pkeyopt",
          "ec_paramgen_curve:prime256v1",
          "-nodes",
          "-keyout",
          join(dir, "key.pem"),
          "-out",
          join(dir, "cert.pem"),
          "-days",
          "1",
          "-subj",
          "/CN=localhost",
          "-addext",
          "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ],
        { stdio: "ignore" },
      );
      const cert = readFileSync(join(dir, "cert.pem"));
      const key = readFileSync(join(dir, "key.pem"));

      const fake = new FakeSmtpServer({ credentials: CREDENTIALS });
      const server = tls.createServer({ key, cert }, (socket) => {
        fake.attach((bytes) => (bytes ? socket.write(bytes) : socket.end()));
        socket.on("data", (chunk) => fake.receive(chunk));
        socket.on("error", () => undefined);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as { port: number }).port;

      const connect: SmtpConnector = ({ port: p }) =>
        new Promise((resolve, reject) => {
          const socket = tls.connect({
            host: "127.0.0.1",
            port: p,
            ca: cert,
            servername: "localhost",
          });
          const queue: Array<Uint8Array | null> = [];
          let waiter: ((c: Uint8Array | null) => void) | null = null;
          const push = (c: Uint8Array | null) => {
            if (waiter) {
              const w = waiter;
              waiter = null;
              w(c);
            } else queue.push(c);
          };
          socket.on("data", (d) => push(new Uint8Array(d)));
          socket.on("end", () => push(null));
          socket.on("error", reject);
          socket.on("secureConnect", () =>
            resolve({
              read: () =>
                queue.length > 0
                  ? Promise.resolve(queue.shift() as Uint8Array | null)
                  : new Promise((r) => {
                      waiter = r;
                    }),
              write: (data) => new Promise((res) => socket.write(data, () => res())),
              close: () => socket.destroy(),
            }),
          );
        });

      const result = await sendSmtpMessage(
        options(connect, {
          server: { hostname: "127.0.0.1", port, ...CREDENTIALS, clientName: "example.com" },
          timeouts: { connectMs: 5_000, commandMs: 5_000, totalMs: 10_000 },
        }),
      );
      expect(result.reply).toContain("queued");
      expect(fake.data).toBe(MESSAGE);
      expect(fake.presented).toEqual(CREDENTIALS);
      await new Promise((resolve) => server.close(resolve));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
