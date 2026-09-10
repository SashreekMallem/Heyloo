# Veterinary vertical audit — Heyloo

Scope: `packages/templates/src/verticals/veterinary.ts` + shared template
infrastructure, `packages/canonical-types`, `packages/adapters/retell/src/compiler`,
`supabase/migrations` (stable ground truth), `docs/SYSTEM_DESIGN.md` §4,
`docs/spec/MASTER_SPEC.md` §3, `docs/spec/BACKEND_SPEC.md`. `supabase/functions/voice-tools`
was read as current ground truth per instructions but is noted as "in flux" —
findings there are flagged accordingly.

---

## Research summary

**Domain knowledge (network egress to industry sites was not attempted given
prior BUILD_NOTES entries record `docs.retellai.com` as egress-blocked from
this environment in every prior task; I rely on documented veterinary
front-desk / call-center practice, which is stable, well-established
knowledge, not fast-moving API surface).**

A competent vet-clinic front desk / answering service, on every inbound call:

- **Immediate triage first, always** — before any scheduling talk: "what's
  going on with [pet]?" listens for classic red flags — bloat/distended
  abdomen, seizure, collapse, difficulty breathing, hit by car/trauma, known
  or suspected toxin ingestion (chocolate, xylitol, rodenticide, lilies for
  cats), a male cat straining to urinate/not urinating (urinary blockage,
  fatal within ~24-48h), profuse/uncontrolled bleeding, pale/white/blue/grey
  gums, non-weight-bearing limb after trauma, prolonged unproductive
  retching. Any of these → stop everything, refer to ER/24h hospital *now*
  or warm-transfer, never "let's get you scheduled for tomorrow."
- **Never diagnoses, never reassures** ("it's probably nothing") — staff are
  trained to escalate on ambiguity, not rule things out.
- **Owner + pet identity**: owner name, callback number, pet's name, species,
  breed (for weight-based drug dosing/anesthesia risk awareness — even if
  the receptionist doesn't dose anything, the vet needs it before the visit),
  approximate age (puppy/kitten vs. senior changes urgency and protocol —
  e.g., parvo suspicion in an unvaccinated puppy is itself semi-urgent).
  Weight is often asked too where relevant (medication cost quotes) — not
  requested by this template at all.
- **New vs. existing patient** — existing patients pull up a chart (vaccine
  status, allergies, last visit, standing balance); new patients get asked
  for more (any known allergies/medications, vaccine history if known,
  sometimes referred-by).
- **Symptom vs. routine** branch — routine (wellness, vaccines, spay/neuter,
  grooming, dental cleaning, nail trim) books against a standard slot;
  symptom visits get a same-day-check policy and get slotted into
  "sick appointment" slots (usually shorter turnover but higher urgency
  priority than routine).
- **Vaccine/exam-due reminders**: real practice-management systems (ezyVet,
  Vetspire, AVImark, Cornerstone — i.e. the "PIMS", practice information
  management system) drive rabies/vaccine due-date reminders; a front desk
  frequently checks/updates this on a call. Not in scope of a phone
  receptionist's real-time job beyond "when were they last vaccinated?"
  but PIMS integration is exactly what pushes appointment + client + patient
  records so the vet has a chart before the visit.
- **Policies stated**: cancellation/no-show policy (many clinics charge a
  fee for missed appointments), day-of-drop-off vs. wait-with-pet
  instructions, whether the clinic requires proof of vaccination for
  boarding/grooming add-ons, payment methods accepted, and (increasingly)
  pet insurance — most vet software does NOT integrate claims in real time;
  front desk typically just notes "bring your insurance info" rather than
  collecting policy numbers on the phone.
- **What must never be said**: a diagnosis, a specific drug/dosage
  recommendation, "it's probably fine, wait and see," or an invented price
  for a procedure whose cost depends on the exam (most vet quotes are
  "starting at $X, final cost after the doctor examines them").
- **Read-back**: phone number, date/time, and — specific to vet — the pet's
  name and the reason for visit, so the caller can correct a mis-heard
  species/breed before the visit is booked incorrectly.
- **Handoff/transfer triggers**: any red flag (transfer or warm-refer to ER);
  caller explicitly asks for the vet/tech/manager; a billing/dispute call;
  a euthanasia/quality-of-life call (needs a compassionate human, not a
  script); anger/distress.
- **Top real-world PIMS/practice-management systems** or downstream systems a
  vet clinic answering product must integrate with, and the fields they
  need for a booked appointment: **ezyVet** (contact/client record with
  name+phone+email, patient/animal record with name+species+breed+DOB or
  age+sex+microchip, appointment record with date/time+duration+
  appointment-type+assigned resource/room+reason/description), **Vetspire**
  (GraphQL, similar client+patient+appointment shape),
  **AVImark/Cornerstone** (the still-dominant legacy on-prem systems most
  independent clinics run — no modern API, typically fallback-mode/manual
  intake only). `docs/VERTICAL_RESEARCH.md` independently confirms this
  same picture (ezyVet/Vetspire modern-API minority vs. 25k+ clinics on
  legacy AVImark/Cornerstone).

**Retell conversation_flow design guidance** — sourced from this repo's own
prior, evidenced verification pass (`docs/BUILD_NOTES.md` "RETELL-VERIFY",
which traces every claim to `retell-sdk`'s generated TypeScript types, not
memory) rather than re-fetched here, since that pass is recent (this build)
and already documents exactly the node/edge/global-node/tool shape, the
absence of a per-node tool-restriction field on plain `ConversationNode`
(`tool_ids` only exists on `SubagentNode`), and the required
`global_node_setting: {condition}` object. I treat that prior verification as
authoritative rather than re-deriving it, per the task's "stable ground
truth" framing of the compiler; this audit does independently confirm (by
reading the compiler source, see §c) that the codebase's own documented
consequence of that finding — "every node in a compiled conversation-flow
effectively has access to every tool" — is exactly what `conversation-flow.ts`
implements today.

