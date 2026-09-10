/**
 * The core of UI Preview Mode's "no network" guarantee
 * (docs/DESIGN_SYSTEM.md §UI Preview Mode,
 * apps/web/src/lib/preview/README.md). Isomorphic — no `server-only`
 * import — because it has to patch `globalThis.fetch` in BOTH runtimes:
 * once on the server (real page/layout Server Components construct a real
 * `@supabase/ssr` client via the three `requireXSession` mocks in
 * `./mocks/`, whose underlying PostgREST/GoTrue HTTP calls need
 * intercepting) and once in the browser (client components like the
 * tenant dashboard's `bookings` page call `supabaseBrowserClient`
 * directly, and admin/partner pages' `useAdminQuery`/`usePartnerQuery`
 * hooks `fetch()` this app's own `/api/**` routes).
 *
 * Why intercept `fetch` rather than alias the Supabase client modules
 * themselves: `@supabase/ssr`'s server client resolves its session from
 * request cookies BEFORE making any network call — with no real login
 * cookie present (which is the whole point of preview mode), the SDK
 * returns "no session" locally and never calls `fetch` at all, so a
 * fetch-only mock could never fake a *logged-in* auth state. The 3 tiny
 * `requireXSession` replacements under `./mocks/` solve that half (they
 * hand back fixture user/claims/tenant objects directly, no SDK auth call
 * involved) while still constructing a REAL Supabase client for the
 * `supabase` value they return — every ordinary data query that real
 * client goes on to make (`.from("bookings").select(...)`, etc.) always
 * does issue a real `fetch()` regardless of session state, and THAT is
 * what this module intercepts.
 *
 * Only Supabase REST/Auth/Storage endpoints and this app's own `/api/**`
 * routes are touched — anything else (most importantly Next.js's own RSC
 * navigation fetches, which would otherwise silently break client-side
 * routing between `/preview/*` pages) passes straight through to the real
 * `fetch`.
 */

import { API_FIXTURE_MATCHERS, API_FIXTURES, TABLE_FIXTURES } from "./fixtures";

const SUPABASE_PATH_MARKERS = ["/rest/v1/", "/auth/v1/", "/storage/v1/"];

function isSupabasePath(pathname: string): boolean {
  return SUPABASE_PATH_MARKERS.some((marker) => pathname.includes(marker));
}

function isAppApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

const PLACEHOLDER_NAMES = [
  "Alex Morgan",
  "Jordan Lee",
  "Taylor Reed",
  "Casey Brooks",
  "Riley Chen",
  "Morgan Ellis",
];

// Columns known to be a jsonb ARRAY on the real schema but with no
// hand-authored fixture on every table that has them — the generic
// fallback below must hand these back as `[]`, never a string, or any
// page that does `column.map(...)` on an unlisted table crashes exactly
// like `hours_exceptions` did (round-3 tenant design review, blocker).
const KNOWN_ARRAY_COLUMNS = new Set([
  "hours_exceptions",
  "transcript",
  "state_trace",
  "items",
  "allergies",
  "extracted_entities",
]);

/** Best-effort synthesis for a column this table has no hand-authored fixture for — never `undefined` for a requested column, so a page can't crash on a missing field, just look a bit generic. */
function synthesizeValue(column: string, index: number, table: string): unknown {
  if (column === "id") return `${table}-${index + 1}`;
  if (column.endsWith("_id")) return `${column.slice(0, -3)}-${index + 1}`;
  if (column === "status") return ["active", "pending", "completed"][index % 3];
  if (column.endsWith("_at") || column === "created_at" || column === "updated_at") {
    return new Date(Date.now() - index * 86_400_000).toISOString();
  }
  // A bare `date` column (Postgres `date`, not `timestamptz`) is compared
  // against `YYYY-MM-DD` strings (`.gte("date", ...)`, `row.date === today`)
  // by real callers (usage_daily) — a generic "Sample date" string never
  // matches those comparisons and silently zeroes out anything derived
  // from it, so give it a real calendar date instead.
  if (column === "date") {
    return new Date(Date.now() - index * 86_400_000).toISOString().slice(0, 10);
  }
  if (KNOWN_ARRAY_COLUMNS.has(column)) return [];
  if (column.endsWith("_cents") || column === "amount") return 1500 + index * 750;
  if (
    column.startsWith("is_") ||
    column.startsWith("has_") ||
    column.endsWith("_flag") ||
    column.endsWith("_verified") ||
    column.endsWith("_enabled") ||
    column.endsWith("_opt_out") ||
    column === "handled"
  ) {
    return index % 2 === 0;
  }
  if (column === "name" || column === "title" || column === "subject") {
    return PLACEHOLDER_NAMES[index % PLACEHOLDER_NAMES.length];
  }
  if (column === "email") return `contact${index + 1}@example.com`;
  if (
    column.includes("phone") ||
    column === "e164" ||
    column === "from_e164" ||
    column === "to_e164" ||
    column === "recipient" ||
    column === "transfer_number"
  ) {
    return `+1512555${String(2000 + index).padStart(4, "0")}`;
  }
  if (column.endsWith("_url")) return null;
  if (column.endsWith("_seconds") || column === "duration") return 30 + index * 15;
  // Any other `*_minutes` / `*_calls` / `*_bookings` count-ish column —
  // real callers do arithmetic (`Number(r.x ?? 0)`, sums, comparisons) on
  // these, so a generic string silently coerces to `NaN`/0 everywhere
  // instead of throwing, which is a much harder bug to notice than a
  // crash (this is what left the Overview trend chart and Billing's usage
  // meter looking blank, round-3 tenant design review, medium/low).
  if (
    column.endsWith("_minutes") ||
    column.endsWith("_calls") ||
    column.endsWith("_bookings") ||
    column === "count"
  ) {
    return index + 1;
  }
  return `Sample ${column.replace(/_/g, " ")}`;
}

