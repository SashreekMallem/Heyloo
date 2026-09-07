# Heyloo Backend Specification

Granular build spec for Layer 1 + Layer 2 backend. This document is
downstream of `docs/SYSTEM_DESIGN.md` (authoritative for architecture and
product decisions) and `docs/MASTER_PLAN.md`/`docs/BUILD_PLAN.md` (business
decisions and task waves). Where those documents already give DDL it is
reproduced verbatim below and extended to full column/index/constraint/
trigger/policy granularity. Build agents for T1 (schema), T2 (canonical
types + provider layer), T3 (voice edge functions), T4 (billing/lifecycle),
T7 (adapters), T8 (outreach), T9 (demo-agent) code against this document.

Conventions used throughout, per `CLAUDE.md`:

- Money: `_cents` integer columns (bigint where cumulative, int where
  per-row bounded), never floating point.
- Phones: `text` holding E.164 (`+15551234567`), normalized at every
  boundary (edge function input, adapter output).
- Time: `timestamptz` everywhere; `tstzrange`/`daterange` for intervals.
  Tenant-facing calendar math (business hours, slot generation) happens at
  materialization time using the tenant's IANA `timezone`, never in the hot
  path.
- IDs: `uuid primary key default gen_random_uuid()` unless noted.
- Every tenant-scoped table has `tenant_id uuid not null references
  tenants(id)`, is indexed on it, and carries an RLS policy (§2.15).
- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql`, additive only,
  never edited once applied. DDL below is grouped by domain for readability;
  actual migration files should be split per domain in the same order.
- Soft delete: tenants only (`deleted_at`); financial/audit tables are
  append-only and never deleted, only status-transitioned.
- `DECIDE:` marks a genuinely open decision with a recommendation; these are
  also listed in SYSTEM_DESIGN §15 where they overlap.

---

## 0. Extensions & schema-wide setup

```sql
create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists btree_gist;    -- GIST exclusion on scalar + range
create extension if not exists pg_cron;       -- scheduled jobs (§4)
create extension if not exists pgmq;          -- queues (§5)
create extension if not exists pg_net;        -- async HTTP from triggers/cron (outbound webhooks, alert pings)
```

`pg_cron` and `pgmq` run in the `cron`/`pgmq` schemas per Supabase defaults;
`search_path` in edge functions and functions below is never relied upon —
all references are schema-qualified.

Generic trigger function used by most tables with `updated_at`:

```sql
create or replace function public.fn_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

---

## 1. Database — domain by domain

### 1.1 Tenancy, membership, admin

#### `tenants`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| name | text | no | | display/business name |
| slug | text | no | | unique, used in demo/marketing URLs |
| vertical | text | no | | check in `('auto_repair','veterinary','legal','dental','real_estate','motel','restaurant','generic')` |
| business_type | text | yes | | free-text sub-type shown in UI, e.g. "Italian restaurant" |
| plan_code | text | no | `'standard'` | maps to price card row |
| price_version | text | no | `'v1'` | snapshot of the price-card version applied at signup; price changes never retroactively move existing tenants |
| status | text | no | `'trialing'` | check in `('trialing','active','past_due','paused','canceled')` |
| timezone | text | no | `'America/New_York'` | IANA tz name |
| business_hours | jsonb | no | `'{}'` | weekly schedule, see shape below |
| hours_exceptions | jsonb | no | `'[]'` | holiday/one-off closures & special hours (G23) |
| branding | jsonb | no | `'{}'` | logo_url, primary_color, assistant_name composes here too (denormalized copy for dashboard theming; source of truth for assistant_name is `agent_configs`) |
| language_config | jsonb | no | `'{"primary":"en","bilingual":false}'` | G12 |
| retention_days | int | no | `30` | recording/transcript retention (G3, BIPA) |
| stripe_customer_id | text | yes | | unique |
| stripe_subscription_id | text | yes | | |
| referrer_partner_id | uuid | yes | | FK `referral_partners(id)` |
| referral_link_id | uuid | yes | | FK `referral_links(id)` |
| owner_test_phone | text | yes | | E.164; calls from this number are excluded from billable usage (G13) |
| manual_mode | boolean | no | `false` | salvaged feature; tenant editing locked out of automated writes when true |
| manual_mode_enabled_at | timestamptz | yes | | |
| usage_hard_cap_minutes | int | yes | | null = no cap (G14) |
| seasonal_pause | boolean | no | `false` | G24, motels/restaurants |
| seasonal_pause_resumes_at | date | yes | | |
| deleted_at | timestamptz | yes | | soft delete only |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | |

`business_hours` shape (per day, tenant-tz local time, 24h):
```json
{
  "mon": [{"open": "08:00", "close": "18:00"}],
  "tue": [{"open": "08:00", "close": "18:00"}],
  "sun": []
}
```
`hours_exceptions` shape (array, date is tenant-tz local):
```json
[{"date": "2026-12-25", "closed": true, "note": "Christmas"},
 {"date": "2026-12-24", "hours": [{"open": "08:00", "close": "13:00"}]}]
```

Indexes: `unique (slug)`, `unique (stripe_customer_id)`, `btree (vertical)`,
`btree (status) where deleted_at is null`.

#### `memberships`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | FK `tenants(id)` |
| user_id | uuid | no | | FK `auth.users(id)` |
| role | text | no | | check in `('owner','admin','member')` |
| invited_email | text | yes | | pre-acceptance invite |
| invited_at | timestamptz | yes | | |
| accepted_at | timestamptz | yes | | |
| created_at | timestamptz | no | `now()` | |

Constraint: `unique (tenant_id, user_id)`. Index: `btree (user_id)` (JWT hook
lookup path).

#### `platform_admins`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| user_id | uuid | no | | PK, FK `auth.users(id)` |
| role | text | no | | check in `('superadmin','support','finance')` |
| aal2_required | boolean | no | `true` | enforced at edge-function layer, not RLS alone |
| created_at | timestamptz | no | `now()` | |

#### `admin_actions` (audit log, G15)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| admin_user_id | uuid | no | | FK `auth.users(id)` |
| action | text | no | | e.g. `impersonate_start`, `impersonate_end`, `tenant_edit`, `refund_issued`, `admin_password_reset`, `template_publish` |
| target_type | text | no | | `'tenant'`\|`'call'`\|`'booking'`\|`'referral'`\|`'agent_template'`\|... |
| target_id | uuid | yes | | |
| before | jsonb | yes | | prior state snapshot, where applicable |
| after | jsonb | yes | | new state snapshot |
| ip_address | inet | yes | | |
| user_agent | text | yes | | |
| created_at | timestamptz | no | `now()` | |

Append-only, no update/delete grants to anyone but `service_role`. Index:
`btree (target_type, target_id)`, `btree (admin_user_id, created_at desc)`.

---

### 1.2 Telephony

#### `phone_numbers`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | FK `tenants(id)` |
| e164 | text | no | | unique |
| twilio_sid | text | no | | unique |
| retell_number_id | text | yes | | Retell-side import id |
| forwarding_mode | text | no | `'conditional'` | check in `('conditional','full')` — owner decision default, SYSTEM_DESIGN §15.5 |
| forwarding_verified_at | timestamptz | yes | | set by the verification test-call flow (§2.9) |
| forwarding_carrier | text | yes | | carrier detected during verification, drives the per-carrier wizard copy |
| spam_label_status | text | no | `'unknown'` | check in `('unknown','clean','flagged','remediating')` (G9) |
| cnam_registered | boolean | no | `false` | G9 |
| is_primary | boolean | no | `true` | multi-number tenants (G26) may have more than one |
| released_at | timestamptz | yes | | set on port-out / offboarding (G7); number stays in the table for audit |
| created_at | timestamptz | no | `now()` | |

Indexes: `unique (e164)`, `unique (twilio_sid)`, `btree (tenant_id) where
released_at is null`.

---

### 1.3 Agent templates & configs

#### `agent_templates`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| vertical | text | no | | matches `tenants.vertical`, plus `'generic'` |
| name | text | no | | human label |
| version | int | no | | monotonic per vertical |
| compile_target | text | no | | check in `('conversation_flow','multi_prompt','single_prompt')` — SYSTEM_DESIGN §4.1 |
| system_prompt | text | yes | | used directly for `single_prompt` target; base/shared prompt fragment otherwise |
| states | jsonb | no | `'[]'` | state graph, schema below |
| transitions | jsonb | no | `'[]'` | schema below |
| global_intents | jsonb | no | `'[]'` | schema below |
| tools | jsonb | no | `'[]'` | JSON-Schema tool defs, canonical (provider-agnostic) shape |
| voice_id | text | no | | ElevenLabs voice id (portable across providers, SYSTEM_DESIGN §3) |
| model | text | no | | LLM tier id, e.g. `'gpt-4o-mini'` — margin-lever configurable per vertical (§11 cockpit) |
| disclosure_line | text | no | | compiler-enforced constant text fragment; **never tenant-editable**, injected verbatim into every compiled greeting (G1/G2) |
| is_active | boolean | no | `true` | superseded versions kept for reproducibility, not deleted |
| created_by | uuid | yes | | FK `auth.users(id)`, platform admin |
| created_at | timestamptz | no | `now()` | |

Constraint: `unique (vertical, version)`. Partial index:
`btree (vertical) where is_active`.

**Canonical template JSON schema** (the shape `states`/`transitions`/
`global_intents`/`tools` must conform to — validated by a Zod schema in
`packages/canonical-types` before insert, and by the compiler before every
Retell publish):

```ts
type StateId = string; // slug, unique within a template

interface AgentState {
  id: StateId;
  name: string;                 // human label for state_trace / debugging
  prompt_fragment: string;      // injected into the compiled prompt/node for this state
  allowed_tools: string[];      // subset of tools[].name reachable from this state
  entry_conditions?: string[];  // free-text guard notes for compiler/reviewer, not executable
  extraction?: {                // typed post-call/inline extraction fields owned by this state
    field: string;
    type: "boolean" | "text" | "number" | "enum";
    enum_values?: string[];
  }[];
  is_terminal?: boolean;
}

interface Transition {
  from: StateId;
  to: StateId;
  on: { intent?: string; predicate?: string }; // intent match and/or tool-result predicate
  priority?: number; // resolves ties when multiple transitions match
}

interface GlobalIntent {
  name: "emergency" | "human_request" | "solicitor" | string;
  reachable_from: "any" | StateId[];
  target_state: StateId;
  description: string;
}

interface CanonicalTool {
  name: string;                 // e.g. "check_availability"
  description: string;
  parameters: object;           // JSON-Schema, draft-07 subset Retell accepts
  authorization: {              // G6 — enforced at /voice/tools, not just documented here
    scope: "caller_number" | "tenant_config_only" | "none";
  };
}

interface AgentTemplate {
  vertical: string;
  compile_target: "conversation_flow" | "multi_prompt" | "single_prompt";
  system_prompt?: string;
  states: AgentState[];
  transitions: Transition[];
  global_intents: GlobalIntent[];
  tools: CanonicalTool[];
  disclosure_line: string;
}
```

The compiler (`packages/adapters/retell`, T2) lowers this into: a Retell
Conversation Flow graph (states → nodes, transitions → edges) for
`conversation_flow` targets; Retell's multi-prompt/states feature for
`multi_prompt`; or a single mega-prompt with the full tool list for
`single_prompt`. `global_intents` compile to Retell's global node/interrupt
mechanism regardless of target so the emergency/human-request/solicitor
escapes are structurally reachable, never model-discretionary (SYSTEM_DESIGN
§4.1). The compiler refuses to publish a template whose compiled output does
not contain `disclosure_line` verbatim in the first agent turn — a CI/publish
gate, not just a code-review convention.

#### `agent_configs`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | FK `tenants(id)`, unique (one active config per tenant) |
| template_id | uuid | no | | FK `agent_templates(id)` |
| template_version | int | no | | denormalized for fast diffing against template updates |
| assistant_name | text | yes | | salvaged feature; composes into disclosure: "Hi, this is {{assistant_name}}, the AI assistant for {{business}} — this call may be recorded." |
| special_instructions | text | yes | | salvaged free-text field injected as a dynamic variable |
| transfer_number | text | yes | | E.164; tenant-config-only per G6, never caller-influenced |
| greeting_overrides | jsonb | no | `'{}'` | per-state prompt overrides scoped to owner-editable fields only (never the disclosure line, never tool authorization) |
| dynamic_variable_overrides | jsonb | no | `'{}'` | manager name/phone, parking info, accessibility notes, prep time, delivery radius/minimums, accepted payment types — salvaged rich-context fields |
| retell_agent_id | text | yes | | |
| retell_llm_id | text | yes | | |
| compiled_config | jsonb | yes | | last-published compiled payload snapshot, for diffing/rollback |
| published_at | timestamptz | yes | | |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | trigger `fn_set_updated_at` |

Constraint: `unique (tenant_id)`.

---

### 1.4 Booking core

#### `offerings`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| name | text | no | | |
| category | text | yes | | vertical-specific grouping (service category, menu section, room type) |
| duration_minutes | int | yes | | null for order-line items (restaurant) |
| price_cents | int | yes | | null when priced dynamically (motel rate table lookup) |
| resource_type_required | text | yes | | matches `resources.type`, drives slot generation |
| metadata | jsonb | no | `'{}'` | allergens, vehicle service codes, room amenities, etc. |
| active | boolean | no | `true` | |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | trigger |

