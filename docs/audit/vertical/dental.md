# Dental vertical audit — `packages/templates/src/verticals/dental.ts`

Scope note: `supabase/functions/voice-tools` is being edited by a concurrent
fix wave; findings that touch it are marked **[IN-FLUX]** and are reported
as "state observed at audit time," not as a demand to change that wave's
work without re-checking. Everything else (templates, canonical-types,
retell compiler, migrations, apps/web) is stable ground truth and graded
directly.

## Research summary

**Dental front-desk practice — domain knowledge, cross-checked against:**
[Doctible insurance-verification checklist](https://www.doctible.com/blog/dental-insurance-verification-checklist),
[Weave dental phone scripts](https://www.getweave.com/dental-telephone-scripts/),
[BoomCloud new-patient call sheet](https://boomcloudapps.com/dental-new-patient-call-sheet/),
[Front Desk new-patient phone scenarios](https://frontdesk.care/blog/dental-new-patient-phone-scripts-12-call-scenarios-that-increase-bookings-copy-paste-templates).

A competent dental front desk collects, in order: caller name + relationship
to patient (self/parent/guardian) → patient full name + DOB (DOB is used
as the patient-matching key in every PMS, e.g. Dentrix/Eaglesoft/Open
Dental/NexHealth) → new vs. existing patient → reason for visit (routine
cleaning/exam vs. pain/broken tooth/lost filling vs. cosmetic consult) →
for pain calls: pain level, swelling, fever, trauma (knocked-out/loose
tooth is a "same-day, don't let them leave the phone without a same-day
slot or ER/emergency-dentist referral" tier; a knocked-out permanent tooth
has a ~30-60 minute re-implantation window, which real scripts flag
explicitly) → insurance carrier + member ID (asked up front specifically so
staff can pre-verify benefits before the visit and avoid a billing surprise
at check-in — this is the #1 called-out practice in every source above) →
preferred day/time → confirmation read-back → cancellation/no-show policy
statement → (existing-patient reschedule/cancel) identity check by name +
DOB or phone. Never: diagnosing over the phone, quoting a treatment price
without seeing the patient, promising insurance will cover something.
Escalation triggers: severe facial swelling/breathing or swallowing
difficulty is a true medical emergency (send to ER/911, not the dental
chair). Top PMS/PIMS systems a dental voice-AI must eventually integrate
with: **Dentrix, Eaglesoft, Open Dental, NexHealth (the only realistic
aggregator API path — this repo's own `docs/VERTICAL_RESEARCH.md:20,93`
already documents this and correctly defers it to a later wave)**; the
fields those systems need per booking are patient name, DOB, phone,
insurance carrier + member ID, appointment type/operatory, provider, and
duration.

**Retell conversation_flow guidance** — `docs.retellai.com` is
egress-blocked in this environment (confirmed by direct WebFetch attempt,
same experience already logged in `docs/BUILD_NOTES.md`'s RETELL-VERIFY
section); used `retell-sdk@5.64.0`'s generated types (the same technique
the repo's own BUILD_NOTES documents) plus WebSearch snippets of the docs
site. Findings, all directly checked against
`node_modules/.pnpm/retell-sdk@5.64.0/node_modules/retell-sdk/resources/conversation-flow.d.ts`:
a plain **`ConversationNode`** (`type: "conversation"`, line 215/6281) has
no tool-scoping field of any kind; a **`FunctionNode`** (line 2312/8378)
takes exactly one **`tool_id: string`** (singular — hard-locks one tool per
node, which is what SYSTEM_DESIGN §4.1 wants); a **`SubagentNode`** (line
683/6749) takes `tool_ids?: string[]` for a scoped subset. `global_node_setting`
exists on every node type as the "reachable from anywhere" mechanism the
compiler uses correctly. This confirms this repo's own compiler docstring
(`conversation-flow.ts:24-34`) and `docs/BUILD_NOTES.md:2309-2319` are
accurate, not guessed.

## Data capture table

| Real front-desk field | Asked in dental template? | Tool arg | DB column | Dashboard? | Vertical adapter? |
|---|---|---|---|---|---|
| Patient full name | Yes — `collect_patient_name` state (`dental.ts:70-76`) | `create_booking.customer.name` | `bookings.customer_id → customers.name` | via booking record, not directly | none built yet (NexHealth deferred, correctly, per VERTICAL_RESEARCH) |
| Caller vs. patient distinction (parent calling for child) | Partially — prompt says "may differ from the caller for a child or dependent" (`dental.ts:73-74`) but **no separate `caller_name` field is ever collected or stored** — `create_booking`'s `customer` object (`shared/tools.ts:59-63`) has only one `name`/`phone` pair | none | none | — | MISSING |
| New vs. existing patient | Yes — `new_or_existing` state (`dental.ts:78-82`) | **not passed to any tool** — the transition condition `status_confirmed` (`dental.ts:134`) only routes the flow, the new/existing answer itself is never placed into `structured_payload` or any tool arg | none (would need to be in `create_booking.structured_payload`, a bare `object` with no per-vertical shape) | no | PARTIAL — asked but not captured anywhere durable |
| Pain / urgency triage (pain level, swelling, fever, knocked-out/broken tooth) | Yes, in detail — `pain_triage` state (`dental.ts:84-93`) | **no tool argument at all carries this** — no `urgency`/`is_urgent`/`triage` field exists on `create_booking`, `check_availability`, or `take_message` (`shared/tools.ts` full read) | `call_logs.urgency_flag` exists and is indexed (`20260907130500_call_logs.sql:28,50,53-54`) but **nothing in the whole codebase sets it in-call** — see Finding B1 | **MISSING from both the calls list (`calls-list-client.tsx:76` selects only `id, started_at, caller_number, classification, duration_seconds, outcome`) and the call detail page (`calls/[id]/page.tsx:15` selects `structured_booking_payload` but never `urgency_flag`)** | MISSING |
| Reason for visit / appointment type (cleaning, filling, emergency exam) | Implicit only ("pain or a routine check-up") — never resolved to a concrete `offering_id` | `create_booking.offering_id` exists in the schema (`shared/tools.ts:56`) but the template never has a state that selects one, and no `list_offerings`-type tool exists for the model to learn what offerings exist | `bookings.offering_id` (nullable FK) — will be null for every dental booking | n/a | MISSING |
| Appointment day/time | Yes — `check_time` state (`dental.ts:95-103`) | `check_availability`/`create_booking.start/end` | `bookings.start_at/end_at` | yes (booking record) | n/a |
| DOB | Explicitly deferred — `PHI_DEFERRAL_FRAGMENT` (`dental.ts:40-44`) | never a tool arg | never stored | n/a | **the "secure post-call form" this defers to does not exist anywhere in the repo** — see Finding B2 |
| Insurance carrier/member ID | Explicitly deferred, same fragment | never a tool arg | tenant-side `insurances_accepted` list exists (`zDentalOverrides`, `agent-template.ts:291-293`) and is dashboard-editable (`vertical-details/page.tsx:287-304`) — but that's the *practice's* accepted-insurance list (an FAQ answer), not the *patient's* carrier/member ID | n/a | same B2 gap — no path for the patient's own insurance to ever reach the practice pre-visit |
| Consent to text/call | Yes — `CONSENT_ASK_FRAGMENT` (`dental.ts:51`, fragments.ts:79-84) | `create_booking.consent.{sms,call}` | `customers.consent` jsonb (`create_booking.ts:72-98`) | not surfaced but stored | n/a |
| Cancellation policy read-out | Yes — `CANCELLATION_POLICY_READOUT_FRAGMENT` (`dental.ts:52`) | n/a (spoken only, from `{{cancellation_policy_text}}` dynamic variable) | `agent_configs.dynamic_variable_overrides.cancellation_policy` | — | OK |
| Waitlist on no availability | Offered — `WAITLIST_OFFER_FRAGMENT` (`dental.ts:53`) | routed through `take_message` with a text-prefix convention (fragments.ts:114-121), **not** a real waitlist insert | `waitlist_entries` table exists with a full schema + a cancellation-triggered auto-notify trigger (`20260907130600_booking_core.sql:140-156`, `20260907131400_functions_triggers.sql:332-363`) that **can never fire for a voice-originated request** — see Finding B3 | n/a | MISSING (structurally broken, not just unsurfaced) |
| Existing-booking identity verification (reschedule/cancel) | Yes — `manageBookingState()` + `IDENTITY_FALLBACK_FRAGMENT` (`utility-states.ts:58-71`, `fragments.ts:100-108`) | `update_booking.verify` / `cancel_booking.verify` (`shared/tools.ts:88-97,113-123`) | `bookings.identity_verified_by` (`20260907130600_booking_core.sql:85`) | not surfaced | OK — **[IN-FLUX]** actually implemented server-side in `update_booking.ts:48-57`/`cancel_booking.ts:52-61` via `verifyBookingIdentity` |
| Message/callback for staff | Yes — `takeMessageFallbackState()` | `take_message.{caller_name,caller_phone,message_text,callback_window}` | `call_logs.message_text` + a `messages_outbound` SMS to `agent_configs.transfer_number` | not surfaced on the call detail page (only `structured_booking_payload` is read) | n/a |

## Conversation design findings

**[BLOCKER] Same-day dental emergency triage has no structural path into
`urgency_flag` — the exact "never wait for post-call" requirement
SYSTEM_DESIGN itself states is violated end to end.**
`pain_triage` (`packages/templates/src/verticals/dental.ts:84-93`) tells the
model to "flag it clearly" for a knocked-out/broken tooth or severe
swelling, but (a) the state declares no `extraction` fields at all (the
`AgentState.extraction` mechanism, `agent-template.ts:61`, exists precisely
for this and is used by zero dental states), (b) even if it were declared,
**no compiler lowers `extraction` into anything** — confirmed by grep, zero
hits for `extraction` in `packages/adapters/retell/src/compiler/*.ts`
(conversation-flow.ts, multi-prompt.ts, single-prompt.ts all checked), and
(c) **no Retell agent creation call ever sends `post_call_analysis_data`**
— `packages/adapters/retell/src/agents.ts:85-99`'s `agentBody` has no such
field, confirmed by grep across the whole adapter. Yet
`supabase/functions/voice-events/handler.ts:191-198` **[IN-FLUX]** reads
`customData["emergency_detected"]`, `customData["classification"]`,
`customData["follow_up_needed"]` from Retell's post-call analysis payload
and uses `emergency_detected` as the *only* code path that ever sets
`urgency_flag = true`. Since Retell is never told to extract any of these
fields, this payload will be empty/absent in production — meaning a
knocked-out-tooth caller who doesn't get a same-day slot has their urgency
recorded nowhere retrievable, and `idx_call_logs_urgency`
(`20260907130500_call_logs.sql:50`) will forever index zero rows. This is
not dental-specific in root cause but dental is the vertical where it does
the most concrete harm (a missed same-day emergency is a health/liability
issue, not just an inconvenience).

**[HIGH] The dashboard has no way to see, filter, or sort urgent calls even
if the flag were set.** `apps/web/src/components/tenant/calls-list-client.tsx:76`
selects `id, started_at, caller_number, classification, duration_seconds,
outcome` — no `urgency_flag`. `apps/web/src/app/[locale]/(tenant)/dashboard/calls/[id]/page.tsx:15`
selects `structured_booking_payload` but not `urgency_flag`,
`message_text`, `sentiment`, or `call_summary` either. A dental office
depending on this product to catch same-day emergencies has literally no
UI surface for it today.

**[HIGH] The "secure post-call form" for DOB/insurance that the template
promises callers does not exist.** `confirm_booking`
(`dental.ts:104-114`) instructs the model to mention "a secure link for
insurance/DOB will follow separately," and the red-team suite
(`red-team/structural.test.ts:114-124`, `injection-fixtures.ts:94-103`)
correctly asserts the PHI-deferral *wording* is present — but there is no
SMS template, no hosted intake-form page, and no distinct `template_key`
for it anywhere in the repo (`send_sms_confirmation`'s `template_key` is an
unconstrained `z.string()`, `_shared/schemas/voice-tools.ts:89`; grepped
`apps/web` and `supabase/functions` for `intake`/`insurance_form`/
`patient.*form` — the only hits are marketing copy). Every dental booking
today captures neither DOB nor insurance by any path, contradicting real
front-desk practice (pre-visit insurance verification is the #1
recommendation in every source researched above) and leaving the eventual
NexHealth push (VERTICAL_RESEARCH.md:20) with no data to send.

**[HIGH, tracked-but-open] Tool access is not actually locked per state —
every dental state can invoke every tool.** `dental.ts`'s first four states
(`greeting`, `collect_patient_name`, `new_or_existing`, `pain_triage`) all
declare `allowed_tools: []`, and `check_time`/`confirm_booking` declare a
narrow allow-list — but `compileConversationFlow`
(`packages/adapters/retell/src/compiler/conversation-flow.ts:24-34,63-72`)
emits every `AgentState` as a plain Retell `conversation` node, which per
the SDK types (verified above) has no tool-restriction field; every node
in the compiled flow gets the entire `tools[]` array. So at the wire level,
a caller mid-`greeting` has model-reachable access to `create_booking`,
`cancel_booking`, `update_booking`, `transfer_call`, and `lookup_customer`
— the state graph's `allowed_tools` is prompt-only steering, not the "model
cannot invent... tool-backed nodes only" hard guarantee SYSTEM_DESIGN §4.1
asks for. This is already logged (`docs/BUILD_NOTES.md:2309-2319,2556-2563`)
as a known gap requiring a `FunctionNode`/`SubagentNode` graph-shape change
— correctly not silently redesigned per CLAUDE.md Rule 4 — but it remains
open and materially weakens dental's PHI/booking discipline specifically
because `lookup_customer` (which surfaces `recent_bookings`) is reachable
before identity is ever discussed.

**[HIGH] The waitlist offer is a promise the backend cannot keep.**
`WAITLIST_OFFER_FRAGMENT` (`packages/templates/src/shared/fragments.ts:114-121`,
used by dental via `dental.ts:53`) tells the caller "someone will text you
the moment something opens up" and instructs the model to record it via
`take_message` with a `"Waitlist request:"` text prefix. But
`waitlist_entries` (`supabase/migrations/20260907130600_booking_core.sql:140-156`)
is a structured table with its own cancellation-triggered auto-notify
trigger (`fn_notify_waitlist_on_cancellation`,
`20260907131400_functions_triggers.sql:332-363`), and **no tool anywhere
inserts into it** — `TOOL_REQUEST_SCHEMAS`
(`packages/canonical-types/src/tools.ts:276-286`) has no `join_waitlist`
entry, and `take_message.ts` only ever writes `call_logs.message_text` +
an outbound SMS. A dental patient told "we'll text you" for a same-day
emergency waitlist spot will never be auto-notified; someone has to
manually read the free-text message and manually re-run the booking flow.

**[MEDIUM] No appointment-type/offering selection step.** Real front desks
distinguish cleaning (~60 min, hygienist chair) from an emergency exam
(~20 min, doctor chair) from a filling — this determines both duration and
which `resources` row to book. Dental's `check_time` state
(`dental.ts:95-103`) calls `check_availability` without ever having
collected an `offering_id`/appointment type, and there is no tool for the
model to enumerate the practice's `offerings` catalog. `pain_triage`
substitutes partially (pain vs. routine) but that's a triage signal, not an
offering selection — `bookings.offering_id` will be null for essentially
every dental booking, which will matter once the vertical adapter needs to
map bookings to specific NexHealth appointment types.

**[MEDIUM] "New vs. existing patient" is asked but never captured.**
`new_or_existing` (`dental.ts:78-82`) has no `extraction` field and its
answer is never placed into `create_booking.structured_payload` (a bare
untyped `object`, `shared/tools.ts:65`) — so front-desk staff looking at
the booking afterward cannot tell from stored data whether this was a new
patient (relevant for new-patient paperwork/intake prep) without listening
to the recording/transcript.

**[MEDIUM, systemic not dental-specific] No dedicated FAQ/question-answering
path.** SYSTEM_DESIGN §4.2's call taxonomy includes "question/FAQ" as one
of 12 classes, but dental's `greeting` (`dental.ts:121-128`) only routes to
`collect_patient_name` (book), `manage_booking` (reschedule/cancel), or
`take_message_fallback` under the intent name
`after_hours_or_general_message` — the same intent used for genuinely
after-hours calls. A mid-day caller asking "do you take Delta Dental?"
(answerable instantly from `insurances_accepted`,
`agent-template.ts:291-293`) has no distinct path from a caller who needs
staff to call them back after hours; both fall into the message-taking
terminal state. Confirmed the same pattern in `restaurant.ts:176` and
`motel.ts:130` — this is a shared-architecture gap, not dental's alone,
best fixed once in `shared/utility-states.ts`.

**[LOW] Caller-vs-patient distinction collected but not modeled.** The
prompt correctly anticipates a parent booking for a child
(`dental.ts:73-74`) but `create_booking.customer` (`shared/tools.ts:59-63`)
has only one `name`/`phone` pair — there's no `caller_name` vs.
`patient_name` distinction anywhere in the schema, so if a parent calls
about a child, only one name is ever stored and it's ambiguous which
person it refers to.

## Backend / tool findings

**check_availability / create_booking / update_booking / cancel_booking /
lookup_customer / take_message / send_sms_confirmation / transfer_call —
tenant scoping and idempotency:** **[IN-FLUX, observed]**
`create_booking.ts:44-53,82-92` uses `bookingIdempotencyKey(call_id, start)`
+ `(tenant_id, idempotency_key)` unique constraint and the GIST exclusion
constraint (`bookings_idempotency_unique`,
`20260907130600_booking_core.sql:88-90`) exactly per SYSTEM_DESIGN §5 —
correct "one INSERT, race-proof" pattern, no check-then-insert.
`update_booking.ts:40-57`/`cancel_booking.ts:37-61` both scope every read
and write by `tenant_id` (Rule 2) and both correctly call
`verifyBookingIdentity` before any write when `args.verify` is/isn't
present. Good.

**[MEDIUM] `packages/canonical-types` (the package CLAUDE.md Rule 2 calls
the single source of truth for tool contracts) is out of sync with the
real runtime schema.** `zUpdateBookingRequest`/`zCancelBookingRequest`
(`packages/canonical-types/src/tools.ts:84-89,101-105`) have no `verify`
field at all, while `packages/templates/src/shared/tools.ts:88-97,113-123`
(what the compiler actually reads) *does* declare `verify`, and the real
runtime schema `supabase/functions/_shared/schemas/voice-tools.ts:61-71`
**[IN-FLUX]** also has it. Nothing is functionally broken today (the
compiler never touches `canonical-types/tools.ts`'s `TOOL_REQUEST_SCHEMAS`
— it reads `shared/tools.ts`'s own `CanonicalTool` literals), but this is
exactly the kind of silent-drift `packages/canonical-types` exists to
prevent, and anyone auditing or building against that file alone (as this
task's brief suggested) gets a materially wrong picture of the identity-
fallback contract.

**Missing tools this vertical needs:** a `join_waitlist` tool (writes
`waitlist_entries` directly instead of the free-text `take_message`
workaround — see Finding above); a way to fetch the practice's `offerings`
catalog (or at minimum, `check_availability`/`create_booking` need a
documented convention for how `offering_id` gets chosen when the model
never learns the catalog); a deposit/no-show-fee hold is out of scope for
dental (not a real-world dental norm the way it is for motels/restaurants)
so its absence is correct, not a gap.

**Validation:** `create_booking.ts:39-42` normalizes phone to E.164 and
fails soft (`confirmed:false, reason:"invalid_phone"`) rather than
throwing — good. Money-in-cents/timestamptz conventions are followed
throughout `bookings`/`call_logs` (no violations found). Dates are passed
as opaque ISO strings between tool and DB with no dental-specific
timezone handling visible in the template layer — tenant-IANA-tz
materialization happens upstream in `availability_slots` per
`20260907130600_booking_core.sql:59-60`'s comment, so this is correctly
out of the template's concern.

## Lean / fast / secure / scalable findings

- **Prompt length/token cost:** `SYSTEM_PROMPT` for dental composes
  `buildSystemPrompt` (7 shared quality fragments, ~600 words) +
  `PHI_DEFERRAL_FRAGMENT` + `CONSENT_ASK_FRAGMENT` +
  `CANCELLATION_POLICY_READOUT_FRAGMENT` + `WAITLIST_OFFER_FRAGMENT` — a
  reasonable ~900-1000 words total, consistent with the design's own
  "single_prompt... under the ~1000-word/5-tool threshold" framing (§4.1)
  even though dental compiles as `conversation_flow`, where the
  `global_prompt` is a fixed per-call token cost on every turn. Not
  excessive but worth watching if more vertical-specific fragments accrete.
- **Tool calls per booking:** minimum 2 (`check_availability`,
  `create_booking`) + 1 (`send_sms_confirmation`) = 3, matching the
  documented hot-path design; no redundant calls found in the state graph.
- **State count:** 10 states total (5 dental-specific + 5 shared
  utility/terminal states) — sane for latency, well under any concerning
  threshold.
- **Hot-path query shape:** not this package's concern directly (lives in
  `supabase/functions/voice-tools`, marked in-flux), but the reads observed
  in `create_booking.ts`/`update_booking.ts`/`cancel_booking.ts` are lean,
  single-purpose, indexed queries with no ORM — consistent with SYSTEM_DESIGN
  §5.
- **PHI leaking into transcripts/recordings:** the template actively tries
  to prevent this (`PHI_DEFERRAL_FRAGMENT`) and the red-team suite tests
  for the wording (`structural.test.ts:114-124`) — but the fragment only
  tells the model not to *ask*; if a caller volunteers DOB/insurance
  anyway (the exact `injection-fixtures.ts:94-103` scenario), it still
  ends up verbatim in `call_logs.transcript`/`recording_url`/
  `stereo_recording_url` since there is no redaction step anywhere in
  `voice-events` **[IN-FLUX, observed]** — for a HIPAA-relevant vertical
  this is a real residual-PHI-in-transcript risk that "don't ask" alone
  doesn't close; the design doc doesn't call for redaction either, so this
  is a gap in SYSTEM_DESIGN itself as much as in the implementation.
- **Per-vertical config completeness (MASTER_SPEC §3.5):** `zDentalOverrides`
  (`agent-template.ts:291-293`) = base fields (manager contact, parking,
  accessibility, prep time, payment types, cancellation policy) +
  `insurances_accepted`. Validated via Zod, surfaced in the dashboard form
  (`vertical-details/page.tsx:287-304`). Reasonably complete for what the
  template currently uses; would need extending with an `appointment_types`
  or `offerings` reference once the offering-selection gap above is fixed.

## Strengths

- The disclosure line, all 3 required global intents (`emergency`,
  `human_request`, `solicitor`), the consent ask, and the cancellation-
  policy read-out are all present and pass a genuinely meaningful
  automated red-team suite (`structural.test.ts`), not just manual review.
- PHI-deferral design (never ask DOB/insurance/SSN on-call) is the correct
  call for a HIPAA-adjacent vertical and is well-worded, specific, and
  tested — the gap is only in the "post-call form" half not existing yet
  (Finding above), not in the on-call discipline itself.
- Identity-fallback for reschedule/cancel is one of the few pieces of this
  vertical's design that is fully wired end-to-end and correctly: template
  prompt → tool schema → real server-side `verifyBookingIdentity` check
  before any write.
- `create_booking`'s idempotency + GIST-exclusion race-proofing is
  textbook-correct against SYSTEM_DESIGN §5 and needs no changes.
- The compiler's own documentation of its known limitations
  (`conversation-flow.ts` docstring, `BUILD_NOTES.md` RETELL-VERIFY
  section) is unusually honest and specific — it names the exact SDK types
  it checked and the exact gap it's leaving open, which made this audit
  faster and more confident rather than requiring independent rediscovery.

## Prioritized fix list

1. **Wire post-call/in-call urgency extraction end to end** (root cause of
   the top finding): add a `urgency`/`is_urgent` argument to
   `create_booking`/`take_message` (or a dedicated extraction field lowered
   by the compiler) so `pain_triage`'s same-day flag becomes a real tool
   argument written synchronously, not a hope that post-call analysis
   catches it later. Files: `packages/templates/src/verticals/dental.ts`
   (add `extraction` to `pain_triage`, or better, add the flag as a
   `create_booking`/`take_message` tool arg), `packages/canonical-types/src/tools.ts`,
   `packages/adapters/retell/src/agents.ts` (send `post_call_analysis_data`
   if the extraction-field route is chosen instead), `supabase/functions/voice-tools/tools/create_booking.ts`
   and `take_message.ts` (write `call_logs.urgency_flag = true` directly,
   in-call, per SYSTEM_DESIGN §4.4's explicit requirement).
2. **Surface `urgency_flag` in the dashboard.** Files:
   `apps/web/src/components/tenant/calls-list-client.tsx` (select it, add
   a sort/filter and a visible badge), `apps/web/src/app/[locale]/(tenant)/dashboard/calls/[id]/page.tsx`
   (select + display it, plus `message_text`/`call_summary`/`sentiment`
   while there). Why: the DB already has a partial index built for this
   exact query pattern (`idx_call_logs_urgency`) and it's currently unused.
3. **Build (or explicitly descope with a BUILD_NOTES entry) the secure
   post-call DOB/insurance intake form** the dental template promises
   callers. Files: needs a new `send_sms_confirmation` template_key +
   hosted form page under `apps/web`, or a `docs/BUILD_NOTES.md` entry
   deferring it with a task id if it's genuinely out of this wave's scope
   — right now it's neither built nor logged as deferred, so it reads as
   an oversight rather than a decision.
4. **Add a `join_waitlist` tool that inserts into `waitlist_entries`**
   instead of routing waitlist requests through free-text `take_message`.
   Files: `packages/canonical-types/src/tools.ts` (new schema),
   `packages/templates/src/shared/tools.ts` (new `CanonicalTool` builder),
   `packages/templates/src/shared/fragments.ts` (`WAITLIST_OFFER_FRAGMENT`
   should reference the new tool, not the text-prefix convention), a new
   `supabase/functions/voice-tools/tools/join_waitlist.ts` handler. Why:
   the DB-side auto-notify trigger already exists and is currently dead
   code for every voice-originated waitlist request.
5. **Add an offering/appointment-type selection step** before
   `check_time` (or fold it into `pain_triage`'s routine branch), so
   `create_booking.offering_id` is populated instead of always null.
   Files: `packages/templates/src/verticals/dental.ts` (new state or
   extended `pain_triage`), `agent_configs.dynamic_variable_overrides` or
   a lightweight offerings list needs to reach the model as a dynamic
   variable (per SYSTEM_DESIGN §5's "static context rides in dynamic
   variables at call start" rule — no new tool call needed if the list is
   small).
6. **Capture "new vs. existing" into `structured_payload`** instead of
   discarding it after routing. File: `packages/templates/src/verticals/dental.ts`
   (`new_or_existing`'s transition/state should feed
   `create_booking.structured_payload.patient_status`).
7. **Give dental (and restaurant/motel) a distinct FAQ/question intent**
   separate from `after_hours_or_general_message`, so an insurance/hours
   question during business hours doesn't fall into the message-taking
   terminal state. Best fixed once in `packages/templates/src/shared/` so
   all three affected verticals pick it up together.
8. **Sync `packages/canonical-types/src/tools.ts`'s `zUpdateBookingRequest`/
   `zCancelBookingRequest` to include `verify`**, matching
   `packages/templates/src/shared/tools.ts` and the real runtime schema —
   currently harmless but a documentation/type-drift trap for the next
   person who treats `canonical-types` as ground truth.
