# Design Requests

Cross-cluster asks surfaced during a design-system pass, for the cluster
that owns the target path to pick up — not actioned here because it's
outside the requesting cluster's OWNERSHIP.

## From cluster TENANT (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

**Target**: `apps/web/src/components/marketing/live-call-hero.tsx` line 63
(cluster: marketing/hero, not TENANT — file is under
`apps/web/src/components/marketing/**`).

**Problem**: `tsc -b` fails with 3 errors (`TS2339: Property 'turns' does
not exist on type '{ turns: number; tool: boolean; booking: boolean; } |
undefined'`, same for `tool`/`booking`) at:

```ts
const { turns, tool, booking } = FRAMES[frame] ?? FRAMES[0];
```

Root cause: with `noUncheckedIndexedAccess` (this repo's strict tsconfig),
`FRAMES[frame]` and `FRAMES[0]` both type as `{...} | undefined` — the `??`
fallback doesn't narrow away `undefined` because the fallback expression
itself is also an indexed access typed as possibly-undefined, so the whole
expression stays `{...} | undefined` and the destructure fails.

**Exact change requested**: give the fallback a concrete, non-optional
type, e.g.:

```ts
const DEFAULT_FRAME = FRAMES[0] as (typeof FRAMES)[number];
// ...
const { turns, tool, booking } = FRAMES[frame] ?? DEFAULT_FRAME;
```

(or equivalently `FRAMES[frame] ?? FRAMES[0]!` with a comment — either
works; the first avoids a bare non-null assertion).

**Impact while unresolved**: this was a pre-existing failure (confirmed
present before this session's TENANT-cluster changes, and reproduced
again after them via a clean `tsc -b`) that blocked `next build --webpack`
for the **whole app** — `Running TypeScript ... Failed to type check.` —
which in turn blocked this session from doing a `pnpm build &&
UI_PREVIEW_MODE=1 pnpm start` screenshot verification pass at 390/768/
1024/1440 of the tenant dashboard redesign (`docs/BUILD_NOTES.md`,
Cluster TENANT entry).

**Status: resolved** — fixed independently by the owning marketing-cluster
agent later in this same session (on this shared working tree); `tsc -b`
is clean repo-wide as of the Cluster TENANT `docs/BUILD_NOTES.md` entry.
Left here for the record rather than deleted. A *different*,
still-unresolved marketing-cluster issue turned up once TS was clean —
`next build --webpack` now compiles and typechecks but fails prerendering
`/en` with `Error: Event handlers cannot be passed to Client Component
props` on `/[locale]/(marketing)/page` — also not TENANT's or DS's to
fix, noted in `docs/BUILD_NOTES.md`'s Cluster TENANT entry rather than
re-filed as a second formal request here since it's the same owning
cluster.

## From cluster MARKETING (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

**Target**: `packages/ui/src/custom/call-feed-item.tsx` (cluster: DS —
`packages/ui/**` is out of MARKETING's ownership).

**Problem**: `CallFeedItem` attaches its own `onClick` handler internally
(`<button type="button" onClick={() => onClick?.(call)}>`) but the file
has no `"use client"` directive. This is exactly the "Event handlers
cannot be passed to Client Component props" prerender failure the TENANT
entry above flagged as unresolved and attributed to marketing — it
wasn't: the actual root cause is this component being a Server Component
that defines an event handler on a host element. Reproduced by adding
`<CallFeedItem>` (this cluster's `dashboard-preview.tsx`, a Server
Component used from the RSC home page) — `next build --webpack` failed
prerendering `/en` with exactly that error, digest `1484207981`, pointing
at a `{type: "button", onClick: function onClick, ...}` prop set.

**Exact change requested**: add `"use client";` as the first line of
`packages/ui/src/custom/call-feed-item.tsx`. Any other `@heyloo/ui`
custom component that defines its own DOM event handler without a
`"use client"` directive has the same latent bug — worth a quick grep
(`onClick=\{.*=>` / `onChange=\{.*=>` etc. across files missing the
directive) rather than a one-off fix.

**Workaround applied here**: `apps/web/src/components/marketing/
dashboard-preview.tsx` (owned by this cluster) now starts with
`"use client"` itself, which resolves the crash for this call site only —
`pnpm build --webpack` is green repo-wide as of this session's MARKETING
`docs/BUILD_NOTES.md` entry. Any other Server Component that renders
`<CallFeedItem>` elsewhere in the app hits the same crash until the
component itself is fixed.

**Status: resolved** (DS pass, 2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)
— added `"use client";` to `call-feed-item.tsx`. Took the "worth a quick
grep" suggestion: `grep -L '"use client"' packages/ui/src/custom/*.tsx`
piped through a search for `on[A-Z]\w*=\{` turned up 5 more files with the
same latent bug (an event handler attached directly to a host element,
no directive) — `alert-rule-row.tsx`, `connection-lifecycle-card.tsx`,
`manual-mode-banner.tsx`, `reply-feed-item.tsx`, `state-trace-viewer.tsx`
— all 6 fixed the same way. `packages/ui/src/primitives/command.tsx`'s
`onOpenChange={onOpenChange}` was the only other match and needed no
change: it's passed to `<Dialog>`, itself a Client Component, not a host
element — not the pattern this bug is about. Verified: `pnpm -w
typecheck` clean; `@heyloo/ui` and `@heyloo/web` vitest suites green
(23/23, 238/238); `next build --webpack` prerenders `/en` (and every
other route) successfully — `● /en` in the route manifest, no "Event
handlers cannot be passed to Client Component props" anywhere in the
build log.

## From cluster ADMIN/PARTNER (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

**Target**: `apps/web/src/lib/preview/mock-fetch.ts` /
`apps/web/src/lib/preview/fixtures.ts` (cluster: DS — `src/lib/preview/**`
is out of ADMIN/PARTNER's ownership).

**Problem**: verifying this cluster's restyle with `UI_PREVIEW_MODE=1
next dev -p 3130`, every admin cockpit page driven by `useAdminQuery`
(`fetch('/api/admin/${path}')`, a real client-side `fetch` in a `"use
client"` hook) resolves to a real network 401 from the actual dev server,
not a mocked fixture — confirmed via `page.on("console")`: `Failed to
load resource: the server responded with a status of 401`. This is
surprising because `/api/admin/admin-tenants` **is** a mapped key in
`API_FIXTURES` (`fixtures.ts` line 341) — the fixture exists, but the
request never reaches the mock at all (a mocked response can't itself
produce a real "server responded with 401" console entry, since a client-
side `fetch` patch never leaves the browser). `DataState` then correctly
renders its own real error state (`admin_query_failed:401` + a working
Retry button) — that part is right; the bug is upstream, in the mock not
being installed/hit for this call path. Reproduced on `/en/preview/
cockpit/tenants` and `/en/preview/cockpit/margin/waterfall` (both
untouched-in-substance by this cluster beyond JSX/markup — no change to
either page's `useAdminQuery` call, query key, or fetch path), so this
predates this cluster's pass and isn't caused by it. Also reproduced the
same `TypeError: ...react.js.createContext is not a function` 500 on an
RSC page this cluster never touched (`/en/preview/dashboard/billing`,
TENANT-owned) — a second, likely-unrelated dev-server/Turbopack RSC
vendoring issue in this sandbox, also worth DS's attention if it recurs
outside this environment.

**Exact change requested**: investigate why `installPreviewFetchMock`'s
patched `fetch` isn't intercepting `/api/admin/**` client-side calls (client
bootstrap install order vs. `useAdminQuery`'s first call; a URL-shape
mismatch between what `mock-fetch.ts` matches and the absolute URL a
browser `fetch('/api/admin/...')` actually sends downstream if a
prior fetch/polyfill already resolved it to an absolute origin URL before
the mock's own matcher runs). No fix attempted here — outside this
cluster's ownership and typecheck/vitest (the actual required gates for
this pass) are unaffected and green.

**Status: resolved** (DS pass, 2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)
— root cause was neither install order nor a URL-shape mismatch: it's
that `UI_PREVIEW_MODE` (no `NEXT_PUBLIC_` prefix) is a server-only env
var by design, so `isPreviewModeEnabled()` — called from the `"use
client"` bootstrap (`preview-client-bootstrap.tsx`) that decides whether
to call `installPreviewFetchMock()` — always evaluated `false` in the
browser bundle (the var is compiled away, not just unset), so the
client-side mock was silently never installed. The server-side mock
*was* installed correctly (via `install-server.ts`, real `process.env`),
which is why this looked selective — RSC/server-fetched data rendered
fine while `"use client"` hooks like `useAdminQuery` hit real, unmocked
network.

Fix: `next.config.ts` now also sets `env: { NEXT_PUBLIC_UI_PREVIEW_MODE:
previewModeActive ? "1" : "0" }` — mirroring the *already*
NODE_ENV-gated boolean, so a production build always inlines `"0"`
regardless of any env var set at runtime, same floor as before. `guard.ts`'s
`isPreviewModeEnabled()` now accepts either `UI_PREVIEW_MODE === "1"`
(server) or `NEXT_PUBLIC_UI_PREVIEW_MODE === "1"` (client-inlined).
`src/types/env.d.ts` gained both as typed `ProcessEnv` properties (the
repo's `noPropertyAccessFromIndexSignature` + Next's requirement that
`NEXT_PUBLIC_*` inlining sees literal dot-notation both need this).

The second issue reproduced in the same report (`TypeError:
...react.js.createContext is not a function` under `next dev`/Turbopack)
is the pre-existing, already-documented Turbopack-dev-mode sandbox issue
from this same DS pass's own `docs/BUILD_NOTES.md` entry, not something
this fix touches — reproduces on completely unrelated pages too, and
`next build --webpack` + `next start` (the actually-supported combo,
`(preview)/layout.tsx`'s doc comment on the config) doesn't hit it.

Verified: `pnpm -w typecheck` clean; `guard.test.ts` (all 5 cases,
unchanged expectations) and `layout.test.tsx` green; `@heyloo/web`
vitest suite green (238/238); `next build --webpack` succeeds end to
end with `UI_PREVIEW_MODE` unset (prod-shaped build — confirms the
`env` mirror doesn't turn preview mode on by accident when nobody
opts in).

## From cluster repair:admin-partner (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

**Target**: `apps/web/src/lib/preview/README.md` (cluster: DS/UI-Preview-Mode
infra, not admin-partner — file is under `apps/web/src/lib/preview/**`).

**Problem**: a design-review pass found `/portal/disclosure` unreachable in
UI Preview Mode — the preview mirror re-exports the real
`(partner)/portal/disclosure/page.tsx` unmodified, and that page's own
`requirePartnerSession` + `if (acknowledged) redirect("/portal")` logic
always finds the preview session "acknowledged" (mocked truthy), so it
immediately bounces to the real, non-preview `/portal` path, which then
hits real middleware and redirects to `/login`. The actual FTC disclosure
screen can't be reviewed via the preview route despite the README implying
every partner route is directly reachable there.

**Requested change**: add a line to the "Known, documented limitations"
section (`apps/web/src/lib/preview/README.md` §~99) noting that
`/preview/portal/disclosure` is not independently reachable while the
preview partner session mocks `acknowledged: true`, and that reviewing the
disclosure gate itself currently requires a real (non-preview) partner
session. (Alternative, if this cluster would rather fix it instead of
documenting it: special-case the preview mock so `acknowledged` starts
`false` for that one route, or have the preview mirror render
`DisclosureGateClient` directly instead of re-exporting the real
guarded page.) Not actioned here — `(partner)/**` in this cluster's
ownership does not include `lib/preview/**`.

**Also flagged, not actioned (token-level, packages/ui/src/theme/globals.css
is shared design-system state, high blast radius)**: an axe color-contrast
scan on the dev-only "UI Preview Mode" banner (`apps/web/src/app/[locale]/
(preview)/layout.tsx` line ~25, `text-warning` on `bg-warning/10`) came back
failing. The reviewer marked this minor/dev-chrome-only, but noted the same
`text-warning`-on-`bg-warning/10` pattern also appears in
`(tenant)/layout.tsx` line 57 (manual-mode banner, TENANT cluster
ownership) and could recur elsewhere. Recommend whichever cluster owns
`packages/ui/src/theme/globals.css`'s `--warning`/`--warning-foreground`
pair (or the two call sites directly) re-check contrast for text laid
directly over a 10%-opacity warning fill, since the badge-level
`bg-warning`/`text-warning-foreground` pair (solid fill) reads as
intentionally contrast-paired and is not the same combination.

## From cluster repair:admin-partner (round 2, 2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

**Target**: `apps/web/src/lib/preview/fixtures.ts` (`support_requests` fixture
rows, ~line 248) — cluster: DS/UI-Preview-Mode infra, not admin-partner
(`lib/preview/**` is outside this cluster's ownership, same boundary noted
above).

**Problem**: reviewer flagged `/cockpit/support` showing a blank "Tenant"
column for every row in preview. Code-level cause fixed in this pass
(`formatDateOrDash` guard on "Last updated" — `Invalid Date` no longer
renders). The blank Tenant column is a separate, fixture-data-only issue:
`TABLE_FIXTURES.support_requests` rows only set `id`, `tenant_id`, `subject`,
`status`, `created_at` — there is no `tenant_name`, `priority`, or
`updated_at` field, so `TicketRow`'s `tenant_name`/`priority`/`updated_at`
columns render empty/blank for every preview row even after the code fix.

**Requested change**: add `tenant_name`, `priority`, and `updated_at` to
each `support_requests` fixture row so the admin support queue preview
reads as populated data instead of blank columns. Not actioned here per
the `lib/preview/**` ownership boundary.

## From cluster repair:tenant (2026-09-10, session_012xvcAnjqsMbPqitErDJQbR)

**Target**: `apps/web/src/lib/preview/mock-fetch.ts` (`getRows()`, ~line
115) and `apps/web/src/lib/preview/fixtures.ts` (`API_FIXTURES`, ~line 340)
— cluster: DS/UI-Preview-Mode infra, not tenant (`lib/preview/**` is
outside this cluster's ownership, same boundary noted in the two entries
above).

**Problem**: a design-review pass against `UI_PREVIEW_MODE=1` reported the
tenant home dashboard, Team, Delivery, Integrations, and Agent > Hours all
crashing to a client-side error boundary, and the 4 record-detail routes
(Calls/Customers/Orders/Support detail) hard-404ing. Root causes, confirmed
by re-reading the current source (not independently re-screenshotted — no
scratch harness was built for this pass):
(a) `getRows()` never applies the request URL's PostgREST filter params
(`?id=eq.<uuid>`, `?tenant_id=eq.<uuid>`, etc.) — it always returns every
row for the table, so any client call that does
`.eq(...).maybeSingle()`/`.single()` for one record by id gets the full
unfiltered table back instead of the one matching row, which is what
produces the "multiple rows" failure the record-detail pages treat as
not-found.
(b) Several `/api/tenant/**` endpoints these routes call client-side via
`useQuery`/`useTenantQuery` have no entry in `API_FIXTURES`
(`/api/tenant/setup-progress`, `/api/tenant/team`,
`/api/tenant/delivery/airtable/status`, `/api/tenant/integrations`,
`/api/tenant/refer/ensure-link` were named in the review) and so fall back
to the generic `{ rows: [] }` shape, which doesn't match what those pages
destructure (e.g. `setup-progress`'s `{ steps, requiredDone, requiredTotal,
complete }`), producing the uncaught `TypeError`s the review attributed to
those pages.

**Requested change**: (a) in `getRows()`, parse and apply the request URL's
`eq.`/`in.` filter params against `TABLE_FIXTURES[table]` before slicing to
`rows[0]` for a `maybeSingle()`/`single()` call, so a by-id lookup returns
the matching fixture row (or none) instead of the whole table. (b) add
hand-authored `API_FIXTURES` entries (matching each route's real response
shape) for `/api/tenant/setup-progress`, `/api/tenant/team`,
`/api/tenant/delivery/airtable/status`, `/api/tenant/integrations`, and
`/api/tenant/refer/ensure-link`. Not actioned here per the `lib/preview/**`
ownership boundary — this pass's own `apps/web` typecheck/test gates don't
cover the preview harness either way, so landing this is purely for the
next design-review pass's benefit.