Index: `btree (tenant_id) where active`.

#### `resources`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| type | text | no | | `'chair'\|'room'\|'table'\|'bay'\|'staff'\|'agent'` |
| name | text | no | | |
| capacity | int | no | `1` | party-size ceiling for tables |
| active | boolean | no | `true` | |
| metadata | jsonb | no | `'{}'` | |
| created_at | timestamptz | no | `now()` | |

#### `availability_slots` (precomputed, SYSTEM_DESIGN §5)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| resource_id | uuid | no | | FK `resources(id)` |
| slot_range | tstzrange | no | | half-open `[start, end)` |
| is_available | boolean | no | `true` | flipped false by booking trigger, never deleted (audit trail of the roll-forward window) |
| source | text | no | `'generated'` | `'generated'\|'manual_block'\|'schedule_change'` |
| generated_at | timestamptz | no | `now()` | |

Indexes:
```sql
create index idx_availability_slots_range on availability_slots
  using gist (resource_id, slot_range);
create index idx_availability_slots_open on availability_slots (tenant_id, resource_id, lower(slot_range))
  where is_available;
```
Materialized 14–30 days ahead (`DECIDE:` window length per vertical —
recommend 21 days as a default, 30 for motels given multi-night lookahead),
rolled forward nightly by the availability roll-forward job (§4). Timezone
math is baked in at generation time from `tenants.timezone` +
`tenants.business_hours`/`hours_exceptions` — the hot-path read is a single
indexed `slot_range && tstzrange($1,$2)` lookup, no tz conversion.

#### `bookings`

```sql
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  resource_id uuid not null references resources(id),
  offering_id uuid references offerings(id),
  customer_id uuid references customers(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  during tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  status text not null default 'scheduled'
    check (status in ('scheduled','confirmed','checked_in','completed',
                       'no_show','cancelled','rescheduled')),
  party_size int,
  source_call_id uuid references call_logs(id),
  idempotency_key text,
  notes text,
  structured_payload jsonb not null default '{}',
  cancel_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_idempotency_unique unique (tenant_id, idempotency_key),
  exclude using gist (resource_id with =, during with &&)
    where (status = 'confirmed')
);
create index idx_bookings_tenant_time on bookings (tenant_id, start_at);
create index idx_bookings_customer on bookings (customer_id);
create trigger trg_bookings_updated_at before update on bookings
  for each row execute function fn_set_updated_at();
```

`idempotency_key` = `call_id || ':' || slot_start_iso` by convention
(SYSTEM_DESIGN §5): a Retell tool-call retry with the same key returns the
existing row via `ON CONFLICT DO NOTHING RETURNING *` / a pre-check, never a
duplicate. The exclusion constraint is scoped to `status = 'confirmed'` so
`scheduled` holds (if ever used) don't block each other, and so a
`cancelled` booking never blocks the slot it freed.

#### `orders` (restaurant/POS specialization)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| customer_id | uuid | yes | | |
| items | jsonb | no | | `[{offering_id, name, qty, unit_price_cents, modifiers[]}]` |
| fulfillment_type | text | no | | `'pickup'\|'delivery'\|'dine_in'` |
| delivery_address | jsonb | yes | | |
| subtotal_cents | int | no | | |
| tax_cents | int | no | `0` | |
| tip_cents | int | no | `0` | |
| total_cents | int | no | | |
| status | text | no | `'received'` | `'received'\|'confirmed'\|'preparing'\|'ready'\|'completed'\|'cancelled'` |
| source_call_id | uuid | yes | | FK `call_logs(id)` |
| pos_order_id | text | yes | | external adapter id, set post-push |
| idempotency_key | text | no | | |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | trigger |

Constraint: `unique (tenant_id, idempotency_key)`.

#### `customers`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| phone_e164 | text | no | | |
| name | text | yes | | |
| email | text | yes | | |
| segment | text | no | `'new'` | `'new'\|'returning'\|'loyal'\|'vip'` — salvaged feature, recomputed by `fn_recompute_customer_segment` |
| lifetime_value_cents | int | no | `0` | |
| lifetime_bookings | int | no | `0` | |
| lifetime_calls | int | no | `0` | |
| first_seen_at | timestamptz | no | `now()` | |
| last_seen_at | timestamptz | no | `now()` | |
| metadata | jsonb | no | `'{}'` | vertical-specific: pets array (vet), vehicles array (auto), addresses (delivery) |
| created_at | timestamptz | no | `now()` | |

Constraint: `unique (tenant_id, phone_e164)` — the E.164-normalized lookup
index SYSTEM_DESIGN §5 requires for zero-scan customer lookup.

---

### 1.5 Calls & messaging

#### `call_logs`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| phone_number_id | uuid | yes | | FK `phone_numbers(id)` |
| retell_call_id | text | no | | unique |
| caller_number | text | yes | | E.164, null if withheld |
| direction | text | no | `'inbound'` | `'inbound'\|'outbound'` (outbound reserved for future callback flows) |
| started_at | timestamptz | yes | | |
| ended_at | timestamptz | yes | | |
| duration_seconds | int | yes | | |
| disconnection_reason | text | yes | | verbatim from provider |
| classification | text | yes | | 12-enum, see below; set by post-call analysis, may be null until `call_analyzed` |
| outcome | text | yes | | free-text/short-enum outcome detail |
| sentiment | text | yes | | `'positive'\|'neutral'\|'negative'` |
| call_successful | boolean | yes | | |
| call_summary | text | yes | | |
| follow_up_needed | boolean | no | `false` | |
| urgency_flag | boolean | no | `false` | **set in-call on red-flag detection, never waiting for post-call** (SYSTEM_DESIGN §4.4) |
| message_text | text | yes | | after-hours / take-message content |
| structured_booking_payload | jsonb | yes | | vertical schema, authoritative copy is on the `bookings`/`orders` row; this is the call-time snapshot for reconciliation |
| extracted_entities | jsonb | yes | | typed Bool/Text/Number/Enum post-call extraction fields |
| state_trace | jsonb | no | `'[]'` | ordered array of state ids visited — compiled-graph debugging |
| variable_values | jsonb | no | `'{}'` | dynamic variables the agent actually had at call time |
| recording_url | text | yes | | Storage path, signed URL minted on read |
| stereo_recording_url | text | yes | | dual-channel, QA/disputes |
| transcript | jsonb | yes | | turn array `[{role, text, ts}]` |
| latency_p50_ms | int | yes | | per-call tool latency rollup |
| latency_p95_ms | int | yes | | |
| tool_call_count | int | no | `0` | |
| tool_error_count | int | no | `0` | |
| cost_cents | int | yes | | denormalized sum of `cost_events.total_cost_cents` for this call, maintained by trigger |
| is_test_call | boolean | no | `false` | true when `caller_number = tenants.owner_test_phone` (G13) |
| legal_advice_given | boolean | no | `false` | legal-vertical guardrail flag; alerting fires if ever true |
| created_at | timestamptz | no | `now()` | |

12-enum `classification` values: `new_booking`, `reschedule`, `cancel`,
`question_faq`, `status_check`, `sales_lead`, `solicitor`, `wrong_number`,
`spam_robocall`, `emergency`, `after_hours_message`, `transfer_request`
(SYSTEM_DESIGN §4.2). A call can migrate class mid-call; `classification`
holds the **final** post-call-authoritative value; `state_trace` shows the
path.

Indexes: `unique (retell_call_id)`, `btree (tenant_id, started_at desc)`,
`btree (tenant_id, classification)`, `btree (tenant_id) where urgency_flag`,
`btree (caller_number)` (callback-continuity lookup, G28).

#### `messages_outbound`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| channel | text | no | | `'sms'\|'email'\|'push'\|'airtable'` |
| recipient | text | no | | phone/email/webhook target |
| template_key | text | no | | e.g. `booking_confirmation`, `after_hours_notice`, `usage_alert_80` |
| payload | jsonb | no | `'{}'` | rendered variables |
| status | text | no | `'queued'` | `'queued'\|'sent'\|'delivered'\|'failed'\|'bounced'\|'pending_verification'` (A2P state, G4) |
| provider_message_id | text | yes | | Twilio SID / email provider id |
| related_call_id | uuid | yes | | |
| related_booking_id | uuid | yes | | |
| related_order_id | uuid | yes | | |
| error | text | yes | | |
| created_at | timestamptz | no | `now()` | |
| sent_at | timestamptz | yes | | |

Index: `btree (tenant_id, created_at desc)`, `btree (status) where status in
('queued','pending_verification')`.

#### `webhook_events`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| source | text | no | | `'retell'\|'stripe'\|'outreach'\|'shopmonkey'\|'ezyvet'\|'square'\|'calendar'\|...` |
| event_id | text | no | | provider-supplied id |
| event_type | text | no | | |
| payload | jsonb | no | | raw verbatim body |
| signature_verified | boolean | no | | |
| processed_at | timestamptz | yes | | null until background processing completes |
| processing_error | text | yes | | |
| created_at | timestamptz | no | `now()` | |

Constraint: `unique (source, event_id)` — this is the idempotent-insert gate
every webhook handler writes to before fast-acking (CLAUDE.md Rule 2).

---

### 1.6 Money domain

#### `cost_events`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| call_id | uuid | yes | | FK `call_logs(id)` |
| provider | text | no | | `'retell'\|'twilio'\|'elevenlabs'\|'openai'\|'anthropic'\|...` |
| product | text | no | | `'voice_infra'\|'llm'\|'tts'\|'stt'\|'telephony'\|'knowledge_base'\|'sms'\|...` |
| quantity | numeric | yes | | minutes/units per `product_costs[]` entry |
| unit | text | yes | | `'minute'\|'unit'\|'message'` |
| unit_cost_cents | numeric | yes | | |
| total_cost_cents | numeric | no | | |
| raw | jsonb | no | `'{}'` | verbatim `product_costs[]` entry from Retell's cost breakdown, for repricing-drift audit |
| occurred_at | timestamptz | no | | |
| created_at | timestamptz | no | `now()` | |

Index: `btree (tenant_id, occurred_at)`, `btree (call_id)`.

#### `revenue_events`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| type | text | no | | `'base_fee'\|'overage'\|'setup_fee'\|'refund'\|'annual_prepay_discount'` |
| amount_cents | int | no | | negative for refunds/discounts |
| stripe_invoice_item_id | text | yes | | |
| period_start | date | yes | | |
| period_end | date | yes | | |
| created_at | timestamptz | no | `now()` | |

Index: `btree (tenant_id, period_start)`.

#### `usage_events`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| call_id | uuid | yes | | |
| minutes | numeric | no | | |
| occurred_at | timestamptz | no | | |
| is_billable | boolean | no | `true` | false for owner test calls (G13) and any admin-flagged QA calls |
| created_at | timestamptz | no | `now()` | |

#### `usage_daily`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| tenant_id | uuid | no | | |
| date | date | no | | tenant-tz local date |
| total_calls | int | no | `0` | |
| total_minutes | numeric | no | `0` | |
| billable_minutes | numeric | no | `0` | |
| total_bookings | int | no | `0` | |
| total_orders | int | no | `0` | |
| total_order_value_cents | int | no | `0` | |
| price_version | text | no | | snapshot for correct overage-rate lookup even after a price-card change |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | |

Primary key `(tenant_id, date)`. Upserted by the usage rollup job (§4) with
the salvaged atomic shape:
```sql
insert into usage_daily (tenant_id, date, total_calls, total_minutes,
  billable_minutes, total_bookings, total_orders, total_order_value_cents, price_version)
values (...)
on conflict (tenant_id, date) do update set
  total_calls = excluded.total_calls,
  total_minutes = excluded.total_minutes,
  billable_minutes = excluded.billable_minutes,
  total_bookings = excluded.total_bookings,
  total_orders = excluded.total_orders,
  total_order_value_cents = excluded.total_order_value_cents,
  updated_at = now();
```

#### `billing_invoices`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| period_start | date | no | | |
| period_end | date | no | | |
| stripe_invoice_id | text | yes | | |
| base_fee_cents | int | no | | |
| included_minutes | numeric | no | | |
| overage_minutes | numeric | no | `0` | |
| overage_cents | int | no | `0` | |
| discount_cents | int | no | `0` | annual-prepay discount |
| total_cents | int | no | | |
| status | text | no | `'draft'` | `'draft'\|'finalized'\|'paid'\|'past_due'\|'void'` |
| created_at | timestamptz | no | `now()` | |

Constraint: `unique (tenant_id, period_start, period_end)` — the idempotent
billing-cycle guarantee.

#### `payment_processing_events`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| stripe_charge_id | text | yes | | |
| stripe_balance_transaction_id | text | yes | | |
| method | text | no | | `'card'\|'ach'` |
| fee_cents | int | no | | actual Stripe-reported fee, not estimated |
| net_cents | int | no | | |
| occurred_at | timestamptz | no | | |
| created_at | timestamptz | no | `now()` | |

