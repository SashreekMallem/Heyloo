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

import { API_FIXTURES, TABLE_FIXTURES } from "./fixtures";

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

/** Best-effort synthesis for a column this table has no hand-authored fixture for — never `undefined` for a requested column, so a page can't crash on a missing field, just look a bit generic. */
function synthesizeValue(column: string, index: number, table: string): unknown {
  if (column === "id") return `${table}-${index + 1}`;
  if (column.endsWith("_id")) return `${column.slice(0, -3)}-${index + 1}`;
  if (column === "status") return ["active", "pending", "completed"][index % 3];
  if (column.endsWith("_at") || column === "created_at" || column === "updated_at") {
    return new Date(Date.now() - index * 86_400_000).toISOString();
  }
  if (column.endsWith("_cents") || column === "amount") return 1500 + index * 750;
  if (
    column.startsWith("is_") ||
    column.startsWith("has_") ||
    column.endsWith("_flag") ||
    column.endsWith("_verified") ||
    column.endsWith("_enabled")
  ) {
    return index % 2 === 0;
  }
  if (column === "name" || column === "title" || column === "subject") {
    return PLACEHOLDER_NAMES[index % PLACEHOLDER_NAMES.length];
  }
  if (column === "email") return `contact${index + 1}@example.com`;
  if (column.includes("phone") || column === "e164") {
    return `+1512555${String(2000 + index).padStart(4, "0")}`;
  }
  if (column.endsWith("_url")) return null;
  if (column.endsWith("_seconds") || column === "duration") return 30 + index * 15;
  if (column === "count") return index + 1;
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

function getRows(table: string, columns: string[] | null): Record<string, unknown>[] {
  const hand = TABLE_FIXTURES[table];
  if (hand) {
    if (!columns) return hand;
    return hand.map((row) => {
      const picked: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        picked[col] = col in row ? row[col] : synthesizeValue(col, i, table);
      });
      return picked;
    });
  }
  const cols = columns ?? DEFAULT_COLUMNS;
  return Array.from({ length: SYNTHESIZED_ROW_COUNT }, (_, i) => synthesizeRow(table, cols, i));
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
      const row = getRows(table, columns)[0] ?? synthesizeRow(table, columns ?? DEFAULT_COLUMNS, 0);
      return jsonResponse(wantsSingle ? row : [row], 201);
    }
    return new Response(null, { status: 204 });
  }

  const rows = getRows(table, columns);

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
  if (method !== "GET" && method !== "HEAD") return jsonResponse({ ok: true });
  const exact = API_FIXTURES[url.pathname];
  if (exact !== undefined) return jsonResponse(exact);
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
