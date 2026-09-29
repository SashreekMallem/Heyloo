// JSONB-2 (docs/BUILD_NOTES.md): proof of how the pinned postgres.js (3.4.9)
// binds a value interpolated into `${x}::jsonb` under `prepare: true` (the
// repo's client option, `_shared/db-options.ts`), plus a source-tree guard so
// the double-encoding pattern CALL-3 fixed cannot be reintroduced.
//
// Every other test in this package injects a fake tagged-template `sql`, so
// none of them can see what postgres.js itself does with a parameter. This
// file drives the REAL `postgres` client against a minimal in-process fake
// Postgres server that speaks just enough of the v3 wire protocol (startup,
// Parse/Describe/Bind/Execute/Sync) to (a) answer Describe with `jsonb` for
// every `$n::jsonb` parameter, exactly as a real server does, and (b) capture
// the exact bytes postgres.js Binds — the parameter text and the type OID it
// declared in Parse.

import { readdirSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildConnectionOptions } from "./db-options.ts";

const JSONB_OID = 3802;
const JSON_OID = 114;
const TEXT_OID = 25;

interface Captured {
  /** Bound parameter texts, in order (null = SQL NULL). */
  params: Array<string | null>;
  /** Parameter type OIDs the client declared in Parse (0 = "let the server infer"). Empty when the statement was already prepared. */
  parseOids: number[];
}

function msg(tag: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const out = Buffer.alloc(5 + body.length);
  out.write(tag, 0, "latin1");
  out.writeInt32BE(body.length + 4, 1);
  body.copy(out, 5);
  return out;
}

function readCString(buf: Buffer, offset: number): [string, number] {
  const end = buf.indexOf(0, offset);
  return [buf.toString("utf8", offset, end), end + 1];
}