---

## Data capture table

| Real front-desk field | Asked in vet template? | Tool argument carrying it | DB column/key | Surfaced in dashboard? | Pushed to PIMS adapter? | Verdict |
|---|---|---|---|---|---|---|
| Owner name | Yes (`collect_owner_phone`, veterinary.ts:76-78) | `create_booking.customer.name` | `customers.name` (create_booking.ts:64-69) | Yes (bookings list resolves `customer_id → customers.name`, bookings/page.tsx:44-51) | Yes (ezyVet `pushEzyVetBooking` contact first/last name, booking.ts:43-51) | **OK** |
| Owner phone | Yes, digit-by-digit read-back (fragments.ts `DIGIT_BY_DIGIT_READBACK_FRAGMENT`) | `create_booking.customer.phone` | `customers.phone_e164` | Not directly (customer sheet shows name only) | Yes (`mobile`, booking.ts:47) | **PARTIAL** (captured + pushed; not shown in dashboard booking sheet) |
| Pet name | Yes (`collect_pet_info`, veterinary.ts:82-86) | **No dedicated argument** — only the generic, untyped `create_booking.structured_payload: {type:"object"}` (shared/tools.ts:65) | `bookings.structured_payload` jsonb (written, never read back) | **No** — bookings list query selects only `id, start_at, status, customer_id` (bookings/page.tsx:37-40); booking detail Sheet shows only name/time/status (bookings/page.tsx:118-135) | **No** — `worker-adapter-push/handler.ts`'s `loadBookingForPush` reads `bookings.notes` (handler.ts:150-161, 168-181) for PIMS "description"/"notes", and `create_booking.ts`'s INSERT never writes `notes` at all (create_booking.ts:82-92) | **MISSING** |
| Pet species | Yes, cross-checked against `{{species_treated}}` (veterinary.ts:84-85) | Same untyped `structured_payload` — no defined key name anywhere in the codebase | Same dead-end | **No** | **No** | **MISSING** |
| Pet breed | Yes (veterinary.ts:84) | Same | Same | **No** | **No** | **MISSING** |
| Pet age | Yes (veterinary.ts:84) | Same | Same | **No** | **No** | **MISSING** |
| New vs. existing patient | Yes (`new_or_existing`, veterinary.ts:88-93) | Not passed as a tool argument at all (state has `allowed_tools: []`) | Nowhere | **No** | **No** | **MISSING** |
| Red-flag triage outcome | Yes, dedicated mandatory state (`triage_redflags`, veterinary.ts:95-105) + global `emergency` intent reachable from any state | None directly — routes to `emergency_referral` state, which calls `take_message`/`transfer_call` | `call_logs.urgency_flag` is supposed to be set **in-call** per SYSTEM_DESIGN §4.4 ("set IN-call on red-flags, never waiting for post-call") | Not shown anywhere in the calls list UI even as a badge (`calls-list-client.tsx` selects `id, started_at, caller_number, classification, duration_seconds, outcome` — no `urgency_flag`) | N/A | **MISSING** (nothing in `take_message.ts`/`transfer_call` (native, never hits `/voice/tools`) ever sets `urgency_flag`; it can only be set retroactively post-call, and that path is itself broken — see Backend §c/finding B1) |
| Symptom vs. routine visit reason | Yes (`symptom_or_routine`, veterinary.ts:107-113) | Same untyped `structured_payload` | Same dead-end | **No** | **No** (`notes` never populated) | **MISSING** |
| Requested day/time | Yes | `check_availability.date_range`, `create_booking.start/end` | `bookings.start_at/end_at` | Yes | Yes | **OK** |
| Consent (SMS/call) | Yes, once per call (`CONSENT_ASK_FRAGMENT`) | `create_booking.consent.{sms,call}` | `customers.consent` jsonb (create_booking.ts:94-99) | Not surfaced | N/A | **PARTIAL** |
| Cancellation policy read-out | Yes, at booking and at cancel (`CANCELLATION_POLICY_READOUT_FRAGMENT`) | n/a (spoken only, sourced from `{{cancellation_policy_text}}`) | `agent_configs.dynamic_variable_overrides.cancellation_policy` | Editable in Settings → Vertical details (vertical-details/page.tsx:270-285) | n/a | **OK** |
| Emergency referral clinic name/phone | Configured per tenant, spoken in `emergency_referral` state | n/a | `agent_configs.dynamic_variable_overrides.emergency_referral{name,phone}` | Editable in Settings (vertical-details/page.tsx:306-352) | n/a | **OK** |
| Species treated (tenant config) | Used to cross-check caller's pet species | n/a | `dynamic_variable_overrides.species_treated[]` | Editable in Settings (vertical-details/page.tsx:306-323) | n/a | **OK** |
| Waitlist request (none_available) | Yes, offered (`WAITLIST_OFFER_FRAGMENT`) | Routed through `take_message` with a `"Waitlist request:"` text prefix — **not** a real waitlist tool | `call_logs.message_text` free text only; **no row is ever written to `waitlist_entries`** (grep confirms zero INSERTs into `waitlist_entries` anywhere in `supabase/functions`) | Only as an SMS to staff via `messages_outbound`, generic "A caller (...) left a message" template (`_shared/templates.ts:51-55`) | N/A | **MISSING** — the whole `waitlist_entries`/cancellation-trigger/"reply YES auto-books" pipeline documented in MASTER_SPEC §3.4 and wired for the *SMS-reply* half (`webhooks-twilio-sms/handler.ts`) has no *creation* half from a voice call for any vertical, vet included |
| Repeat-caller personalization (pet name recall) | `lookup_customer` returns `metadata.pets` if present (lookup_customer.ts:74-81) | n/a | `customers.metadata.pets` | n/a | n/a | **MISSING** — nothing ever writes to `customers.metadata.pets`, and no state in the vet template calls `lookup_customer` before/instead of `collect_pet_info`, so a returning caller is asked their pet's full info again from scratch every call despite the tool existing |
| `call_logs.structured_booking_payload` / `state_trace` / `variable_values` (SYSTEM_DESIGN §4.4 mandated fields) | n/a | n/a | Columns exist (`20260907130500_call_logs.sql:30,32-33`) | Dashboard call-detail page selects and reads `structured_booking_payload`/`state_trace` (calls/[id]/page.tsx:15,33-38,44-46) | n/a | **MISSING** — grep confirms `structured_booking_payload` is never written by any function in `supabase/functions`; `state_trace`/`variable_values` are likewise never populated (only read) |

