-- Agent templates & configs. BACKEND_SPEC.md §1.3.
-- The canonical states/transitions/global_intents/tools JSON shape is
-- validated by a Zod schema in packages/canonical-types (T2), not by a
-- Postgres CHECK — jsonb columns here just hold the compiled/pre-compiled
-- payloads.

create table public.agent_templates (
  id uuid primary key default gen_random_uuid(),
  vertical text not null,
  name text not null,
  version int not null,
  compile_target text not null
    check (compile_target in ('conversation_flow','multi_prompt','single_prompt')),
  system_prompt text,
  states jsonb not null default '[]'::jsonb,
  transitions jsonb not null default '[]'::jsonb,
  global_intents jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  voice_id text not null,
  model text not null,
  disclosure_line text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint agent_templates_vertical_version_unique unique (vertical, version)
);

create index idx_agent_templates_active on public.agent_templates (vertical) where is_active;

comment on column public.agent_templates.disclosure_line is
  'Compiler-enforced constant text fragment; never tenant-editable, injected verbatim into every compiled greeting (G1/G2). The compiler (T2) refuses to publish a template whose compiled output omits this verbatim.';

create table public.agent_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  template_id uuid not null references public.agent_templates(id),
  template_version int not null,
  assistant_name text,
  special_instructions text,
  transfer_number text,
  greeting_overrides jsonb not null default '{}'::jsonb,
  dynamic_variable_overrides jsonb not null default '{}'::jsonb,
  retell_agent_id text,
  retell_llm_id text,
  compiled_config jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_configs_tenant_unique unique (tenant_id)
);

create trigger trg_agent_configs_updated_at
  before update on public.agent_configs
  for each row execute function public.fn_set_updated_at();

comment on column public.agent_configs.transfer_number is
  'E.164; tenant-config-only per G6, never caller-influenced at runtime.';
comment on column public.agent_configs.dynamic_variable_overrides is
  'Manager name/phone, parking info, accessibility notes, prep time, delivery radius/minimums, accepted payment types, plus MASTER_SPEC §3.5 per-vertical typed keys (insurances_accepted, species_treated, emergency_referral, tow_partner, vehicle_makes_serviced, practice_areas, consult_fee_cents, deposit_policy, rate_table, delivery_radius_m, min_order_cents, cancellation_policy) — validated per-vertical by a Zod schema at the application layer (T2/T5), not a DB constraint.';
