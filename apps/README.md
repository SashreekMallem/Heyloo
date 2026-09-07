# apps/

Empty by design. The frontend apps (`apps/web` — tenant dashboard + admin
cockpit + partner portal, `apps/marketing` — marketing site + demo-agent
widget + signup flow) are scaffolded in **T5**, once the frontend stack
decision doc merges (SYSTEM_DESIGN §3 leaves the framework choice open).
See `docs/BUILD_PLAN.md` Wave 2.

Do not add app code here ahead of T5 — the pnpm workspace already globs
`apps/*` so a new app package is picked up the moment it lands.
