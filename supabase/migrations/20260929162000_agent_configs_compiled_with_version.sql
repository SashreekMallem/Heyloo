-- SETTINGS-2 (docs/BUILD_NOTES.md): a compiler-version stamp on the published
-- agent. `_shared/provisioning/compile-and-publish.ts` writes the compiler's
-- `AGENT_COMPILER_VERSION` here every time it compiles and creates an agent;
-- the owner portal's "Changes pending" badge
-- (apps/web/src/lib/settings/publish-status.ts) flags any tenant whose value
-- is NULL (compiled before this stamp existed) or lower than the current
-- compiler version, so a compiler change that only takes effect on republish
-- (a new prompt block, tool wiring) is never invisible to the owner.
--
-- Additive and nullable on purpose: NULL means "compiled before the stamp
-- existed", which is exactly the population that needs a republish to pick up
-- the SETTINGS-2 owner-info block. No default, no backfill, no constraint
-- beyond non-negative.

alter table public.agent_configs
  add column if not exists compiled_with_version integer;

alter table public.agent_configs
  add constraint agent_configs_compiled_with_version_check
    check (compiled_with_version is null or compiled_with_version >= 0);

comment on column public.agent_configs.compiled_with_version is
  'AGENT_COMPILER_VERSION (supabase/functions/_shared/compiler/template-compiler.ts) the published agent was compiled with. NULL = compiled before this stamp existed. Written only by compile-and-publish; read by the portal publish-status badge.';
