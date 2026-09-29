import net from "node:net";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { buildConnectionOptions, HOT_PATH_MAX_CONNECTIONS } from "./db-options.ts";

describe("buildConnectionOptions", () => {
  it("threads statementTimeoutMs through as a connection.statement_timeout GUC", () => {
    const opts = buildConnectionOptions({ statementTimeoutMs: 1_200 });
    expect(opts.connection).toEqual({ statement_timeout: 1_200 });
  });

  it("omits the connection key entirely when called with {}", () => {
    const opts = buildConnectionOptions({});
    expect(opts.connection).toBeUndefined();
    expect("connection" in opts).toBe(false);
  });

  it("omits the connection key entirely when called with undefined", () => {
    const opts = buildConnectionOptions(undefined);
    expect(opts.connection).toBeUndefined();
    expect("connection" in opts).toBe(false);
  });

  it("always sets the shared pool/prepare/timeout base options (default profile unchanged)", () => {
    const withTimeout = buildConnectionOptions({ statementTimeoutMs: 500 });
    const without = buildConnectionOptions();
    for (const opts of [withTimeout, without]) {
      expect(opts.prepare).toBe(true);
      expect(opts.max).toBe(5);
      expect(opts.idle_timeout).toBe(20);
      expect(opts.connect_timeout).toBe(5);
    }
  });

  it("HOTPATH: the hot_path profile is one connection, still prepared (direct connection), same timeouts", () => {
    const opts = buildConnectionOptions({ statementTimeoutMs: 1_200, profile: "hot_path" });
    expect(HOT_PATH_MAX_CONNECTIONS).toBe(1);
    expect(opts).toEqual({
      prepare: true,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 5,
      connection: { statement_timeout: 1_200 },
    });
  });
});

// ---------------------------------------------------------------------------
// HOTPATH: what the pool size actually does with the REAL postgres.js 3.4.9
// client, against a minimal in-process fake Postgres (v3 wire protocol:
// startup, Parse/Describe/Flush, Bind/Execute/Sync). It records every
// connection and the order statements execute in. Nothing here touches a
// real database.
// ---------------------------------------------------------------------------

function msg(tag: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const out = Buffer.alloc(5 + body.length);
  out.write(tag, 0, "latin1");
  out.writeInt32BE(body.length + 4, 1);
  body.copy(out, 5);
  return out;
}

interface FakeServer {
  port: number;
  connections: () => number;
  /** Statement texts in the order the server EXECUTED them. */
  executed: string[];
  close(): Promise<void>;
}

