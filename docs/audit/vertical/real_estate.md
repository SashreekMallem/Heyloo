# Real Estate Vertical Audit (`template key: real_estate`, compiled as Retell `single_prompt`)

Audited read-only. All line numbers verified against the current working tree on 2026-09-10.
`supabase/functions/voice-tools` is noted as "in flux" per the task brief but was read for
evidence anyway since it is the only place several claims can be checked; flag re-verify if it
changes materially.

## Research summary

**Real-world front-desk / ISA practice (WebSearch, domain knowledge labeled):**
- [Scripts for Your Real Estate ISA](https://hireaiva.com/blog/scripts-for-isa/), [5 buyer-lead qualifying questions](https://hireaiva.com/blog/five-qualifying-questions-for-buyer-leads/), [Pre-Qualification Script](https://www.jamilacademy.com/blog/pre-qualification-script-how-to-qualify-buyers) — buyer-side: property type/area, whether they've already toured/found it online, how long they've been looking, lender/pre-approval status, **whether they already have an agent** (critical dedup/compliance question — calling on someone else's listing when the caller is already represented is an ethics/MLS issue), timeline, budget. Seller-side ("hub and spoke" from "are you thinking of selling?"): motivation, timeline, price expectation, property condition, and — domain knowledge — **whether the home is already listed with another agent** (a live listing agreement is the single most important seller-side compliance question; soliciting an already-listed seller is a real ethical/legal problem in the industry).
- Domain knowledge (not independently re-verified beyond the above): a competent human front desk/ISA also captures property address or MLS# if the caller is calling about a specific listing, best contact time, and — for a showing — confirms who will be present (buyer's agent, if any) and how they'll get in (lockbox/gate code), which a phone agent obviously cannot hand out but should flag for the listing agent.
- **Follow Up Boss** (the vertical's Wave-2 CRM pick per `docs/spec/API_AND_FLOWS.md:976`): [`/events` endpoint](https://docs.followupboss.com/reference/events-post) is the idiomatic contact-create path (`source`, `system`, `type`, `message`, `person{firstName,lastName,emails,phones}`), triggering the account's own automation; [`/appointments`](https://docs.followupboss.com/reference/appointments-get) for showings. FUB supports custom fields per-account. No FUB adapter package exists yet in this repo (`packages/adapters/` has shopmonkey/retell/ezyvet/google-calendar/square only) — expected, this is Wave-2/not-yet-built per `MASTER_PLAN`/`VERTICAL_RESEARCH.md:59`, not a bug.
- **Retell single-prompt guidance** ([Single/Multi Prompt Agent Overview](https://docs.retellai.com/build/single-multi-prompt/prompt-overview) — page itself blocked by this environment's egress proxy, content below via WebSearch snippet of that same page, so treat as high-confidence secondhand, not a live fetch): single-prompt is for simple/open-ended conversations; **"consider using conversation flow or multi-prompt when your single prompt exceeds 1000 words or uses more than 5 functions"**; multi-prompt "outperforms single-prompt on complex tasks... the model might spontaneously jump to a new topic or repeat questions in single prompts, since it doesn't have a built-in notion of conversation phases." This exactly matches `SYSTEM_DESIGN.md:114`'s own stated threshold — see Finding R-1 below for what this means once actually measured against the compiled template.
- Could not reach `docs.retellai.com` directly (`EGRESS_BLOCKED` on `WebFetch`) to verify node-type/dynamic-variable/post-call-analysis specifics beyond what the repo's own extensive VERIFY-comments in `packages/adapters/retell/src/compiler/types.ts` already document from `retell-typescript-sdk`; relied on those in-repo VERIFY notes (already resolved by prior build agents against the actual SDK types) plus the WebSearch snippet above.

## Data capture table

Real estate is `single_prompt`: there is no node graph, so "state" below is the one organizational
`qualification` section (`packages/templates/src/verticals/real-estate.ts:50-61`).

| Real-world field | Asked in template? | Tool argument | DB column / jsonb key | Dashboard? | Adapter push? | Status |
|---|---|---|---|---|---|---|
| Buyer vs. seller | Yes, prose only ("whether they're a buyer or a seller") — real-estate.ts:54 | none — no schema field anywhere carries this | none (would have to be free text inside `take_message.message_text` or an unspecified key of `create_booking.structured_payload`) | not shown (call detail page only reads `structured_booking_payload.booking_id`, `apps/web/.../calls/[id]/page.tsx:44-46`) | no adapter exists yet (expected, Wave-2) | **MISSING** |
| Property / area of interest | Yes, prose — real-estate.ts:54-55 | none | none | not shown | no | **MISSING** |
| Buyer pre-approved for financing | Yes, prose — real-estate.ts:55-56 | none | none | not shown | no | **MISSING** |
| Timeline | Yes, prose — real-estate.ts:56 | none | none | not shown | no | **MISSING** |
| Budget | Yes, prose — real-estate.ts:56 | none | none | not shown | no | **MISSING** |
| Already working with another agent (buyer) / already listed (seller) — the single most important compliance question per research above | **Not asked at all** — not in the prompt text | n/a | n/a | n/a | n/a | **MISSING** |
| Name + phone (showing path) | Yes | `create_booking.customer.{name,phone}` (`tools.ts:59-64`) | `bookings.customer_id` → `customers.name/phone_e164` (`20260907130600_booking_core.sql:69`, `20260907130400_customers.sql:8-9`) | shown generically (caller_number column, `calls-list-client.tsx:14-47`) | no | **OK** |
| Name + phone (quote/no-commit path) | Yes | `take_message.caller_name/caller_phone` (`tools.ts:158-161`) | `call_logs.message_text` only (name/phone are folded into the free-text SMS payload in `take_message.ts:44-50`, never their own column) | not shown on call detail page (`message_text` isn't even selected — page.tsx:15) — only reaches staff via the outbound SMS | no | **PARTIAL** |
| Showing date/time | Yes, via `check_availability`/`create_booking` | `start`/`end` (`tools.ts:57-58`) | `bookings.start_at/end_at` | not directly, but booking exists and is queryable | n/a | **OK** (booking path only) |
| Consent to text/call | Yes (shared `CONSENT_ASK_FRAGMENT`, real-estate.ts:41) | `create_booking.consent{sms,call}` | `customers.consent` jsonb (`create_booking.ts:72-79,94-98`) | not surfaced in call/customer UI reviewed | n/a | **OK** (booking path); **N/A on quote path** — `take_message` has no consent field at all, so a quote-only caller's consent is never asked/stored even though MASTER_SPEC §3.6 implies it should gate any future outbound (reminder/review) contact |
| Cancellation policy readback | **Not included** — real-estate.ts's `buildSystemPrompt` call passes only `CONSENT_ASK_FRAGMENT` + `WAITLIST_OFFER_FRAGMENT` (real-estate.ts:36-43), omitting `CANCELLATION_POLICY_READOUT_FRAGMENT` (contrast with auto-repair.ts:40-42 which includes it) | n/a | `agent_configs.dynamic_variable_overrides.cancellation_policy` **is still configurable** by a real-estate tenant via the Settings → Vertical Details tab (the field is vertical-agnostic, `vertical-details/page.tsx:270-285`, always rendered) | tenant can fill in a policy that the compiled agent will **never speak** | n/a | **Dead config / mismatch** — see Finding R-6 |
| Reschedule / cancel an existing showing | **Not handled at all** — no `manage_booking` state, no `update_booking`/`cancel_booking` tools declared (contrast with every other booking vertical — auto-repair.ts:146,183-184; dental.ts:115,154-155; motel.ts:118,153-154; restaurant.ts:154,218-219; veterinary.ts:132,197-198) | n/a | n/a | n/a | n/a | **MISSING (BLOCKER)** — see Finding R-2 |
| Identity fallback on reschedule/cancel (MASTER_SPEC §3.7) | N/A — no reschedule/cancel path exists to protect | n/a | `bookings.identity_verified_by` column exists in schema but real estate has no code path that ever sets it | n/a | n/a | **MISSING**, inherits from R-2 |
| Showing confirmation SMS | **Not sent** — `sendSmsConfirmationTool()` is not in real-estate.ts's `tools[]` (every other booking vertical has it: auto-repair.ts:187, dental.ts:158, motel.ts:157, restaurant.ts:223, veterinary.ts:201) | n/a | n/a | n/a | n/a | **MISSING** — see Finding R-4 |
| Waitlist on no-availability | Yes (`WAITLIST_OFFER_FRAGMENT`, real-estate.ts:42) | `take_message` with a "Waitlist request:" prefix (per shared fragment text, `fragments.ts:114-121`) | `call_logs.message_text` (free text) — **not** `waitlist_entries` table, since no tool actually inserts a `waitlist_entries` row from `take_message` | not shown | n/a | **PARTIAL** — the fragment's own wording says the SMS message becomes the waitlist mechanism, but nothing wires it to the real `waitlist_entries` table/cancellation-matching trigger (`booking_core.sql:138-156`, `functions_triggers.sql` waitlist-notify trigger) the way a `create_booking`-adjacent flow would; this is a real backend/tool gap the fragment's own wording doesn't fully cover (shared across every non-motel vertical, not unique to real estate, but worth naming since it's exercised here) |
| Per-vertical tenant config (MLS/board disclaimer, listing-agent contact, license #, etc.) | N/A — `zRealEstateOverrides = zBaseDynamicVariableOverrides` with **zero** real-estate-specific keys (`agent-template.ts:329`), and the Settings UI has no `vertical === "real_estate"` branch at all (contrast with dental/vet/auto/legal/motel/restaurant branches, `vertical-details/page.tsx:287-525`) | n/a | n/a | n/a | n/a | **MISSING** — see Finding R-7 |

## Conversation design findings

**R-1 [HIGH] — Compiled prompt is already over Retell's own documented single-prompt viability threshold.**
Compiling `REAL_ESTATE_TEMPLATE` exactly as `single-prompt.ts` does (disclosure line + system prompt
+ every state's `## heading\nprompt_fragment` + every global intent's escape text) measures at
**1,022 words / 5 tools** (measured directly: `node` script over the built
`packages/templates/dist/verticals/real-estate.js`, reproducing `compileSinglePrompt`'s exact
`sections.join`). `docs/SYSTEM_DESIGN.md:114` itself states real estate/generic must stay "under
the ~1000-word/5-tool threshold" for single_prompt to be appropriate, and the (secondhand,
WebSearch-sourced) Retell docs give the identical number. The template is already over on words and
at the tool ceiling — **before** fixing R-2/R-4 below, both of which require adding more prompt text
and more tools. This means the natural fix for R-2 (add reschedule/cancel) can't be "just append more
sections" without either (a) trimming existing prose to compensate, or (b) revisiting whether
`single_prompt` is still the right compile target for this vertical, which is a `SYSTEM_DESIGN`
architecture question, not a template-authoring one — per CLAUDE.md Rule 4 this should be logged to
`docs/BUILD_NOTES.md`, not silently redesigned by whichever agent picks up R-2.

**R-2 [BLOCKER] — No reschedule/cancel path exists for real estate at all.**
`packages/templates/src/verticals/real-estate.ts:49-71` declares only `qualification`,
`transferToHumanState()`, `solicitorDeflectState()`, `safetyEmergencyState()` — no
`manageBookingState()` (contrast with every other booking-capable vertical, confirmed by grep:
auto-repair.ts:146, dental.ts:115, motel.ts:118, restaurant.ts:154, veterinary.ts:132), and
`tools[]` (real-estate.ts:72-81) declares neither `updateBookingTool()` nor `cancelBookingTool()`.
Since `compileSinglePrompt` (`single-prompt.ts:25-37`) builds Retell's `general_tools` directly from
`template.tools`, these functions are not merely "unreachable" in-prompt — they **do not exist as
callable Retell functions on the compiled agent at all**. `docs/canonical-types/call-taxonomy.ts`
declares `reschedule`/`cancel` as 2 of the 12 universal call classes every call must land in
(`call_logs.classification` check constraint includes both, `20260907130500_call_logs.sql:19-22`),
and this is one of the most common real-world calls a real-estate office gets (showing conflicts,
weather, work). Today, a caller who already booked a showing and wants to move it hits: (a) no
`global_intent` matches (only `emergency`/`human_request`/`solicitor` are declared,
real-estate.ts:67-71, and `human_request`'s own description is "explicitly asks for a human/manager/
owner" — a reschedule ask doesn't literally match that text), so the model is working from the
`qualification` prompt alone, which only describes fresh-intake questions; (b) it has no tool to
actually change a booking even if it tries. Best case the model generalizes and transfers to a human
via `transfer_call` (not guaranteed, single_prompt has no structural routing per `single-prompt.ts`'s
own docstring: "no graph here"); worst case it says something like "sure, I've moved it to Friday" —
a spoken commitment with **zero corresponding database write**, i.e. a hallucinated booking change.
This is the single most severe finding in this audit. The red-team suite's own
`structural.test.ts:166-176` ("identity fallback present in every template with a reschedule/cancel
path") *silently skips* real estate for exactly this reason (`if (!manageState) continue`) — the
suite is not currently positioned to catch this as a failure, only to describe it when present
elsewhere.

**R-3 [MEDIUM] — "Already working with another agent" / "already listed" is never asked.**
Per the research above, this is the single most important compliance question on either side of a
real-estate call (soliciting an already-represented buyer or an already-listed seller is a real
industry ethics/legal issue), and it is absent from `qualification`'s prompt fragment
(real-estate.ts:53-59), which only lists buyer/seller · property/area · pre-approval · timeline ·
budget · showing time. This mirrors `SYSTEM_DESIGN.md:156-157`'s own (short) enumeration, which also
omits it — so this is a genuine gap in the source-of-truth spec, not just the template, and should be
raised via `docs/BUILD_NOTES.md` per Rule 4 rather than unilaterally added to the prompt.

**R-4 [HIGH] — Showings are booked with no confirmation SMS.**
`sendSmsConfirmationTool()` is not declared in real-estate.ts's `tools[]` (real-estate.ts:72-81),
unlike every other vertical that calls `createBookingTool` (auto-repair.ts:187, dental.ts:158,
motel.ts:157, restaurant.ts:223, veterinary.ts:201). No DB trigger sends a confirmation on
`bookings` insert either (checked `20260907131400_functions_triggers.sql`'s full trigger inventory —
only broadcast/availability-invalidate/segment-recompute/cost-rollup/customer-touch triggers exist,
nothing SMS-related). The consent question is still asked and stored (`CONSENT_ASK_FRAGMENT`,
real-estate.ts:41) but nothing ever acts on it for a showing confirmation — the caller says yes to
being texted and then is never texted.

**R-5 [MEDIUM] — Sales-lead qualification data has no structured capture path at all (see Data table).**
The `qualification` state instructs the agent to gather 5 valuable fields conversationally and then,
for the no-commitment case, "capture their contact info with take_message" (real-estate.ts:58-59).
`take_message`'s schema (`tools.ts:152-168`) has only `caller_name`, `caller_phone`, `message_text`,
`callback_window` — no field for buyer/seller, area, pre-approval, timeline, or budget. There is
also no `extraction` (Retell typed post-call extraction, `zAgentState.extraction`,
`agent-template.ts:34-53,61`) declared on `qualification`, so even the compiler-level structured-
extraction path (used only by `legal.ts:54` in this codebase, for `legal_advice_given`) isn't
available here as an alternative. In practice this means: the model *may* choose to compress all
five answers into `message_text` (which does reach staff via the SMS in `take_message.ts:42-59`),
but nothing enforces it, nothing makes it queryable/reportable (the call detail page doesn't even
select `message_text`, `apps/web/.../calls/[id]/page.tsx:15`, and there's no dashboard "leads"
view — confirmed by grep, only `calls-list-client.tsx` generic list and a message thread view), and
it's not pushed to Follow Up Boss in any structured form even once that adapter exists (Wave-2). Note:
`bookings.structured_payload` and `create_booking`'s `structured_payload` argument (`tools.ts:65`)
*could* carry this data on the showing-booked path, and the write path fully supports it end-to-end
(`create_booking.ts:85-89` writes whatever object the model sends) — but the tool's JSON Schema gives
the model zero hint of expected keys (`parameters.properties.structured_payload = {type:"object"}`
with no nested `properties`), and no prompt text in real-estate.ts instructs the model to populate it
with e.g. `{buyer_or_seller, area, pre_approved, timeline, budget_cents}`. This is the highest-value,
cheapest fix available (see prioritized list).

**R-6 [MEDIUM] — Cancellation-policy config is a dead field for this vertical.**
`vertical-details/page.tsx` always renders the cancellation-policy fields (window_hours/fee_cents/
text, lines 232-285) for every vertical including real estate, and `verticalDetailsSchema`
(`vertical-details.ts:11-18`) applies it universally too. But real-estate.ts's `buildSystemPrompt`
call (lines 36-43) does not include `CANCELLATION_POLICY_READOUT_FRAGMENT`, so
`{{cancellation_policy_text}}` is never referenced anywhere in the compiled prompt — a real-estate
tenant can fill in a cancellation policy and fee that the agent will never speak. Either the field
should be hidden for this vertical (a showing generally has no cancellation fee — plausible reason
it was omitted) or, if a business does want a no-show/cancellation policy stated, the fragment should
be added deliberately. Currently it's silently inert either way.

**R-7 [LOW] — Real estate is the only vertical with zero configurable per-vertical fields.**
`zRealEstateOverrides = zBaseDynamicVariableOverrides` with no additions (`agent-template.ts:329`,
contrast with every other vertical at lines 291-327 of the same file), and the Settings →
Vertical Details form has no `vertical === "real_estate"` branch (`vertical-details/page.tsx`, the
`{vertical === "dental" | "vet" | "auto" | "legal" | "motel" | "restaurant"}` branches at
lines 287-525 cover every OTHER vertical). A real-estate tenant cannot configure e.g. a
listing-agent/team contact name+phone for the warm-transfer context, MLS/board disclaimer text, or a
brokerage license line some states require on business calls. This matches `MASTER_SPEC.md §3.5`
(`docs/spec/MASTER_SPEC.md:105-114`), which also never mentions a real-estate-specific config key —
so, like R-3, this is a spec-level gap worth raising via `docs/BUILD_NOTES.md`, not a template bug
per se.

**Other conversation-quality checks (real estate passes these):**
- Disclosure line present verbatim as the first compiled section (`single-prompt.ts:39`,
  `real-estate.ts:82`) — matches `structural.test.ts:25-35`.
- All three required global intents (`emergency`/`human_request`/`solicitor`) declared,
  `reachable_from: "any"` (real-estate.ts:67-71) — matches `structural.test.ts:37-55`.
- `lookup_customer` correctly scoped `caller_number` (real-estate.ts uses the shared builder,
  `tools.ts:137-150`) — matches `structural.test.ts:57-65`.
- `transfer_call` has zero parameters, `tenant_config_only` scope (shared builder,
  `tools.ts:266-280`) — matches `structural.test.ts:67-77`.
- Consent ask is present for the one tool that needs it (`create_booking`) —
  `structural.test.ts:153-164` passes.
- Waitlist offer text present (`WAITLIST_OFFER_FRAGMENT`, real-estate.ts:42) —
  `structural.test.ts:178-190` passes, though see the note under the Data table above about it not
  actually reaching the `waitlist_entries` table.
- Prompt-injection lint passes (no unescaped interpolation sink) — `structural.test.ts:192-204`, and
  the shared `injection-fixtures.ts` "*"-scoped fixtures (disclosure can't be talked out of,
  lookup_customer/transfer_call structurally can't be hijacked) hold for this template too because
  they hold structurally for every template using the shared builders.
- One-field-at-a-time / digit-by-digit read-back / silence handling / give-up ladder / escalation
  triggers / low-confidence-field read-back are all present via the shared
  `QUALITY_AND_COLLECTION_FRAGMENT` (`fragments.ts:124-132`, pulled in by every `buildSystemPrompt`
  call including real-estate.ts:36).
- **Test-suite accuracy nit (LOW):** `injection-fixtures.ts:137-148`'s `identity_spoofing` fixture is
  scoped `vertical: "*"` and its `expectation` text asserts "`update_booking`/`cancel_booking` require
  BOTH full name AND exact appointment time... (`manage_booking`'s prompt_fragment carries the
  identity-fallback rule verbatim)" — this is simply false for real estate, which has neither state
  nor tools. The fixture dataset's own self-check (`structural.test.ts:206-217`) only verifies the
  `vertical` field names a real key or `"*"`, not that a `"*"`-scoped expectation actually holds for
  every registered template — worth tightening whenever someone next touches this file, not urgent on
  its own.

**Compiled Retell structure (single_prompt specific):** there is no node graph to check for
ambiguous transitions (`single-prompt.ts`'s own docstring: "There is no graph here"), and
per-state `allowed_tools` restriction is not compiler-enforced for this target — `generalTools`
(single-prompt.ts:25-37) is always the FULL `template.tools` list regardless of which `states[]`
section declares which `allowed_tools`; enforcement is text-only ("in this section, only use tool
X"). This is inherent to the single_prompt architecture as chosen in `SYSTEM_DESIGN.md:114` and
already self-documented in this codebase (`compiler/types.ts`'s extensive VERIFY-8 notes describe
the identical "no hard per-node tool restriction" gap for conversation_flow, already logged as a
known architecture gap) — not a new finding, just confirmed to apply here too.

## Backend/tool findings

- **`check_availability`** (`tools.ts:24-46`): generic, vertical-agnostic — `offering_id`,
  `resource_type`, `date_range{start,end}`, `party_size`. Real estate would use `resource_type:
  "agent"` (allowed by `resources.type` check constraint, `booking_core.sql:28`) to model an agent's
  calendar — reasonable fit, no vertical-specific gap here.
- **`create_booking`** (`tools.ts:48-76`): idempotent (GIST exclusion + `(tenant_id,
  idempotency_key)` unique, `booking_core.sql:88-91`), race-proof single INSERT
  (`create_booking.ts:81-129`, never check-then-insert per CLAUDE.md Rule 2), phone normalized
  E.164 (`normalizeE164`, `create_booking.ts:39`). No vertical-specific validation issue found. The
  one real gap is R-5 above: `structured_payload` has no defined shape and nothing instructs the
  agent to use it for this vertical's qualification fields.
- **`lookup_customer`**: correctly scoped `caller_number`, matches structural guarantee.
- **`take_message`** (`take_message.ts`): upserts against `call_id` (one message row per call,
  per its own doc comment), enqueues an SMS to `agent_configs.transfer_number` — this is the ONLY
  place real estate's rich qualification data can reach a human today (R-5), and it works, but only
  as unstructured prose inside one SMS.
- **`transfer_call`**: zero caller-suppliable destination, resolved server-side from
  `agent_configs.transfer_number` — correct per G6.
- **Missing tools this vertical needs**: `update_booking`/`cancel_booking` (R-2, BLOCKER),
  `send_sms_confirmation` (R-4). Not needed for real estate specifically: `create_order`,
  `send_payment_link` (no commerce/deposit concept for a showing) — their absence is correct, not a
  gap.
- **Idempotency**: `create_booking`'s key is `retellCallId + start` (`bookingIdempotencyKey`,
  referenced `create_booking.ts:44`) — fine. `take_message` upserts by `call_id` — fine, but means a
  second `take_message` call later in the same call **overwrites** rather than appends
  (`take_message.ts:28-33`, a plain `update`, not an insert-then-append) — if the qualification
  conversation naturally produces two separate take_message calls (e.g., one early "let me jot this
  down" and a fuller one later), only the last one's `message_text` survives on `call_logs`; worth
  knowing though not vertical-specific to real estate alone.
- **Tenant scoping**: every tool's SQL filters by `ctx.tenantId` explicitly (`create_booking.ts:49,
  87`; `take_message.ts:32,53`) — matches CLAUDE.md Rule 2's "every secret-key edge function still
  explicitly filters by a verified tenant_id."

## Lean/fast/secure/scalable findings

- **Prompt length**: measured 1,022 words for the fully compiled `general_prompt` (see R-1) — over
  the ~1000-word guideline this codebase's own `SYSTEM_DESIGN.md:114` and Retell's documented
  guidance both cite for single_prompt viability, at the very moment this vertical is missing
  capabilities (R-2, R-4) whose natural fix is "add more prompt text."
- **Tool count**: 5 (at, not under, the "5 functions" ceiling per the same guidance) — every tool
  schema is also re-sent to the model as part of the request on every turn Retell forms a
  function-calling decision (standard LLM tool-calling behavior), so tool count is a real per-call
  token-cost lever, not just an authoring nicety.
- **Tool calls per booking**: showing path is `check_availability` → `create_booking` → (no
  `send_sms_confirmation`, R-4) = 2 calls; quote/no-commit path is 1 (`take_message`). Both are lean.
- **Hot-path query shape**: `create_booking` is a single indexed INSERT relying on the GIST exclusion
  constraint (no check-then-insert), matching CLAUDE.md Rule 2's hot-path invariant; no ORM in the
  edge function.
- **PII/PHI leakage into transcripts**: real estate's qualification data (budget, timeline,
  pre-approval status) is financial-ish but not PHI/PCI — no equivalent of dental's DOB/insurance
  deferral is needed here, and none is attempted, which is correct for this vertical.
- **Per-vertical config completeness**: see R-7 — real estate has strictly less configurable surface
  than any other vertical (zero fields beyond the universal cancellation policy, which per R-6 isn't
  even spoken for this vertical). This is lean in the sense of "small," but it's lean because
  capability is missing, not because it was deliberately minimized.
- **Cross-cutting (not real-estate-specific, noted briefly for completeness)**: neither
  `zAgentState.extraction` nor any Retell `post_call_analysis_data`-equivalent field is wired by any
  compiler (`compiler/types.ts`'s three request interfaces have no such field; grep of
  `compiler/*.ts` for `post_call_analysis`/`extraction` returns nothing), and no
  `interruption_sensitivity`/`backchannel_words`/`speak_during_execution`/`voicemail_detection`
  agent-level settings are sent in `agents.ts`'s `agentBody` (lines 85-99) for any vertical. These
  affect every template equally, not uniquely real estate, so not re-litigated here as a
  real-estate-only finding, but they compound R-5 (no structured extraction path exists to fall back
  on even if the template declared `extraction` fields).

## Strengths

- Every shared structural guarantee (disclosure-first, universal global intents, `lookup_customer`
  caller-scoping, zero-parameter `transfer_call`, prompt-injection lint, consent-ask gating) holds
  for real estate exactly because it's built from the same shared builders as every other vertical —
  the red-team suite's cross-template assertions all pass for this template today.
- The showing-booking path itself (`check_availability` → `create_booking`) is race-proof,
  idempotent, and tenant-scoped correctly — no correctness bug found in the booking write path.
- The vertical correctly recognizes and handles its two genuinely distinct outcomes (showing booked
  vs. quote-only lead) at the prompt level, matching `SYSTEM_DESIGN.md:156-157`'s brief spec almost
  exactly — the qualification-question set itself (buyer/seller, area, pre-approval, timeline,
  budget) matches real-world ISA practice reasonably well; the gap is capture/persistence, not the
  conversational design of asking.
- Consent-ask discipline (ask once, never repeat, never assume yes) is correctly present via the
  shared fragment.

## Prioritized fix list

1. **Add reschedule/cancel capability** (R-2, BLOCKER). Add `manageBookingState()`,
   `updateBookingTool()`, `cancelBookingTool()` to `packages/templates/src/verticals/real-estate.ts`
   the same way every other booking vertical does, including the identity-fallback fragment. Because
   of R-1, this must be done alongside a trim elsewhere in the prompt (or a `docs/BUILD_NOTES.md`
   entry raising whether real estate should move off `single_prompt`) rather than a pure addition —
   flag this explicitly to whoever picks up the fix per CLAUDE.md Rule 4, don't silently switch
   compile targets.
2. **Give sales-lead qualification data a structured home** (R-5, HIGH-value/low-cost). Cheapest
   correct fix: enumerate the expected keys in `createBookingTool`'s `structured_payload` JSON Schema
   (so the model has a schema hint) and add an equivalent small structured object to
   `take_message`'s schema (`tools.ts:152-168`) for the no-commitment path — e.g.
   `lead_details:{buyer_or_seller, area, pre_approved, timeline, budget_cents}` — then extend
   `take_message.ts` to store it (a new jsonb column or extending the existing notification payload)
   and surface it on the call detail page/dashboard alongside `message_text` (currently not even
   selected, `apps/web/.../calls/[id]/page.tsx:15`).
3. **Add `send_sms_confirmation` to real estate's tools** (R-4). One-line addition
   (`sendSmsConfirmationTool()` in `tools[]`) plus a prompt instruction to call it after
   `create_booking` succeeds, matching every other booking vertical.
4. **Resolve the dead cancellation-policy config for this vertical** (R-6). Either hide the
   cancellation-policy fields in `vertical-details/page.tsx` for `vertical === "real_estate"`, or add
   `CANCELLATION_POLICY_READOUT_FRAGMENT` to real-estate.ts's `buildSystemPrompt` call if the business
   decision is that showings CAN carry a no-show policy — this is a product decision, log to
   `docs/BUILD_NOTES.md` rather than picking one silently.
5. **Log the two spec-level gaps for owner/spec-author decision, not silent template changes**
   (Rule 4): (a) R-3, the "already represented/listed" qualifying question missing from both
   `SYSTEM_DESIGN.md:156-157` and the template; (b) R-7, real estate having zero per-vertical
   `dynamic_variable_overrides` keys (e.g., a listing-agent/team contact for warm-transfer context,
   brokerage disclaimer text) unlike every other vertical in `MASTER_SPEC.md §3.5`.
6. **Minor test-suite accuracy fix** (LOW): tighten `injection-fixtures.ts`'s `identity_spoofing`
   fixture (or its self-check in `structural.test.ts:206-217`) so a `"*"`-scoped fixture's
   `expectation` text can't silently describe behavior (identity-fallback via `manage_booking`) that
   doesn't exist for every registered template.