#### `commission_events`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| referral_partner_id | uuid | no | | |
| referral_id | uuid | no | | FK `referrals(id)` |
| tenant_id | uuid | no | | referred tenant |
| amount_cents | int | no | | snapshotted flat $X at qualification time |
| period | date | yes | | payout batch period once paid |
| status | text | no | `'accrued'` | `'accrued'\|'batched'\|'paid'\|'clawed_back'` |
| created_at | timestamptz | no | `now()` | |

#### `cac_events`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| channel | text | no | | `'cold_email'\|'referral'\|'organic'\|'paid_ads'\|...` |
| tenant_id | uuid | yes | | null until the lead converts |
| lead_id | uuid | yes | | FK `leads(id)` |
| cost_cents | int | no | | |
| occurred_at | timestamptz | no | | |
| created_at | timestamptz | no | `now()` | |

#### `fixed_cost_allocations`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| period | date | no | | month bucket |
| category | text | no | | `'infra'\|'tooling'\|'labor'\|'domain_warmup'\|...` |
| amount_cents | int | no | | |
| allocation_method | text | no | | `'per_active_tenant'\|'flat'\|'per_minute'` |
| created_at | timestamptz | no | `now()` | |

---

### 1.7 Referral program

#### `referral_partners`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| user_id | uuid | yes | | FK `auth.users(id)`, partner portal login |
| name | text | no | | |
| email | text | no | | |
| payout_method | text | no | `'paypal'` | |
| paypal_email | text | yes | | |
| w9_status | text | no | `'not_submitted'` | `'not_submitted'\|'submitted'\|'verified'` |
| ytd_payout_cents | int | no | `0` | reset each calendar year, drives 1099-NEC threshold at $2k/yr |
| fraud_flags | jsonb | no | `'[]'` | G34 signals accumulated |
| created_at | timestamptz | no | `now()` | |

#### `referral_links`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| referral_partner_id | uuid | no | | |
| code | text | no | | unique, URL slug |
| created_at | timestamptz | no | `now()` | |

#### `referrals`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| referral_link_id | uuid | yes | | null if attributed by cookie fallback only |
| referral_partner_id | uuid | no | | denormalized for query simplicity |
| referred_tenant_id | uuid | no | | FK `tenants(id)`, unique |
| attribution_source | text | no | | `'link'\|'cookie'` |
| status | text | no | `'pending'` | `'pending'\|'qualified'\|'paid'\|'clawed_back'\|'disqualified'` |
| qualified_at | timestamptz | yes | | default rule: after referred tenant's 2nd paid month |
| amount_cents_snapshot | int | yes | | $X from `platform_settings` at qualification time |
| fraud_flag | boolean | no | `false` | self-referral / matching-fingerprint detection (G34) |
| created_at | timestamptz | no | `now()` | |

Constraint: `unique (referred_tenant_id)`.

#### `referral_payouts`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| referral_partner_id | uuid | no | | |
| period | date | no | | monthly batch |
| total_cents | int | no | | |
| paypal_batch_id | text | yes | | |
| status | text | no | `'pending'` | `'pending'\|'sent'\|'failed'` |
| created_at | timestamptz | no | `now()` | |

---

### 1.8 Outreach engine

#### `leads`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| source | text | no | | `'apollo'\|'outscraper'\|'apify'\|'license_roll'` |
| vertical | text | yes | | |
| company_name | text | yes | | |
| contact_name | text | yes | | |
| email | text | yes | | |
| phone | text | yes | | never called by AI voice (TCPA, SYSTEM_DESIGN §11) |
| enrichment | jsonb | no | `'{}'` | |
| status | text | no | `'new'` | `'new'\|'queued'\|'sent'\|'replied'\|'suppressed'\|'converted'` |
| created_at | timestamptz | no | `now()` | |

#### `campaigns`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| name | text | no | | |
| vertical | text | yes | | |
| sender_domain | text | no | | |
| provider | text | no | | `'smartlead'\|'instantly'` |
| status | text | no | `'draft'` | `'draft'\|'warming'\|'active'\|'paused'` |
| complaint_rate | numeric | yes | | monitored for the <0.3% auto-pause rule |
| created_at | timestamptz | no | `now()` | |

#### `send_events`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| campaign_id | uuid | no | | |
| lead_id | uuid | no | | |
| step_index | int | no | | sequence step number |
| provider_message_id | text | yes | | |
| sent_at | timestamptz | yes | | |
| opened_at | timestamptz | yes | | |
| clicked_at | timestamptz | yes | | |
| status | text | no | `'queued'` | `'queued'\|'sent'\|'bounced'\|'complained'` |

#### `replies`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| send_event_id | uuid | yes | | |
| lead_id | uuid | no | | |
| body | text | no | | |
| ai_intent | text | yes | | Claude-classified: `'interested'\|'not_interested'\|'unsubscribe'\|'question'\|'auto_reply'` |
| received_at | timestamptz | no | | |

#### `suppression_list`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| contact | text | no | | email or E.164 |
| reason | text | no | | `'unsubscribe'\|'bounce'\|'complaint'\|'manual'` |
| created_at | timestamptz | no | `now()` | |

Constraint: `unique (contact)`.

#### `pipeline_costs`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| campaign_id | uuid | yes | | |
| category | text | no | | `'list_cost'\|'ai_personalization'\|'sender_fee'\|'domain_warmup'` |
| amount_cents | int | no | | |
| occurred_at | timestamptz | no | | |

---

### 1.9 Platform, support, API tokens

#### `platform_settings`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| key | text | no | | PK, e.g. `'referral_flat_amount_cents'`, `'referral_qualification_rule'`, `'usage_alert_thresholds'` |
| value | jsonb | no | | |
| updated_by | uuid | yes | | FK `auth.users(id)` |
| updated_at | timestamptz | no | `now()` | |

#### `support_requests` (salvaged, redesigned)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| call_id | uuid | yes | | links to the "transfer request"/"after-hours message" call classes |
| booking_id | uuid | yes | | |
| subject | text | no | | |
| body | text | no | | |
| priority | text | no | `'medium'` | `'low'\|'medium'\|'high'\|'urgent'` |
| status | text | no | `'open'` | `'open'\|'pending'\|'resolved'\|'closed'` |
| created_by | uuid | yes | | FK `auth.users(id)`, member who filed it (null if system-generated from a call class) |
| created_at | timestamptz | no | `now()` | |
| updated_at | timestamptz | no | `now()` | trigger |

#### `support_request_notes`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| support_request_id | uuid | no | | FK |
| author_id | uuid | no | | |
| body | text | no | | |
| visible_to_tenant | boolean | no | `false` | internal-vs-visible split, salvaged |
| created_at | timestamptz | no | `now()` | |

#### `api_tokens` (salvaged, redesigned — hashed)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | `gen_random_uuid()` | PK |
| tenant_id | uuid | no | | |
| name | text | no | | tenant-assigned label |
| token_hash | text | no | | `sha256(token)`, never store plaintext |
| token_prefix | text | no | | first 8 chars, shown post-issuance for identification |
| scopes | jsonb | no | `'["read"]'` | |
| last_used_at | timestamptz | yes | | |
| revoked_at | timestamptz | yes | | |
| created_at | timestamptz | no | `now()` | |

Full token is shown to the tenant exactly once at creation (secret-reveal-
once modal, salvaged UX pattern) and never retrievable again.

---

## 2. Views

```sql
-- Per-tenant margin, current calendar month, for the cockpit waterfall.
create or replace view public.v_tenant_margin as
select
  t.id as tenant_id,
  t.name,
  t.vertical,
  coalesce(r.revenue_cents, 0) as revenue_cents,
  coalesce(c.cost_cents, 0) as cost_cents,
  coalesce(r.revenue_cents, 0) - coalesce(c.cost_cents, 0) as margin_cents
from tenants t
left join (
  select tenant_id, sum(amount_cents) as revenue_cents
  from revenue_events
  where period_start >= date_trunc('month', now())::date
  group by tenant_id
) r on r.tenant_id = t.id
left join (
  select tenant_id, sum(total_cost_cents)::int as cost_cents
  from cost_events
  where occurred_at >= date_trunc('month', now())
  group by tenant_id
) c on c.tenant_id = t.id
where t.deleted_at is null;

-- Per-call cost vs implied billed amount, for the "per-call cost vs billed" cockpit page.
create or replace view public.v_call_cost_vs_billed as
select
  cl.id as call_id,
  cl.tenant_id,
  cl.duration_seconds,
  cl.cost_cents as provider_cost_cents,
  round((cl.duration_seconds / 60.0) * ov.overage_rate_cents)::int as implied_billed_cents
from call_logs cl
join lateral (
  select (value->>'overage_cents')::int as overage_rate_cents
  from platform_settings
  where key = 'price_card_' || (select vertical from tenants where id = cl.tenant_id)
) ov on true
where cl.is_test_call = false;

-- Tenants crossing usage-alert thresholds (80%/100% of included minutes), G14.
create or replace view public.v_usage_alerts as
select
  ud.tenant_id,
  sum(ud.billable_minutes) as mtd_minutes,
  pc.included_minutes,
  sum(ud.billable_minutes) / nullif(pc.included_minutes, 0) as pct_used
from usage_daily ud
join lateral (
  select (value->>'included_minutes')::numeric as included_minutes
  from platform_settings
  where key = 'price_card_' || (select vertical from tenants where id = ud.tenant_id)
) pc on true
where ud.date >= date_trunc('month', now())::date
group by ud.tenant_id, pc.included_minutes
having sum(ud.billable_minutes) / nullif(pc.included_minutes, 0) >= 0.8;

-- Referral P&L per partner.
create or replace view public.v_referral_pnl as
select
  rp.id as referral_partner_id,
  rp.name,
  count(r.id) filter (where r.status = 'qualified') as qualified_count,
  sum(ce.amount_cents) filter (where ce.status = 'paid') as paid_cents,
  sum(ce.amount_cents) filter (where ce.status = 'accrued') as accrued_cents
from referral_partners rp
left join referrals r on r.referral_partner_id = rp.id
left join commission_events ce on ce.referral_partner_id = rp.id
group by rp.id, rp.name;
```

`DECIDE:` the `price_card_<vertical>` key convention above assumes the
per-vertical price card (SYSTEM_DESIGN §1) is stored in `platform_settings`
as one JSON row per vertical (`{base_cents, included_minutes, overage_cents}`)
rather than a dedicated `price_cards` table — recommended because the card
changes rarely and admin-editability via existing `platform_settings` CRUD
is simpler than a new table + migration path; revisit if versioning history
per price card becomes a requirement (it already is snapshotted per-tenant
via `tenants.price_version` and per-invoice via `usage_daily.price_version`).

---

## 3. Postgres functions

### 3.1 Custom Access Token Hook

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_user_id uuid := (event->>'user_id')::uuid;
  v_membership record;
  v_is_admin boolean;
  v_partner_id uuid;
begin
  claims := event->'claims';

  select tenant_id, role into v_membership
  from public.memberships
  where user_id = v_user_id
  limit 1; -- DECIDE: multi-tenant users pick primary membership; UI switches tenant via a
           -- re-auth/refresh that re-derives claims for the selected tenant (see §6 auth model)

  select exists(select 1 from public.platform_admins where user_id = v_user_id) into v_is_admin;
  select id into v_partner_id from public.referral_partners where user_id = v_user_id;

  if v_membership.tenant_id is not null then
    claims := jsonb_set(claims, '{app_metadata,tenant_id}', to_jsonb(v_membership.tenant_id::text));
    claims := jsonb_set(claims, '{app_metadata,role}', to_jsonb(v_membership.role));
  end if;

  if v_is_admin then
    claims := jsonb_set(claims, '{app_metadata,platform_admin}', 'true');
  end if;

  if v_partner_id is not null then
    claims := jsonb_set(claims, '{app_metadata,referral_partner_id}', to_jsonb(v_partner_id::text));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
```

Registered via Supabase Auth Hooks config (`auth.hook.custom_access_token`)
per current supabase.com/docs guidance (CLAUDE.md Rule 1 — verify exact
registration mechanism against current docs at build time; the hook function
signature above targets the documented `event`/`claims` jsonb contract).

### 3.2 Availability regeneration

```sql
create or replace function public.fn_regenerate_availability_slots(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_days_ahead int default 21
) returns void
language plpgsql as $$
declare
  v_tz text;
  v_hours jsonb;
  v_exceptions jsonb;
  v_day date;
  v_dow text;
  v_window jsonb;
begin
  select timezone, business_hours, hours_exceptions
    into v_tz, v_hours, v_exceptions
  from tenants where id = p_tenant_id;

  -- Clear only future generated (non-manual-block) slots for this resource
  -- before regenerating, so schedule-change edits are idempotent.
  delete from availability_slots
  where resource_id = p_resource_id
    and source = 'generated'
    and lower(slot_range) >= now();

  for v_day in select generate_series(current_date, current_date + p_days_ahead, '1 day')::date loop
    v_dow := lower(to_char(v_day, 'dy'));
    -- exceptions override business_hours for this date; see JSON shapes in §1.1
    for v_window in select jsonb_array_elements(
        coalesce(
          (select value->'hours' from jsonb_array_elements(v_exceptions) e(value)
           where (e.value->>'date')::date = v_day and not coalesce((e.value->>'closed')::boolean, false)),
          v_hours->v_dow
        )
      ) loop
      -- one slot per offering-duration granularity; duration handled by the
      -- caller passing distinct p_resource_id per offering-compatible resource;
      -- exact slot-size strategy is vertical-specific (DECIDE below).
      insert into availability_slots (tenant_id, resource_id, slot_range, source)
      values (
        p_tenant_id, p_resource_id,
        tstzrange(
          (v_day || ' ' || (v_window->>'open'))::timestamp at time zone v_tz,
          (v_day || ' ' || (v_window->>'close'))::timestamp at time zone v_tz,
          '[)'
        ),
        'generated'
      );
    end loop;
  end loop;
