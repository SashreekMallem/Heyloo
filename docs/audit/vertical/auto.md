# Auto Repair Vertical Audit — Heyloo

Template key `auto`, compile target `conversation_flow`.
Files read: `packages/templates/src/verticals/auto-repair.ts`, `packages/templates/src/shared/*`,
`packages/canonical-types/src/{agent-template,tools,voice-provider,schemas/vertical-details}.ts`,
`packages/adapters/retell/src/compiler/*`, `supabase/migrations/*`,
`supabase/functions/{voice-inbound,voice-tools,webhooks-twilio-sms,_shared}/**`,
`apps/web/src/{app/[locale]/(tenant)/dashboard/bookings/page.tsx,components/tenant/call-detail-client.tsx}`,
`docs/SYSTEM_DESIGN.md` §4.1–4.5, `docs/spec/BACKEND_SPEC.md`.

---

## Research summary

**Domain knowledge + WebSearch (labeled per item; direct `WebFetch` to
`docs.retellai.com` was blocked by the environment's egress proxy —
`EGRESS_BLOCKED` on both `/build/conversation-flow/node` and
`/build/conversation-flow/conversation-node`; findings below are from
WebSearch's indexed snippets of those same pages plus community threads,
not a live fetch — this should be logged to `docs/VERIFY.md` by whoever
next touches the compiler).**

**What a competent auto-shop phone front desk collects** (domain knowledge,
corroborated by WebSearch results — Paperform/AutoSoftWay/ChecklistGuro
intake-checklist pages):
- Caller name, callback phone, **vehicle year/make/model, VIN, mileage,
  license plate**; mileage matters for warranty eligibility and
  odometer-fraud/service-interval checks.
- The complaint in the caller's own words, specific rather than vague
  ("check-engine light on, rough idle after fueling, worse when cold" vs.
  "check engine light"), mapped by the advisor (never the caller) to a
  service category.
- Drop-off vs. wait-on-site, and whether a loaner/shuttle is needed.
- New vs. returning customer / vehicle on file (a repeat customer should
  not have to re-dictate their car).
- Insurance/collision-claim flag when relevant (body-shop side; not
  universal for general repair).
- Consent to text/call, and — in many US states (e.g. California's
  Automotive Repair Act) — a policy that no work proceeds beyond a written
  estimate without customer authorization; a diagnostic fee if one
  applies.
- Emergency/safety branch: brakes failing, smoke, a wreck just happened →
  refuse to advise "keep driving," refer to a tow partner, take contact
  info for a fast callback.
- Top shop management systems (PMS/DMS equivalents in this trade) a
  competent build should eventually integrate with: **Shopmonkey,
  Tekmetric, Mitchell1 Manager SE, AutoLeap, Shop-Ware** — all want
  VIN/year/make/model, mileage, complaint text, RO (repair-order) status,
  and customer contact as first-class fields.

**Retell `conversation_flow` node types** (WebSearch snippets of
`docs.retellai.com/build/conversation-flow/{node,conversation-node,
function-node,global-node}` — domain-knowledge gap-filled where the
snippet was thin):
- **Conversation Node**: holds a multi-turn spoken exchange, "supports
  multiple tools per node," stays active across turns/tool calls before
  transitioning — i.e. tools are *available*, not *locked*.
- **Function Node**: "executes a single tool/function deterministically
  on node entry — not for dialogue... if a tool must always run at a
  fixed point in the flow, use a function node." Supports
  `speak_during_execution`/"talk while waiting" and a "wait for result"
  toggle that lets the next edge branch directly on the tool's return
  value.
- **Subagent Node**: for a step that needs *both* free conversation and
  tool use in the same node.
- **Global Node**: `global_node_setting: {condition}` reachable from
  anywhere — used correctly here (see Strengths).
- **Press Digit / Logic Split / End Node**: IVR digit nodes, no-speech
  branch-only nodes, and a call-ending node with an optional closing line.