/** Minimal fake Postgres. Records every Bind; never touches a real database. */
async function startFakePostgres(): Promise<{
  port: number;
  take(): Captured;
  close(): Promise<void>;
}> {
  let current: Captured = { params: [], parseOids: [] };
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let started = false;
    let lastQuery = "";
    let lastParamCount = 0;

    const send = (...parts: Buffer[]) => socket.write(Buffer.concat(parts));
    const ready = () => msg("Z", Buffer.from("I"));

    const handle = (tag: string, body: Buffer) => {
      switch (tag) {
        case "P": {
          const [, afterName] = readCString(body, 0);
          const [query, afterQuery] = readCString(body, afterName);
          lastQuery = query;
          lastParamCount = body.readUInt16BE(afterQuery);
          current.parseOids = Array.from({ length: lastParamCount }, (_, i) =>
            body.readUInt32BE(afterQuery + 2 + i * 4),
          );
          send(msg("1"));
          break;
        }
        case "D": {
          // Answer ParameterDescription like a real server: `$n::jsonb` -> jsonb.
          const oids = Array.from({ length: lastParamCount }, (_, i) => {
            const n = i + 1;
            if (lastQuery.includes(`$${n}::jsonb`)) return JSONB_OID;
            if (lastQuery.includes(`$${n}::json `) || lastQuery.includes(`$${n}::json,`))
              return JSON_OID;
            return TEXT_OID;
          });
          const pd = Buffer.alloc(2 + oids.length * 4);
          pd.writeUInt16BE(oids.length, 0);
          oids.forEach((oid, i) => {
            pd.writeUInt32BE(oid, 2 + i * 4);
          });
          send(msg("t", pd), msg("n"));
          break;
        }
        case "B": {
          let o = readCString(body, 0)[1]; // portal
          o = readCString(body, o)[1]; // statement
          const formatCount = body.readUInt16BE(o);
          o += 2 + formatCount * 2;
          const paramCount = body.readUInt16BE(o);
          o += 2;
          const params: Array<string | null> = [];
          for (let i = 0; i < paramCount; i++) {
            const len = body.readInt32BE(o);
            o += 4;
            if (len === -1) {
              params.push(null);
            } else {
              params.push(body.toString("utf8", o, o + len));
              o += len;
            }
          }
          current.params = params;
          send(msg("2"));
          break;
        }
        case "E":
          send(msg("C", Buffer.from("UPDATE 1\0")));
          break;
        case "S":
          send(ready());
          break;
        default:
          break; // H (Flush), X (Terminate), ...
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
          send(msg("R", Buffer.from([0, 0, 0, 0])), ready());
          continue;
        }
        if (buf.length < 5) return;
        const len = buf.readInt32BE(1);
        if (buf.length < 1 + len) return;
        const tag = String.fromCharCode(buf[0] as number);
        const body = buf.subarray(5, 1 + len);
        buf = buf.subarray(1 + len);
        handle(tag, Buffer.from(body));
      }
    });
    socket.on("error", () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    take() {
      const out = current;
      current = { params: [], parseOids: [] };
      return out;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let fake: Awaited<ReturnType<typeof startFakePostgres>>;
let sql: postgres.Sql;

beforeAll(async () => {
  fake = await startFakePostgres();
  sql = postgres({
    // Same options the edge functions use (prepare: true, ...).
    ...buildConnectionOptions(),
    host: "127.0.0.1",
    port: fake.port,
    username: "test",
    database: "test",
    ssl: false,
    fetch_types: false,
    max: 1,
  });
});

afterAll(async () => {
  await sql.end({ timeout: 1 });
  await fake.close();
});

/**
 * Runs `update t set c = ${value}::jsonb where id = ${"row"}` twice — the
 * first execution goes through Parse/Describe (types learned from the server),
 * the second reuses the cached prepared statement — and returns both bound
 * texts so the test can prove the two agree.
 */
let tableSeq = 0;
async function bindJsonb(value: unknown): Promise<{ first: Captured; second: Captured }> {
  // A unique table name per call gives each case its own statement signature,
  // so its first execution really goes through Parse/Describe.
  const table = `t${++tableSeq}`;
  const run = () => sql`update ${sql(table)} set c = ${value as never}::jsonb where id = ${"row"}`;
  fake.take();
  await run();
  const first = fake.take();
  await run();
  const second = fake.take();
  return { first, second };
}

/** Bound text of the jsonb parameter ($1), and what jsonb would store for it. */
function stored(captured: Captured): { text: string | null; parsed: unknown } {
  const text = captured.params[0] ?? null;
  return { text, parsed: text === null ? null : JSON.parse(text) };
}

describe("postgres.js jsonb parameter binding (real client, fake server)", () => {
  // Each entry mirrors a call-site expression from supabase/functions.
  const correct: Array<[string, unknown]> = [
    // admin/handler.ts writeAlertRules (~L456)
    ["admin alert rules `{ rules }`", { rules: [{ id: "r1", threshold: 3, channels: ["sms"] }] }],
    ["admin alert rules `{ rules: [] }`", { rules: [] }],
    // admin/handler.ts referral (~L774, ~L779)
    ["admin referral `{ amount_cents }`", { amount_cents: 2500 }],
    ["admin referral `{ rule }`", { rule: "first_payment" }],
    // admin/handler.ts pricing merge (~L825)
    [
      "admin pricing merged card",
      {
        legacy_field: "kept",
        base_cents: 29900,
        included_minutes: 300,
        effective_at: "2026-10-01",
      },
    ],
    // admin/handler.ts template create `body[x] ?? []` and patch `patch[x]` (~L1314-1363)
    ["template array of objects (states)", [{ id: "greet", allowed_tools: [] }]],
    ["template empty array (`?? []` fallback)", []],
    ["empty object (`?? {}` fallbacks, voice-events custom_analysis_data)", {}],
    ["template array of strings (tools)", ["lookup_customer", "transfer_call"]],
    ["template array of numbers", [1, 2, 3]],
    ["template nested arrays", [[1, 2], [3]]],
    ["template array starting with null", [null, { a: 1 }]],
    ["object whose values are arrays (global_intents)", { a: ["x"], b: [] }],
    ["job-agent-regression failures", [{ case_id: "a", result_explanation: "wrong hours" }]],
  ];

  it.each(correct)("%s binds as ONE JSON document (jsonb object/array)", async (_label, value) => {
    const { first, second } = await bindJsonb(value);

    // Type is left for the server to infer (0) — postgres.js never pre-declares
    // a Postgres array type or text for these; the server answers jsonb.
    expect(first.parseOids).toEqual([0, 0]);

    for (const captured of [first, second]) {
      const { text, parsed } = stored(captured);
      expect(text).not.toBeNull();
      // Exactly one JSON encode: parsing the bound text yields the original
      // value, NOT a string (double-encoded) ...
      expect(typeof parsed).not.toBe("string");
      expect(parsed).toEqual(value);
      // ... and it is JSON text, never a Postgres array literal like `{a,b}`.
      if (Array.isArray(value)) expect(text?.startsWith("[")).toBe(true);
    }
    expect(second.params[0]).toBe(first.params[0]);
  });

  it("a JS null binds as SQL NULL (`x ?? null` cast to jsonb)", async () => {
    const { first, second } = await bindJsonb(null);
    expect(first.params[0]).toBeNull();
    expect(second.params[0]).toBeNull();
  });

  it("a JS string is stored as a jsonb string scalar — the double-encoding shape when it was pre-stringified", async () => {
    const doc = { failures: [{ a: 1 }] };
    const { first } = await bindJsonb(JSON.stringify(doc));
    const { parsed } = stored(first);
    // What the OLD `${JSON.stringify(x)}::jsonb` sites stored: a jsonb STRING
    // holding JSON text (jsonb_typeof = 'string'), not the object.
    expect(typeof parsed).toBe("string");
    expect(parsed).toBe(JSON.stringify(doc));
    expect(parsed).not.toEqual(doc);
  });

  it("a raw JS boolean is declared as bool in Parse (not learned as jsonb) — fails loudly, so sites wrap it in an object", async () => {
    // Documented edge: postgres.js infers OID 16 for booleans (and for arrays
    // whose FIRST element is a boolean), so `$1::jsonb` becomes a bool->jsonb
    // cast the server rejects. Never a silent corruption; the affected call
    // sites (job-retell-health-failover `{ active }`) already wrap the value.
    const { first } = await bindJsonb(true);
    expect(first.parseOids[0]).toBe(16);
    const { first: arr } = await bindJsonb([true, false]);
    expect(arr.parseOids[0]).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Source guard: no `JSON.stringify(...)` (directly, inside the `${...}`) may
// feed a `::jsonb` / `::json` cast anywhere in supabase/functions.
// ---------------------------------------------------------------------------

const FUNCTIONS_ROOT = fileURLToPath(new URL("..", import.meta.url));

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Returns the `${...}` expression text that immediately precedes each `::json(b)` cast. */
function castedInterpolations(source: string): string[] {
  const found: string[] = [];
  const cast = /\}\s*::jsonb?\b/g;
  for (let m = cast.exec(source); m !== null; m = cast.exec(source)) {
    let depth = 0;
    for (let i = m.index; i >= 1; i--) {
      const ch = source[i];
      if (ch === "}") depth++;
      else if (ch === "{") {
        depth--;
        if (depth === 0) {
          if (source[i - 1] === "$") found.push(source.slice(i + 1, m.index));
          break;
        }
      }
    }
  }
  return found;
}

describe("source guard: no pre-stringified value bound into a jsonb cast", () => {
  const files = listSourceFiles(FUNCTIONS_ROOT);

  it("scans a meaningful number of interpolated jsonb casts", () => {
    const total = files.reduce(
      (n, f) => n + castedInterpolations(readFileSync(f, "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThan(50);
  });

  it("finds no `JSON.stringify` inside any jsonb/json-cast interpolation", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const expr of castedInterpolations(readFileSync(file, "utf8"))) {
        if (expr.includes("JSON.stringify")) {
          offenders.push(`${relative(FUNCTIONS_ROOT, file)}: \${${expr.trim().slice(0, 80)}}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the guard itself detects the bad pattern (multi-line, ternary)", () => {
    const open = "$" + "{";
    const bad = `x = ${open}cond ? JSON.stringify(v) : null}::jsonb, y = ${open}\n JSON.stringify({a: 1})}::json`;
    expect(castedInterpolations(bad).filter((e) => e.includes("JSON.stringify"))).toHaveLength(2);
  });
});