end;
$$;
```

`DECIDE:` slot granularity (whether `availability_slots` stores one row per
whole open window, subdivided later by the `/voice/tools` `check_availability`
query, vs. pre-subdivided into fixed offering-duration increments at
generation time) — recommend **pre-subdivided per resource's typical
offering duration** (e.g. 30-min increments for auto/dental, per-night for
motels) because it keeps the hot-path query a pure indexed range-overlap
check with zero runtime arithmetic; the regeneration function's per-window
subdivision loop is the piece to fill in per vertical during T1 (this
function sketch is the shape, not the final subdivision logic).

### 3.3 Usage upsert

```sql
create or replace function public.fn_upsert_usage_daily(p_tenant_id uuid, p_date date)
returns void language plpgsql as $$
declare
  v_price_version text;
begin
  select price_version into v_price_version from tenants where id = p_tenant_id;

  insert into usage_daily (
    tenant_id, date, total_calls, total_minutes, billable_minutes,
    total_bookings, total_orders, total_order_value_cents, price_version
  )
  select
    p_tenant_id, p_date,
    count(*) filter (where cl.started_at::date = p_date),
    coalesce(sum(cl.duration_seconds) filter (where cl.started_at::date = p_date), 0) / 60.0,
    coalesce(sum(ue.minutes) filter (where ue.is_billable and ue.occurred_at::date = p_date), 0),
    (select count(*) from bookings b where b.tenant_id = p_tenant_id and b.created_at::date = p_date),
    (select count(*) from orders o where o.tenant_id = p_tenant_id and o.created_at::date = p_date),
    (select coalesce(sum(o.total_cents), 0) from orders o where o.tenant_id = p_tenant_id and o.created_at::date = p_date),
    v_price_version
  from call_logs cl
  left join usage_events ue on ue.call_id = cl.id
  where cl.tenant_id = p_tenant_id
  on conflict (tenant_id, date) do update set
    total_calls = excluded.total_calls,
    total_minutes = excluded.total_minutes,
    billable_minutes = excluded.billable_minutes,
    total_bookings = excluded.total_bookings,
    total_orders = excluded.total_orders,
    total_order_value_cents = excluded.total_order_value_cents,
    updated_at = now();
end;
$$;
```

### 3.4 Broadcast triggers (tenant-scoped realtime)

```sql
create or replace function public.fn_broadcast_tenant_update()
returns trigger language plpgsql as $$
declare
  v_tenant_id uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  perform realtime.broadcast_changes(
    'tenant:' || v_tenant_id,   -- private per-tenant topic
    tg_op, tg_op, tg_table_name, tg_table_schema,
    new, old
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_broadcast_call_logs after insert or update on call_logs
  for each row execute function fn_broadcast_tenant_update();
create trigger trg_broadcast_bookings after insert or update on bookings
  for each row execute function fn_broadcast_tenant_update();
create trigger trg_broadcast_orders after insert or update on orders
  for each row execute function fn_broadcast_tenant_update();
create trigger trg_broadcast_support_requests after insert or update on support_requests
  for each row execute function fn_broadcast_tenant_update();
```

`realtime.broadcast_changes` payload shape and grant model per current
supabase.com/docs Broadcast-from-Database guidance (verify exact function
signature at build time, Rule 1); the topic name `tenant:<tenant_id>` is the
private channel RLS on `realtime.messages` gates (§2.15). The frontend never
reads row payload off the broadcast for anything sensitive — it refetches via
TanStack Query on receipt, matching SYSTEM_DESIGN's "fires only on update,
delivered only to that tenant, frontend refetches" model exactly.

### 3.5 Availability invalidation on booking write

```sql
create or replace function public.fn_invalidate_availability_on_booking()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' and new.status = 'confirmed')
     or (tg_op = 'UPDATE' and new.status = 'confirmed' and old.status is distinct from 'confirmed') then
    update availability_slots
    set is_available = false
    where resource_id = new.resource_id
      and slot_range && new.during;
  elsif (tg_op = 'UPDATE' and old.status = 'confirmed'
         and new.status in ('cancelled','no_show')) then
    update availability_slots
    set is_available = true
    where resource_id = new.resource_id
      and slot_range && new.during
      and source = 'generated';
  end if;
  return new;
end;
$$;

create trigger trg_bookings_invalidate_availability
  after insert or update on bookings
  for each row execute function fn_invalidate_availability_on_booking();
```

### 3.6 Customer segment recompute

```sql
create or replace function public.fn_recompute_customer_segment()
returns trigger language plpgsql as $$
begin
  update customers set
    segment = case
      when lifetime_bookings >= 10 or lifetime_value_cents >= 100000 then 'vip'
      when lifetime_bookings >= 4 then 'loyal'
      when lifetime_bookings >= 2 then 'returning'
      else 'new'
    end,
    last_seen_at = now()
  where id = new.customer_id;
  return new;
end;
$$;

create trigger trg_bookings_recompute_segment
  after insert or update of status on bookings
  for each row when (new.status = 'completed')
  execute function fn_recompute_customer_segment();
```

`DECIDE:` segment thresholds above are placeholders carried forward
conceptually from the salvaged feature (exact cutoffs weren't specified in
SYSTEM_DESIGN) — recommend tuning after Wave-1 real usage data rather than
guessing further; expose thresholds via `platform_settings` so they're
admin-tunable without a migration.

### 3.7 Referral qualification

```sql
create or replace function public.fn_check_referral_qualification()
returns void language plpgsql as $$
begin
  update referrals r
  set status = 'qualified',
      qualified_at = now(),
      amount_cents_snapshot = (
        select (value->>'flat_amount_cents')::int
        from platform_settings where key = 'referral_flat_amount_cents'
      )
  where r.status = 'pending'
    and r.fraud_flag = false
    and (
      select count(*) from billing_invoices bi
      where bi.tenant_id = r.referred_tenant_id and bi.status = 'paid'
    ) >= 2; -- default rule: qualifies after 2nd paid month (SYSTEM_DESIGN §6, §10)

  insert into commission_events (referral_partner_id, referral_id, tenant_id, amount_cents, status)
  select r.referral_partner_id, r.id, r.referred_tenant_id, r.amount_cents_snapshot, 'accrued'
  from referrals r
  where r.status = 'qualified'
    and not exists (select 1 from commission_events ce where ce.referral_id = r.id);
end;
$$;
```

Called by the referral-qualification cron job (§4); the admin-configurable
`$X` is read fresh from `platform_settings` and snapshotted onto the referral
row at the moment of qualification, per SYSTEM_DESIGN §6.

---

## 4. Trigger inventory (summary)

| Trigger | Table | Event | Function | Purpose |
|---|---|---|---|---|
| `trg_set_updated_at_*` | most tables with `updated_at` (tenants, agent_configs, offerings, orders, bookings, support_requests, usage_daily) | before update | `fn_set_updated_at` | maintain `updated_at` |
| `trg_bookings_updated_at` | bookings | before update | `fn_set_updated_at` | " |
| `trg_bookings_invalidate_availability` | bookings | after insert/update | `fn_invalidate_availability_on_booking` | flip `availability_slots.is_available` on confirm/cancel |
| `trg_bookings_recompute_segment` | bookings | after insert/update of status (when completed) | `fn_recompute_customer_segment` | customer VIP/Loyal/Returning/New |
| `trg_broadcast_call_logs` | call_logs | after insert/update | `fn_broadcast_tenant_update` | tenant-scoped realtime |
| `trg_broadcast_bookings` | bookings | after insert/update | `fn_broadcast_tenant_update` | " |
| `trg_broadcast_orders` | orders | after insert/update | `fn_broadcast_tenant_update` | " |
| `trg_broadcast_support_requests` | support_requests | after insert/update | `fn_broadcast_tenant_update` | " |
| `trg_call_logs_cost_rollup` | cost_events | after insert | `fn_rollup_call_cost` (below) | maintain `call_logs.cost_cents` |
| `trg_customers_touch` | bookings, orders, call_logs | after insert | `fn_touch_customer` (below) | maintain `customers.last_seen_at`/lifetime counters |

```sql
create or replace function public.fn_rollup_call_cost()
returns trigger language plpgsql as $$
begin
  if new.call_id is not null then
    update call_logs
    set cost_cents = coalesce((
      select sum(total_cost_cents)::int from cost_events where call_id = new.call_id
    ), 0)
    where id = new.call_id;
  end if;
  return new;
end;
$$;
create trigger trg_call_logs_cost_rollup after insert on cost_events
  for each row execute function fn_rollup_call_cost();

create or replace function public.fn_touch_customer()
returns trigger language plpgsql as $$
begin
  if new.customer_id is not null then
    update customers set
      last_seen_at = now(),
      lifetime_calls = lifetime_calls + (case when tg_table_name = 'call_logs' then 1 else 0 end),
      lifetime_bookings = lifetime_bookings + (case when tg_table_name = 'bookings' then 1 else 0 end),
      lifetime_value_cents = lifetime_value_cents + (case when tg_table_name = 'orders' then new.total_cents else 0 end)
    where id = new.customer_id;
  end if;
  return new;
end;
$$;
create trigger trg_customers_touch_bookings after insert on bookings
  for each row execute function fn_touch_customer();
create trigger trg_customers_touch_orders after insert on orders
  for each row execute function fn_touch_customer();
```

---

## 5. Row Level Security — policy matrix

Global rules (CLAUDE.md Rule 2, non-negotiable): RLS is enabled on **every**
table in this document; `tenant_id` for the predicate comes only from
`auth.jwt() -> 'app_metadata' ->> 'tenant_id'` (set by the Custom Access
Token Hook, §3.1), never a client-supplied parameter; `service_role` bypasses
RLS for edge functions that have already verified tenant scope themselves
(and per CLAUDE.md, those functions must still explicitly filter by a
verified tenant_id in the query — RLS bypass is not a substitute). Helper
expressions used below:

```sql
create or replace function public.fn_jwt_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb
    -> 'app_metadata' ->> 'tenant_id', '')::uuid;
$$;

create or replace function public.fn_jwt_is_platform_admin() returns boolean
language sql stable as $$
  select coalesce((current_setting('request.jwt.claims', true)::jsonb
    -> 'app_metadata' ->> 'platform_admin')::boolean, false);
$$;

create or replace function public.fn_jwt_referral_partner_id() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb
    -> 'app_metadata' ->> 'referral_partner_id', '')::uuid;