This directly contradicts this compiler's own documented conclusion (see
Finding CD-2 below): a **Function Node**, not a `SubagentNode`, is the
documented mechanism for "one tool locked to one step," and this compiler
never emits one.

---

## Data capture table

| Real-world field | Asked in template? (state/line) | Tool arg carrying it | DB column | Surfaced in dashboard? | Pushed to adapter? | Verdict |
|---|---|---|---|---|---|---|
| Caller name | `collect_name` (auto-repair.ts:93-97) | `create_booking.customer.name` | `customers.name` | Bookings list shows `customerName` (bookings/page.tsx:52) | n/a (no PMS adapter exists yet) | OK |
| Callback phone (digit read-back) | `collect_phone` (auto-repair.ts:99-104), `DIGIT_BY_DIGIT_READBACK_FRAGMENT` | `create_booking.customer.phone` | `customers.phone_e164` | Not shown on bookings list (only name); shown on customer detail page | n/a | PARTIAL |
| Vehicle year/make/model | `collect_vehicle` (auto-repair.ts:106-112) | **only** the generic `structured_payload: object` on `create_booking` (packages/templates/src/shared/tools.ts:53-77) — no typed `vehicle` field exists on the canonical tool schema | `bookings.structured_payload` jsonb, **freeform, no defined keys anywhere** (BACKEND_SPEC.md:1537 also types it as bare `object`) | **Not selected at all** — `bookings/page.tsx:36` query is `select("id, start_at, status, customer_id")`; `structured_payload` never appears in any `apps/web` file | No — `customers.metadata` (documented in migration comment as holding `"vehicles array (auto)"`, `20260907130400_customers.sql:28`) is **never written** by `create_booking.ts` (only `name`/`phone_e164`/`consent` are upserted, lines 63-69/94-98) | **MISSING** — collected on the call, has no reliable schema, and is invisible to the shop owner |
| Symptom → service category | `collect_symptom` (auto-repair.ts:114-121) | same undifferentiated `structured_payload` | same as above | same as above | same as above | **MISSING** |
| Drop-off vs. wait | `drop_off_or_wait` (auto-repair.ts:123-127) | same undifferentiated `structured_payload` | same as above | same as above | same as above | **MISSING** |
| Appointment time | `check_time` (auto-repair.ts:129-135) | `check_availability`/`create_booking.start/end` | `bookings.start_at/end_at` | shown (bookings/page.tsx:52) | n/a | OK |
| Consent (sms/call) | `CONSENT_ASK_FRAGMENT`, asked in `confirm_booking` | `create_booking.consent` | `customers.consent` jsonb (create_booking.ts:94-98) | Not surfaced in dashboard (grep found no UI reference) | n/a | PARTIAL |
| Cancellation policy read-out | `CANCELLATION_POLICY_READOUT_FRAGMENT` — `{{cancellation_policy_text}}` | n/a (spoken only) | tenant's own text lives in `agent_configs.dynamic_variable_overrides.cancellation_policy.text` (verticalDetailsSchema, `schemas/vertical-details.ts:13-15`) | n/a | **Never reaches the call** — see Finding CD-1 | **MISSING (broken pipe)** |
| Vehicle-makes-serviced check | intro line: *"Use `{{vehicle_makes_serviced}}`..."* (auto-repair.ts:38) | n/a (prompt-only judgment, no tool, no explicit branch) | `agent_configs.dynamic_variable_overrides.vehicle_makes_serviced` (verticalDetailsSchema:24) | n/a | **Never reaches the call** — see Finding CD-1 | **MISSING (broken pipe) + no structural branch (CD-4)** |
| Vehicle-safety emergency (tow referral) | `vehicle_safety_emergency` state, `{{tow_partner_name}}`/`{{tow_partner_phone}}` (auto-repair.ts:61-62) | `take_message` | `call_logs.message_text` | Not shown in call-detail UI (see Backend findings) | **Never reaches the call** — see Finding CD-1 | **MISSING (broken pipe) — a live safety-referral line will say a literal unresolved token or silently drop the name/number** |
| Reschedule/cancel identity fallback (name + time) | `manageBookingState()` (utility-states.ts:66-76), `IDENTITY_FALLBACK_FRAGMENT` | `update_booking.verify` / `cancel_booking.verify` | `bookings.identity_verified_by` (`booking_core.sql:82-83`) | not surfaced | n/a | OK, but only because the **runtime** schema (`supabase/functions/_shared/schemas/voice-tools.ts:57-71`) accepts `verify` — the **canonical** `packages/canonical-types/src/tools.ts` `zUpdateBookingRequest`/`zCancelBookingRequest` (lines 84-108) has **no `verify` field at all**, i.e. two different "source of truth" schemas for the same tool, only one of which matches what actually runs (see Backend findings) |
| Waitlist offer on no-availability | `WAITLIST_OFFER_FRAGMENT` (fragments.ts:113-121) | `take_message`, message text prefixed `"Waitlist request:"` | `call_logs.message_text` (free text) — **never** `waitlist_entries` | not surfaced structurally | n/a | **MISSING** — see Finding BE-2 |
| VIN, mileage, license plate | not asked anywhere | — | — | — | — | **MISSING** (real-world field, not in SYSTEM_DESIGN §4.3 spec for auto either — a spec gap, not just a build gap) |
| Diagnostic fee / estimate-approval policy | not in `verticalDetailsSchema` for auto (only `tow_partner`, `vehicle_makes_serviced`) | — | — | — | — | **MISSING** (config gap) |

