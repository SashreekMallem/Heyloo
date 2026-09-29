/**
 * SETTINGS-1: a small in-memory stand-in for the Supabase query builder,
 * shared by the owner-settings route tests (the older route tests each
 * inline their own `chain()` mock). Records every call — table, operation,
 * payload, filters — and answers from per-`table:op` result queues, so a
 * test can assert exactly what was written and how it was scoped.
 *
 * Use from a `vi.mock` factory via dynamic import so the test file and the
 * mocked module share this one instance:
 *
 *   vi.mock("@/lib/supabase/server", async () => {
 *     const { fakeClient } = await import("@/test/fake-supabase");
 *     return { createSupabaseServerComponentClient: async () => fakeClient() };
 *   });
 */

export type FakeOp = "select" | "update" | "insert" | "delete";

export interface FakeCall {
  table: string;
  op: FakeOp;
  columns?: string;
  payload?: unknown;
  filters: Array<[string, ...unknown[]]>;
}

export interface FakeResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

interface FakeState {
  user: { id: string } | null;
  claims: Record<string, unknown>;
  results: Map<string, FakeResult[]>;
  calls: FakeCall[];
  rpcCalls: Array<{ fn: string; args: unknown }>;
}

export const fake: FakeState & {
  reset(): void;
  signInAs(claims: Record<string, unknown>): void;
  queue(key: string, ...results: FakeResult[]): void;
  callsTo(table: string, op?: FakeOp): FakeCall[];
} = {
  user: null,
  claims: {},
  results: new Map(),
  calls: [],
  rpcCalls: [],
  reset() {
    this.user = null;
    this.claims = {};
    this.results = new Map();
    this.calls = [];
    this.rpcCalls = [];
  },
  signInAs(claims) {
    this.user = { id: "u1" };
    this.claims = claims;
  },
  /** `key` is `"table:op"` (e.g. `"tenants:update"`) or `"rpc:fn_name"`. */
  queue(key, ...results) {
    const existing = this.results.get(key) ?? [];
    this.results.set(key, [...existing, ...results]);
  },
  callsTo(table, op) {
    return this.calls.filter((c) => c.table === table && (op === undefined || c.op === op));
  },
};

function nextResult(key: string): FakeResult {
  const queue = fake.results.get(key);
  if (queue && queue.length > 0) return queue.shift() as FakeResult;
  return { data: null, error: null };
}

function builder(table: string) {
  const call: FakeCall = { table, op: "select", filters: [] };
  fake.calls.push(call);
  const b: Record<string, unknown> = {};
  b["select"] = (columns?: string) => {
    if (call.op === "select" && columns !== undefined) call.columns = columns;
    return b;
  };
  b["update"] = (payload: unknown) => {
    call.op = "update";
    call.payload = payload;
    return b;
  };
  b["insert"] = (payload: unknown) => {
    call.op = "insert";
    call.payload = payload;
    return b;
  };
  b["delete"] = () => {
    call.op = "delete";
    return b;
  };
  for (const method of ["eq", "neq", "in", "is", "order", "limit", "gte", "lte", "rangeGte"]) {
    b[method] = (...args: unknown[]) => {
      call.filters.push([method, ...args]);
      return b;
    };
  }
  b["maybeSingle"] = () => b;
  b["single"] = () => b;
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  b["then"] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(nextResult(`${table}:${call.op}`)).then(resolve, reject);
  return b;
}

export function fakeClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: fake.user } }),
      getSession: async () => ({
        data: { session: fake.user ? { access_token: "jwt" } : null },
      }),
      getClaims: async () => ({
        data: fake.user ? { claims: { app_metadata: fake.claims } } : null,
        error: null,
      }),
    },
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: unknown) => {
      fake.rpcCalls.push({ fn, args });
      return nextResult(`rpc:${fn}`);
    },
  };
}

export const OWNER = { tenant_id: "t1", role: "owner" } as const;
export const MEMBER = { tenant_id: "t1", role: "member" } as const;

export function jsonRequest(url: string, body: unknown, method = "POST"): Request {
  return new Request(`http://localhost${url}`, { method, body: JSON.stringify(body) });
}