$$;
```

| Table | SELECT predicate | INSERT/UPDATE/DELETE predicate | Notes |
|---|---|---|---|
| `tenants` | `id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | UPDATE: `id = fn_jwt_tenant_id() and role in ('owner','admin')` (role from JWT `app_metadata.role`), or platform admin. No client DELETE — soft delete only, `service_role`/admin action | |
| `memberships` | `tenant_id = fn_jwt_tenant_id() or user_id = auth.uid() or fn_jwt_is_platform_admin()` | INSERT/UPDATE/DELETE: `tenant_id = fn_jwt_tenant_id() and (jwt role) = 'owner'`, or platform admin | owner manages seat roles |
| `platform_admins` | `fn_jwt_is_platform_admin()` | `service_role` only (no self-service admin grants) | |
| `admin_actions` | `fn_jwt_is_platform_admin()` | INSERT via `service_role` from admin edge functions only; no UPDATE/DELETE ever | append-only audit |
| `phone_numbers` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | write: `service_role` only (provisioning saga owns this table) | tenants read-only even for their own row |
| `agent_templates` | `fn_jwt_is_platform_admin()` (tenants never see raw templates — only their compiled `agent_configs`) | `fn_jwt_is_platform_admin()` | |
| `agent_configs` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | UPDATE (owner-editable columns only, enforced by a column-privilege grant, not RLS): `tenant_id = fn_jwt_tenant_id() and role in ('owner','admin')`; INSERT/publish: `service_role` (provisioning saga / template compiler) | tenant PATCH goes through an edge function that whitelists which columns are owner-writable (assistant_name, special_instructions, transfer_number, greeting_overrides, dynamic_variable_overrides) — never `retell_agent_id`/`compiled_config` |
| `offerings` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | `tenant_id = fn_jwt_tenant_id() and role in ('owner','admin')` | |
| `resources` | same as `offerings` | same as `offerings` | |
| `availability_slots` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | `service_role` only (generated/invalidated by functions & triggers) | |
| `bookings` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | `tenant_id = fn_jwt_tenant_id()` for member-initiated status changes (reschedule/cancel from dashboard); INSERT primarily via `service_role` from `/voice/tools`, but member-created manual bookings allowed when `manual_mode` | |
| `orders` | same shape as `bookings` | same shape as `bookings` | |
| `customers` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | `tenant_id = fn_jwt_tenant_id() and role in ('owner','admin','member')` | `lookup_customer` tool itself additionally scopes to caller's own number at the application layer (G6) — RLS alone doesn't express "this call's caller" |
| `call_logs` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | `service_role` only | recordings/transcripts never client-writable |
| `messages_outbound` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | `service_role` only | |
| `webhook_events` | `fn_jwt_is_platform_admin()` | `service_role` only | tenants never see raw webhook payloads |
| `cost_events` | `fn_jwt_is_platform_admin()` | `service_role` only | cost is admin/cockpit-only, never tenant-exposed (margin secrecy) |
| `revenue_events` | `fn_jwt_is_platform_admin()` | `service_role` only | |
| `usage_events` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | `service_role` only | tenants see their own usage (needed for usage-alert UI) but not the cost side |
| `usage_daily` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | `service_role` only | |
| `billing_invoices` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | `service_role` only | |
| `payment_processing_events` | `fn_jwt_is_platform_admin()` | `service_role` only | |
| `commission_events` | `referral_partner_id = fn_jwt_referral_partner_id() or fn_jwt_is_platform_admin()` | `service_role` only | |
| `cac_events` | `fn_jwt_is_platform_admin()` | `service_role` only | |
| `fixed_cost_allocations` | `fn_jwt_is_platform_admin()` | `fn_jwt_is_platform_admin()` | |
| `referral_partners` | `id = fn_jwt_referral_partner_id() or fn_jwt_is_platform_admin()` | UPDATE own profile fields: `id = fn_jwt_referral_partner_id()`; else admin | |
| `referral_links` | `referral_partner_id = fn_jwt_referral_partner_id() or fn_jwt_is_platform_admin()` | `service_role` (link creation via admin/partner-portal edge function) | |
| `referrals` | `referral_partner_id = fn_jwt_referral_partner_id() or fn_jwt_is_platform_admin()` | `service_role` only | |
| `referral_payouts` | same as `referrals` | `service_role` only | |
| `leads`, `campaigns`, `send_events`, `replies`, `suppression_list`, `pipeline_costs` | `fn_jwt_is_platform_admin()` | `fn_jwt_is_platform_admin()` / `service_role` | outreach is admin-only, no tenant exposure |
| `platform_settings` | `fn_jwt_is_platform_admin()` (some keys like price cards may be read by the signup flow via `service_role` proxy, never direct client read) | `fn_jwt_is_platform_admin()` | |
| `support_requests` | `tenant_id = fn_jwt_tenant_id() or fn_jwt_is_platform_admin()` | `tenant_id = fn_jwt_tenant_id()` (create/update own), admin full | |
| `support_request_notes` | tenant sees only rows with `visible_to_tenant = true` on a request they own; admin sees all | tenant INSERT only with `visible_to_tenant = true` forced; admin full | |
| `api_tokens` | `tenant_id = fn_jwt_tenant_id() and role in ('owner','admin')`, admin full (hash never exposed by the API layer regardless of RLS) | `tenant_id = fn_jwt_tenant_id() and role in ('owner','admin')` | token value itself is never stored in a SELECT-able column |

**CI cross-tenant probe** (CLAUDE.md / SYSTEM_DESIGN §2): a test harness
authenticates as tenant A, attempts `select *` against every tenant-scoped
table filtered to tenant B's id, and asserts zero rows for all of them; run
in CI on every migration change, blocking merge on any non-zero result.

---

## 6. Storage

Bucket `recordings`, path convention `recordings/{tenant_id}/{call_id}.wav`
(mono) and `recordings/{tenant_id}/{call_id}_stereo.wav`. Bucket is private;
all reads go through signed URLs minted server-side (never a public bucket
policy). Storage RLS policy: `service_role` write-only (recording archival
happens in `/voice/events` background work, §7.3); no client SELECT policy at
all — the dashboard requests a signed URL from an authenticated edge
function that itself checks `call_logs.tenant_id = fn_jwt_tenant_id()`
before minting. Retention: nightly retention-sweep job (§8) deletes objects
older than `tenants.retention_days` (BIPA-aware default 30–90 days, G3) and
nulls the corresponding `call_logs.recording_url`/`stereo_recording_url`
while leaving the row (transcript/analysis) intact unless the tenant's
retention policy also covers transcripts — `DECIDE:` recommend transcripts
outlive audio by default (lower BIPA exposure is specifically about
voiceprint data in the audio, not text) but confirm with counsel per G3
before shipping the sweep job's transcript-handling branch.

---

## 7. Edge functions

General rules applying to every function below (CLAUDE.md, SYSTEM_DESIGN §2,
§5): region-pinned to the Supabase project region; module-scope DB client
(no per-invocation client construction); no ORM on hot-path functions;
webhooks verify signature against the **raw** body before any parsing;
verified webhooks insert into `webhook_events` (unique `source,event_id`)
before any side effect, so retried deliveries are no-ops; fail closed (a
missing/misconfigured secret rejects the request, never silently skips
verification). `verify_jwt` is a Supabase Edge Function deployment setting
(`--no-verify-jwt` vs default) — noted per function below; functions with
`verify_jwt: false` implement their OWN auth (HMAC signature, admin session
check, hashed API token) since Supabase's platform-level JWT gate is off.

### 7.1 `/voice/inbound`

| | |
|---|---|
| Route | `POST /functions/v1/voice-inbound` |
| verify_jwt | `false` — Retell calls this directly; auth is HMAC (below) |
| Auth | Retell webhook signature header verified against raw body using the per-provider shared secret (`RETELL_WEBHOOK_SECRET`); reject with 401 on failure or missing header — fail closed |
| Purpose | number → tenant → agent resolver; returns dynamic variables Retell injects into the call at answer time |

**Request schema** (Retell's inbound-call webhook shape — verify exact field
names against Retell's current docs before coding, Rule 1; canonical shape
assumed):
```ts
{
  call_id: string;
  from_number: string;   // E.164
  to_number: string;     // E.164, our Twilio number imported into Retell
  agent_id?: string;     // Retell-side agent id, if already resolved
}
```

**Response schema** (200):
```ts
{
  call_inbound: {
    override_agent_id?: string;      // set if number → tenant resolves to a
                                      // different agent than Retell's default binding
    dynamic_variables: {
      business_name: string;
      assistant_name: string;
      greeting_hours_context: string;   // precomputed "we're open until 6pm" / "we're closed" string
      timezone: string;
      special_instructions: string;
      manager_name?: string;
      manager_phone?: string;
      parking_info?: string;
      accessibility_notes?: string;
      accepted_payment_types?: string[];
      is_manual_mode: boolean;           // agent should shift to message-only framing if true
      language: string;                  // G12
      caller_recent_context?: string;    // G28 callback continuity: short summary if this number
                                          // called/booked recently
      disclosure_line: string;           // compiled-in constant, always present
    };
  };
}
```

**Error responses:** `401` bad/missing signature; `404` number not found in
`phone_numbers` (logged, and Retell falls back to its own default — this
should not happen for a provisioned number, alert if it does); `500` DB
error → Retell's own retry/timeout applies (never our failure path per
SYSTEM_DESIGN §5, so this handler is kept trivial and fast).

**Side effects:** none beyond an optional row touch on `phone_numbers` (last
inbound timestamp, `DECIDE:` skip if it adds latency risk — recommend
skipping; log via async `pg_net` fire-and-forget if desired instead of an
inline write).

**Latency budget:** p95 < 300ms (this gates Retell's ability to start the
greeting at all — tighter than the tool-call budget). Single indexed read on
`phone_numbers.e164` joined to `tenants`/`agent_configs`; no external calls.

**Idempotency:** naturally idempotent (pure read); no dedup table needed.

### 7.2 `/voice/tools`

| | |
|---|---|
| Route | `POST /functions/v1/voice-tools` |
| verify_jwt | `false` — HMAC signature auth, same as inbound |
| Auth | Retell tool-call webhook signature over raw body |
| Purpose | hot-path tool dispatch: availability/booking/customer/message tools |
| Latency budget | **p50 < 200ms, p95 < 500ms, hard abort at 1.5s** → graceful fallback response, never silence |

**Dispatch envelope** (Retell's function-calling tool-webhook shape,
canonical — verify against current docs):
```ts
{ call_id: string; name: string; args: Record<string, unknown>; }
```
Response envelope on every branch: `{ result: <tool-specific JSON> }` or, on
abort/circuit-break, `{ result: { fallback: true, message: "I'll take your
details and have someone confirm." } }` — never an HTTP error back to Retell
for a business-logic failure (only auth/parse failures return non-200).

Every tool call is wrapped by the **circuit breaker**: a rolling per-tool
error/timeout counter (in-memory per warm instance + a shared counter table
`DECIDE:` — recommend an in-process rolling window per instance backed by a
lightweight `tool_health` table updated async, since a synchronous shared
counter read would itself tax the hot path) short-circuits new calls to
fallback mode above ~20% error rate/min, resetting after a cooldown; per-tool
p50/p95/p99 and error rate are emitted (via async `pg_net` beacon or a
buffered insert) to feed the cockpit bottleneck view + alerts (§9).

Tool authorization (G6), enforced in code, not just documented:
`lookup_customer` is **always** scoped server-side to `args.caller_number ==
call.from_number` (from the call session, never trusted from `args` alone —
cross-check against the Retell call record) — a request for a different
number's data is rejected regardless of what the model passes.
`transfer_call` (see §7.2.8) resolves its destination **only** from
`agent_configs.transfer_number`, never from any caller-supplied value.

#### 7.2.1 `check_availability`

- **Request:** `{ offering_id?: string, resource_type?: string, date_range: {start: string, end: string}, party_size?: number }`
- **Response:** `{ slots: [{start: string, end: string, resource_id: string}], none_available: boolean, nearest_alternative?: {start, end} }`
- **Side effects:** none (pure read against `availability_slots`)
- **Implementation:** single `slot_range && tstzrange($1,$2)` indexed query per SYSTEM_DESIGN §5, no timezone math at request time
- **Idempotency:** N/A (read-only)

#### 7.2.2 `create_booking`

- **Request:** `{ resource_id: string, offering_id?: string, start: string, end: string, customer: {name, phone, ...vertical fields}, party_size?: number, structured_payload?: object }`
- **Response:** `{ booking_id: string, confirmed: true, start, end } | { confirmed: false, reason: "slot_taken", nearest_alternative?: {...} }`
- **Side effects:** upsert `customers` (by `tenant_id, phone_e164`), INSERT `bookings` with `status='confirmed'`, `source_call_id`, `idempotency_key = call_id || ':' || start`; the availability-invalidation trigger (§3.5) flips the slot; on unique/exclusion-constraint violation (`23P01`), catch and return `confirmed:false, reason:"slot_taken"` — **never** check-then-insert (SYSTEM_DESIGN §5 — the exclusion constraint is the race-proofing, not app logic)
- **Idempotency:** `idempotency_key` unique per tenant; a Retell retry of the same tool call with the same args returns the existing booking (`select` first on conflict, or `insert ... on conflict (tenant_id, idempotency_key) do nothing returning *` then fetch if empty)

#### 7.2.3 `update_booking` (reschedule)

- **Request:** `{ booking_id: string, new_start: string, new_end: string }`
- **Response:** `{ confirmed: true, start, end } | { confirmed: false, reason: "slot_taken" }`
- **Side effects:** UPDATE `bookings.start_at/end_at`, `status` stays `confirmed` (the exclusion constraint re-validates on update automatically); triggers re-flip old/new availability slots
- **Idempotency:** re-sending the identical new_start/new_end is a no-op update

#### 7.2.4 `cancel_booking`

- **Request:** `{ booking_id: string, reason?: string }`
- **Response:** `{ cancelled: true }`
- **Side effects:** UPDATE `status='cancelled'`, `cancelled_at`, `cancel_reason`; trigger frees the availability slot; enqueues a `messages_outbound` cancellation-confirmation SMS
- **Idempotency:** cancelling an already-cancelled booking is a no-op (status check before update)

#### 7.2.5 `lookup_customer`

- **Request:** `{ phone: string }` — server-side cross-checked against the live call's caller number (G6); a mismatch is rejected with `{ error: "unauthorized_lookup" }` and logged as a potential prompt-injection attempt for the red-team dataset
- **Response:** `{ found: boolean, name?, segment?, recent_bookings?: [...], vehicles?/pets?: [...] }` (vertical metadata surfaced from `customers.metadata`)
- **Side effects:** none
- **Idempotency:** N/A

#### 7.2.6 `take_message`