---

## Conversation design findings

### CD-1 — BLOCKER: every per-vertical dynamic-variable placeholder the auto template relies on is never populated at call time

`auto-repair.ts` embeds four dynamic-variable references that only make
sense if resolved before the call starts:
- `{{vehicle_makes_serviced}}` (auto-repair.ts:38, 110)
- `{{tow_partner_name}}`, `{{tow_partner_phone}}` (auto-repair.ts:61-62)
- `{{cancellation_policy_text}}` (shared `CANCELLATION_POLICY_READOUT_FRAGMENT`,
  `fragments.ts:83-87` — used by **every** vertical, not just auto)

The dashboard *does* collect and store these values
(`apps/web/.../agent/vertical-details/page.tsx:75,177,387` for
`vehicle_makes_serviced`; the `verticalDetailsSchema`,
`packages/canonical-types/src/schemas/vertical-details.ts:13-26`, defines
`cancellation_policy`, `tow_partner`, `vehicle_makes_serviced` and they land
in `agent_configs.dynamic_variable_overrides`).

But the function that actually builds the dynamic-variables object sent to
Retell at call start — `supabase/functions/voice-inbound/handler.ts:120-145`
— only ever copies four specific override keys out of that jsonb blob:
`manager_name`, `manager_phone`, `parking_info`, `accessibility_notes`,
`accepted_payment_types`. It never reads `overrides["tow_partner"]`,
`overrides["vehicle_makes_serviced"]`, or `overrides["cancellation_policy"]`.
The response schema (`supabase/functions/_shared/schemas/voice-inbound.ts:35-50`,
`VoiceInboundDynamicVariablesSchema`) and the canonical
`zAgentDynamicVariables` (`packages/canonical-types/src/voice-provider.ts:96-113`)
don't even declare fields for them — so there is no key anywhere in the
pipe for these values to travel through even if `handler.ts` were fixed to
read them.

**Consequence at runtime:** Retell either speaks the literal token
(`{{tow_partner_name}}`) or drops it, in the exact sentence that is
supposed to refer a caller with a vehicle safety emergency to a real human
tow partner — the single highest-stakes line in this entire template — and
in the cancellation-policy read-out required on **every** booking across
**all eight verticals**, not only auto. This is the top-priority fix in
this audit.