/** `slowMs` delays the reply to any statement containing "pg_sleep_fake". */
async function startFakePostgres(slowMs: number): Promise<FakeServer> {
  let connections = 0;
  const executed: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    connections += 1;
    let buf = Buffer.alloc(0);
    let started = false;
    const statements = new Map<string, { query: string; params: number }>();
    let lastParsed = { query: "", params: 0 };
    let portalQuery = "";
    // Replies are chained so a slow statement delays everything after it on
    // this connection, exactly like a real backend.
    let chain: Promise<void> = Promise.resolve();
    const send = (...parts: Buffer[]) => {
      chain = chain.then(() => {
        socket.write(Buffer.concat(parts));
      });
    };
    const delay = (ms: number) => {
      chain = chain.then(() => new Promise((r) => setTimeout(r, ms)));
    };

    const handle = (tag: string, body: Buffer) => {
      switch (tag) {
        case "P": {
          const nameEnd = body.indexOf(0);
          const name = body.toString("utf8", 0, nameEnd);
          const queryEnd = body.indexOf(0, nameEnd + 1);
          const query = body.toString("utf8", nameEnd + 1, queryEnd);
          const params = body.readUInt16BE(queryEnd + 1);
          lastParsed = { query, params };
          statements.set(name, lastParsed);
          send(msg("1"));
          break;
        }
        case "D": {
          const pd = Buffer.alloc(2 + lastParsed.params * 4);
          pd.writeUInt16BE(lastParsed.params, 0);
          for (let i = 0; i < lastParsed.params; i++) pd.writeUInt32BE(25, 2 + i * 4); // text
          send(msg("t", pd), msg("n"));
          break;
        }
        case "B": {
          const portalEnd = body.indexOf(0);
          const stmtEnd = body.indexOf(0, portalEnd + 1);
          const stmt = body.toString("utf8", portalEnd + 1, stmtEnd);
          portalQuery = (statements.get(stmt) ?? lastParsed).query;
          send(msg("2"));
          break;
        }
        case "E": {
          const query = portalQuery;
          if (query.includes("pg_sleep_fake")) delay(slowMs);
          chain = chain.then(() => {
            executed.push(query);
          });
          send(msg("C", Buffer.from("SELECT 0\0")));
          break;
        }
        case "S":
          send(msg("Z", Buffer.from("I")));
          break;
        default:
          break; // H (Flush), X (Terminate)
      }
    };

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!started) {
          if (buf.length < 4) return;
          const len = buf.readInt32BE(0);
          if (buf.length < len) return;
          buf = buf.subarray(len);
          started = true;
          send(msg("R", Buffer.from([0, 0, 0, 0])), msg("Z", Buffer.from("I")));
          continue;
        }
        if (buf.length < 5) return;
        const len = buf.readInt32BE(1);
        if (buf.length < 1 + len) return;
        const tag = String.fromCharCode(buf[0] as number);
        const body = Buffer.from(buf.subarray(5, 1 + len));
        buf = buf.subarray(1 + len);
        handle(tag, body);
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    connections: () => connections,
    executed,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

describe("HOTPATH: pool size with the real postgres.js client (fake server)", () => {
  let fake: FakeServer | undefined;
  let sql: postgres.Sql | undefined;

  afterEach(async () => {
    await sql?.end({ timeout: 1 });
    await fake?.close();
    sql = undefined;
    fake = undefined;
  });

  function connect(profile: "default" | "hot_path"): postgres.Sql {
    if (!fake) throw new Error("fake server not started");
    return postgres({
      ...buildConnectionOptions({ profile }),
      host: "127.0.0.1",
      port: fake.port,
      username: "test",
      database: "test",
      ssl: false,
      fetch_types: false,
    });
  }

  it("default profile (max 5): two concurrent parameterized statements on a cold pool open TWO connections", async () => {
    fake = await startFakePostgres(0);
    sql = connect("default");
    await Promise.all([sql`select ${"a"}::text as a`, sql`select ${"b"}::text as b`]);
    expect(fake.connections()).toBe(2);
  });

  it("hot_path profile (max 1): the same concurrent pair shares ONE connection", async () => {
    fake = await startFakePostgres(0);
    sql = connect("hot_path");
    await Promise.all([sql`select ${"a"}::text as a`, sql`select ${"b"}::text as b`]);
    expect(fake.connections()).toBe(1);
  });

  it("hot_path profile: a statement issued while another is still executing runs strictly AFTER it (the ordering create_booking's timeout recovery relies on)", async () => {
    fake = await startFakePostgres(80);
    sql = connect("hot_path");
    const events: string[] = [];
    const slowWrite = sql`insert into t select ${"x"} where pg_sleep_fake`.then(() => {
      events.push("write-done");
    });
    // Issued while the "write" is in flight (the deadline fired).
    await new Promise((r) => setTimeout(r, 20));
    const verify = sql`select id from bookings where idempotency_key = ${"k"}`.then(() => {
      events.push("verify-done");
    });
    await Promise.all([slowWrite, verify]);
    expect(fake.connections()).toBe(1);
    expect(fake.executed.map((q) => (q.includes("pg_sleep_fake") ? "write" : "verify"))).toEqual([
      "write",
      "verify",
    ]);
    expect(events).toEqual(["write-done", "verify-done"]);
  });
});
