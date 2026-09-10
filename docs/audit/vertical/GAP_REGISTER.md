# Heyloo Vertical Audit — Gap Register

Synthesized from 8 per-vertical audit reports (auto, vet, legal, dental,
real_estate, motel, restaurant, generic) in this directory. Read-only
synthesis — no repo files touched, no git.

---

## 1. CROSS-VERTICAL GAPS (shared by 2+ verticals)

Ordered by how many verticals are affected and blast radius. Every item
below was independently found in at least two of the eight audits.

### 1.1 `AgentState.extraction[]` never compiled into Retell post-call analysis
**Affects:** legal, dental, vet, real_estate (declared/needed), and
structurally every vertical since the compilers are shared.
**Symptom:** `zAgentState.extraction` is declared in canonical types and
authored on states (legal's `legal_advice_given`, vet's emergency states),
but grep across all three compile targets shows zero references to
`extraction`/`post_call_analysis`/`custom_analysis` anywhere in
`packages/adapters/retell/src/compiler/{conversation-flow,multi-prompt,single-prompt,index}.ts`,
and `packages/adapters/retell/src/agents.ts`'s create/update-agent request
body never sets `post_call_analysis_data`. Downstream,
`supabase/functions/voice-events/handler.ts`'s `handleCallAnalyzed` reads
`call.call_analysis.custom_analysis_data.*` keys that are never populated —
`urgency_flag`, `legal_advice_given`, `emergency_detected`, `classification`,
`sentiment`, `follow_up_needed` are all permanently null/false in production.
**Exact fix:**
- Add a `toPostCallAnalysisData(states: AgentState[]): RetellPostCallAnalysisField[]`
  lowering function in `packages/adapters/retell/src/compiler/index.ts` (or a
  new `extraction.ts` in that dir) that walks every state's `extraction[]`
  and emits Retell's `post_call_analysis_data` array (type: boolean/string/
  number/enum, per Retell's Post-Call Data Extraction docs).
- Call it from all three compile targets (`conversation-flow.ts`,
  `multi-prompt.ts`, `single-prompt.ts`) and attach the result to whatever
  request shape each of `RetellConversationFlowRequest` /
  `RetellMultiPromptRequest` / `RetellSinglePromptRequest` (`types.ts`) uses.
- Wire the compiled field into `agents.ts`'s create-agent/update-agent body
  (currently omits it entirely).
