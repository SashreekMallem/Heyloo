# UI Preview Mode

Cluster **DS**. See `docs/DESIGN_SYSTEM.md`'s "UI Preview Mode" section
first — this file is the implementation detail behind it.

## Turning it on

```sh
UI_PREVIEW_MODE=1 pnpm --filter @heyloo/web dev
```

Then visit `http://localhost:3000/preview`. **Never** run this alongside
real usage of the same dev server (see "Why fetch, not the Supabase client
modules" below) — it's a dedicated mode, not a toggle you flip mid-session.

`UI_PREVIEW_MODE=1` alone does nothing in a production build —
`isPreviewModeEnabled()` (`guard.ts`) also requires
`NODE_ENV !== "production"`, and that condition can't be forced from the
deploy environment.

## The four pieces

1. **`guard.ts`** — `isPreviewModeEnabled()`, the runtime condition
   `(preview)/layout.tsx` checks on every request (`notFound()` otherwise).
   Independent of everything below — even if the aliasing in
   `next.config.ts` somehow shipped, this still 404s in production.

2. **`fixtures.ts`** — every piece of invented data: the fixture
   tenant/admin/partner identities `requireXSession` mocks hand back, and
   `TABLE_FIXTURES`/`API_FIXTURES` the fetch interceptor reads from.

3. **`mock-fetch.ts`** (`installPreviewFetchMock`) — patches
   `globalThis.fetch` once (idempotent) to intercept:
   - Supabase REST/Auth/Storage calls (`/rest/v1/`, `/auth/v1/`,
     `/storage/v1/` anywhere in the URL) → fixture rows from
     `TABLE_FIXTURES`, or a plausible synthesized row for any table with no
     hand-authored fixture (`synthesizeValue` — never `undefined` for a
     requested column).
   - This app's own `/api/**` routes → `API_FIXTURES[pathname]` if hand-
     mapped, else a generic non-crashing `{ rows: [] }` (renders as a real
     `EmptyState`, not a broken page).
   - Everything else (most importantly Next's own RSC navigation fetches)
     passes straight through to the real `fetch` — this mode does not
     break client-side routing between pages.

   Installed twice, deliberately: `install-server.ts` (imported first,
   `server-only`, at the top of `(preview)/layout.tsx`) for the server
   runtime, `preview-client-bootstrap.tsx` (module-scope call, `"use
   client"`) for the browser runtime. Both call the same idempotent
   function — see the code comments in `mock-fetch.ts` for exactly why
   both are needed and why a fetch-only mock can't fake a logged-in
   session by itself.

4. **`mocks/require-{tenant,admin,partner}-session.ts`** + the matching
   `next.config.ts` alias (active only under the same
   `UI_PREVIEW_MODE=1 && NODE_ENV !== "production"` condition, both
   Turbopack's `turbopack.resolveAlias` and Webpack's `resolve.alias` —
   `next dev` defaults to Turbopack in this Next version, `next build` in
   this repo runs `--webpack`). Every real `(tenant)/(admin)/(partner)`
   page and layout that calls `requireTenantSession(nextPath)` etc. keeps
   the exact same import statement — the bundler silently substitutes a
   fixture-backed replacement with an identical export signature. This is
   why real page components never need forking to run with no auth.

   **Turbopack alias value gotcha** (confirmed by running this exact
   config): give it a path relative to `next.config.ts`
   (`"./src/lib/preview/mocks/..."`) — a leading `/` is read as an
   unsupported "server-relative" import and the build fails. Webpack's
   `resolve.alias` wants the opposite: a real absolute filesystem path.
   `next.config.ts`'s `previewModeAliases(kind)` builds both forms from
   one list.

## The mirror pages

Every real page/layout under `(tenant)/dashboard/**`, `(admin)/cockpit/**`,
`(partner)/portal/**` (63 pages + the 3 root shell layouts + 1 nested
layout, 67 files total) has a one-line mirror under
`apps/web/src/app/[locale]/(preview)/preview/**`:

```ts
export { default } from "@/app/[locale]/(tenant)/dashboard/calls/page";
```

Mechanically generated (strip the `(tenant)/`/`(admin)/`/`(partner)/`
route-group prefix, prepend `(preview)/preview/`) — the 3 ROOT layouts
(`(tenant)/layout.tsx` etc., which carry no `dashboard`/`cockpit`/`portal`
segment of their own) are special-cased to
`preview/dashboard/layout.tsx` / `preview/cockpit/layout.tsx` /
`preview/portal/layout.tsx` so they scope correctly instead of colliding
with `(preview)/layout.tsx` itself. `apps/web/src/lib/preview/routes.ts`
is the generated registry `/preview` reads to render its index.

If a real page/layout moves, gets added, or is removed, regenerate the
mirrors and `routes.ts` the same way (strip-prefix + the 3 special cases)
rather than hand-editing — see the two generator scripts referenced in
this task's session notes (not checked in; they're one-off codegen, not
a build step).

## Known, documented limitations

- **Sidebar/nav links leave preview mode.** The mirrored root layouts
  reuse the real `TenantShellClient`/`AdminShellClient`/`PartnerShellClient`
  unmodified, which render real absolute hrefs (`/dashboard/calls`, not
  `/preview/dashboard/calls`) — clicking a sidebar item navigates to the
  real (auth-gated) route. Open each `/preview/**` URL directly (the
  `/preview` index page links every one) instead of navigating via the
  in-page nav.
- **Realtime**: `(tenant)/layout.tsx` wraps children in
  `TenantRealtimeProvider`, which opens a Supabase Realtime **WebSocket**
  — `mock-fetch.ts` only intercepts `fetch`, not WebSockets, so a preview
  tenant page may attempt (and fail to complete) a real websocket
  connection in the background. This degrades silently in the realtime
  client (retries, no thrown error) rather than breaking the page; fixing
  it would mean forking or aliasing `apps/web/src/lib/realtime/**`, which
  is out of this cluster's ownership. See `docs/BUILD_NOTES.md`'s DS entry.
- **Fixture fidelity is intentionally uneven.** `TABLE_FIXTURES` in
  `fixtures.ts` hand-authors the ~15 highest-traffic tables (by `.from(...)`
  call-site count across `apps/web/src`); everything else — most
  `/api/admin/**`/`/api/tenant/**` endpoints included — falls back to a
  generic, non-crashing shape (an empty list, or a synthesized-but-
  plausible row). A page that looks sparser than its real counterpart is
  very likely hitting that fallback, not a bug — extend `TABLE_FIXTURES`/
  `API_FIXTURES` for higher fidelity on a specific screen.
- **Query filters aren't honored.** Every `.eq()`/`.in()`/etc. on a
  fixture-backed table is ignored — the interceptor always returns that
  table's full fixture set (or the one matching "single" row). Fine for
  visual review, not for testing actual data logic.
