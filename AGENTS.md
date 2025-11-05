# Repository Guidelines

## Project Structure & Module Organization
- Treat `ABOUT_PROJECT.md`, `IMPLEMENTATION_GUIDE.md`, `MCP_SERVERS_GUIDE.md`, and `PLATFORM_DOCUMENTATION.md` as the canonical blueprint; update them whenever flows or data contracts move.
- When code lands, adopt a layered layout: `server/` (Node/Express voice + billing APIs), `dashboard/` (React analytics apps), `supabase/` (SQL migrations, policies, seed data), and `packages/shared/` (schemas, types, utilities). Keep integrations under `server/integrations/*` to mirror the VAPI → API → Supabase → POS/Stripe pipeline described in the guides.

## Build, Test, and Development Commands
- Bootstrap dependencies with `npm install` at the repository root; keep shared tooling in root-level scripts.
- Start the voice service via `npm run dev:api` (Express + ngrok) and dashboards with `npm run dev:dashboard`; both should load environment files such as `.env.local`.
- Bring up Supabase locally using `supabase start`, apply schema changes with `supabase db push`, and reseed fixtures with `npm run db:seed`.

## Coding Style & Naming Conventions
- Standardize on TypeScript, 2-space indentation, single quotes, and explicit exports; prefer `async/await` over promise chains.
- Enforce ESLint + Prettier through `npm run lint` and `npm run format`. Name files by domain (`orders.service.ts`, `RestaurantMetricsChart.tsx`) and timestamp migrations (`20250112_supabase_rls.sql`).

## Testing Guidelines
- Exercise service logic with Jest (`npm run test:api`) against a disposable Supabase schema to validate RLS enforcement (`restaurant_id = current_setting('app.tenant_id')`).
- Test dashboards with React Testing Library + Vitest (`npm run test:ui`), covering KPI calculations and filters noted in `PLATFORM_DOCUMENTATION.md`.
- Maintain end-to-end smoke tests that replay VAPI webhook payloads and assert Stripe link creation or Supabase writes for core call scenarios.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat:`, `fix:`, `chore:`) and reference affected subsystems or migration IDs in commit bodies.
- PRs must summarize the change, include manual/automated test evidence, attach UI screenshots when dashboards change, and link to any documentation updates.
- Block merges if documentation, Supabase schema files, or MCP server configs drift from implementation; update the relevant markdown in the same PR.

## Security & Configuration Tips
- Store credentials in untracked `.env.local` files; rotate VAPI and Stripe secrets whenever integration code under `server/integrations/` changes and note rotations in the PR.
- Inspect migration diffs with `supabase db diff` before merging and confirm RLS policies are intact.
- Audit MCP server configs when adding tooling endpoints and scrub secrets from logs or payload samples.