function synthesizeRow(table: string, columns: string[], index: number): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of columns) row[column] = synthesizeValue(column, index, table);
  return row;
}

const DEFAULT_COLUMNS = ["id", "name", "status", "created_at"];
const SYNTHESIZED_ROW_COUNT = 4;

function parseSelectColumns(selectParam: string | null): string[] | null {
  if (!selectParam || selectParam === "*") return null;
  return selectParam
    .split(",")
    .map((part) => part.trim().split(":").pop()?.split("(")[0]?.trim() ?? "")
    .filter(Boolean);
}

const RESERVED_QUERY_PARAMS = new Set([
  "select",
  "order",
  "limit",
  "offset",
  "apikey",
  "columns",
  "on_conflict",
]);

/**
 * Best-effort PostgREST filter application (`column=eq.value`,
 * `column=in.(a,b)`, `column=neq.value`, `column=is.null`) — real fixture
 * rows have real, matchable column values (e.g. `tenant_id` scoping), so
 * honoring these narrows a list down correctly instead of always handing
 * back the whole table.
 *
 * The one deliberate exception is `id`: every dynamic preview route
 * (`/preview/dashboard/calls/[id]` etc., see `routes.ts`) uses the literal
 * placeholder id `"demo"`, which never matches a real fixture row. A
 * `.single()`/`.maybeSingle()` call on an `id=eq.demo` filter that matched
 * zero rows would otherwise correctly resolve to "not found" — accurate
 * for a real id, but not what a design review of a detail PAGE wants to
 * see. So an `eq` filter on `id` that matches nothing is dropped rather
 * than applied (the row set falls back to whatever the OTHER filters
 * already narrowed it to, e.g. `tenant_id`), and the caller then caps the
 * result to one row so `.maybeSingle()`'s client-side cardinality check
 * (`isMaybeSingle` in `@supabase/postgrest-js`, which rejects >1 rows with
 * PGRST116/406 rather than the `Accept` header trick `.single()` uses)
 * never sees more than one row for what both callers intend as a
 * single-record lookup.
 */
function applyFilters(
  rows: Record<string, unknown>[],
  searchParams: URLSearchParams,
): { rows: Record<string, unknown>[]; idFilterDropped: boolean } {
  let filtered = rows;
  let idFilterDropped = false;
  for (const [key, raw] of searchParams.entries()) {
    if (RESERVED_QUERY_PARAMS.has(key)) continue;
    const match = raw.match(/^(eq|neq|in|is)\.(.*)$/);
    if (!match) continue;
    const [, op, value] = match;
    if (op === "eq") {
      const decoded = decodeURIComponent(value ?? "");
      const next = filtered.filter((row) => String(row[key]) === decoded);
      if (next.length === 0 && key === "id") {
        idFilterDropped = true;
        continue;
      }
      filtered = next;
    } else if (op === "neq") {
      const decoded = decodeURIComponent(value ?? "");
      filtered = filtered.filter((row) => String(row[key]) !== decoded);
    } else if (op === "in") {
      const values = (value ?? "")
        .replace(/^\(|\)$/g, "")
        .split(",")
        .filter(Boolean)
        .map((v) => decodeURIComponent(v.replace(/^"|"$/g, "")));
      filtered = filtered.filter((row) => values.includes(String(row[key])));
    } else if (op === "is" && value === "null") {
      filtered = filtered.filter((row) => row[key] === null || row[key] === undefined);
    }
  }
  if (idFilterDropped && filtered.length > 1) filtered = filtered.slice(0, 1);
  return { rows: filtered, idFilterDropped };
}