### CD-2 — HIGH: conversation_flow compiler emits every state as a plain Conversation Node, so no tool is ever hard-locked to a step, contradicting SYSTEM_DESIGN §4.1's stated goal for this compile target

`docs/SYSTEM_DESIGN.md:111` says auto (Conversation Flow) exists precisely
for **"tool-backed nodes only... model cannot invent."** The compiler's own
docstring (`packages/adapters/retell/src/compiler/conversation-flow.ts:23-34`
and `types.ts:12-28`) documents that it deliberately does **not** lower a
state's `allowed_tools` into any per-node restriction, concluding "there is
no hard per-node restriction mechanism... a real hard per-node restriction
would need `SubagentNode`."

Per Retell's own docs (WebSearch snippets, domain-knowledge cross-checked —
direct fetch blocked, see Research summary), that conclusion appears
**incomplete**: Retell documents a distinct **Function Node** whose whole
purpose is "if a tool must always run at a fixed point in the flow, use a
function node" — i.e. exactly a hard, single-tool, deterministic-on-entry
node, achievable without `SubagentNode`. `check_time` (calls only
`check_availability`) and `confirm_booking` (calls only `create_booking` +
`send_sms_confirmation`) in `auto-repair.ts:129-145` are textbook Function
Node candidates. As built, every one of the auto template's ten nodes gets
access to every one of its eight declared tools
(`checkAvailabilityTool`, `createBookingTool`, `updateBookingTool`,
`cancelBookingTool`, `lookupCustomerTool`, `takeMessageTool`,
`sendSmsConfirmationTool`, `transferCallTool`) at every step, restricted
only by prompt-text steering — soft, not structural. This should be
re-opened as a VERIFY item (`docs/VERIFY.md`) rather than left as a closed
"RESOLVED, RETELL-VERIFY" conclusion.

### CD-3 — HIGH: `AgentState.extraction` (typed post-call Bool/Text/Number/Enum fields, SYSTEM_DESIGN §4.4) is fully unwired in the compiler

The canonical schema supports per-state `extraction` fields
(`packages/canonical-types/src/agent-template.ts:56-63`) and exactly one
template — legal — uses it, for a single boolean
(`packages/templates/src/verticals/legal.ts:54`,
`legal_advice_given`). A grep of the entire `packages/adapters/retell/src`
compiler package for `extraction`/`post_call_analysis`/`custom_analysis`
returns **zero matches outside test/comment files** — none of
`conversation-flow.ts`, `multi-prompt.ts`, `single-prompt.ts`, or
`index.ts` ever lowers a state's `extraction` array into Retell's actual
post-call custom-analysis-field configuration. So even where a template
declares it, it is silently dropped at compile time. For auto specifically,
this is the second (and structurally cleaner) path that SYSTEM_DESIGN §4.4
describes for capturing vehicle year/make/model/service-category/drop-off-
vs-wait as typed post-call fields, and the auto template doesn't declare
any `extraction` at all (compounding CD-3 with the earlier data-capture
gap: neither path — tool args nor extraction — reliably lands this data
anywhere queryable).

### CD-4 — MEDIUM: no explicit branch when the caller's vehicle make isn't serviced

The intro paragraph tells the model, in prose only, "if the caller's
vehicle isn't one of [`vehicle_makes_serviced`], say so honestly and offer
to take a message anyway" (auto-repair.ts:38-39), and `collect_vehicle`'s
fragment says "Cross-check the make against `{{vehicle_makes_serviced}}`"
(auto-repair.ts:110) — but there is no transition or state for this
outcome; `collect_vehicle → collect_symptom` is the only edge
(auto-repair.ts:162), fired on the single intent `vehicle_confirmed`. Every
other edge-case in this template (no-availability, after-hours, emergency,
identity-mismatch) gets its own explicit state/transition; this one is
left entirely to in-context model judgment, and — per CD-1 — the variable
it's supposed to cross-check against never actually arrives in the prompt
at all, making the gap worse in practice than on paper.