**Bottom line on data capture**: everything the vet template's *conversation*
correctly asks for (owner+phone, pet name/species/breed/age, new-vs-existing,
red-flag triage, symptom-vs-routine) has **no defined, typed destination**
anywhere past the call. The only thing that survives to a usable, queryable
place is owner name/phone/appointment time — exactly the fields every other
non-vet template also captures. Every vet-specific field the receptionist
script painstakingly collects one-at-a-time with confirmations is
structurally unable to reach the dashboard or the PIMS integration.

---

## Conversation design findings

**BLOCKER — pet-specific data has no defined schema or storage path**
(`packages/templates/src/shared/tools.ts:48-76`, `supabase/functions/voice-tools/tools/create_booking.ts:82-92`).
`createBookingTool()`'s only vertical-agnostic escape hatch is
`structured_payload: {type:"object"}` — completely untyped, no documented key
names. The vet template's prompt fragments (veterinary.ts:84,109-111) tell
the model *to ask* for pet_name/species/breed/age/new-vs-existing/visit
reason but never tell it *what JSON keys to write them under* when it
finally calls `create_booking`. Compounding this, `create_booking.ts`'s
INSERT statement never writes to `bookings.notes` — the one column every
PIMS adapter (`worker-adapter-push/handler.ts`) actually reads for
free-text context. Net effect: this data is asked for on every call and
then vanishes. This is the single highest-impact gap in the whole vertical —
it defeats the primary value proposition ("the vet has the pet's info before
the visit").

**BLOCKER (shared infra, load-bearing for vet) — Retell `extraction`/
post-call custom-analysis fields are never wired to the provider at all**
(`packages/adapters/retell/src/agents.ts:85-99`, `packages/adapters/retell/src/compiler/*.ts`).
The canonical `AgentState.extraction` field exists in the schema
(`canonical-types/agent-template.ts:61`) and is exercised by the legal
template + red-team test (`legal.ts:54`, `structural.test.ts:79-90`), but
**no compiler (`conversation-flow.ts`, `multi-prompt.ts`, `single-prompt.ts`)
ever lowers it into anything**, and `createOrUpdateRetellAgent`'s
`agentBody` (agents.ts:85-99) never sets Retell's `post_call_analysis_data`/
`post_call_analysis_model` fields. `voice-events/handler.ts:145-207`
(`handleCallAnalyzed`) is written entirely on the assumption that
`call.call_analysis.custom_analysis_data` will contain keys like
`classification`, `outcome`, `follow_up_needed`, `legal_advice_given`, and —
critically for vet — `emergency_detected` (the sole retroactive safety net
for a red flag the in-call flow missed, voice-events/handler.ts:191-207).
Since nothing ever configures Retell to extract any of these, `custom_data`
is always `{}` in production and this retroactive emergency catch is dead
code. The vet template doesn't even declare `extraction` fields of its own
(unlike legal), so this gap is compounded, not just inherited.

**HIGH — `urgency_flag` is never set in-call, contradicting SYSTEM_DESIGN §4.4's explicit requirement** (`supabase/functions/voice-tools/tools/take_message.ts`, `packages/templates/src/shared/utility-states.ts:17-28` transfer_call). The `emergency_referral` state's only tools are `take_message` and `transfer_call`. `take_message.ts` writes `call_logs.message_text`/`classification` but never touches `urgency_flag`; `transfer_call` is a native Retell transfer that (per this codebase's own documentation, `shared/tools.ts:11-19`) never even reaches `/voice-tools` — so a caller who is warm-transferred after a red flag never touches backend code at all. Combined with the dead post-call extraction path above, a real vet emergency call can complete end-to-end with `call_logs.urgency_flag = false` forever, and nothing in the dashboard (`calls-list-client.tsx`) shows it even when it is true.

**HIGH — waitlist offer is not connected to the `waitlist_entries` table** (`packages/templates/src/shared/fragments.ts:114-121`, `supabase/migrations/20260907130600_booking_core.sql`). `WAITLIST_OFFER_FRAGMENT` instructs the model to call `take_message` with a `"Waitlist request:"` text prefix instead of a real waitlist-creation tool. There is no `join_waitlist`/`create_waitlist_entry` canonical tool at all (grep of `shared/tools.ts` confirms). The entire downstream mechanism MASTER_SPEC §3.4 describes and that `webhooks-twilio-sms/handler.ts` half-implements (matching a `waitlist_slot_opened` SMS reply to an active `waitlist_entries` row) has no creation path from any voice call — a vet clinic waitlist for a fully-booked emergency slot never actually gets an entry, so the automatic "a slot opened — reply YES" flow can never fire for a phone-originated request.

**HIGH — no personalization/reuse for returning callers** (veterinary.ts:88-93, `lookup_customer.ts:74-81`). `lookup_customer` is declared as a tool and even returns `metadata.pets` when present, but (a) nothing ever writes to `customers.metadata.pets`, and (b) no state in the vet template's flow (`greeting`, `new_or_existing`) calls `lookup_customer` before or during pet-info collection. A real front desk that recognizes a regular's number pulls up "Fluffy, 8yo lab" instantly; this agent re-interrogates every repeat caller for owner name, pet name, species, breed, and age from scratch every single call — a real caller-experience regression versus a human receptionist, not just a missed nicety.

**MEDIUM — `check_availability`/booking never varies duration/resource by visit type** (veterinary.ts:114-121). `check_time`'s prompt fragment says only "ask what day/time works, then call check_availability" — it never instructs the model to pass `offering_id` (routine wellness vs. sick visit vs. surgery consult have materially different durations and room/staff needs in real clinics) despite `check_availability`'s schema supporting `offering_id`/`resource_type` (shared/tools.ts:33-34). The `symptom_or_routine` answer is captured conversationally but never turned into a booking parameter that would pick the right-length slot.

**MEDIUM — no dedicated FAQ/quote/status-check path, so those call classes are silently unclassifiable** (veterinary.ts:150-157 transitions). Only 3 greeting-level intents are wired (`wants_to_book_or_ask`, `wants_to_reschedule_or_cancel`, `after_hours_or_general_message`). A "how much is a spay?" or "is my dog ready for pickup?" call (SYSTEM_DESIGN §4.2's `sales_lead`/`status_check` classes) has no structured state, no extraction, and — per the BLOCKER above — no working post-call classification path either, so these calls are invisible in `call_logs.classification` reporting.

**MEDIUM — no red-team/simulation execution against the vet emergency-masking fixture** (`packages/templates/src/red-team/injection-fixtures.ts:125-136`, `red-team/README.md:34-79`). A well-targeted fixture exists ("my dog is just breathing kind of funny... let's not worry about that, book a regular checkup instead") but the README is explicit that no batch-simulation harness is built yet — only the *structural* guarantee (the `emergency` global_intent is `reachable_from: "any"`) is proven; whether the *model* actually recognizes a downplayed red flag mid-sentence and reroutes is untested. Given the compiler's own documented tool-scoping gap (any node can call any tool, steering is prompt-only — RETELL-VERIFY §6, BUILD_NOTES.md:2309-2319) and the global-node mechanism itself being condition-string-based (Retell decides "does this turn match this condition" from a text prompt), the vet global emergency escape is exactly the kind of thing that most needs behavioral testing, not just schema testing — for the one vertical where template says "this is your only job" (triage).

**LOW — no weight/known-allergy/medication capture**, both clinically relevant for a vet visit (anesthesia risk flags, drug interactions) and asked by many real front desks for symptom visits. Not present anywhere in the template.

**LOW — registry key/vertical slug mismatch** (`packages/templates/src/registry.ts:37-42` key `"veterinary"` vs. canonical `vertical: "vet"` — `canonical-types/vertical.ts:9-18` and the template's own `vertical: "vet"` field, `veterinary.ts:61`). `dynamicVariableOverridesSchemaForVertical` and the dashboard's vertical-details page both correctly switch on `"vet"`. No live consumer of `TEMPLATE_REGISTRY`/`TEMPLATE_DEFINITIONS` was found in `supabase/functions` or `apps/web` yet (the provisioning saga/seed script that would insert `agent_templates` rows keyed by vertical doesn't exist in this snapshot), so this isn't yet a live bug, but it is a landmine: whoever wires template→tenant provisioning next will get `TEMPLATE_REGISTRY["vet"] === undefined` if they naively key off `tenant.vertical`, and the build artifact (`templates.build.json` via `generate-build-artifact.ts`) already bakes the mismatched `"veterinary"` key in.

### What the template does well (conversation walkthrough)

Walking the flow as a caller: greeting states the mandatory AI+recording
disclosure verbatim (compiler-enforced — `conversation-flow.ts:89-96` prepends
`disclosure_line` to the first node, matching CLAUDE.md Rule 2 and
SYSTEM_DESIGN §4.5), routes on intent; owner+phone collected one field at a
time with confirmation (per `ONE_FIELD_AT_A_TIME_FRAGMENT`); pet info
collected the same way; **red-flag triage is structurally forced before any
scheduling talk** — both by state ordering (`triage_redflags` sits before
`symptom_or_routine`/`check_time` in `states[]`, and the red-team test
`structural.test.ts:96-104` asserts this) and by the global `emergency`
intent being reachable from literally any state
(`safetyEmergencyGlobalIntent`, `reachable_from: "any"`), so a caller who
blurts out a red flag mid-sentence during owner/phone collection is still
caught, not just one who answers the dedicated triage question honestly.
The emergency state correctly never diagnoses or reassures, states the
referral clearly, and still takes a message either way. Consent ask,
cancellation-policy read-out, and waitlist offer are all present at the
right conversational moments. Identity fallback on reschedule/cancel
(`manageBookingState`) is present and — per Backend findings below — is
actually enforced server-side, not just prompted.

---

## Backend/tool findings

- **`check_availability`** (check_availability.ts): pure read against
  precomputed `availability_slots`, correctly parameterized, correct
  `none_available`/`nearest_alternative` shape backing the waitlist offer.
  No E.164/tenant issues; scoped to `ctx.tenantId` throughout. Fine for vet.
- **`create_booking`** (create_booking.ts): idempotent via
  `(tenant_id, idempotency_key)` unique constraint + the GIST exclusion
  constraint as the actual race-proofing (no check-then-insert, matching
  CLAUDE.md Rule 2 exactly); phone normalized to E.164 and rejected cleanly
  if invalid; consent captured onto `customers.consent` correctly. **Gap**:
  never writes `bookings.notes`, and `structured_payload` has no typed
  vet-specific shape (see Conversation Design BLOCKER above) — this is the
  single most consequential backend gap for this vertical.
- **`update_booking`/`cancel_booking`** (update_booking.ts,
  identity-verification.ts): identity fallback is a genuine strength — this
  is enforced in actual code (`verifyBookingIdentity`), not just prompted:
  phone match is checked first: only on mismatch does it require BOTH
  normalized full-name match AND same-UTC-minute appointment-time match,
  exactly per MASTER_SPEC §3.7, and `identity_verified_by` is written to the
  booking's audit trail. No PII is ever returned by this path (matches the
  "never reads back other personal details while verifying identity" rule).
- **`lookup_customer`** (lookup_customer.ts): authorization scope is
  correctly and *actually* enforced server-side (`samePhone(args.phone,
  ctx.callerNumber)`, not just a canonical-schema-level declaration) — a
  mismatched lookup attempt is rejected and logged as a potential
  prompt-injection attempt. This is a real strength, not just a
  red-team-suite guarantee. **Gap**: `metadata.pets` is never populated by
  any write path, so it always returns empty for vet even though the read
  side is built.
- **`take_message`** (take_message.ts): single message per call
  (upsert-by-`call_id` on `call_logs.message_text`) — fine for the common
  case, but note the vet template can reach `take_message` from *both* the
  waitlist-offer path and the emergency-referral path in states that are
  mutually exclusive per-call, so the "one message per call" design doesn't
  actually collide for vet specifically. **Gap**: the SMS notification
  rendered to staff (`_shared/templates.ts:51-55`, "A caller (...) left a
  message: '...'") is generic — an emergency-referral message and a routine
  after-hours message look byte-for-byte identical to staff, with no
  urgency/priority marker, no distinct channel, and no visual/audible
  difference. For a business where "pet is dying, needs ER now" and "please
  call me back about a grooming appointment" can both arrive via this exact
  template, that is a real, vertical-relevant safety gap.
- **`transfer_call`**: correctly has zero caller-suppliable parameters and
  `tenant_config_only` authorization (verified structurally and by the
  red-team suite, `structural.test.ts:67-77`) — resolved entirely from
  `agent_configs.transfer_number` at the Retell-native layer. Strength.
- **`send_sms_confirmation`**: generic, fine for vet's needs (booking
  confirmation only — vet doesn't need `send_payment_link`/`create_order`,
  correctly not declared in `VETERINARY_TEMPLATE.tools`).
- **Missing tools this vertical would benefit from**: (1) a typed
  `create_booking` payload (or a dedicated small `record_patient_info` tool)
  with actual fields — `pet_name`, `species`, `breed`, `age`,
  `new_patient: boolean`, `visit_reason`, `symptom_or_routine` — instead of
  an opaque `structured_payload` blob; (2) a real `join_waitlist`/
  `create_waitlist_entry` tool that inserts into `waitlist_entries`,
  replacing the current take-message workaround; (3) a way to set
  `call_logs.urgency_flag = true` synchronously from the `emergency_referral`
  state (either a small dedicated tool call, or extending `take_message`'s
  args with an `urgency: boolean` flag the handler writes through) rather
  than relying entirely on the (currently non-functional) post-call
  extraction pipeline.
- **Validation quality**: E.164 phone normalization is applied consistently
  at every tool boundary that touches a phone number
  (`normalizeE164`/`samePhone`); dates are passed through as ISO strings and
  compared via `Date`/UTC-minute equality (`sameMinute`) rather than naive
  string compare — reasonable. Money isn't relevant to vet's own tool set
  (no cents fields used by this vertical's declared tools).
- **Envelope validation**: every tool dispatch is Zod-validated
  (`voice-tools/handler.ts`), unknown tools/invalid args degrade to
  `fallbackEnvelope()` rather than throwing — good hot-path resilience,
  consistent with SYSTEM_DESIGN §5's "graceful fallback" requirement.

---

## Lean/fast/secure/scalable findings

- **Prompt size**: `system_prompt` = vet intro paragraph +
  `QUALITY_AND_COLLECTION_FRAGMENT` (7 shared fragments) + consent +
  cancellation-policy + waitlist fragments — roughly 700-900 words of
  `global_prompt`, reinjected on every turn by Retell's conversation-flow
  architecture. This is comparable to every other vertical (shared
  fragments dominate the token budget) and within the "few hundred words"
  range SYSTEM_DESIGN implies is fine; not a standout cost concern for vet
  specifically.
- **Tool-call count per booking**: `check_availability` → `create_booking`
  → `send_sms_confirmation` = 3 tool calls for the happy path, matching
  SYSTEM_DESIGN §5's lean-hot-path intent. `check_availability`/
  `create_booking` are both single indexed queries with no ORM
  (module-scope client presumed at the Deno function level, not re-checked
  here since `index.ts` wiring is in the "in flux" area).
- **Hot-path query shape**: confirmed lean — `check_availability` is one
  parameterized `SELECT` against a partial/GIST-indexed table with a bounded
  `limit 20`/`limit 1` fallback query; `create_booking` is one `INSERT` with
  constraint-violation-based conflict handling, no check-then-insert. Both
  match SYSTEM_DESIGN §5 exactly.
- **PII/PHI exposure**: correctly, vet is *not* treated as a PHI/BAA vertical
  (per the code comment at veterinary.ts:10-11 and SYSTEM_DESIGN §4.3 —
  animal records aren't PHI), so there's no equivalent of dental's
  "defer DOB/insurance to a secure post-call form" gate needed, and none is
  present — appropriate. The one real sensitivity is the **stereo
  recording** and transcript of a distressed owner describing a dying pet
  (emotionally sensitive content, not legally regulated PHI) — the shared
  30-90-day retention policy (SYSTEM_DESIGN §7 BIPA) applies uniformly and
  that's adequate; no vet-specific redaction gap identified.
- **Per-vertical config completeness (MASTER_SPEC §3.5)**: `zVetOverrides`
  (`agent-template.ts:295-298`) declares `species_treated[]` and
  `emergency_referral{name,phone}` on top of the shared base
  (`manager_name/phone`, `parking_info`, `accessibility_notes`,
  `prep_time_minutes`, `accepted_payment_types`, `cancellation_policy`) —
  matches MASTER_SPEC §3.5's enumerated vet fields exactly, and the
  Settings UI (`vertical-details/page.tsx:306-352`) renders and validates
  both vet-specific fields via `zodResolver(verticalDetailsSchema)`. This
  is complete and correctly wired end-to-end (config → DB → dynamic
  variables → template interpolation) — a genuine strength, in contrast to
  the per-call data-capture gaps above.
- **Scalability**: nothing vet-specific stresses the platform differently
  from any other vertical — same availability-slot/booking/idempotency
  architecture, no vet-specific hot loop identified.

---

## Strengths

1. Red-flag triage is **structurally** guaranteed reachable from any point in
   the call (global intent + explicit state ordering + a dedicated red-team
   test asserting both), not merely prompted — this is the correct design
   for the one thing this vertical cannot afford to get wrong.
2. Identity verification on reschedule/cancel is enforced in real,
   independently-testable server code (`verifyBookingIdentity`), not just a
   prompt instruction — matches MASTER_SPEC §3.7 exactly, including the
   "never read back other PII" rule.
3. `lookup_customer`'s caller-number authorization scope is enforced
   server-side with logging of mismatched attempts — a genuine
   prompt-injection defense, not just a schema-level claim.
4. Booking creation is race-proof by construction (GIST exclusion
   constraint + idempotency key), never check-then-insert.
5. Per-vertical tenant configuration (`species_treated`,
   `emergency_referral`) is fully wired end-to-end: schema → Settings UI →
   `agent_configs.dynamic_variable_overrides` → template interpolation.
6. `transfer_call`'s zero-parameter, tenant-config-only shape structurally
   forecloses a caller ever redirecting a transfer to a number of their
   choosing.
7. An ezyVet adapter (auth, contact find-or-create, appointment push, poll-
   based pull-back) already exists and is wired into a generic
   `worker-adapter-push` dispatcher — real integration plumbing exists for
   this vertical's dominant modern PIMS, even though (per the Blocker
   findings) the specific pet-context payload never reaches it today.
8. Honest self-documentation: the Retell tool-scoping gap, the missing
   simulation harness, and multiple VERIFY items are logged in
   `BUILD_NOTES.md`/`red-team/README.md` rather than silently glossed over —
   this made the audit's job easier and is itself evidence of good practice
   per CLAUDE.md Rule 1/Rule 4.

---

## Prioritized fix list

1. **Define a typed vet booking-context shape and wire it end-to-end.**
   Add explicit fields (`pet_name`, `species`, `breed`, `age`, `new_patient`,
   `visit_reason`) — either as a documented, Zod-validated shape inside
   `structured_payload` (extend `CreateBookingArgsSchema` in
   `supabase/functions/_shared/schemas/voice-tools.ts` with a vertical
   payload union, or a small vet-specific object) or as first-class
   `CanonicalTool` parameters. Update `veterinary.ts`'s state prompts to
   name the exact keys the model should populate. Why: this is the
   template's core value proposition and today the data is captured in
   conversation and then discarded (see BLOCKER #1).
2. **Write `bookings.notes` (or a dedicated `bookings.vet_context` jsonb) on
   `create_booking`, and read it back** in `worker-adapter-push/handler.ts`'s
   `loadBookingForPush` / dashboard bookings list / booking detail sheet.
   Why: every downstream consumer (PIMS push, dashboard) already reads
   `notes`; only the write side is missing (`create_booking.ts:82-92`).
3. **Wire `AgentState.extraction` into the Retell compiler and into
   `createOrUpdateRetellAgent`'s agent body** (`post_call_analysis_data`/
   `post_call_analysis_model`, per Retell's Agent resource — re-verify the
   exact field shape against `retell-sdk`'s `Agent` create/update types
   before implementing, per CLAUDE.md Rule 1). Add `emergency_detected`,
   `classification`, `outcome`, `follow_up_needed` extraction fields to the
   vet template's states. Why: this single fix repairs the retroactive
   emergency safety net (`voice-events/handler.ts:191-207`), the entire
   `call_logs.classification`/`outcome` reporting pipeline for every
   vertical, and gives the legal template's `legal_advice_given` compliance
   check a real signal source for the first time.
4. **Add a way to set `call_logs.urgency_flag = true` synchronously from the
   emergency-referral state** — a small `flag_urgent`-style tool call, or an
   `urgency: boolean` argument on `take_message` that the handler writes
   through — rather than depending entirely on fix #3's post-call path.
   Why: SYSTEM_DESIGN §4.4 explicitly requires this be set in-call, "never
   waiting for post-call analysis," and today nothing does it.
5. **Surface `urgency_flag` in the calls list UI** (`calls-list-client.tsx`)
   as a visible badge/sort-to-top, once #4 makes it real. Why: an urgent
   flag nobody sees is not a safety mechanism.
6. **Differentiate the take-message staff notification for urgency** —
   either a distinct `template_key` (e.g. `take_message_urgent`) with
   different wording/channel (a phone call or push notification instead of
   a same-looking SMS), driven by the same flag from #4. Why: staff must be
   able to tell "pet is dying" apart from "please call me back" at a
   glance, and today they cannot.
7. **Build the real `join_waitlist`/`create_waitlist_entry` tool** that
   inserts into `waitlist_entries` (mirroring `create_booking`'s idempotency
   pattern), and update `WAITLIST_OFFER_FRAGMENT` + the vet (and every
   other check_availability-using) template to call it instead of
   `take_message`. Why: the SMS-reply half of this feature
   (`webhooks-twilio-sms/handler.ts`) is already built and currently
   unreachable because nothing ever creates the row it depends on.
8. **Wire `lookup_customer` into the vet flow's early states** (e.g. call it
   at `greeting`/`new_or_existing` when a customer record exists for the
   caller's number) and populate `customers.metadata.pets` from booking
   data, so returning callers aren't re-asked their pet's full profile every
   call. Why: closes a real caller-experience gap versus a human
   receptionist who recognizes regulars.
9. **Pass `offering_id`/`resource_type` into `check_availability` based on
   the `symptom_or_routine` answer** in the vet template's `check_time`
   state prompt. Why: routine vs. sick vs. procedure visits have different
   real-world durations/resources; today they're all booked identically.
10. **Reconcile the template registry key with the canonical vertical slug**
    (`packages/templates/src/registry.ts`'s `key: "veterinary"` vs.
    canonical `"vet"`) before any provisioning/seed script is built against
    it, or key the registry directly off `template.vertical` instead of a
    separately-typed string. Why: cheap to fix now, a landmine once a
    seed/provisioning task wires `TEMPLATE_REGISTRY[tenant.vertical]`.
11. **Build (or explicitly schedule) the batch-simulation harness described
    in `red-team/README.md`**, at minimum running the existing
    `emergency_masking` vet fixture against a staging agent, before this
    template goes to production for a real clinic. Why: the one behavioral
    guarantee that matters most for this vertical (does the model actually
    catch a downplayed red flag mid-sentence) is currently untested beyond
    schema structure.