- Since this is the single highest-leverage fix in the whole audit (it
  unblocks dental's emergency triage, vet's emergency catch, legal's
  compliance signal, and every vertical's `classification`), it should be
  its own work item, not bundled into a per-vertical task.

### 1.2 Waitlist offer never reaches `waitlist_entries`
**Affects:** auto, vet, legal (implicitly via take_message overload), dental,
real_estate, motel (opts out but same root cause noted), restaurant,
generic — i.e. essentially every vertical that uses
`WAITLIST_OFFER_FRAGMENT`.
**Symptom:** The shared fragment
(`packages/templates/src/shared/fragments.ts`) instructs the model to record
a waitlist request via `take_message` with a free-text `"Waitlist request:"`
prefix. `waitlist_entries` (`supabase/migrations/20260907130600_booking_core.sql:135-153`)
is a fully-built table with a GIST window index and an auto-notify-on-cancel
trigger consumed by `supabase/functions/webhooks-twilio-sms/handler.ts:49-87`
(SMS reply-YES auto-rebook) — but nothing anywhere inserts into it from a
voice call.
**Exact fix:**
- Add a `join_waitlist` canonical tool: `zJoinWaitlistRequest` in
  `packages/canonical-types/src/tools.ts` (fields: `customer` name/phone,
  `resource_type`/`offering_id?`, `preferred_window_start`,
  `preferred_window_end`, `notes?`).
- Add its Zod schema to `supabase/functions/_shared/schemas/voice-tools.ts`
  and a new handler `supabase/functions/voice-tools/tools/join_waitlist.ts`
  that does a single tenant-scoped INSERT into `waitlist_entries` (idempotent
  on `(tenant_id, idempotency_key)` like `create_booking.ts`).
- Add `joinWaitlistTool()` to `packages/templates/src/shared/tools.ts` and
  splice it into every vertical currently importing
  `WAITLIST_OFFER_FRAGMENT`, updating the fragment's instruction from "use
  take_message" to "call join_waitlist".
- Add a dashboard "Waitlist" card query in apps/web (several audits note the
  card already exists but is permanently empty).

### 1.3 Per-vertical `dynamic_variable_overrides` never forwarded to the live call
**Affects:** auto (tow_partner_name/phone, vehicle_makes_serviced,
cancellation_policy_text), legal (practice_areas, consult_fee_cents), motel
(rate_table, deposit_policy, cancellation_policy), restaurant (menu_text,
cancellation_policy_text, tax_rate_bps) — i.e. every vertical with
tenant-configured template placeholders, and `cancellation_policy_text`
specifically is shared/universal.
**Symptom:** `supabase/functions/voice-inbound/handler.ts:120-145` builds the
`dynamic_variables` object sent to Retell but only ever copies
`manager_name/manager_phone/parking_info/accessibility_notes/
accepted_payment_types` — the generic/base override keys. It never reads
`agent_configs.dynamic_variable_overrides` for any vertical-specific key, so
every `{{token}}` the templates reference beyond the base five is spoken to
the caller as a literal unresolved placeholder or silently dropped.
Compounding this, `zAgentDynamicVariables`/`VoiceInboundDynamicVariablesSchema`
don't declare the missing keys at all, so there's no validation surface
either.
**Exact fix:**
- Extend `VoiceInboundDynamicVariablesSchema` (wherever
  `zAgentDynamicVariables` lives, referenced from
  `supabase/functions/voice-inbound/handler.ts`) to declare the full union of
  per-vertical override keys (tow_partner_name, tow_partner_phone,
  vehicle_makes_serviced, practice_areas, consult_fee_text, rate_table,
  deposit_policy_text, menu_text, tax_rate_bps, cancellation_policy_text).
- Rewrite `handler.ts:120-145` to flatten `agent_configs.dynamic_variable_overrides`
  generically (iterate the vertical's own override schema rather than a
  hardcoded 5-key allowlist), with per-type formatters where needed (e.g. a
  cents→"$X.XX" formatter for `consult_fee_cents` → `consult_fee_text`, and a
  rate-table array→human-readable-string formatter for motel).
- Add the missing formatter fields to the relevant `z*Overrides` schemas in
  `packages/canonical-types/src/agent-template.ts` (legal needs
  `consult_fee_text`; motel's `zMotelOverrides` needs its `rate_table`/
  `deposit_policy` shape reconciled with what `vertical-details.ts` actually
  collects — see 1.6 below).

### 1.4 No per-node tool locking — every tool reachable from every state
**Affects:** all verticals compiled via `conversation-flow.ts` (auto, dental,
vet, motel, restaurant, real_estate, generic) and single/multi-prompt
targets, since it's the same compiler.
**Symptom:** `packages/adapters/retell/src/compiler/conversation-flow.ts:23-34`
and `types.ts:12-28` compile every `AgentState` to a plain Retell
Conversation Node, which has no `tool_id`/`tool_ids` scoping — every declared
tool is available at every node, so `AgentState.allowed_tools` is prose-only
steering, not a structural guarantee. This directly contradicts
SYSTEM_DESIGN §4.1's "tool-backed nodes only... model cannot invent" goal,
and is called out independently by the auto, dental, restaurant, and motel
audits (motel's own `RETELL-VERIFY` code comment already flags it).
**Exact fix (per auto's audit, confirmed via WebSearch of docs.retellai.com,
direct WebFetch blocked by egress proxy — re-verify against current docs
before implementing):**
- Retell's Function Node (single tool, deterministic-on-entry, "wait for
  result" branching) is the documented mechanism for hard-locking one tool to
  one node — use it for any state whose `allowed_tools` is a singleton (e.g.
  `create_booking`-only states), and Retell's Logic Split node for branching
  on a tool's structured return value (see 1.5).
- Add a `compileToolLockedNode()` path in `conversation-flow.ts` that emits a
  Function Node when `state.allowed_tools.length === 1`, falling back to the
  current plain Conversation Node (with a comment explaining why) when a
  state genuinely needs multiple tools live.
- Because this is a compiler-level structural change, write it once, then
  re-run `packages/templates/src/red-team/structural.test.ts` (extend it to
  assert per-node tool restriction, not just canonical `allowed_tools`
  declarations) across all 8 templates before shipping.
- Log the re-opened decision in `docs/BUILD_NOTES.md` since SYSTEM_DESIGN
  §4.1 already anticipated this and the compiler's own comment previously
  dismissed it as requiring SubagentNode — this is new evidence it doesn't.

### 1.5 Tool-result branching is soft-prompt, not structural
**Affects:** restaurant explicitly (`slot_selected`,
`none_available_and_caller_declines_waitlist` transitions), motel
(check_availability result never structurally gates create_booking), and
implicitly every vertical using `conversation-flow.ts`.
**Symptom:** Predicate transitions after a tool call compile to the same
soft `type:'prompt'` `transition_condition` as free-text user-intent
transitions (`conversation-flow.ts:74-85`) — branching on the tool's actual
structured return value relies on model recall, not the return payload.
**Exact fix:** Use Retell's Logic Split node type (deterministic branch on a
prior tool-call result/variable) for any `AgentState` transition whose
canonical type is `predicate-on-tool-result` (a new field to add to the
transition schema, e.g. `packages/canonical-types/src/agent-template.ts`'s
transition union) rather than free-text intent. Compile it in
`conversation-flow.ts` alongside the Function Node change in 1.4 — they're
the same class of fix (stop treating deterministic outcomes as prose).

### 1.6 Per-vertical config schema drift between tenant-facing form and template consumer
**Affects:** motel (`deposit_policy`/`rate_table` shape mismatch between
`verticalDetailsSchema` and `zMotelOverrides`), legal (no `consult_fee_text`
field to hold what the fee guardrail needs), restaurant (`tax_rate_bps`,
`menu_text`, `tenant_geocode` read at runtime but absent from
`zRestaurantOverrides` and the Settings UI), real_estate (zero
vertical-specific override keys and no Settings UI branch at all).
**Symptom:** `packages/canonical-types/src/schemas/vertical-details.ts` (the
tenant-facing form schema) and each vertical's `z*Overrides` in
`packages/canonical-types/src/agent-template.ts` (what the template/compiler
actually expects) were built independently and have incompatible shapes —
so even a diligent tenant filling out the dashboard form can produce data
the runtime can't consume, or has no field to enter data the runtime reads.
**Exact fix:**
- Treat `vertical-details.ts` and each `z*Overrides` schema as one contract:
  for every field a template's fragments/system-prompt reference via
  `{{token}}`, require a matching field in both schemas with the *same*
  representation (e.g. motel's rate table as `Array<{room_type: string,
  nightly_rate_cents: number}>` in both places, not dollars-as-Record on one
  side and cents-as-array on the other).
  - Add a build-time or test-time consistency check (a small script or a
    `.test.ts` in `packages/canonical-types`) that diffs the token set each
    vertical's compiled prompt references (via `system-prompt.ts` +
    `fragments.ts`) against the keys its `z*Overrides` schema declares —
    this would have caught essentially every "config exists in DB but never
    reaches the call" finding in this audit set.
- Add the missing Settings UI branches for real_estate and restaurant's
  missing fields in apps/web's vertical-details page.

### 1.7 `bookings.structured_payload` / `call_logs.structured_booking_payload` are dead columns everywhere
**Affects:** auto, vet, generic explicitly (real_estate/restaurant/motel/
dental share the same "no defined keys" root cause under different naming).
**Symptom:** Every vertical's most information-dense in-call capture
(vehicle info, pet species/breed, buyer/seller qualification, room
type/rate, allergy/special instructions) is asked for conversationally but
has no typed destination: `structured_payload` is `{type: object}` with no
`properties` in the JSON Schema sent to Retell (so the model gets no
authoring hint), no vertical's system prompt instructs populating it, and
even when `create_booking.ts` does persist whatever object it receives,
`apps/web`'s bookings list/detail pages never select or render the column.
`call_logs.structured_booking_payload` is asked for by the dashboard's
"Linked booking" card in multiple verticals but literally never written by
any function in the repo.
**Exact fix:**
- Define one discriminated-union Zod schema per vertical for the booking
  payload shape (e.g. `zAutoBookingPayload`, `zVetBookingPayload`,
  `zRealEstateBookingPayload`) in `packages/canonical-types/src/` (a new
  `booking-payloads.ts`), keyed by `vertical`, and reference it from
  `zCreateBookingRequest.structured_payload` instead of bare `object` — this
  both gives the model an authoring schema (Retell surfaces JSON Schema
  `properties` in the tool definition, which measurably improves fill rate)
  and gives `create_booking.ts` something typed to validate against before
  insert.
  - Also update each vertical's relevant states in `packages/templates/src/verticals/*.ts`
    to instruct populating specific keys (e.g. auto-repair.ts's
    vehicle-details state should say "call create_booking with
    structured_payload: { vehicle_year, vehicle_make, vehicle_model,
    symptom_category, drop_off_or_wait }").
- Update `apps/web`'s bookings list/detail pages (and call detail page) to
  select and render `structured_payload` / `structured_booking_payload`
  (currently `bookings/page.tsx:36` selects only id/start_at/status/
  customer_id).
- Actually write `call_logs.structured_booking_payload` from whichever
  handler owns the call-completion path (likely
  `supabase/functions/voice-events/handler.ts`), sourced from the same
  typed payload the booking tool received.

### 1.8 `customers.metadata` (vehicles/pets history) never written
**Affects:** auto (`vehicles`), vet (`pets`) — same root cause, same fix
shape, and likely the same pattern for any future vertical with a
recurring-asset customer profile (e.g. real estate's saved listings, though
not yet built).
**Symptom:** `customers.metadata` is documented as holding vertical-specific
recurring info and `lookup_customer`'s response schema declares a
`vehicles`/`pets` field for it, but `create_booking.ts` only ever upserts
`name/phone_e164/consent` — `metadata` is never written, so returning
customers can never have this info recalled, and (compounding it) most
verticals never even call `lookup_customer` on the new-booking path (only on
reschedule/cancel).
**Exact fix:**
- Extend `create_booking.ts`'s customer upsert to merge
  `structured_payload`'s vehicle/pet fields (once 1.7 lands) into
  `customers.metadata` via a `jsonb` merge (`metadata = metadata || $new`),
  scoped per vertical.
- Add `lookup_customer` to `allowed_tools` on each vertical's initial
  greeting/new-booking states (not just reschedule/cancel), and instruct the
  prompt to use its `vehicles`/`pets` result to skip re-asking known info.

### 1.9 `canonical-types` tool schemas have drifted from the runtime-enforced schemas
**Affects:** cross-cutting — flagged independently in auto, dental, restaurant,
generic audits.
**Symptom:** Two files both claim to be the single source of truth for tool
contracts and disagree: `packages/canonical-types/src/tools.ts` (e.g.
`zCreateBookingRequest` missing `consent`, `zUpdateBookingRequest`/
`zCancelBookingRequest` missing `verify`) vs.
`supabase/functions/_shared/schemas/voice-tools.ts` (the schema actually
enforced at the runtime edge function, which does have both). This directly
violates CLAUDE.md Rule 2's single-source-of-truth invariant.
**Exact fix:**
- Make `supabase/functions/_shared/schemas/voice-tools.ts` import and
  re-export (or `.extend()`) the schemas from
  `packages/canonical-types/src/tools.ts` rather than re-declaring parallel
  Zod objects — if Supabase Edge Functions can't import the workspace
  package directly (bundling constraint), generate the edge-function schema
  file from the canonical one at build time and add a CI check that fails
  if they diverge (a snapshot/diff test), rather than hand-maintaining two
  copies.
- Add `consent` to `zCreateBookingRequest` and `verify` to
  `zUpdateBookingRequest`/`zCancelBookingRequest` in `tools.ts` immediately
  as the concrete unblock.

### 1.10 `create_order` has no `consent` field (booking's does)
**Affects:** restaurant explicitly; any future commerce-capable vertical
inherits the same gap since `create_order` is the shared order tool.
**Fix:** Add `consent` to `zCreateOrderRequest`
(`packages/canonical-types/src/tools.ts:189-236`) and
`supabase/functions/_shared/schemas/voice-tools.ts:101-119`, and persist it
in `create_order.ts` the same way `create_booking.ts:72-98` does for
consent.

### 1.11 Dashboard never surfaces the signals the schema already has
**Affects:** all verticals — `urgency_flag`, `call_summary`, `sentiment`,
`follow_up_needed`, `legal_advice_given`, `consent`, `structured_payload`
are consistently captured (where they're captured at all) but never
selected/rendered by any `apps/web` page. This is downstream of 1.1 and 1.7
(nothing to show because nothing is written), but it is also an independent
gap — even the few fields that ARE written today (e.g. `customers.consent`)
still aren't shown.
**Fix:** Once 1.1/1.7 land, do one dashboard pass: extend the `select()` in
`apps/web`'s bookings list/detail and calls list/detail pages to include
these columns, and add UI for them (urgency badge, consent indicator,
structured-payload card). This is a single, mechanical, cross-vertical
dashboard task — do not fork it per vertical.

### 1.12 Reschedule/cancel and cancellation-policy readout coverage is inconsistent
**Affects:** real_estate (BLOCKER — no `manage_booking` state, no
`update_booking`/`cancel_booking` tools at all), generic (same gap), motel/
restaurant/dental/vet/auto (have the states but cancellation-policy fragment
omission varies — real_estate and generic never speak
`{{cancellation_policy_text}}` at all despite the dashboard forcing every
tenant, including these two verticals, to configure one).
**Fix:** Add `manageBookingState()` + `updateBookingTool()`/
`cancelBookingTool()` + `IDENTITY_FALLBACK_FRAGMENT` to
`packages/templates/src/verticals/real-estate.ts` and `generic.ts`, mirroring
`auto-repair.ts`/`dental.ts`/`veterinary.ts`. Splice
`CANCELLATION_POLICY_READOUT_FRAGMENT` into both templates' `buildSystemPrompt`
calls, or — if a vertical genuinely has no cancellation concept — remove the
forced field from `verticalDetailsSchema` for that vertical rather than
collecting configuration that's never spoken. NOTE: real_estate's compiled
prompt is already measured at 1,022 words / 5 tools, at/over Retell's
documented single-prompt viability ceiling — adding tools/fragments here
must be paired with trimming existing prose, or with revisiting whether
real_estate should compile via `conversation_flow`/`multi_prompt` instead of
`single_prompt`. Flag that tradeoff decision in `docs/BUILD_NOTES.md` per
CLAUDE.md Rule 4 rather than silently choosing.

### 1.13 `transfer_call` for the generic/message-first vertical is a non-functional no-op
**Affects:** generic specifically, but the underlying mechanism (compiled as
an ordinary custom webhook tool with no special-casing in any compiler or in
`agents.ts`) is the same `transfer_call` used everywhere else — other
verticals rely on Retell's native transfer node/feature working, generic is
the one place the audit caught it silently falling through to
`/voice-tools`' unknown-tool fallback.
**Fix:** Audit whether every vertical's `transfer_call` is actually wired to
Retell's native transfer mechanism (per current docs.retellai.com — verify,
don't assume) versus falling through as a dead custom tool; add a compiler
test that asserts `transfer_call` compiles to Retell's real transfer node
type for every registered template, not just generic.

---

## 2. PER-VERTICAL TOP GAPS

### Auto repair
1. **BLOCKER** — `dynamic_variable_overrides` (tow_partner_name/phone,
   vehicle_makes_serviced, cancellation_policy_text) never forwarded by
   `voice-inbound/handler.ts:120-145` → unresolved `{{token}}` spoken on the
   tow-referral and mandatory cancellation-policy lines (see 1.3).
2. No typed shape for vehicle year/make/model/symptom/drop-off — dumped into
   untyped `structured_payload` (see 1.7); `customers.metadata.vehicles`
   never written (see 1.8).
3. No `join_waitlist` tool (see 1.2).
4. `lookup_customer` only called on reschedule/cancel, never on new bookings
   — repeat customers re-dictate vehicle info every call (see 1.8).
5. `canonical-types` tools.ts drift (see 1.9).

### Veterinary
1. **BLOCKER** — `AgentState.extraction` never lowered to Retell post-call
   analysis (see 1.1) → the emergency-detection retroactive safety net
   (`emergency_detected`) and `urgency_flag` are permanently dead; not even
   surfaced in `calls-list-client.tsx` if it worked.
2. Pet name/species/breed/age/visit-reason have no typed destination;
   `create_booking.ts` never writes `bookings.notes`, which the ezyVet/
   Shopmonkey pushers (`worker-adapter-push/handler.ts`) actually read for
   pet context — fix: write `bookings.notes` directly from a
   `visit_reason`/pet-summary field in `create_booking.ts`, in addition to
   the typed `structured_payload` fix in 1.7.
3. No `join_waitlist` tool (see 1.2); `customers.metadata.pets` never
   written and no vet state calls `lookup_customer` (see 1.8).
4. `check_time` never passes `offering_id`/`resource_type` based on
   symptom_or_routine — routine/sick/procedure visits book identical-duration
   slots. Fix: have the `symptom_or_routine` state pass a
   vertical-specific `offering_id` lookup (new small tool or a static
   tenant-configured mapping) into `check_availability`.
5. `registry.ts` keys the template `'veterinary'` while the canonical
   vertical slug is `'vet'` — landmine for provisioning; rename the registry
   key to match `packages/canonical-types/src/vertical.ts`'s slug.

### Legal
1. **BLOCKER** — same `extraction` pipeline gap as vet (see 1.1), here
   killing `legal_advice_given`, the vertical's own named compliance signal.
2. **BLOCKER** — `practice_areas`/`consult_fee_cents` never forwarded to the
   live call (see 1.3) → the fee guardrail has no number to enforce.
3. **BLOCKER** — no `take_message` fallback spliced into `legal.ts` (missing
   `takeMessageFallbackState()`, present in every other vertical) → a
   `human_request` global intent firing before `intake_complete` silently
   discards the whole intake including the conflict-check answer. Fix: add
   `takeMessageFallbackState()` to `packages/templates/src/verticals/legal.ts`
   the same way `auto-repair.ts`/`dental.ts` do.
4. `matter_type`, opposing-party/conflict-check answer, referral source have
   no structured persistence — everything lands in one free-text
   `take_message.message_text` column, and is lost entirely if the call
   doesn't reach the terminal state. Fix: add a legal-specific structured
   tool or extend `take_message`'s schema with optional
   `matter_type`/`opposing_party`/`urgency` fields, written even on an early
   `human_request` exit.
5. `lookup_customer` declared but never wired into any state's
   `allowed_tools` — dead tool.

### Dental
1. **BLOCKER** — same `extraction` pipeline gap (see 1.1): `pain_triage`
   declares no extraction fields to begin with, and even if it did nothing
   would lower them. Fix both: add extraction fields to the `pain_triage`
   state in `packages/templates/src/verticals/dental.ts`, and land 1.1.
2. Promised "secure link for DOB/insurance" has zero implementation — no SMS
   template, no hosted intake form, no distinct `template_key`. Fix: this is
   new product surface (a hosted form + a `messages_outbound` template),
   size it as its own build item rather than folding into the conversation
   fix.
3. `new_or_existing` answer discarded (see 1.7); no offering/appointment-type
   selection step so `bookings.offering_id` is always null — add a
   `list_offerings`-style tool or a static config-driven offering picker
   state before `check_time`.
4. No `join_waitlist` (see 1.2); no redaction step if a caller volunteers
   DOB/insurance anyway — residual PHI in transcript/recording with no
   mitigation (flag to `docs/BUILD_NOTES.md`, real design decision needed,
   not silently redesigned per CLAUDE.md Rule 4).

### Real estate
1. **BLOCKER** — no reschedule/cancel path at all (see 1.12) — a universal
   call class this vertical structurally cannot handle.
2. **BLOCKER** — zero structured capture of buyer/seller, area, pre-approval,
   timeline, budget (the vertical's whole qualification value, and it has
   the highest avg-transaction-value of any vertical) — see 1.7; on the
   showing-booked path this data is lost entirely (not even in a message).
3. No "already working with another agent" question anywhere (a real
   compliance/norms question for the industry) — this is a spec-level gap,
   not just a template gap; append to `docs/BUILD_NOTES.md` for
   SYSTEM_DESIGN §4.3 to address, not silently added by the template author.
4. No showing-confirmation SMS (`sendSmsConfirmationTool()` absent from
   `real-estate.ts`'s tools, unique among booking verticals).
5. Cancellation-policy config is entirely dead for this vertical (see 1.12);
   zero per-vertical `dynamic_variable_overrides` and no Settings UI branch
   (see 1.6). Compiled prompt already at 1,022 words/5 tools — any fix here
   needs a trim-or-retarget decision (see 1.12 note), flagged not silently
   redesigned.

### Motel
1. **BLOCKER** — no dashboard page or provisioning path creates/edits
   `public.resources` rows at all — a motel tenant cannot configure room
   inventory, so `availability_slots` can never populate and
   `check_availability` always returns none-available. Fix: build a
   `resources` management page in `apps/web`'s tenant dashboard (net-new
   surface, size as its own work item).
2. **BLOCKER** — even with resources configured, `check_availability`'s
   `resource_type` filter only matches the coarse `resources.type` enum
   (`'room'`), with no room-type/rate-tier dimension — `offering_id` is
   accepted by both tool schemas but never used in
   `check_availability.ts`'s SQL (dead parameter). Fix: add a room-type
   dimension (either a proper `offering_id` filter wired into the SQL, or a
   new `resources.room_type` column) and use it in the WHERE clause.
3. **BLOCKER** — `rate_table`/`deposit_policy`/`cancellation_policy`
   overrides never forwarded (see 1.3) — the anti-hallucination rate
   guarantee has nothing to enforce against.
4. **BLOCKER** — `create_booking.ts` hard-codes `status='confirmed'` on every
   insert, never `'scheduled'`, contradicting MASTER_SPEC §3.2's "held
   scheduled until paid" requirement for motel; no expiry job exists either.
   Fix: parameterize `create_booking.ts`'s status by vertical/deposit-policy
   (motel → `'scheduled'` when a deposit is required), and add a `pg_cron`
   job to expire unpaid `scheduled` bookings past a TTL.
5. Quoted nightly rate never passed to/stored by `create_booking` (unlike
   `create_order`/`send_payment_link`, which do persist amounts) — add a
   `quoted_rate_cents` field to `zCreateBookingRequest`'s
   `structured_payload` (see 1.7) and require the motel template to pass it.
6. `verticalDetailsSchema` vs `zMotelOverrides` shape mismatch for
   `deposit_policy`/`rate_table` (see 1.6).

### Restaurant
1. **BLOCKER** — `menu_text`/`cancellation_policy_text` never populated at
   call time (see 1.3) — the agent cannot state its own menu.
2. **BLOCKER** — no allergy/`special_instructions` field anywhere in
   `create_order`'s schema or the `orders` table, despite the template
   mandating an explicit allergy ask. Fix: add `allergies`/
   `special_instructions` to `zCreateOrderRequest`
   (`packages/canonical-types/src/tools.ts:189-236`) and to
   `supabase/migrations/*booking_core.sql`'s `orders` table (new additive
   migration), then persist in `create_order.ts`.
3. **BLOCKER** — `check_availability` accepts `party_size` but never filters
   by `resources.capacity` — fix in `check_availability.ts:38-53`, add a
   `capacity >= party_size` predicate to the SQL.
4. **BLOCKER** — saved-default-delivery-address flow doesn't exist:
   `lookup_customer.ts:42-83` never queries `customer_addresses` and nothing
   writes to it, so `create_order.ts`'s delivery-radius check
   (:110-157) can never run. Fix: either build the `customer_addresses`
   write/read path, or (cheaper) remove the "saved address" claim from the
   template's prompt until it's built — flag the choice in
   `docs/BUILD_NOTES.md`.
5. **BLOCKER (backend)** — POS adapter push is completely broken:
   `create_order.ts:211-219` enqueues `{adapter:'pos', ...}` but
   `ADAPTER_PUSHERS` in `worker-adapter-push/handler.ts:606-611` only knows
   `'square'/'shopmonkey'/'ezyvet'/'google_calendar'` — every restaurant
   order silently fails to reach the POS, even for a fully-connected Square
   tenant whose push branch (`handler.ts:224-303`) is otherwise complete.
   Fix: change `create_order.ts`'s enqueue key from `'pos'` to `'square'`
   (or dispatch by the tenant's actual connected POS type).
6. `tax_rate_bps` read at runtime but absent from `zRestaurantOverrides` and
   the Settings UI — always computes $0 tax (see 1.6). No `create_order`
   `consent` field (see 1.10).

### Generic
1. **BLOCKER** — `transfer_call` is a non-functional no-op, generic's only
   non-message escalation path (see 1.13).
2. **BLOCKER** — `post_call_analysis_data` never configured (see 1.1) — most
   classification/urgency signal never reaches the dashboard.
3. No reschedule/cancel path and no cancellation-policy readout (see 1.12) —
   the one booking-capable vertical missing both.
4. `message_text`/`callback_window`/`caller_name` captured but invisible in
   the dashboard (see 1.11); `call_logs.structured_booking_payload` selected
   by the dashboard but never written (see 1.7); no `join_waitlist` (see
   1.2).
5. Compiled prompt duplicates the warm-transfer escape text 3x verbatim
   (~300+ avoidable words on the vertical's highest-volume, cheapest tier) —
   fix by de-duplicating the escape-text composition in whichever fragment
   builder assembles `global-intents.ts`'s human-request text into the
   single_prompt compile target (`single-prompt.ts`).

---

## 3. CONVERSATION ENGINE CHANGES (compiler/schema level)

Grounded in Retell's documented node types (Conversation Node, Function
Node, Logic Split Node, transfer/end-call nodes) and Post-Call Data
Extraction feature — re-verify exact current field names against
docs.retellai.com before implementing (audits note direct WebFetch was
proxy-blocked; WebSearch-sourced confirmations were used as a fallback and
should be re-checked per CLAUDE.md Rule 1).

1. **Post-call extraction lowering** (see 1.1) — new lowering pass in
   `packages/adapters/retell/src/compiler/`, consumed by all 3 compile
   targets and wired into `agents.ts`'s agent create/update body.
2. **Function-Node tool locking** (see 1.4) — `conversation-flow.ts` should
   emit Retell Function Nodes for single-tool states instead of universally
   using plain Conversation Nodes, closing the "every tool at every node"
   gap that both the compiler's own comments and 4 separate audits flag.
3. **Logic Split for tool-result branching** (see 1.5) — add a
   `predicate-on-tool-result` transition kind to the canonical transition
   schema (`agent-template.ts`) and compile it to Retell's Logic Split node
   instead of a soft prompt-type transition.
4. **Transfer-call native wiring audit** (see 1.13) — verify every
   template's `transfer_call` compiles to Retell's actual transfer mechanism,
   not a generic custom webhook tool that silently 404s at the dispatcher.
5. **Schema/token consistency check** (see 1.6) — a test that fails CI if a
   template's compiled prompt references a `{{token}}` with no matching key
   in that vertical's `z*Overrides` schema, and no matching field in
   `vertical-details.ts`'s tenant-facing form. This is the single test that
   would have caught the majority of the "config exists somewhere but never
   reaches the call" findings across every vertical.
6. **Typed `structured_payload`** (see 1.7) — replace the bare
   `{type:'object'}` JSON Schema on `create_booking`/`create_order` with a
   per-vertical discriminated union, both for model-authoring quality (Retell
   surfaces tool JSON Schema `properties` to the LLM) and for
   `create_booking.ts`/`create_order.ts` to validate against before insert.
7. **Prompt-length budget monitoring** — real_estate is already measured at
   1,022 words/5 tools, at/over Retell's own documented single_prompt
   viability ceiling; generic has ~300 words of avoidable duplication.
   Add a compile-time word/tool-count assertion (a small test in
   `packages/adapters/retell/src/compiler/index.test.ts`) that warns or fails
   when a compiled `single_prompt` target exceeds a documented threshold, so
   future per-vertical additions don't silently regress reliability.

---

## 4. BUILD PLAN — parallelizable work clusters

Each cluster is designed to touch a disjoint set of files so multiple agents
can work concurrently with minimal merge conflicts. Sequencing note: Cluster
A (engine) and Cluster D (DB fields) should land before Clusters B/C consume
them where a per-vertical fix explicitly depends on a new column/schema
(e.g. dental's pain_triage extraction field needs Cluster A's lowering pass
to have any effect; auto's tow-partner fix needs Cluster A's dynamic-variable
forwarding fix). Where a per-vertical task only needs its *own* template file
plus already-existing tools, it can start immediately in parallel.

### Cluster A — Conversation engine (compiler)
**Files:** `packages/adapters/retell/src/compiler/*.ts`,
`packages/adapters/retell/src/agents.ts`, canonical `agent-template.ts`
transition/extraction types.
**Work:** items 1.1, 1.4, 1.5, 1.13, engine changes 1–4 above.
**Acceptance criteria:**
- A template with `extraction` fields declared on a state compiles to a
  request body containing Retell's post-call-analysis-equivalent field,
  verified by a new compiler unit test (extend `index.test.ts`) and by a
  live Retell dry-run/sandbox call if available.
- A template state with a single-tool `allowed_tools` compiles to a Function
  Node (or documented equivalent), verified by a compiler snapshot test
  (`compiler/__snapshots__`).
- `transfer_call` compiles to Retell's real transfer mechanism for every
  registered template (new test iterating `packages/templates/src/registry.ts`).
- Simulation scenarios that must pass: legal's `legal_advice_given` red-team
  fixture (`red-team/injection-fixtures.ts`) now resolves to a populated
  `custom_analysis_data` field end-to-end, not just at the canonical-object
  level; vet's downplayed-emergency batch-simulation fixture
  (`injection-fixtures.ts:125-136`) actually flips `urgency_flag`/
  `emergency_detected` post-call.

### Cluster B — Dynamic-variable / per-vertical config pipeline
**Files:** `supabase/functions/voice-inbound/handler.ts`,
`packages/canonical-types/src/agent-template.ts` (`z*Overrides` schemas),
`packages/canonical-types/src/schemas/vertical-details.ts`, apps/web
vertical-details Settings UI pages.
**Work:** items 1.3, 1.6, and the per-vertical config gaps listed for auto,
legal, motel, restaurant, real_estate.
**Acceptance criteria:**
- Every vertical's compiled prompt tokens have a matching override schema
  key and dashboard form field (the consistency test from engine change 5).
- A tenant who fills in the Settings UI for tow-partner (auto),
  practice_areas/consult_fee (legal), rate_table/deposit_policy (motel), or
  menu_text/tax_rate (restaurant) gets that value spoken/enforced on a live
  call — verified by an integration test asserting `dynamic_variables` sent
  to Retell contains the resolved (not literal-token) value.
- Simulation scenarios: motel's rate-quote-from-table scenario, legal's
  fee-guardrail scenario, auto's tow-referral scenario, restaurant's
  tax-computation scenario — all from the respective audits' conversation
  fragments.

### Cluster C — Tools/backend (new tools, schema drift, adapter wiring)
**Files:** `packages/canonical-types/src/tools.ts`,
`supabase/functions/_shared/schemas/voice-tools.ts`,
`supabase/functions/voice-tools/tools/*.ts` (new `join_waitlist.ts`),
`packages/templates/src/shared/tools.ts`,
`supabase/functions/worker-adapter-push/handler.ts`.
**Work:** items 1.2 (join_waitlist), 1.9 (schema drift), 1.10 (create_order
consent), restaurant's POS adapter-key fix, motel's `status='confirmed'`
hard-code fix.
**Acceptance criteria:**
- `join_waitlist` tool exists, is race-proof/idempotent like
  `create_booking.ts`, and a voice call can insert a row that the existing
  SMS reply-YES consumer (`webhooks-twilio-sms/handler.ts:49-87`) correctly
  picks up — verified with an integration test round-tripping a waitlist
  insert through to an SMS-triggered auto-rebook.
- `canonical-types/tools.ts` and `_shared/schemas/voice-tools.ts` no longer
  diverge — either the same source or a CI diff check fails the build on
  drift.
- A restaurant order enqueued to a tenant with a connected Square account
  actually reaches Square (fix verified against Square's order-push API
  per CLAUDE.md Rule 1 documentation-first requirement).
- A motel booking with a deposit policy configured inserts with
  `status='scheduled'`, and a `pg_cron` job (new migration) expires it if
  unpaid past its TTL.

### Cluster D — DB fields / typed payloads
**Files:** new migration(s) under `supabase/migrations/` (timestamped,
additive per CLAUDE.md Rule 2), `packages/canonical-types/src/` (new
`booking-payloads.ts`), `create_booking.ts`, `create_order.ts`.
**Work:** item 1.7 (typed structured_payload per vertical), 1.8
(customers.metadata vehicles/pets write), restaurant's allergy/
special_instructions column, dental's offering_id capture, motel's
quoted_rate_cents.
**Acceptance criteria:**
- Every vertical has a defined Zod schema for its booking payload, and
  `create_booking.ts`/`create_order.ts` validate against it before insert
  (reject with a clear error on mismatch, don't silently drop fields).
- `customers.metadata` is populated from the typed payload on every booking
  and read back correctly by `lookup_customer.ts` on a repeat call.
- New migration(s) are additive-only, reproducible from zero, never edit an
  applied migration (per CLAUDE.md Rule 2).
- Simulation scenarios: auto's "repeat customer, vehicle already on file"
  call should skip the vehicle-info ask; restaurant's allergy-stated order
  should show `allergies` populated on the `orders` row; motel's booking
  dispute scenario should have `quoted_rate_cents` recoverable without a
  transcript re-listen.

### Cluster E — Dashboard surfacing
**Files:** `apps/web/src/app/[locale]/(tenant)/dashboard/bookings/**`,
calls list/detail pages, a new Waitlist card/page.
**Work:** item 1.11, plus per-vertical rendering of whatever Clusters C/D
produce (structured_payload, urgency_flag, consent, allergies, quoted rate).
**Acceptance criteria:** every column written by Clusters A/C/D is selected
and rendered somewhere in apps/web; this cluster should NOT need to touch
any backend/edge-function file, keeping it fully parallel with B/C/D once
their schemas are agreed (can start against mocked/fixture data before B/C/D
land, then wire to real columns).

### Cluster F — Per-vertical template authoring (auto, vet, legal, dental, real_estate, motel, restaurant, generic)
**Files:** `packages/templates/src/verticals/*.ts`,
`packages/templates/src/shared/{fragments,utility-states,tools}.ts`.
**Work:** the template-only items from Section 2 that don't require new
backend capability first — e.g. legal's missing `takeMessageFallbackState()`
splice, real_estate's `manageBookingState()`/`updateBookingTool()`/
`cancelBookingTool()` addition, generic's same, vet's `lookup_customer`
wiring into more states, dental's extraction-field declaration on
`pain_triage` (declaration can land now, lowering depends on Cluster A).
**Acceptance criteria:** `packages/templates/src/red-team/structural.test.ts`
passes for all 8 templates including newly-added states/tools (extend the
suite's `if (!manageState) continue` skip for real_estate/generic to a hard
assertion once the states exist); each vertical's compiled prompt word/tool
count stays under the single_prompt viability threshold from engine change 7
(or the vertical is explicitly moved to `conversation_flow`/`multi_prompt`
with that decision logged in `docs/BUILD_NOTES.md`).

---

## 5. OVERALL VERDICT (per vertical, one line each)

- **Auto:** Conversation authoring solid; data collection incomplete
  (no typed vehicle schema, dynamic variables unresolved); backend tools
  correctly race-proof but schema-drifted; lean/fast/secure — not yet
  production-ready due to pipeline gaps, not template quality.
- **Vet:** Emergency-triage conversation design is genuinely strong and
  structurally enforced; data collection (pet info) has no destination and
  the extraction pipeline that should catch missed emergencies is entirely
  dead; booking mechanics lean/secure/race-proof — not production-ready
  until the extraction and pet-data-capture gaps close.
- **Legal:** Best-authored prompt in the set (conflict-check ordering,
  no-advice guardrail); data collection for matter_type/conflict/urgency has
  no structured home and can be lost entirely on early exit; its own named
  compliance signal (legal_advice_given) is dead end-to-end; backend lean
  and authorization-correct — not production-ready, highest-stakes gaps of
  any vertical given per-call dollar exposure.
- **Dental:** Conversation branches (triage, PHI deferral, identity
  fallback) are well designed and tested; the vertical's single
  safety-critical feature (same-day emergency flag) is completely
  non-functional end-to-end; promised secure DOB/insurance link doesn't
  exist; booking mechanics solid — not production-ready.
- **Real estate:** Passes every shared structural guarantee but is the least
  operationally complete vertical: no reschedule/cancel capability at all,
  zero structured capture of its own (highest-value) qualification data,
  compiled prompt already at Retell's single_prompt ceiling; backend booking
  writes are correct/race-proof — not release-ready.
- **Motel:** Template itself is disciplined (rate-invention guardrails,
  identity fallback, consent, disclosure) and well-tested; the vertical is
  non-functional in practice because there is no way to configure room
  inventory at all and the rate/deposit/policy dynamic variables never reach
  a live call; hot-path SQL is correct but moot without data; not
  production-ready, most infrastructurally incomplete vertical.
- **Restaurant:** Conversation design (routing, read-backs, red-team
  resistance) is solid; four independent BLOCKERs (menu/policy never
  spoken, no allergy field, no capacity check, dead saved-address feature)
  plus a POS-adapter key mismatch that silently drops every order; hot path
  otherwise lean and idempotent — not production-ready, cannot complete a
  real order as designed today.
- **Generic:** Template composes cleanly and passes every structural/
  red-team guarantee; its only human-escalation path (transfer_call) is a
  functional no-op and post-call analysis is dead; message-first data
  (caller name, callback window, reason) is captured but invisible or lost
  in the dashboard; lean/fast with no elevated security exposure — a
  generic-tier caller gets a materially worse outcome than the prompt
  promises, not production-ready.

**Cross-vertical summary:** No vertical in this audit is currently
production-ready. The failures are overwhelmingly pipeline/wiring gaps
between well-designed conversation templates and an incompletely-wired
backend (post-call extraction never lowered, dynamic variables never
forwarded, structured payloads never typed, waitlist never real, canonical
schemas drifted from runtime schemas) rather than defects in the prompt/
conversation-design layer itself, which is consistently the strongest part
of the codebase across all 8 verticals. Booking-write mechanics
(idempotency, GIST-exclusion race-proofing, tenant-scoping, tool
authorization) are correctly and consistently built everywhere they were
checked. The single highest-leverage fix available is the post-call
extraction lowering pass (Section 1.1 / Cluster A) — it unblocks safety-
critical signals in three separate verticals (vet, dental, legal) with one
compiler change plus, on the per-vertical config side, the dynamic-variable
forwarding fix (Section 1.3 / Cluster B), which unblocks four verticals'
anti-hallucination/fee/policy guarantees with one handler change.
