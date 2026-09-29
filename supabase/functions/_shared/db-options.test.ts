import net from "node:net";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildConnectionOptions,
  HOT_PATH_DATE_TYPE,
  HOT_PATH_MAX_CONNECTIONS,
  serializeTimestampParam,
  UNPARSEABLE_TIMESTAMP_SENTINEL,
} from "./db-options.ts";

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
      // HOTPATH-REVIEW: the date-serializer override is hot-path only.
      expect("types" in opts).toBe(false);
    }
  });

  it("HOTPATH: the hot_path profile is one connection, still prepared (direct connection), same timeouts, non-throwing date serializer", () => {
    const opts = buildConnectionOptions({ statementTimeoutMs: 1_200, profile: "hot_path" });
    expect(HOT_PATH_MAX_CONNECTIONS).toBe(1);
    expect(opts).toEqual({
      prepare: true,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 5,
      connection: { statement_timeout: 1_200 },
      types: { date: HOT_PATH_DATE_TYPE },
    });
  });
});

describe("serializeTimestampParam / HOT_PATH_DATE_TYPE (HOTPATH-REVIEW)", () => {
  // postgres@3.4.9 src/types.js, the built-in `date` type, verbatim.
  const stockSerialize = (x: unknown) =>
    (x instanceof Date ? x : new Date(x as string)).toISOString();
  const stockParse = (x: string) => new Date(x);

  it("serializes every valid value exactly as the stock serializer does", () => {
    for (const value of [
      new Date("2026-09-29T14:00:00.000Z"),
      "2026-09-29T10:00:00-04:00",
      "2026-09-29T14:00:00Z",
      "2026-09-29",
      "2026-09-29 10:00",
      1_790_690_400_000,
    ]) {
      expect(serializeTimestampParam(value)).toBe(stockSerialize(value));
    }
  });

  it("never throws: an unparseable value becomes a sentinel Postgres rejects with 22007 (never the raw text, which Postgres might read as 'tomorrow')", () => {
    for (const value of ["tomorrow", "10:30 AM", "", new Date(Number.NaN), Symbol("x"), {}]) {
      expect(() => serializeTimestampParam(value)).not.toThrow();
      expect(serializeTimestampParam(value)).toBe(UNPARSEABLE_TIMESTAMP_SENTINEL);
    }
    expect(() => stockSerialize("tomorrow")).toThrow(RangeError);
  });

  it("covers the same type OIDs (date, timestamp, timestamptz) and parses exactly like the stock type", () => {
    expect(HOT_PATH_DATE_TYPE.to).toBe(1184);
    expect(HOT_PATH_DATE_TYPE.from).toEqual([1082, 1114, 1184]);
    for (const raw of ["2026-09-29 14:00:00+00", "2026-09-29", "2026-09-29 10:00:00-04"]) {
      expect(HOT_PATH_DATE_TYPE.parse(raw)).toEqual(stockParse(raw));
    }
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
  /** Every Bind: the statement text and its text-format parameter values. */
  bound: { query: string; values: (string | null)[] }[];
  close(): Promise<void>;
}

/** `slowMs` delays the reply to any statement containing "pg_sleep_fake". */
async function startFakePostgres(slowMs: number): Promise<FakeServer> {
  let connections = 0;
  const executed: string[] = [];
  const bound: { query: string; values: (string | null)[] }[] = [];
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
          // text, or timestamptz (1184) for a `::timestamptz` statement, so
          // postgres.js picks its date serializer for those parameters.
          const oid = lastParsed.query.includes("::timestamptz") ? 1184 : 25;
          for (let i = 0; i < lastParsed.params; i++) pd.writeUInt32BE(oid, 2 + i * 4);
          send(msg("t", pd), msg("n"));
          break;
        }
        case "B": {
          const portalEnd = body.indexOf(0);
          const stmtEnd = body.indexOf(0, portalEnd + 1);
          const stmt = body.toString("utf8", portalEnd + 1, stmtEnd);
          portalQuery = (statements.get(stmt) ?? lastParsed).query;
          let at = stmtEnd + 1;
          const formats = body.readUInt16BE(at);
          at += 2 + formats * 2;
          const count = body.readUInt16BE(at);
          at += 2;
          const values: (string | null)[] = [];
          for (let i = 0; i < count; i++) {
            const len = body.readInt32BE(at);
            at += 4;
            values.push(len < 0 ? null : body.toString("utf8", at, at + len));
            at += Math.max(0, len);
          }
          bound.push({ query: portalQuery, values });
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
    bound,
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

// ---------------------------------------------------------------------------
// HOTPATH-REVIEW: an unparseable timestamp must never poison the hot path's
// single connection. Same fake server; the pipelined sequence below is what
// a tool call with a bad time looks like while the previous request's
// telemetry insert (or another call's statement) is still in flight.
// ---------------------------------------------------------------------------

type Outcome = { status: "fulfilled" } | { status: "rejected"; error: string } | { status: "hang" };

function outcome(p: Promise<unknown>, hangMs = 300): Promise<Outcome> {
  return Promise.race([
    p.then(
      (): Outcome => ({ status: "fulfilled" }),
      (e: unknown): Outcome => ({ status: "rejected", error: String(e) }),
    ),
    new Promise<Outcome>((r) => setTimeout(() => r({ status: "hang" }), hangMs)),
  ]);
}

describe("HOTPATH-REVIEW: unparseable timestamp on the single connection (real postgres.js, fake server)", () => {
  let fake: FakeServer | undefined;
  let sql: postgres.Sql | undefined;

  afterEach(async () => {
    await sql?.end({ timeout: 1 });
    await fake?.close();
    sql = undefined;
    fake = undefined;
  });

  async function pipelinedBadTimestamp(stockSerializer: boolean): Promise<Outcome[]> {
    fake = await startFakePostgres(80);
    const { types: _hotPathTypes, ...withoutTypes } = buildConnectionOptions({
      profile: "hot_path",
    });
    sql = postgres({
      ...(stockSerializer ? withoutTypes : buildConnectionOptions({ profile: "hot_path" })),
      host: "127.0.0.1",
      port: fake.port,
      username: "test",
      database: "test",
      ssl: false,
      fetch_types: false,
    });
    const client = sql;
    const byTime = (value: string) => client`select ${value}::timestamptz as ts`;
    // The statement is prepared on this connection (the warm hot path).
    await byTime("2026-09-29T10:00:00-04:00");
    const inFlight = outcome(client`select 1 where pg_sleep_fake`);
    await new Promise((r) => setTimeout(r, 20));
    const bad = outcome(byTime("tomorrow"));
    const after = outcome(client`select ${"after"}::text as who`);
    return Promise.all([inFlight, bad, after]);
  }

  it("postgres.js 3.4.9's stock date serializer poisons the connection: the innocent in-flight statement is rejected and the next one never completes (why the hot path overrides it)", async () => {
    const [inFlight, , after] = await pipelinedBadTimestamp(true);
    expect(inFlight).toMatchObject({ status: "rejected" });
    expect((inFlight as { error: string }).error).toContain("Invalid time value");
    expect(after).toEqual({ status: "hang" });
  });

  it("the hot_path profile sends a sentinel the server rejects instead: every statement completes and the connection stays healthy", async () => {
    const [inFlight, bad, after] = await pipelinedBadTimestamp(false);
    expect(inFlight).toEqual({ status: "fulfilled" });
    // The fake server does not validate; a real Postgres answers 22007 here
    // (checked against Postgres 16: `invalid input syntax for type timestamp
    // with time zone: "Invalid Date"`), an ordinary per-statement error.
    expect(bad).toEqual({ status: "fulfilled" });
    expect(after).toEqual({ status: "fulfilled" });
    const timestamps = (fake?.bound ?? [])
      .filter((b) => b.query.includes("::timestamptz"))
      .map((b) => b.values[0]);
    expect(timestamps).toEqual(["2026-09-29T14:00:00.000Z", UNPARSEABLE_TIMESTAMP_SENTINEL]);
  });
});