### CD-5 — MEDIUM: repeat customers re-dictate their vehicle every time; `lookup_customer` is only ever called on the reschedule/cancel path

`greeting` and `collect_vehicle` never call `lookup_customer`
(`allowed_tools: []` at auto-repair.ts:90,111) — only
`manageBookingState()` does (utility-states.ts:69). A returning customer
booking a **new** appointment gets a one-line contextual hint
("`{{caller_recent_context}}`" — "X has booked with us before",
`voice-inbound/handler.ts:104-109`) but is asked to restate year/make/model
from scratch every single call, even though `lookupCustomerTool`'s result
schema explicitly supports a `vehicles` array
(`packages/canonical-types/src/tools.ts:117-128`). This is moot today
anyway because nothing ever populates that array (see BE-1), but the
conversation design itself doesn't attempt the lookup even in principle.

### CD-6 — LOW: no diagnostic-fee / write-estimate-authorization statement

Many US jurisdictions require a shop to get written authorization before
work exceeds an estimate, and shops commonly quote a diagnostic fee up
front. `verticalDetailsSchema` has no key for either
(`packages/canonical-types/src/schemas/vertical-details.ts:24-25` — auto
only gets `tow_partner`/`vehicle_makes_serviced`), so there is nothing for
the template to say even if it wanted to. Reasonable to defer (it's more a
shop-floor concern than an intake-call blocker), but worth a
`docs/BUILD_NOTES.md` entry since SYSTEM_DESIGN doesn't mention it either.

---

## Backend/tool findings

### BE-1 — HIGH: `packages/canonical-types/src/tools.ts` (the documented dispatch-table "canonical" schema) has silently drifted from the schema the runtime actually validates against