- **Request:** `{ caller_name?, caller_phone, message_text, callback_window? }`
- **Response:** `{ recorded: true }`
- **Side effects:** UPDATE `call_logs.message_text` (+ sets `classification` hint, final value still owned by post-call analysis); enqueues `messages_outbound` (SMS/email to the tenant) with `template_key='after_hours_message'` or `'take_message'`
- **Idempotency:** upsert against `call_id` (one message row per call; re-invocation overwrites, doesn't duplicate)

#### 7.2.7 `send_sms_confirmation`

- **Request:** `{ booking_id?: string, order_id?: string, phone: string, template_key: string }`
- **Response:** `{ queued: true, message_id: string }`
- **Side effects:** INSERT `messages_outbound` (`status='queued'` or `'pending_verification'` if the tenant's A2P campaign isn't yet vetted, G4) — actual Twilio send happens in the queue worker (§10), not inline, to keep this tool call fast
- **Idempotency:** unique on `(related_booking_id, template_key)` soft-checked before insert to avoid double-confirming on a Retell retry

#### 7.2.8 `transfer_call` configuration (not a `/voice/tools` HTTP call)

`transfer_call` is a **native Retell function**, not one of our tool-webhook
endpoints — it's configured entirely in the compiled agent: the destination
number is compiled in from `agent_configs.transfer_number` at publish time
(never a runtime tool argument, G6), and the compiler attaches the
warm-transfer context-summary payload (SYSTEM_DESIGN §4.5: "warm transfers
always carry a context summary") using Retell's transfer-with-context
mechanism (verify exact API shape — `transfer_call` tool config /
`custom_sip_headers` / handoff summary field — against current Retell docs,
Rule 1, before compiler implementation). Our only runtime involvement is
that `/voice/events`' `call_ended` handler records `disconnection_reason =
'transferred'` and the transcript-so-far as the summary source.

### 7.3 `/voice/events`

| | |
|---|---|
| Route | `POST /functions/v1/voice-events` |
| verify_jwt | `false` — HMAC signature auth |
| Auth | Retell webhook signature over raw body |
| Purpose | ingest `call_started`, `call_ended`, `call_analyzed` events; verify → dedup → fast-ack → background processing |

**Request schema** (canonical, per event type — verify field names against
current Retell docs):
```ts
{ event: "call_started" | "call_ended" | "call_analyzed"; call: RetellCallObject }
```

**Processing pipeline** (all three event types share this shape):
1. Verify HMAC signature against raw body → 401 fail-closed on failure.
2. `insert into webhook_events (source, event_id, event_type, payload,
   signature_verified) values ('retell', call.call_id || ':' || event,
   event, payload, true) on conflict (source, event_id) do nothing
   returning id` — if no row returned, this exact event was already
   processed; return 200 immediately (idempotent redelivery, and tolerant of
   **out-of-order delivery**: `call_ended` arriving before `call_started` is
   handled by each branch being an `upsert`/`update ... where` rather than
   assuming row existence, per SYSTEM_DESIGN §8).
3. Fast-ack: return `200` to Retell immediately after the dedup insert
   succeeds.
4. Background work (via `pg_net` async call to a `-background` variant of
   this function, or `EdgeRuntime.waitUntil` per Supabase's documented
   background-task pattern — verify current mechanism, Rule 1):
   - `call_started`: `insert into call_logs (tenant_id, phone_number_id,
     retell_call_id, caller_number, started_at, is_test_call) values (...)
     on conflict (retell_call_id) do nothing`; `is_test_call` computed by
     comparing `caller_number` to `tenants.owner_test_phone` (G13).
   - `call_ended`: `update call_logs set ended_at=..., duration_seconds=...,
     disconnection_reason=... where retell_call_id=...`; enqueue a
     `recording-fetch` pgmq message (recordings must be pulled within Retell's
     <10-minute availability window, SYSTEM_DESIGN §2); insert `cost_events`
     rows from `call.call_cost.product_costs[]` (each entry → one row); insert
     a `usage_events` row (`minutes = duration_seconds/60`, `is_billable =
     not is_test_call`); trigger notification fan-out (§10) for booking/
     order/message confirmations tied to this call if not already sent
     in-call.
   - `call_analyzed`: `update call_logs set classification=..., outcome=...,
     sentiment=..., call_successful=..., call_summary=..., follow_up_needed=...,
     extracted_entities=..., state_trace=..., variable_values=...,
     legal_advice_given=... where retell_call_id=...`; if
     `legal_advice_given = true`, fire an immediate admin alert (§9); if
     `urgency_flag` wasn't already set in-call and analysis retroactively
     flags an emergency-vertical red flag, set it now and alert (belt-and-
     suspenders — the in-call global-intent escape is the primary guarantee,
     analysis is the backstop).

**Response schema:** `200 { received: true }` on success/dedup-noop; `401`
signature failure.

**Latency budget:** the synchronous portion (verify + dedup insert + ack)
targets < 300ms; background work is unbounded but the recording pull has its
own <10-minute hard deadline enforced by the queue worker's retry/alert
policy, not by this function's request/response cycle.

**Idempotency:** the `webhook_events` unique constraint is the mechanism;
every downstream write is additionally an `upsert`/conditional `update` so a
duplicate background-task execution (e.g. a queue redelivery) is also safe.

**Nightly reconciliation** (§8) re-fetches Retell's `get-call` for any
`call_logs` row where `call_analyzed` never arrived within a window (webhook
loss safety net) — SYSTEM_DESIGN §2/§8.

### 7.4 `/webhooks/stripe`

| | |
|---|---|
| Route | `POST /functions/v1/webhooks-stripe` |
| verify_jwt | `false` |
| Auth | Stripe signature header (`Stripe-Signature`) verified via the Stripe SDK's `constructEvent` against the raw body and `STRIPE_WEBHOOK_SECRET`; fail closed |
| Purpose | subscription lifecycle, invoice/payment events, meter-event ack |

**Request schema:** Stripe `Event` object (verify current API version pinned
in `STRIPE_API_VERSION` against Stripe's docs, Rule 1).

**Events handled:**
| Event type | Action |
|---|---|
| `checkout.session.completed` | mark tenant `status='active'`, store `stripe_subscription_id`, kick off the provisioning saga (§7.9) if not already started |
| `customer.subscription.updated` | sync `tenants.status` (`past_due`, `paused`, `canceled` mapping) |
| `customer.subscription.deleted` | `status='canceled'`, kick off offboarding wind-down (number port-out SLA, data export, G7) |
| `invoice.paid` | `billing_invoices.status='paid'`, triggers referral-qualification eligibility re-check |
| `invoice.payment_failed` | dunning flow entry, tenant-facing banner + email |
| `charge.succeeded` / `payout.paid` | insert `payment_processing_events` with actual fee/net from `balance_transaction` |
| `billing.meter_event.error` (if applicable per current Meters API) | admin alert — a usage report to Stripe failed, financial-integrity risk |

**Response:** `200 {received:true}` fast, all business logic in background
work identical in shape to §7.3.

**Side effects:** as above; every write goes through `webhook_events` dedup
first (`source='stripe'`).

**Idempotency:** `webhook_events` unique `(source, event_id)` using Stripe's
`event.id`.

### 7.5 `/webhooks/outreach`

| | |
|---|---|
| Route | `POST /functions/v1/webhooks-outreach` |
| verify_jwt | `false` |
| Auth | Smartlead/Instantly webhook signature or shared-secret header per that provider's current docs (Rule 1 — confirm which of the two is selected before coding; interface is provider-agnostic at the handler level, one adapter module per provider) |
| Purpose | ingest reply/open/click/bounce/complaint events for the outreach engine |

**Request schema:** provider-specific (verify against current docs);
normalized internally to:
```ts
{ campaign_external_id: string; lead_email_or_phone: string;
  event: "reply" | "open" | "click" | "bounce" | "complaint" | "unsubscribe";
  body?: string; occurred_at: string; provider_message_id?: string }
```

**Side effects:** `send_events` status update; on `reply`, insert into
`replies` and enqueue a Claude intent-classification call (async, populates
`ai_intent`); on `bounce`/`complaint`/`unsubscribe`, upsert `suppression_list`
and increment `campaigns.complaint_rate` — auto-pause the campaign
(`status='paused'`) if the rolling complaint rate crosses 0.3% (CAN-SPAM
hard rule, SYSTEM_DESIGN §11).

**Idempotency:** `webhook_events` dedup on `(source='outreach', event_id)`
where `event_id` is the provider's message/event id.

### 7.6 `/webhooks/pos` (per adapter)

One route, adapter dispatched by a path segment or a `provider` field
resolved from the tenant's connected integration; each adapter is a separate
module under `packages/adapters/*` implementing the shared `IntegrationAdapter`
interface (`syncCatalog`, `pushBooking/pushOrder`, `checkAvailability`,
`handleWebhook`, `refreshAuth` — MASTER_PLAN §1).

| | |
|---|---|
| Route | `POST /functions/v1/webhooks-pos/{provider}` |
| verify_jwt | `false` |
| Auth | per-provider signature scheme, verified inside that adapter's `handleWebhook` before any shared logic runs |

| Adapter | Signature scheme | Webhook payload note | Two-way sync behavior (G11) |
|---|---|---|---|
| Shopmonkey | per Shopmonkey's current docs (verify, Rule 1) | assumed to carry the changed-object id | poll-back on a schedule (job §8) if no cancellation webhook exists; else webhook-driven |
| ezyVet | per ezyVet's current docs (verify, Rule 1) | | same poll-back fallback pattern |
| Square (restaurant) | HMAC-SHA256(`notificationUrl + rawBody`), base64 (legacy-verified shape, `CLOVER_CRUD_DOCUMENTATION.md` salvage note — **re-verify against Square's current docs before coding**, only the shape is carried forward as a starting hypothesis) | webhook carries the changed object id; fetch full object after, matching the Clover pattern where webhooks carry no payload | Square's own change-feed/webhook is used directly where available |
| Google/Outlook Calendar | OAuth-scoped webhook (push notifications channel) per each provider's current docs | | polling fallback (`DECIDE:` — recommend polling as the primary mechanism for the generic calendar adapter since push-notification channel renewal adds meaningful ops overhead for the most "long-tail solo operator" adapter; revisit if latency complaints arise) |
| Cloudbeds | per current docs (Wave 3, opportunistic) | | |
| Clio / Follow Up Boss / NexHealth | per current docs (Wave 2/3) | | |

**Shared side effects across all adapters:** `handleWebhook` normalizes the
provider event into a canonical `{type: 'booking_changed'|'order_changed'|
'auth_revoked', external_id, changes}` shape; `auth_revoked` marks the
tenant's adapter connection `disconnected` and fires a dashboard banner +
notification (salvaged "adapter revocation handling" feature, generalized to
all adapters per SYSTEM_DESIGN §14) — pushes are never silently dropped
after a revocation, the tenant sees the disconnect immediately.

**Idempotency:** `webhook_events` dedup per `(source=provider, event_id)`;
`pushBooking`/`pushOrder` calls carry the same `idempotency_key` used
internally so a retried push doesn't create a duplicate on the external
system (where that system supports an idempotency header — otherwise a
pre-check-by-external-id read, adapter-specific).

### 7.7 `/admin/*`

| | |
|---|---|
| Route prefix | `/functions/v1/admin-*` (one function per resource area, or one function with internal routing — `DECIDE:` recommend one function with internal path routing mirroring the legacy `restaurants` function's segment-dispatch pattern, since Supabase Edge Functions have per-function cold-start overhead and the admin surface is low-QPS, favoring fewer functions) |
| verify_jwt | `true` (Supabase-verified JWT required) |
| Auth | JWT `app_metadata.platform_admin = true` **and** session AAL2 (`auth.aal2`) — checked explicitly in code, not just implied by RLS; endpoints performing sensitive actions (impersonation, refunds, template publish) additionally require AAL2 confirmed within a short freshness window (`DECIDE:` recommend 15 minutes, re-challenge after) |

**Endpoint groups:**

| Group | Examples | Notes |
|---|---|---|
| Tenants | `GET /admin-tenants`, `GET /admin-tenants/:id`, `PATCH /admin-tenants/:id` (override), `POST /admin-tenants/:id/impersonate` | impersonation mints a short-lived scoped session and writes `admin_actions` (`impersonate_start`/`_end`) — G15 |
| Margin cockpit | `GET /admin-cockpit/waterfall`, `/per-customer-margin`, `/per-call-cost`, `/repricing-drift`, `/bottleneck`, `/alerts` | reads from the views in §6 + `cost_events`/`revenue_events` directly for drill-down |
| Config Lab | `GET/POST /admin-config-lab/simulate` | runs "what-if" margin projections against `platform_settings` price-card edits without committing them |
| Referral P&L | `GET /admin-referrals`, `POST /admin-referrals/:id/payout-override` | |
| CAC | `GET /admin-cac` | reads `cac_events` joined to `leads`/`campaigns` |
| Alerts | `GET /admin-alerts`, `PATCH /admin-alerts/:id/ack` | surfaces the alert-evaluation job's output (§8) |
| Templates | `GET/POST/PATCH /admin-templates`, `POST /admin-templates/:id/publish` | publish runs the compiler + Retell adapter publish call, writes `admin_actions` |
| Support | `GET/PATCH /admin-support-requests`, `POST /admin-support-requests/:id/notes` | |
| Outreach | `GET/POST /admin-outreach/leads`, `/campaigns`, `/funnel` | |
| Feature flags | `GET/PATCH /admin-flags` | G35, staged rollout for template/code changes |

**Error responses:** `401` no/invalid JWT; `403` JWT valid but not a
platform admin, or AAL2 required and not met; `404`/`409`/`422` per-resource
validation. **Side effects:** every mutating call writes `admin_actions`
with before/after snapshots. **Latency:** no hot-path budget (admin
console), standard web latency targets apply. **Idempotency:** mutating
endpoints accept an optional `Idempotency-Key` header, checked against a
short-lived cache/`admin_actions` lookup for POSTs that create resources
(template publish, payout override).

### 7.8 `/api/demo-agent`

| | |
|---|---|
| Route | `POST /functions/v1/api-demo-agent` |
| verify_jwt | `false` (public marketing-site flow) — rate-limited by IP/session instead |
| Auth | none required to call; abuse mitigated via rate limiting + a CAPTCHA/turnstile check at the marketing-site layer before this function is invoked |
| Purpose | scrape a business's public site → sanitize → seed a personalized demo agent → return a web-call token + demo phone number |

**Request schema:** `{ business_name: string, url: string, vertical?: string }`

**Response schema:** `{ demo_session_id: string, retell_call_token: string,
demo_phone_e164: string, agent_summary: { business_name, hours_detected,
services_detected } }`

**Side effects:** scrapes the URL (server-side fetch, timeout-bounded),
extracts hours/services/contact info via an LLM pass, **sanitizes
scraped content of instruction-like patterns before injection** (G21 —
strip/escape anything resembling a system-prompt override, e.g. text
containing "ignore previous instructions" or role-play framing, before it
ever reaches a dynamic variable or prompt fragment); creates an ephemeral
`agent_configs`-like row scoped to the demo session (not a real tenant —
`DECIDE:` recommend a dedicated `demo_sessions` table mirroring the subset
of `agent_configs` fields needed, expiring after 24h via a cron sweep,
rather than overloading the real tenant tables with non-billing rows);
mints a Retell web-call token server-side (secret never reaches the
browser, per `FRONTEND_STACK.md`).

**Error responses:** `400` invalid URL/unreachable site (falls back to a
generic template with just `business_name`, never a hard failure — the demo
must always produce *something* per the <60s promise in SYSTEM_DESIGN §9);
`429` rate limited.

**Latency budget:** target end-to-end < 60s per the "personalized demo agent
<60s" product requirement (SYSTEM_DESIGN §9); scrape+LLM extraction is the
dominant cost — run with an aggressive timeout and the generic-template
fallback rather than ever blocking past it.

**Idempotency:** re-submitting the same URL within a short window returns a
cached demo session rather than re-scraping (keyed on normalized URL).

### 7.9 `/api/provision`

| | |
|---|---|
| Route | `POST /functions/v1/api-provision` |
| verify_jwt | `true` |
| Auth | authenticated tenant owner (JWT `app_metadata.tenant_id` matches the target tenant, role `owner`), OR triggered internally by the Stripe webhook handler (`service_role`) on `checkout.session.completed` |
| Purpose | saga: tenant row → compiled agent → Twilio number → Retell import → billing wiring |

**Saga steps** (each step idempotent and independently retryable; a
`provisioning_state` column/table tracks progress — `DECIDE:` recommend a
dedicated `provisioning_runs` table: `id, tenant_id, step, status, error,
attempts, updated_at` so retries and the progress-screen UI both read the
same source of truth):

1. **Tenant finalize** — mark `tenants.status` moving from `trialing`
   toward `active` pending the rest of the saga; idempotent upsert.
2. **Agent compile** — resolve `agent_templates` for the tenant's vertical,
   create `agent_configs` row, run the compiler, call the Retell adapter's
   create-agent API → store `retell_agent_id`/`retell_llm_id`.
   *Compensation:* if a later step fails, the created Retell agent is left
   in place (cheap, no compensation needed) but not marked `published_at`.
3. **Twilio number provision** — purchase/assign a number in Twilio,
   register CNAM (G9), insert `phone_numbers` row.
   *Compensation:* release the Twilio number back if step 4 fails
   irrecoverably (retry budget exhausted).
4. **Retell number import** — import the Twilio number into Retell, bind to
   the agent from step 2.
   *Compensation:* on failure, retry with backoff; after N attempts, flag
   for manual admin intervention rather than auto-releasing the number (a
   half-provisioned tenant should alert, not silently unwind revenue-bearing
   state).
5. **Billing wiring** — confirm Stripe subscription is active (may already
   be true if this saga was triggered by the Stripe webhook), attach the
   Stripe Meter for usage-based minutes.
   *Compensation:* none destructive; retries only.
6. **Publish agent** — final Retell publish call, set `agent_configs.
   published_at`, flip `tenants.status='active'`.
7. **Notify** — SMS/email the tenant "you're live" + kick off the forwarding
   wizard (§7.10).

**Response schema:** `{ provisioning_run_id: string, status: "in_progress" }`
immediately; the frontend polls or subscribes to the tenant-scoped realtime
channel for progress (the `provisioning_runs` table gets its own broadcast
trigger, or the progress screen polls `GET /api-provision/:run_id` —
`DECIDE:` recommend realtime broadcast for consistency with the rest of the
dashboard's update model).

**Error responses:** `409` provisioning already in progress/complete for
this tenant; `422` missing required signup data (vertical, business hours).

**Latency budget:** no hot-path constraint; target full saga completion
under ~2 minutes for the onboarding UX, each external API call individually
timeout-bounded with retry/backoff.

**Idempotency:** the whole saga is re-entrant — calling it again for a
tenant with a `provisioning_runs` row already at a given step resumes from
there rather than re-running completed steps (each step checks for its own
already-created resource, e.g. "does `phone_numbers` already have a row for
this tenant" before purchasing another number).

### 7.10 Forwarding verification test-call endpoint

| | |
|---|---|
| Route | `POST /functions/v1/forwarding-verify` |
| verify_jwt | `true` |
| Auth | authenticated tenant owner/admin |
| Purpose | drive the per-carrier forwarding wizard's automated verification call |

**Request schema:** `{ tenant_id: string, carrier_hint?: string }`

**Flow:** places (or instructs the tenant to place, per the wizard's current
step) a test call to the tenant's existing business line to confirm the
carrier-specific conditional-forward code was entered correctly; listens for
the call to land on the Retell agent (via a correlation token embedded in
the test call's dynamic variables) within a timeout window.

**Response schema:** `{ verified: boolean, detected_carrier?: string,
next_step?: "retry" | "try_full_forward" | "complete" }` → on success,
UPDATE `phone_numbers.forwarding_verified_at`, `forwarding_carrier`.

**Error responses:** `408` timeout (no correlated call arrived) → wizard
shows carrier-specific retry copy; `422` invalid tenant/number state.

**Latency budget:** bounded by the verification window (`DECIDE:` recommend
45–60s timeout matching a realistic call-forward round trip), not the hot-
path budget — this is an onboarding-flow function, called once per setup
attempt.

**Idempotency:** re-running verification for the same tenant simply
re-attempts; no duplicate-write risk (`forwarding_verified_at` is a single
UPDATE).

---

## 8. Scheduled jobs (pg_cron)

All jobs are registered via `cron.schedule(name, schedule, $$ ... $$)` and
call either a Postgres function directly or invoke an edge function via
`pg_net.http_post` for anything needing external API calls (Stripe, Twilio,
Retell) — DB-internal jobs (rollups, availability roll-forward) run as plain
SQL/PLpgSQL; jobs needing third-party HTTP run as thin SQL wrappers around
`pg_net` calls to a dedicated `-job` edge function.

| Job | Schedule | What it does | Failure behavior |
|---|---|---|---|
| **Queue worker poll** | `*/1 * * * *` (every minute; pgmq itself is pull-based, this cron just ensures a worker cycle runs even with no live listener) | drains `messages_outbound_queue`, `recording_fetch_queue`, `adapter_push_queue` (§9) — reads a batch, dispatches, acks/deletes on success | failed messages stay invisible until visibility timeout expires, then retry; after N retries moved to each queue's dead-letter queue and an alert fires |
| **Nightly get-call reconciliation** | `0 3 * * *` (03:00 UTC) | for every `call_logs` row older than 15 minutes with `classification is null` (i.e. `call_analyzed` webhook never arrived), calls Retell's `get-call` API and backfills analysis fields | per-call failures logged, not fatal to the batch; a tenant with persistent reconciliation failures triggers an admin alert |
| **Availability window roll-forward** | `0 4 * * *` (04:00 UTC) | for every active `resources` row, calls `fn_regenerate_availability_slots` to extend the materialized window by one day (keeping the 14–30 day rolling window full) | per-resource failure logged; does not block other resources; a resource stuck without fresh slots for >48h alerts |
| **Usage rollup** | `10 0 * * *` (00:10 UTC, after midnight local-ish batch settle) | calls `fn_upsert_usage_daily` for every tenant for the prior UTC day (`DECIDE:` — tenant-timezone-exact daily boundaries would be more correct for the dashboard's date-range pill UI; recommend rolling up per tenant using that tenant's local previous day rather than a single UTC cutoff — the job iterates tenants and passes each tenant's local "yesterday" date) | per-tenant failure logged, retried once; persistent failure alerts (feeds billing, so silent failure is a financial-integrity risk) |
| **Billing cycle → Stripe meter events** | `0 1 * * *` (01:00 UTC daily; actual invoice generation is monthly, keyed off each tenant's billing anchor date) | for tenants whose billing period just closed, reads `usage_daily` for the period, computes overage against `included_minutes`, reports usage to Stripe Billing Meters, generates a `billing_invoices` row (idempotent on `unique(tenant_id, period_start, period_end)`) | failure leaves the tenant's invoice in `draft`/absent and retries next run; an invoice stuck un-finalized past the grace window alerts finance |
| **Retention sweep** | `0 5 * * *` (05:00 UTC) | deletes Storage objects (`recordings/{tenant}/*`) older than `tenants.retention_days`, nulls the corresponding `call_logs` recording URL columns (§6) | per-object failure logged, retried next run; never blocks on a single failed delete |
| **Churn scoring** | `0 6 * * *` (06:00 UTC) | recomputes a per-tenant churn-risk score from usage trend, support-ticket volume, payment-failure history; writes to a `tenants` metadata field or a dedicated `churn_scores` table (`DECIDE:` recommend a small `churn_scores(tenant_id, score, factors jsonb, computed_at)` table rather than overloading `tenants`, since it's a derived/overwritable rollup, not tenant identity) | failure logged; stale scores are acceptable for a day, not alerted unless failing repeatedly |
| **Weekly value emails** | `0 14 * * 1` (Monday 14:00 UTC) | sends each active tenant a "here's what your AI did this week" summary (calls answered, bookings captured, revenue attributed) via the email provider (§10) | per-tenant send failure logged to `messages_outbound` with `status='failed'`; not retried same week (next week's job supersedes) |
| **Referral qualification + payout batch** | qualification: `0 7 * * *` (07:00 UTC daily) calls `fn_check_referral_qualification`; payout batch: `0 8 1 * *` (1st of month, 08:00 UTC) batches `commission_events` where `status='accrued'` into a PayPal Payouts batch call, creates `referral_payouts` | qualification failure retried next day; payout batch failure leaves commissions `accrued` (not lost) and alerts finance for manual retry |
| **Retell health check / failover** | `*/2 * * * *` (every 2 minutes, G5) | synthetic test-call or Retell status API probe; on N consecutive failures, flips Twilio routing (via Twilio API) from Retell-import to forward-to-owner-cell + voicemail, SMS's the tenant, marks a platform-wide incident flag; on recovery, auto-restores | the check itself failing to run (cron/infra issue) is the worst case — monitored externally via the status-page automation (SYSTEM_DESIGN §8), not just by this job's own success |
| **Alert evaluation** | `*/5 * * * *` (every 5 minutes) | evaluates the alert rules from SYSTEM_DESIGN §11 cockpit spec: price drift >8% (compare `cost_events.raw` unit costs against a baseline in `platform_settings`), negative margin (from `v_tenant_margin`), usage spike ≥2.5× trailing average, concurrency ≥80% of purchased Retell concurrency, tool-failure spike (from the circuit-breaker's emitted stats), commission > margin, payment failures — writes/updates rows in an `alerts` table (`DECIDE:` add `alerts(id, rule, severity, tenant_id nullable, payload jsonb, status, created_at, acked_at, acked_by)` — not enumerated in SYSTEM_DESIGN §6's table list explicitly but required by the cockpit's "alert rules" page; treated here as part of the admin domain) and fires push/email to platform admins on new/escalating alerts | evaluation failure alerts on itself via the external status-page monitor, same reasoning as the health-check job |
| **Keep-warm ping** | `*/3 * * * *` (every 3 minutes, SYSTEM_DESIGN §5) | pings `/voice/inbound` and `/voice/tools` with a lightweight no-op request to keep the edge function instance warm and the DB connection pool primed | a missed ping is self-healing next cycle; not alerted unless the *target* function itself starts erroring (that's the alert-evaluation job's concern, not this one's) |

`DECIDE:` exact cron timing above (the specific minute/hour offsets) is a
reasonable default schedule, not a hard requirement — tune to avoid thundering-
herd overlap once real job durations are measured; the ordering constraint
that matters is: usage rollup runs before the billing-cycle job on any day
both fire, and availability roll-forward/retention sweep have no ordering
dependency on anything else.

---

## 9. Queues (pgmq)

| Queue | Message shape | Visibility timeout | Dead-letter handling |
|---|---|---|---|
| `messages_outbound_queue` | `{ message_id: uuid }` (pointer to a `messages_outbound` row; worker reads full row, dispatches via the channel's provider, updates status) | 30s (SMS/email send should complete well under this) | after 5 attempts, row status → `failed`, moved to `messages_outbound_dlq` (a companion pgmq queue) for manual admin review; tenant-facing dashboard shows the failure |
| `recording_fetch_queue` | `{ call_id: uuid, retell_call_id: text, attempt: int }` | 60s | after 8 attempts (spread to stay within Retell's <10-minute recording-availability window per SYSTEM_DESIGN §2), moved to `recording_fetch_dlq`; alert fires — a lost recording is a support/QA problem worth a human look |
| `adapter_push_queue` | `{ tenant_id: uuid, adapter: text, entity_type: "booking"|"order", entity_id: uuid, idempotency_key: text, attempt: int }` | 45s | after 6 attempts, moved to `adapter_push_dlq`; tenant dashboard shows a "sync failed" banner on the affected booking/order (never silent, per the adapter-revocation-handling salvaged principle extended to generic push failures) |
| `outreach_send_queue` | `{ lead_id: uuid, campaign_id: uuid, step_index: int }` | 30s | after 3 attempts, moved to `outreach_send_dlq`; does not retry indefinitely to avoid CAN-SPAM-adjacent repeated-send risk on a flaky provider response |

All four queues are created via `pgmq.create('<queue_name>')`; workers use
`pgmq.read(queue, vt, qty)` + `pgmq.delete`/`pgmq.archive` on success,
matching current pgmq API (verify exact function names/signatures against
Supabase's pgmq docs at build time, Rule 1). Dead-letter queues are plain
pgmq queues named `<queue>_dlq`, populated by the worker itself after
exhausting retries (pgmq has no native DLQ primitive as of the researched
version — verify whether a newer version adds one before building this by
hand).

---

## 10. Notification fan-out

### 10.1 SMS

Path: Retell/Twilio — the same Twilio account that owns the phone numbers
sends tenant- and customer-facing SMS (booking confirmations, after-hours
messages, usage alerts, weekly value emails' SMS-summary variant if used).
**A2P 10DLC states** (G4): the platform registers as a reseller brand;
`campaigns.status`/a tenant-level `a2p_status` field (`DECIDE:` add to
`tenants` or a small `tenant_a2p_status` table: `pending_verification` →
`verified` → possibly `failed`) drives an explicit "SMS pending
verification (1–5 business days)" state shown on the dashboard, with email
used as the fallback confirmation channel during that window — **never
silently failing** a confirmation because SMS isn't yet vetted.
`messages_outbound.status = 'pending_verification'` is the row-level
manifestation of this state; the queue worker checks tenant A2P status
before attempting an SMS send and routes to email instead when pending.

### 10.2 Email

`DECIDE:` **Resend vs Postmark — recommend Resend.** Reasoning: Resend's
API/DX is closer to the rest of the stack's TypeScript-first tooling
(official SDK, React Email templates integrate cleanly with the
`packages/ui` component approach already chosen for the frontend), pricing
at this scale (transactional volume: confirmations, alerts, weekly value
emails, support notifications — low hundreds/thousands per month at 50
tenants) is comparable to Postmark, and Resend's deliverability/reputation
tooling has matured enough by 2026 to not be the deciding factor either way.
Postmark remains the fallback pick if Resend's current domain-reputation
posture or support responsiveness proves inadequate during Week 0 evaluation
— verify current pricing/limits/deliverability reputation against both
providers' live docs before locking in (Rule 1), this is a recommendation,
not a verified-final choice.

Templates: `booking_confirmation`, `booking_cancelled`,
`after_hours_message`, `usage_alert_80`, `usage_alert_100`,
`weekly_value_summary`, `support_ticket_update`, `a2p_pending_fallback`,
`referral_payout_receipt`, `dunning_payment_failed`. All rendered
server-side from `messages_outbound.payload` at send time (not
pre-rendered at enqueue time), so a template fix doesn't require replaying
already-queued messages.

### 10.3 Airtable sync

One-way push (tenant's booking/order data → their own Airtable base, opt-in
integration) plus **conflict handling** (G30): the adapter records the
`last_synced_at` and a content hash per pushed record; if the tenant
manually edited the Airtable row since last sync (detected via Airtable's
own `Last Modified Time` field exceeding our `last_synced_at`), the next
push does **not** silently overwrite — it flags a `sync_conflict` on the
dashboard and skips that record until the tenant acknowledges (one-way push
+ change-detection warning, per SYSTEM_DESIGN §11). Upsert shape: Airtable
record matched by a stored `airtable_record_id` on the Heyloo-side
`bookings`/`orders` row (added as a nullable column, `DECIDE:` — or a small
`airtable_sync_state(tenant_id, entity_type, entity_id, airtable_record_id,
last_synced_at, content_hash)` side table, recommended over adding columns to
`bookings`/`orders` to keep those tables adapter-agnostic per the
`IntegrationAdapter` isolation principle in CLAUDE.md Rule 2).

### 10.4 Browser push

Web Push (VAPID keys) for the tenant dashboard's "new booking" toast even
when the tab isn't focused; subscription endpoints stored per-user (not
per-tenant, since a membership can have multiple users) in a
`push_subscriptions(user_id, endpoint, keys jsonb, created_at)` table
(`DECIDE:` add this table — not enumerated in SYSTEM_DESIGN §6 but implied
by "browser push" in the notification fan-out requirement); fan-out fires
from the same trigger path as the realtime broadcast (§3.4), as a secondary
async delivery, not a replacement for it — the dashboard's live feed already
gets the realtime update, push is for the not-currently-looking case.

---

## 11. Auth model

### 11.1 Roles

| Role | Where it lives | Scope |
|---|---|---|
| Tenant owner | `memberships.role = 'owner'` | full tenant CRUD, billing, seat management, agent config edits, manual mode toggle |
| Tenant member | `memberships.role = 'member'` (an `'admin'` sub-role also exists for a trusted non-owner staff member with most owner powers minus billing/seat management — `DECIDE:` confirm whether `'admin'` is needed at launch or `'owner'`/`'member'` alone suffice; the schema in §1.1 already includes it since removing a role later is cheaper than adding one under RLS) | day-to-day dashboard use: view calls/bookings/customers, respond to support tickets, cannot change billing or transfer_number |
| Platform admin | `platform_admins` row | full cross-tenant admin cockpit access, gated by AAL2 for sensitive actions |
| Referral partner | `referral_partners.user_id` set | partner-portal-only access to their own link/referrals/payouts, no tenant data |

A single `auth.users` row can hold more than one of these simultaneously
(e.g. a platform admin who is also a referral partner) — the JWT claims hook
(§3.1) sets whichever `app_metadata` fields apply, and RLS predicates for
each domain check only the field relevant to that domain.

### 11.2 JWT claims shape

```json
{
  "sub": "auth-user-uuid",
  "app_metadata": {
    "tenant_id": "tenant-uuid-or-absent",
    "role": "owner|admin|member",
    "platform_admin": true,
    "referral_partner_id": "partner-uuid-or-absent"
  },
  "aal": "aal1|aal2"
}
```
`tenant_id`/`role` are absent for users with no membership (e.g. a
referral-partner-only account); `platform_admin` is only ever present (and
`true`) for platform admins, never present-and-false (RLS predicates use
`coalesce(..., false)` accordingly, §5). A user belonging to multiple
tenants (`DECIDE:` — multi-tenant membership is schema-supported via
`memberships` having no uniqueness on `user_id` alone, but the hook above
picks one `limit 1` row) resolves their active tenant via a tenant-switcher
UI flow that triggers a session refresh scoped to the selected tenant
(passing a `tenant_id` hint the hook reads, or — simpler — the hook enumerates
all memberships into `app_metadata.tenant_ids: []` and the frontend/RLS use
an explicitly-selected one from a separate claim; **recommend**: since v1
scope has one owner-operated tenant per user as the common case, ship the
`limit 1` single-tenant hook first and defer true multi-tenant-per-user
switching to when a real multi-location/multi-brand operator shows up
(relates to G26)).

### 11.3 AAL2 admin flows

Platform admin login requires MFA enrollment (Supabase Auth MFA, TOTP);
`admin_actions`-writing endpoints check `auth.aal2` (or the JWT `aal` claim)
explicitly in code (§7.7) rather than trusting RLS alone, since RLS can gate
row access but the "was this session AAL2-elevated within the last N
minutes" freshness check is an application-layer concern. Session AAL2
freshness `DECIDE:` recommend 15 minutes, matching common admin-console
conventions, re-prompt for MFA challenge after.

### 11.4 API token auth (tenant external access)

Tenant-facing API tokens (`api_tokens`, §1.9) authenticate **not** via
Supabase JWT but via a bearer token the tenant includes on requests to a
dedicated `/api/v1/*` surface (distinct from the dashboard's cookie-session
Supabase auth, per `FRONTEND_STACK.md`'s "no tokens in localStorage" rule —
this is a *server-to-server* token, not a browser credential). Verification:
edge function hashes the presented token (`sha256`) and looks up
`api_tokens.token_hash`, checks `revoked_at is null`, sets a synthetic
tenant-scoped context for the rest of the request (equivalent RLS effect to
the JWT hook's `tenant_id`, achieved here by the edge function running as
`service_role` and explicitly filtering every query by the resolved
`tenant_id` — CLAUDE.md Rule 2's "every secret-key edge function still
explicitly filters by a verified tenant_id" applies directly). Scopes
(`api_tokens.scopes`, e.g. `["read"]`, `["read","write"]`) are checked
per-endpoint before any query runs. `last_used_at` is updated async
(fire-and-forget) to avoid taxing every authenticated request with a
synchronous write.

---

## 12. Completeness self-check

Everything requested in the assignment is specified above with one
exception noted per item below; items marked `DECIDE:` inline throughout
are genuinely open decisions with a stated recommendation, not gaps in the
specification itself. Known incompleteness, honestly:

1. **Exact Retell webhook/tool-call field names** (`/voice/inbound`,
   `/voice/tools`, `/voice/events` request schemas) are given in the
   canonical shape this spec assumes based on SYSTEM_DESIGN's description of
   Retell's model, not verified against Retell's live current API reference
   — per CLAUDE.md Rule 1, the build agent for T2/T3 must fetch Retell's
   current docs before finalizing the Zod validators at these boundaries.
   Same caveat applies to the exact `transfer_call` context-summary
   mechanism (§7.2.8) and the Custom Access Token Hook's registration
   mechanism and `realtime.broadcast_changes` signature (§3.1, §3.4).
2. **Per-adapter webhook signature schemes** for Shopmonkey, ezyVet,
   Cloudbeds, Clio, Follow Up Boss, NexHealth, and the Google/Outlook
   Calendar adapter (§7.6) are marked for Rule-1 verification rather than
   specified — only Square's (carried from the legacy Clover/Square salvage
   notes) and the general shape are given with any confidence, and even that
   is flagged for re-verification.
3. **Availability slot subdivision granularity** (§3.2) is sketched as a
   function shape with the exact per-vertical subdivision logic left as a
   `DECIDE:` for T1 implementation — the hot-path *query* contract (indexed
   range-overlap read) is fully specified; the generation-time subdivision
   rule per vertical (30-min increments vs per-night vs per-appointment-slot)
   needs one line of vertical-specific logic each, deferred to avoid
   guessing eight verticals' real scheduling granularity without owner/
   vertical-research input beyond what SYSTEM_DESIGN §4.3 already implies.
4. **Churn scoring model, segment thresholds, and alert-rule numeric
   constants** beyond those SYSTEM_DESIGN already states (price drift >8%,
   usage spike 2.5×, concurrency 80%) are placeholders pending real usage
   data — flagged `DECIDE:` at each occurrence (§3.6, §8) rather than
   invented with false precision.
5. **`alerts` and `push_subscriptions` tables**, and a `provisioning_runs`
   / `demo_sessions` / `churn_scores` / `airtable_sync_state` /
   `tenant_a2p_status` table each, are introduced in this spec (§7.7, §7.8,
   §7.9, §8, §10.3, §10.4) as necessary supporting structures implied by the
   assignment's own requirements (admin alerts, browser push, provisioning
   progress, demo sessions, churn scores, Airtable conflict tracking, A2P
   state) but **not** explicitly named in SYSTEM_DESIGN §6's table list —
   each is marked `DECIDE:` at its point of introduction with the reasoning
   for why it's a separate table rather than an overload of an existing one;
   flagged here so build agents know these are spec-author additions, not
   SYSTEM_DESIGN omissions to cross-check against.
6. **Multi-tenant-per-user JWT claims** (§11.2) ship a single-tenant `limit
   1` hook by design recommendation, with true switching deferred — this is
   a scoped-down decision, not an unspecified one, but is called out because
   it interacts with G26 (multi-location) and should be revisited together.
7. **Exact cron schedule offsets** (§8) are a reasonable default, explicitly
   flagged as tunable rather than load-tested — no production traffic exists
   yet to tune against.
8. **Email provider final choice** (§10.2) is a reasoned recommendation
   (Resend) per the assignment's explicit request to pick one, not a
   verified decision — Week 0 should confirm current pricing/deliverability
   for both candidates before the integration is built against either SDK.

Nothing in the assignment's six numbered requirement areas was left
unaddressed; every `DECIDE:` above carries a concrete recommendation so a
build agent can proceed without blocking on it, per CLAUDE.md Rule 4 ("append
to `docs/BUILD_NOTES.md` and proceed with the documented decision").
