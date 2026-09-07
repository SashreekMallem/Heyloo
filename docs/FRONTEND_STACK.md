# Frontend Stack Decision (T5 build reference)

Researched Sept 2026 (sources in the research archive; verify versions
against official docs at build time per CLAUDE.md Rule 1).

## The stack (one opinionated pick)

| Area | Pick | Key reason |
|---|---|---|
| Framework | **Next.js App Router — ONE app**, route groups `(marketing)/(tenant)/(admin)/(partner)` | RSC marketing pages ship ~zero client JS (SEO/CWV); same-origin cookies make Supabase auth flow marketing→signup→dashboard cleanly; no split = one deploy pipeline for a solo founder |
| Auth | `@supabase/ssr` (`createServerClient` + middleware; `createBrowserClient` for realtime). Cookie sessions — **no tokens in localStorage** (old audit flaw #12) | auth-helpers-* is deprecated |
| Guards | Middleware + route-group layouts reading the SAME `app_metadata.role`/`tenant_id` JWT claims the backend hook sets — one auth model, not two | |
| Hosting | **Vercel Pro**, Node serverless (NOT edge runtime) for anything touching Postgres, `preferredRegion` pinned to the Supabase region | Fluid compute pricing; native Supabase branching integration (gotcha: gate preview deploys on Supabase env-sync completing — known race) |
| UI | **shadcn/ui + Tailwind v4**; charts via shadcn's first-party Recharts-based `chart` (Tremor has an unresolved Tailwind-v4 breakage — avoid); visx only if the margin waterfall needs it | |
| Forms | react-hook-form + zod (schemas shared from `packages/canonical-types`) | |
| Data | TanStack Query hydrated from server components; realtime = private tenant channel (`private: true`, RLS on realtime.messages) → broadcast handler calls `invalidateQueries` — exactly SYSTEM_DESIGN's refetch-on-event model | |
| i18n | next-intl with `[locale]` segment scaffolded day 1 (EN content; ES = gap G12 later) | |
| Lint | **ESLint flat config + Prettier** (not Biome yet: Next.js/security/testing-library plugin coverage) | |
| Tests | Vitest + Testing Library; Playwright smoke (signup→checkout, realtime dashboard, role-guard redirects, HTTP-layer cross-tenant probe). No Storybook v1 | |
| Docs site | **Mintlify** (`apps/docs`) — auto `llms.txt` + MCP server feeds the support chatbot with zero custom RAG build | Runner-up: Fumadocs (free, DIY AI-readiness) |
| Demo widget | `retell-client-js-sdk` driven from a client island; call token minted server-side in a Route Handler — Retell secret never reaches the browser | Packaged FAB widget too generic for the personalized-demo flow |
| Monitoring | `@sentry/nextjs`, same Sentry project as edge functions | |

## Directory shape (inside the monorepo T0 scaffolds)

`apps/web` (Next.js: route groups above, `src/lib/supabase/{browser,server}.ts`,
`src/lib/realtime/` tenant-channel provider, `api/` route handlers for Stripe
webhook proxy + Retell token mint, `[vertical]/page.tsx` programmatic
landing pages via generateStaticParams) · `apps/docs` (Mintlify) ·
`packages/ui` (shadcn + theme tokens incl. per-tenant branding vars) ·
`packages/canonical-types` · `packages/supabase-client` (typed factories) ·
`packages/config` (eslint/tsconfig/tailwind presets).

## CI rules that kill the old repo's sins

- `large-file-guard`: fail on any added file >1MB.
- clean-build assertion: `git status --porcelain` empty after build (no
  committed dist).
- `no-stray-js-guard`: no `.js` outside build output; `allowJs: false`,
  strict + `noUncheckedIndexedAccess`.

## Signup flow (marketing → paid)

`/signup`: business type → vertical price card (SYSTEM_DESIGN §1) → account
→ Stripe Checkout → provisioning progress screen → forwarding wizard. Demo
flow (`/demo`): business name + URL → scrape (sanitized) → personalized
agent → web-call island + demo phone number.