function getRows(
  table: string,
  columns: string[] | null,
  searchParams: URLSearchParams,
): Record<string, unknown>[] {
  const hand = TABLE_FIXTURES[table];
  const base =
    hand ??
    Array.from({ length: SYNTHESIZED_ROW_COUNT }, (_, i) =>
      synthesizeRow(table, columns ?? DEFAULT_COLUMNS, i),
    );
  const { rows: filtered } = applyFilters(base, searchParams);

  if (!columns) return filtered;
  return filtered.map((row, i) => {
    const picked: Record<string, unknown> = {};
    columns.forEach((col) => {
      picked[col] = col in row ? row[col] : synthesizeValue(col, i, table);
    });
    return picked;
  });
}

function mockSupabaseResponse(url: URL, method: string, headers: Headers): Response {
  if (url.pathname.includes("/auth/v1/")) {
    return jsonResponse({
      id: "preview-user",
      aud: "authenticated",
      email: "preview@heyloo.example",
      app_metadata: {},
      user_metadata: {},
    });
  }

  const match = url.pathname.match(/\/rest\/v1\/([^/?]+)/);
  const table = match?.[1] ? decodeURIComponent(match[1]) : "unknown";
  const accept = headers.get("accept") ?? "";
  const wantsSingle = accept.includes("vnd.pgrst.object+json");
  const prefer = headers.get("prefer") ?? "";
  const columns = parseSelectColumns(url.searchParams.get("select"));

  if (method !== "GET" && method !== "HEAD") {
    if (prefer.includes("return=representation")) {
      const row =
        getRows(table, columns, url.searchParams)[0] ??
        synthesizeRow(table, columns ?? DEFAULT_COLUMNS, 0);
      return jsonResponse(wantsSingle ? row : [row], 201);
    }
    return new Response(null, { status: 204 });
  }

  const rows = getRows(table, columns, url.searchParams);

  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` },
    });
  }

  const body = wantsSingle ? (rows[0] ?? null) : rows;
  const extra = prefer.includes("count=exact")
    ? { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }
    : undefined;
  return jsonResponse(body, 200, extra);
}

function mockAppApiResponse(url: URL, method: string): Response {
  if (method === "GET" || method === "HEAD") {
    const exact = API_FIXTURES[url.pathname];
    if (exact !== undefined) return jsonResponse(exact);
  }
  // Dynamic `[id]` (and other non-exact-match) routes, and non-GET
  // endpoints like the tenant refer-link POST — checked for every method,
  // since `API_FIXTURES` above only ever answers a fixed-pathname GET.
  for (const matcher of API_FIXTURE_MATCHERS) {
    if (matcher.method !== "*" && matcher.method !== method) continue;
    const match = url.pathname.match(matcher.pattern);
    if (match) return jsonResponse(matcher.build(match));
  }
  if (method !== "GET" && method !== "HEAD") return jsonResponse({ ok: true });
  // Generic, non-crashing default — most tenant/admin list endpoints
  // render an `EmptyState` off an empty `rows`/list array rather than
  // throwing, so an unmapped endpoint still screenshots cleanly.
  return jsonResponse({ rows: [] });
}

declare global {
  var __heylooPreviewFetchInstalled: boolean | undefined;
}

/**
 * Idempotent — safe to call from both the server bootstrap
 * (`install-server.ts`) and the client bootstrap
 * (`preview-client-bootstrap.tsx`); the second call on a given
 * `globalThis` is a no-op.
 */
export function installPreviewFetchMock(): void {
  if (typeof globalThis.fetch !== "function") return;
  if (globalThis.__heylooPreviewFetchInstalled) return;
  globalThis.__heylooPreviewFetchInstalled = true;

  const realFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const isRequestObject = typeof Request !== "undefined" && input instanceof Request;
    const rawUrl = isRequestObject ? (input as Request).url : String(input);
    let url: URL;
    try {
      const base =
        typeof globalThis.location !== "undefined"
          ? globalThis.location.origin
          : "http://preview.local";
      url = new URL(rawUrl, base);
    } catch {
      return realFetch(input as RequestInfo, init);
    }

    const method = (
      init?.method ??
      (isRequestObject ? (input as Request).method : undefined) ??
      "GET"
    ).toUpperCase();
    const headers = new Headers(
      init?.headers ?? (isRequestObject ? (input as Request).headers : undefined),
    );

    if (isSupabasePath(url.pathname)) return mockSupabaseResponse(url, method, headers);
    if (isAppApiPath(url.pathname)) return mockAppApiResponse(url, method);
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
}