`packages/canonical-types/src/tools.ts:84-108` (`zUpdateBookingRequest`,
`zCancelBookingRequest`) has **no `verify` field**, and
`zCreateBookingRequest` (lines 54-63) has **no `consent` field** — yet the
templates' own tool builders declare both
(`packages/templates/src/shared/tools.ts:66-77` `consent` on
`createBookingTool`; lines 89-100/113-124 `verify` on
`updateBookingTool`/`cancelBookingTool`), and the **actual running code**
(`supabase/functions/_shared/schemas/voice-tools.ts:36-71`,
`CreateBookingArgsSchema`/`UpdateBookingArgsSchema`/`CancelBookingArgsSchema`)
accepts and validates both. Two independent Zod schemas exist for the same
three tool contracts; only one of them (the Deno-local one) matches what
`voice-tools/index.ts` dispatches through
(`supabase/functions/voice-tools/handler.ts` imports from
`_shared/schemas/voice-tools.ts`, not `@heyloo/canonical-types`). This
directly conflicts with CLAUDE.md Rule 2's "core code sees only canonical
types from `packages/canonical-types`" invariant and with
`packages/canonical-types/src/agent-template.ts`'s own header comment
("This is validated by Zod before every `agent_templates` insert AND by the
compiler... before every Retell publish") — the tool-arg contract the
conversation is actually built against isn't the one in
`packages/canonical-types` at all. (Task context flags `voice-tools` as
in-flux; this finding is about the **duplication itself**, which pre-dates
and will outlive that particular edit wave unless one schema is made the
single source and the other imports/re-exports it.)

### BE-2 — HIGH: no `join_waitlist` tool; the waitlist offer is routed through free-text `take_message` and never reaches the real `waitlist_entries` table

`waitlist_entries` (`supabase/migrations/20260907130600_booking_core.sql:135-153`)
is a fully-designed table with `customer_id`, `offering_id`,
`resource_type`, a `tstzrange "window"`, and a documented
auto-rebook-on-cancellation trigger + two-way-SMS "reply YES" flow — and
`supabase/functions/webhooks-twilio-sms/handler.ts:49-87` genuinely reads
and updates rows there. But `WAITLIST_OFFER_FRAGMENT`
(`packages/templates/src/shared/fragments.ts:113-121`) instructs the model
to call `take_message` and prefix the free-text message with the literal
words `"Waitlist request:"` — there is no `join_waitlist` tool anywhere in
`packages/templates/src/shared/tools.ts` or
`packages/canonical-types/src/tools.ts`, and a grep of
`supabase/functions` for `waitlist_entries` writes turns up **only**
`webhooks-twilio-sms` (reads/updates existing rows) — nothing anywhere
inserts a row from a voice call. So on a real call, "add me to the
waitlist" today produces a staff SMS with unstructured text, and the
described automatic "slot opened → text the caller → reply YES auto-books"
pipeline can never fire from a phone call, only from however else
`waitlist_entries` rows might get created (not found anywhere in this
codebase).

### BE-3 — HIGH: vehicle/symptom/drop-off data collected by the auto template has no defined schema anywhere downstream

Covered in the data-capture table above; restated here as a backend
finding because it's a schema gap, not just a UI gap: `create_booking`'s
only carrier for this data is `structured_payload: { type: "object" }`
with **no defined shape** — not in `packages/canonical-types/src/tools.ts`,
not in `BACKEND_SPEC.md:1537` (`structured_payload?: object`, untyped), not
per-vertical anywhere. `bookings.structured_payload` is written verbatim
from whatever keys the model happened to choose
(`supabase/functions/voice-tools/tools/create_booking.ts:89`), and
`call_logs.structured_booking_payload` — the column SYSTEM_DESIGN §4.4
explicitly calls out as "vertical schema" — is **never written by any code
in this repo** (grep across `supabase/functions` for
`structured_booking_payload` matches nothing outside migrations/tests).

### BE-4 — MEDIUM: `create_booking` never writes to `customers.metadata`, so `lookup_customer`'s `vehicles` field is permanently empty

`customers.metadata` is documented (`20260907130400_customers.sql:28`) as
holding "vehicles array (auto)", and `zLookupCustomerResult`
(`packages/canonical-types/src/tools.ts:117-128`) declares a `vehicles`
field for exactly this purpose — but `create_booking.ts`'s customer upsert
(lines 63-69) only ever writes `name`/`phone_e164`/`last_seen_at`; nothing
in this repo ever writes to `customers.metadata`. Combined with CD-5, this
means the "repeat customer, recall their vehicle" experience this schema
was clearly designed for is currently unreachable for auto no matter how
the conversation is written.

### BE-5 — Tenant scoping / idempotency / hot-path shape (checked, mostly OK)

- `create_booking.ts` and `update_booking.ts` both filter every read/write
  by `tenant_id` (lines 43,63,87 / 43,63) — matches CLAUDE.md Rule 2.
- `create_booking` is race-proof via the GIST exclusion constraint +
  idempotency key, never check-then-insert (lines 44-129) — matches Rule 2
  exactly.
- Both use tagged-template raw SQL (no ORM) — matches the hot-path
  invariant.
- `update_booking`/`cancel_booking` correctly gate identity verification
  (`verifyBookingIdentity`) before any write when the caller number
  doesn't match the booking's own customer number — matches MASTER_SPEC
  §3.7, **using the runtime schema's `verify` field that the canonical
  schema doesn't declare** (BE-1).
- No dates-in-tenant-timezone / E.164 validation gap found specific to
  auto beyond BE-1/BE-3 above; `normalizeE164` is applied on every phone
  write path checked.

---

## Lean/fast/secure/scalable findings

- **Tool calls per booking (happy path):** `check_availability` →
  `create_booking` → `send_sms_confirmation` = 3 — lean, matches the
  budget implied by SYSTEM_DESIGN §5's hot-path targets.
- **Prompt length:** `SYSTEM_PROMPT` (auto-repair.ts:34-43) composes one
  intro paragraph + `QUALITY_AND_COLLECTION_FRAGMENT` (7 shared
  paragraphs) + 3 extra fragments (~40-45 short sentences total) — modest
  and consistent with the other 7 templates; no runaway prompt bloat
  specific to auto.
- **Hot-path query shape:** confirmed lean per BE-5 (raw SQL, module-level
  exclusion-constraint race-proofing, no ORM).
- **PII/PHI exposure:** auto has no PHI/PCI-equivalent concern the way
  dental (PHI) or motel/restaurant (payment) do — vehicle year/make/model
  and a symptom description are not sensitive categories requiring
  transcript deferral. No finding here.
- **Per-vertical config completeness (MASTER_SPEC §3.5):** `verticalDetailsSchema`
  gives auto exactly two optional keys (`tow_partner`,
  `vehicle_makes_serviced`) plus the universal `cancellation_policy` — no
  diagnostic-fee, loaner/shuttle, or estimate-authorization key (CD-6) —
  and, per CD-1, **none of the three actually reach the live call anyway**,
  which is a bigger problem than the config surface being small.
- **State count:** 10 states (auto-repair.ts:83-151) is on the small side
  for a conversation_flow graph — reasonable for latency, no sprawl
  concern.

---

## Strengths

- Shared fragment library (`packages/templates/src/shared/fragments.ts`,
  `utility-states.ts`, `global-intents.ts`, `tools.ts`) means consent-ask,
  cancellation-policy readout, identity-fallback, digit-by-digit read-back,
  and silence/give-up-ladder wording are authored once and reused
  identically across all 8 verticals — exactly the anti-drift design the
  file headers describe, and it shows: auto's template is a thin,
  readable composition rather than a copy-pasted wall of text.
- Auto's own `vehicle_safety_emergency` global intent is a well-scoped,
  domain-specific escalation (brakes/smoke/wreck → tow partner referral,
  with a 911 carve-out for injury) layered on top of the generic
  `emergency` safety net every vertical gets — a genuinely good,
  vertical-aware design choice (auto-repair.ts:45-77), undermined only by
  the dynamic-variable pipe being broken (CD-1), not by the design itself.
- `create_booking`'s race-proofing (GIST exclusion + idempotency key,
  never check-then-insert) and tenant scoping on every write are done
  correctly and match CLAUDE.md Rule 2 exactly.
- `lookup_customer` and `transfer_call`'s authorization scopes
  (`caller_number`, `tenant_config_only`) are structurally guaranteed at
  the canonical-tool level and asserted by the red-team `structural.test.ts`
  suite across every template, auto included — a real, load-bearing
  security guarantee, not just a convention.
- The disclosure-line publish gate (`disclosure-gate.ts`) is an
  independent structural self-check, not just a code-review convention —
  good defense in depth for the AI-disclosure/two-party-consent
  requirement.
- Global-intent wiring (`emergency`/`human_request`/`solicitor`, all
  `reachable_from: "any"`) is correctly structural, not model-discretionary,
  and lowers correctly to Retell's `global_node_setting` in the compiler.

---

## Prioritized fix list

1. **Wire the missing per-vertical dynamic variables end-to-end.**
   Add `tow_partner_name`, `tow_partner_phone`, `vehicle_makes_serviced`,
   and a universal `cancellation_policy_text` to
   `zAgentDynamicVariables` (`packages/canonical-types/src/voice-provider.ts:96-113`),
   `VoiceInboundDynamicVariablesSchema`
   (`supabase/functions/_shared/schemas/voice-inbound.ts:35-50`), and the
   object built in `supabase/functions/voice-inbound/handler.ts:120-145`
   (read `overrides["tow_partner"]`, `overrides["vehicle_makes_serviced"]`,
   `overrides["cancellation_policy"]` the same way the four existing keys
   are read). Why: today the highest-stakes line in this template (the
   tow-partner referral) and the cancellation-policy readout required on
   every booking, across all 8 verticals, are unresolvable template
   tokens at call time.

2. **Reconcile the two `voice-tools` argument schemas.**
   Either re-export `supabase/functions/_shared/schemas/voice-tools.ts`
   from `packages/canonical-types/src/tools.ts` (add `consent`/`verify` to
   `zCreateBookingRequest`/`zUpdateBookingRequest`/`zCancelBookingRequest`),
   or have the Deno schemas import the canonical ones. Why: Rule 2's
   single-source-of-truth invariant is currently violated for exactly the
   tool arguments the identity-fallback and consent features depend on.

3. **Give vehicle/symptom/drop-off a real schema and a real destination.**
   Add typed fields (e.g. `vehicle: {year, make, model}`, `service_category`,
   `drop_off_or_wait`) to `createBookingTool`
   (`packages/templates/src/shared/tools.ts:53-77`) and the matching
   canonical/runtime request schemas; have
   `supabase/functions/voice-tools/tools/create_booking.ts` write the
   vehicle into `customers.metadata.vehicles[]` (upsert/append) in addition
   to `bookings.structured_payload`, and populate
   `call_logs.structured_booking_payload` per SYSTEM_DESIGN §4.4. Why:
   this is the core data a shop owner and a future Shopmonkey/Tekmetric
   adapter both need, and today it has no defined shape and is invisible
   in the dashboard.

4. **Surface it in the dashboard.**
   Add `structured_payload`, `resource_id`/`offering_id` to the bookings
   list query (`apps/web/.../dashboard/bookings/page.tsx:36`) and render
   vehicle/service/drop-off in the booking detail sheet; add
   `call_summary`, `structured_booking_payload`/`extracted_entities`,
   `urgency_flag`, `sentiment` to `CallDetailClient`
   (`apps/web/src/components/tenant/call-detail-client.tsx`). Why: none of
   the rich post-call/booking data currently reaches the shop owner's
   screen at all.

5. **Add a real `join_waitlist` tool backed by `waitlist_entries`.**
   Add the tool to `packages/templates/src/shared/tools.ts` +
   canonical/runtime schemas, insert a row in a new `voice-tools/tools/join_waitlist.ts`,
   and rewrite `WAITLIST_OFFER_FRAGMENT`
   (`packages/templates/src/shared/fragments.ts:113-121`) to call it
   instead of prefixing free text into `take_message`. Why: the
   auto-rebook-on-cancellation + SMS-reply-YES pipeline
   (`webhooks-twilio-sms/handler.ts`) already exists and expects real
   `waitlist_entries` rows that a voice call can never currently create.

6. **Re-open the conversation_flow tool-locking question (CD-2) as a
   VERIFY item**, not a closed conclusion — check whether Retell's
   Function Node (single tool, deterministic, "wait for result" branching)
   can replace the current all-tools-everywhere Conversation Node design
   for `check_time`/`confirm_booking`, which is what SYSTEM_DESIGN §4.1
   asked for. File: `packages/adapters/retell/src/compiler/conversation-flow.ts`,
   `types.ts`.

7. **Wire `AgentState.extraction` into the compiler** (all three targets in
   `packages/adapters/retell/src/compiler/`) so declared typed post-call
   fields actually reach Retell's post-call-analysis config, and give auto
   `extraction` entries for service category / drop-off-vs-wait as a
   second, structurally-independent capture path for BE-3's data. File:
   `packages/adapters/retell/src/compiler/{conversation-flow,multi-prompt,single-prompt,index}.ts`.

8. **Add an explicit "vehicle make not serviced" branch** (new state +
   transition) to `auto-repair.ts` instead of leaving it to prose-only
   judgment inside `collect_vehicle`, once #1 makes
   `vehicle_makes_serviced` actually resolvable.

9. *(Lower priority, spec-level)* consider adding VIN/mileage capture and a
   diagnostic-fee/estimate-authorization `verticalDetailsSchema` key +
   template line — real-world front-desk practice both use, and
   SYSTEM_DESIGN §4.3 doesn't currently ask for either; log as a
   `docs/BUILD_NOTES.md` gap per CLAUDE.md Rule 4 rather than adding
   unrequested scope.
