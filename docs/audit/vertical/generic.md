# Vertical audit — Generic small business (message-first) (`generic`, single_prompt)

Scope: `packages/templates/src/verticals/generic.ts` + shared fragments/tools/utility-states it
composes from, `packages/canonical-types`, `packages/adapters/retell/src/compiler/single-prompt.ts`
+ `agents.ts`, `supabase/migrations/*`, `supabase/functions/voice-tools/*`, `supabase/functions/voice-events/*`,
`apps/web` dashboard pages for calls/bookings/messages/vertical-details.
`supabase/functions/voice-tools` was flagged as in-flux; findings below that touch it are anchored to the
version on disk at audit time and re-checked against `docs/VERIFY.md` where a doubt existed.

## Research summary

Domain knowledge (WebSearch/WebFetch were not exercised for this pass — network access for external
research tools was not available in this session; everything below is standard small-business
front-desk/answering-service practice, labeled **domain knowledge**) plus the actual Retell SDK types
vendored in this repo (`node_modules/retell-sdk`, and `packages/adapters/retell/src/compiler/types.ts`'s
own extensive "confirmed via retell-typescript-sdk" comments, which I read in place of live docs.retellai.com
access — labeled **repo-sourced, SDK-confirmed**).

**Domain knowledge — what a competent generic/message-first front desk (a locksmith, a handyman, a
small repair shop, a cleaning service, anything not covered by the other 7 verticals) actually does:**
- Establishes identity fast: caller's name, callback number (confirmed digit-by-digit), and *why they're
  calling* — this last field is the single most important thing a message-first business needs, because
  staff triage callbacks by urgency/topic, not just by name.
- Branches early on new vs. returning customer (recognizes a repeat caller by phone) and on whether the
  request is something the business can act on live (an appointment / job booking) vs. something that
  can only be handled as a callback (a quote request, a complaint, an urgent same-day ask, "is anyone
  there today").
- For anything booked, reads back the day/time and gives a plain-language sense of what happens next
  (confirmation text, who calls back, when).
- States a cancellation/rescheduling policy if one exists, *at the moment of booking* — not just on
  request — because that's when the customer is most receptive and the business is most protected.
- Handles "I need to change/cancel an existing appointment" as a distinct branch, verifying identity
  when the caller's number doesn't match the one on file (a common real fraud/mistake vector — someone
  calling from a different phone claiming to be a customer).
- Treats vendors/solicitors and personal emergencies as immediate off-ramps, never mixed into the normal
  intake script.
- Never invents a price, a slot, or a policy it wasn't given.
- For the business's own systems: a message-first small business's "downstream system" is very rarely a
  dedicated CRM — it's overwhelmingly a phone (missed-call/voicemail-to-text) plus a shared inbox or a
  lightweight CRM (Podium, Housecall Pro, Jobber, ServiceTitan-lite tiers, or literally a spreadsheet/
  group text). The fields that downstream consumer needs, at minimum: caller name, callback number, the
  reason/ask in the caller's own words, when they want a callback by, and whether they already agreed to
  be texted. A real receptionist reads all of that back once before hanging up so nothing gets
  mis-transcribed.

**Repo-sourced, SDK-confirmed — Retell conversation-design mechanics relevant to `single_prompt`:**
Per `packages/adapters/retell/src/compiler/types.ts`'s own verification notes (cross-checked against
`retell-typescript-sdk`'s `llm.ts`/`conversation-flow.ts` types, which are vendored in this repo):
- `single_prompt` (Retell "Retell LLM" with no `states`) has **no node graph at all** — `general_tools`
  is a flat list available to the model on every turn; there is no mechanism to lock one tool per step
  the way conversation-flow's per-node `instruction` + `multi_prompt`'s per-state `tools` can at least
  softly steer. This is the compile target SYSTEM_DESIGN §4.1 deliberately picks for `generic`/
  `real_estate` ("under the ~1000-word/5-tool threshold... over-structuring reads as interrogation"),
  so it's a documented tradeoff, not an oversight — but it does mean CLAUDE.md Rule 2's "function nodes
  locking one tool per step" invariant is **structurally impossible** to satisfy for this vertical's
  compile target, worth naming explicitly rather than silently assuming it holds everywhere.
- `global_node_setting` (conversation-flow's actual escape mechanism) doesn't exist for `single_prompt`
  at all — the compiler's only lever for `global_intents` on this target is folding each one into a
  plain "## Escape: X" text paragraph (see `single-prompt.ts:46-53`), i.e. exactly as
  model-discretionary as any other prompt instruction, which directly contradicts the confidence claim
  in `packages/templates/src/shared/global-intents.ts:9` ("structurally guaranteed, not
  model-discretionary") for this compile target specifically.
- Retell's real "transfer to a human" mechanism is a dedicated function/node type with its own
  destination-number wiring (confirmed absent from this repo's compiler — see Backend/tool findings #1).
- Post-call analysis (`custom_analysis_data`) is configured on the agent as its own schema
  (`post_call_analysis_data`), separate from anything this repo's compiler currently emits — confirmed
  absent from `agents.ts`'s `agentBody` (see Backend/tool findings #2).

## Data capture table

| Field a real front desk collects | Asked in template? | Tool argument | DB column | Surfaced in dashboard? | Verdict |
|---|---|---|---|---|---|
| Caller name | Yes — `generic.ts:50` "the caller's name" | `customer.name` (create_booking) / `caller_name` (take_message) | `customers.name` (booking path) / **nowhere queryable** for take_message (see below) | Calls list shows only `caller_number`, never a name (`calls-list-client.tsx:14-18,45-47`) | **PARTIAL** |
| Callback phone number | Yes — digit-by-digit read-back rule (`fragments.ts:69-73`) | `customer.phone` / `caller_phone` | `customers.phone_e164` / `call_logs.caller_number` | Calls list `caller_number` column — yes | OK |
| Reason for the call | Yes — `generic.ts:50` "the reason for the call" | **No dedicated argument on any tool.** `createBookingTool` has no `reason`/`notes` field (`tools.ts:48-76`); `structured_payload` exists but is never mentioned in any prompt text anywhere in the 8 templates (`grep` for "structured_payload" across `packages/templates/src` = 1 hit, the schema declaration itself) | Would land in `bookings.structured_payload` jsonb *only* if the model spontaneously chose a shape for it — nothing tells it to | Not selected anywhere in `apps/web` | **MISSING** for the booking path. For the message-taking path it survives only as free text inside `message_text`. |
| Callback window ("call me back by 5pm") | Yes — `generic.ts:52`, `takeMessageTool.callback_window` | `callback_window` | **Not a `call_logs` column at all.** `take_message.ts:28-33` only writes `message_text`+`classification` to `call_logs`; `callback_window` is stuffed into `messages_outbound.payload` jsonb only if `agent_configs.transfer_number` is set (`take_message.ts:42-55`) | Never selected/rendered anywhere in `apps/web` (`grep callback_window` across `apps/web/src` = 0 hits) | **MISSING** |
| The message itself (what the caller actually said) | Yes | `message_text` | `call_logs.message_text` — correctly stored | **Never selected** by `calls/[id]/page.tsx` (select list at line 15 omits it) or `calls-list-client.tsx` | **MISSING from UI** despite being the core deliverable of this vertical |
| Consent to text/call (MASTER_SPEC §3.6) | Yes — `CONSENT_ASK_FRAGMENT` | `consent.sms`/`consent.call` on create_booking | `customers.consent` jsonb — correctly written (`create_booking.ts:72-99`) | Not surfaced in customer/booking dashboards | **PARTIAL** (captured + stored, invisible downstream) |
| Confirmed appointment date/time | Yes | `start`/`end` | `bookings.start_at`/`end_at` | Bookings calendar/list — yes | OK |
| Waitlist request when nothing's open | Yes — `WAITLIST_OFFER_FRAGMENT` | Routed through `take_message` with a magic `"Waitlist request:"` text prefix — **no dedicated tool** | Never reaches `waitlist_entries` (the real table with automatic slot-reopen notify + auto-rebook, `booking_core.sql:138-157`) | Dashboard's own "Waitlist" card (`bookings/page.tsx`) reads `waitlist_entries` only — a voice-collected waitlist "request" never appears there | **MISSING** (real system entirely bypassed) |
| Vendor/solicitor calls | Yes — dedicated deflect state + global intent | — | `call_logs.classification` enum has `'solicitor'` | Depends on post-call `custom_analysis_data`, which is never configured on the agent (see Backend #2) — classification stays null | **MISSING** (pipeline never fires) |
| Emergency/safety calls | Yes — shared safety-net state + global intent | — | `call_logs.urgency_flag` | Comment on the column says "set in-call on red-flag detection, never waiting for post-call analysis" (`call_logs.sql:53-54`) but the actual code only ever sets it in `handleCallAnalyzed` (post-call, `voice-events/handler.ts:194-199`), which itself depends on the same never-configured `custom_analysis_data` | **MISSING** — contradicts its own migration comment |
| Escalation to a human | Yes — `transfer_call` | zero-arg tool call | n/a (native transfer) | n/a | **BLOCKER — non-functional**, see Backend #1 |
| Reschedule/cancel an existing booking | **Not offered at all** for generic | no `update_booking`/`cancel_booking` tools declared | n/a | n/a | **MISSING** (every other create_booking-capable vertical has this) |

## Conversation design findings

- **BLOCKER — `transfer_call` never actually transfers the call.** `generic.ts`'s only "connect me to a
  human" mechanism (`transferToHumanState()`, `utility-states.ts:17-28`) tells the model to "use
  transfer_call" after preparing a warm-transfer summary. The `single_prompt` compiler
  (`packages/adapters/retell/src/compiler/single-prompt.ts:25-37`) lowers `transfer_call` into an
  ordinary `{type:"custom", url: toolWebhookUrl}` function exactly like every other tool — there is no
  special-casing anywhere in the compiler package (`grep -rn "transfer_call" packages/adapters/retell/src`
  outside tests returns nothing) or in `agents.ts`. When Retell actually calls it, `/voice-tools`'
  dispatcher (`supabase/functions/voice-tools/handler.ts:47-57,125-128`) doesn't recognize the name (it's
  deliberately excluded from `TOOL_REQUEST_SCHEMAS`/`KNOWN_TOOLS`) and falls into the `default:` branch,
  logging `voice_tools_unknown_tool` and returning a generic fallback message. **The caller is never
  transferred; the model just gets told "something went wrong, take a message instead."** This is the
  ONLY human-escalation path generic has for non-emergency requests (there's no `takeMessageFallbackState`
  either — see below), so a caller who explicitly asks for a human currently gets silently stuck.
- **HIGH — no reschedule/cancel path exists for generic bookings.** Every other `create_booking`-capable
  vertical (`auto-repair.ts`, `dental.ts`, `motel.ts`, `veterinary.ts`, `restaurant.ts`) imports and wires
  `manageBookingState()` + `updateBookingTool()`/`cancelBookingTool()` + `IDENTITY_FALLBACK_FRAGMENT`.
  `generic.ts` imports none of these. A generic-vertical caller who booked an appointment and calls back
  to change or cancel it has no self-service path at all — the model is left to `take_message`
  free-form, with no identity check, no `booking_id` reference, no cancellation-policy reminder.
- **HIGH — cancellation policy is never spoken, despite generic being able to book.**
  `CANCELLATION_POLICY_READOUT_FRAGMENT` is used by every other booking-capable vertical
  (`grep` confirms auto-repair/dental/motel/veterinary/restaurant all include it) but is absent from
  `generic.ts:33-39`'s `buildSystemPrompt(...)` call. This directly conflicts with the dashboard's own
  `agent/vertical-details` form (see Backend #10), which *forces every tenant, including generic, to fill
  in a cancellation policy* — a field the compiled agent then never says out loud.
- **MEDIUM — all 6 tools are globally exposed on every turn, no per-step lock.** Confirmed by reading the
  actual compiler output (`single-prompt.ts`): `general_tools` is one flat array with no state
  restriction. This is inherent to the `single_prompt` compile target SYSTEM_DESIGN §4.1 deliberately
  picked for this vertical, so it's a known tradeoff — but it means `check_availability`,
  `create_booking`, `lookup_customer`, `take_message`, `send_sms_confirmation`, and the (currently
  broken) `transfer_call` are all simultaneously "in reach" of the model at all times, with the state
  boundaries (`Intake`, `Transfer to human`, etc.) existing only as prompt-text section headers, not as
  an enforced graph.
- **MEDIUM — the compiled prompt duplicates the warm-transfer text three times and has a grammar bug in
  every escape section.** I compiled `GENERIC_TEMPLATE` directly (Node against `dist/verticals/generic.js`)
  to read the real ~970-word/~5800-char `general_prompt` Retell would receive. `WARM_TRANSFER_FRAGMENT`
  appears verbatim (1) in the shared quality-fragment block, (2) inside the `Transfer to human` state
  section, and (3) again inside `## Escape: human_request` (because `single-prompt.ts:46-53` re-embeds
  the *target state's entire prompt_fragment* into the escape text). The escape sections themselves read
  as broken English: `"If The caller explicitly asks to speak with a human, a manager, or the owner.,
  immediately: The caller wants a human. ..."` — the compiler concatenates already-capitalized,
  already-punctuated sentences into a lowercase-expecting template (`single-prompt.ts:48`: `` `If
  ${globalIntent.description}, immediately: ...` ``), producing sentences an actual reviewer would flag
  as a bug on sight, and burning real tokens/latency on every single call for a vertical whose whole
  premise is being the cheap, high-volume fallback tier.
- **MEDIUM — `lookup_customer` is declared but never actually directed.** It's in `intake`'s
  `allowed_tools` (`generic.ts:57`) but nothing in the prompt tells the model *when* to call it (e.g. "if
  this looks like a returning caller with an existing booking, look them up first"). A returning customer
  gets no recognition or context reuse — every call replays as if from a stranger.
- **LOW — the shared `identity_spoofing` red-team fixture's stated expectation doesn't hold for generic.**
  `injection-fixtures.ts:137-148` (vertical `"*"`) claims "`update_booking`/`cancel_booking` require BOTH
  full name AND exact appointment time... a bare assertion of identity is never sufficient" as a universal
  guarantee — but generic has neither tool, so there's nothing to bypass *or* protect; the fixture's
  wildcard expectation is simply inapplicable/misleading for this template, worth scoping to only the
  templates that actually declare `manage_booking`.
- **LOW — no distinct handling for "spam/robocall" vs. a human solicitor.** `call_logs.classification`
  distinguishes `spam_robocall` from `solicitor`, but no template (generic included) has any
  state/instruction differentiating an automated recording from an actual salesperson — not
  generic-specific, but worth naming since generic is the vertical most likely to receive raw robocall
  traffic (no established number reputation yet).

## Backend/tool findings

1. **BLOCKER — `transfer_call` has no real transfer implementation anywhere in the compiler or dispatcher.**
   Same finding as above, from the backend side: `packages/adapters/retell/src/agents.ts:85-99`'s
   `agentBody` never references a transfer destination or a dedicated transfer function type; none of the
   three compilers (`single-prompt.ts`, `multi-prompt.ts`, `conversation-flow.ts`) special-case the tool
   name `"transfer_call"`; `canonical-types/src/tools.ts` deliberately excludes it from
   `TOOL_REQUEST_SCHEMAS` (comment: "modeled here only as the config shape the compiler reads" — but
   nothing reads it that way). Net effect: every vertical's escalate-to-human path is currently a no-op,
   generic hit hardest since it's one of only two off-ramps it has (the other being message-taking).
2. **BLOCKER — post-call custom analysis (`custom_analysis_data`) is never configured on the Retell
   agent.** `voice-events/handler.ts:145-207`'s `handleCallAnalyzed` reads
   `customData["classification"]`/`["outcome"]`/`["follow_up_needed"]`/`["legal_advice_given"]`/
   `["emergency_detected"]` straight off `call.call_analysis.custom_analysis_data`, but nothing in
   `agents.ts`'s `create-agent`/`update-agent` request body ever sets a `post_call_analysis_data` schema
   telling Retell what fields to extract or how. This is already flagged as an open item in
   `docs/VERIFY.md` line 392 ("Confirm against T2's actual Retell compiler output") — T2's compiler has
   now landed and confirms the gap is real: `classification`/`outcome`/`follow_up_needed` will never
   populate for `new_booking`/`reschedule`/`cancel`/`solicitor`/`emergency`/`transfer_request` (the values
   only `take_message`'s in-call direct write, `after_hours_message`, actually reaches). This starves the
   calls-list classification filter and dashboard triage for the majority of generic's own call types.
3. **BLOCKER — `call_logs.structured_booking_payload` is read by the dashboard but never written by
   anything.** `apps/web/.../dashboard/calls/[id]/page.tsx:15,43-46` selects it to render a "Linked
   booking" card. `grep -rn structured_booking_payload` across the whole repo shows only the migration
   column definition, doc references, the generated `database.types.ts`, and this same read site — no
   `INSERT`/`UPDATE` anywhere (`create_booking.ts` writes `bookings.structured_payload`, a different
   column on a different table). The "Linked booking" card will never appear, for any call, in any
   vertical.
4. **HIGH — no real tool backs the waitlist offer.** `WAITLIST_OFFER_FRAGMENT` tells the model to record a
   waitlist ask via `take_message` with a `"Waitlist request:"` text prefix. There is no
   `create_waitlist_entry`/`join_waitlist` tool in `shared/tools.ts`, and the dispatcher has no matching
   case. The schema already has a fully-built `waitlist_entries` table with a GIST window index and an
   automatic cancellation-triggered notify + reply-YES auto-rebook flow (`booking_core.sql:138-157`), and
   the dashboard's own Waitlist card (`bookings/page.tsx`) reads exactly that table — none of which a
   voice-collected waitlist request ever reaches.
5. **HIGH — `structured_payload` on `create_booking` has zero prompt guidance across all 8 templates.**
   `grep -rn structured_payload packages/templates/src` returns exactly one hit: the schema declaration
   in `shared/tools.ts:65`. No template tells the model what shape to use it for. For generic specifically
   this is the one place "the reason for the call" (explicitly collected per `generic.ts:50`) could land,
   and currently doesn't.
6. **MEDIUM — `take_message`'s `caller_name`/`callback_window` are not durably stored anywhere queryable.**
   `take_message.ts:28-33` writes only `message_text` + `classification` to `call_logs`; `caller_name` and
   `callback_window` exist solely inside `messages_outbound.payload` jsonb (`take_message.ts:42-55`), and
   that row is only inserted `where ac.transfer_number is not null` — a tenant with no transfer number
   configured loses both fields entirely, with nothing logged about it.
7. **MEDIUM — the staff notification for a taken message renders as a generic, unlabeled bubble in the
   dashboard's Messages inbox.** `describeOutboundMessage` (`apps/web/src/lib/messages/outbound-preview.ts:22-31`)
   has no case for `template_key: "take_message"`, so it falls into the `"System message sent"` catch-all
   — the actual message content is invisible without opening raw payload data, and the "thread" it
   appears under is keyed by the tenant's own `transfer_number`, not the caller, further muddying the
   Messages list (`messages-list-client.tsx`).
8. **MEDIUM — `canonical-types`'s `zCreateBookingRequest` has drifted from the actually-deployed schema.**
   `packages/canonical-types/src/tools.ts:54-63` omits `consent`, while the real dispatcher's schema
   (`supabase/functions/_shared/schemas/voice-tools.ts:35-46`) includes it and is what
   `create_booking.ts:72` actually reads. Not a live bug (production uses the correct schema) but it means
   two files both claim to be "the" canonical `create_booking` contract and disagree — exactly the drift
   CLAUDE.md Rule 2's provider-isolation intent is meant to prevent.
9. **MEDIUM — per-vertical config (MASTER_SPEC §3.5) is incomplete/mismatched for generic in both
   directions.** `verticalDetailsSchema` (`packages/canonical-types/src/schemas/vertical-details.ts:17-19`)
   makes `cancellation_policy` a hard-required field with no per-vertical opt-out, so generic tenants must
   fill it in even though (per Conversation design finding above) generic's compiled prompt never speaks
   it. Meanwhile the fields generic's own `GenericOverrides` type is actually built from
   (`manager_name`/`manager_phone`/`parking_info`/`accessibility_notes`/`accepted_payment_types`, the
   "salvaged rich-context fields" on `zBaseDynamicVariableOverrides`) have **no form inputs anywhere** in
   `agent/vertical-details/page.tsx`, and are **never interpolated as `{{...}}` in any of the 8 templates**
   (`grep` for each name across `packages/templates/src` returns zero prompt usages) — despite being
   pre-approved in the prompt-injection lint's `ALLOWED_DYNAMIC_VARIABLES` allowlist
   (`prompt-lint.ts:20-39`) as if they were live. For generic, whose override type is *only* these base
   fields, this means the vertical currently has no functioning tenant-customizable prompt variable at
   all.

## Lean/fast/secure/scalable findings

- Compiled `general_prompt` for `generic` measures **~970 words / ~5,792 characters** (measured directly
  from `dist/verticals/generic.js`), reasonably lean next to the other 7 templates, but roughly 300+
  words of that is the duplicated warm-transfer text called out above — real, avoidable token/latency
  cost paid on every single call for what's supposed to be the cheapest/highest-volume tier.
- Tool-call count for the happy-path booking flow is `check_availability` → `create_booking` →
  `send_sms_confirmation` (3 calls), consistent with the hot-path latency budget; no N+1 concerns
  observed.
- No PHI or payment-card exposure risk specific to generic — it collects no medical/insurance/card data,
  and `send_payment_link` isn't even declared in its `tools[]` (correctly out of scope for a plain
  message-first tier).
- `lookup_customer`'s `caller_number` authorization scope and `transfer_call`'s empty-parameter/
  `tenant_config_only` scope are both correctly enforced *structurally* by `zAgentTemplate` +
  `structural.test.ts`, and generic inherits both guarantees for free by using the shared builders — this
  part of the security posture is solid even though the transfer mechanism itself is non-functional (a
  functional-correctness bug, not an authorization bug).
- Per-vertical config validation exists (`verticalDetailsSchema` via Zod + `zodResolver` on the form) but,
  per Backend finding #9, is miscalibrated for what generic's own template actually consumes.

## Strengths

- The canonical `zAgentTemplate` schema plus `red-team/structural.test.ts` gives real, automatically
  enforced guarantees (disclosure line present verbatim, all three global intents reachable from every
  state, `lookup_customer` always `caller_number`-scoped, `transfer_call` always zero-parameter/
  `tenant_config_only`) that hold for generic exactly because it's built from the same shared builders as
  every other vertical — a genuinely good architecture choice.
- `create_booking` is race-proof by construction: single INSERT relying on the GIST exclusion constraint
  + `(tenant_id, idempotency_key)` uniqueness, never check-then-insert, exactly matching CLAUDE.md Rule 2
  (`create_booking.ts:34-129`).
- `take_message` sets `call_logs.classification = 'after_hours_message'` directly, in-call, independent of
  the broken post-call-analysis pipeline — the one classification value generic actually needs most
  (since message-taking is its primary path) works correctly today.
- The prompt-injection lint (`lintPromptForInjectionSinks`) plus its fixture dataset already catch a real
  bug class (stray `${...}` leaks, unknown `{{placeholder}}` names), and `generic` passes cleanly.
- The waitlist *offer* itself (never just giving up on `none_available`) is good caller-facing behavior
  even though its backend wiring is a hack — the instinct is right, the plumbing needs to catch up.
- Consent capture for SMS/call outreach is genuinely correctly wired end-to-end into `customers.consent`
  for the booking path, satisfying MASTER_SPEC §3.6's shape even if it isn't surfaced downstream yet.

## Prioritized fix list

1. **Wire a real Retell transfer mechanism.** Files: `packages/adapters/retell/src/compiler/single-prompt.ts`,
   `multi-prompt.ts`, `conversation-flow.ts`, `agents.ts`. Why: `transfer_call` is currently indistinguishable
   from any other custom webhook tool, hits `/voice-tools`' unknown-tool fallback, and never actually
   connects the caller to a human — the single biggest functional gap found, and it's generic's only
   non-message escalation path.
2. **Configure `post_call_analysis_data` on agent create/update, and confirm the field-name mapping
   against a live Retell agent.** Files: `packages/adapters/retell/src/agents.ts`,
   `supabase/functions/voice-events/handler.ts`, `docs/VERIFY.md` (already tracks this — resolve it now
   that the compiler exists). Why: without it, `classification`/`outcome`/`follow_up_needed`/
   `legal_advice_given`/`emergency_detected` never populate for anything except `take_message`'s direct
   write, silently breaking the calls-list classification filter and safety-flag reporting.
3. **Write `call_logs.structured_booking_payload` from `create_booking`/`create_order`.** File:
   `supabase/functions/voice-tools/tools/create_booking.ts` (and `create_order.ts`). Why: the dashboard's
   "Linked booking" card reads this column and it is currently always null for every call in every
   vertical.
4. **Surface `message_text`, `callback_window`, `call_summary`, `urgency_flag`, `follow_up_needed` on the
   calls dashboard.** Files: `apps/web/src/components/tenant/call-detail-client.tsx`,
   `calls-list-client.tsx`, `apps/web/src/app/[locale]/(tenant)/dashboard/calls/[id]/page.tsx`. Why: for
   generic ("message-first"), the taken message *is* the product of the call, and it is currently
   completely invisible in the UI.
5. **Persist `caller_name`/`callback_window` durably** (a `call_logs` column, or a dedicated table) instead
   of only inside a conditionally-created SMS-notification payload. Files:
   `supabase/functions/voice-tools/tools/take_message.ts`, a new migration under `supabase/migrations`.
   Why: currently both are lost entirely whenever the tenant hasn't configured `transfer_number`.
6. **Add a real `create_waitlist_entry` tool** (shared, used by every `WAITLIST_OFFER_FRAGMENT` vertical
   including generic) that inserts into `waitlist_entries` instead of a magic-prefixed `take_message`
   string. Files: `packages/templates/src/shared/{tools.ts,fragments.ts}` (+ every vertical using the
   fragment), `supabase/functions/voice-tools/{handler.ts,tools/}`. Why: the real waitlist system
   (auto-notify on cancellation, reply-YES auto-rebook, the dashboard's own Waitlist card) is fully built
   and currently unreachable from any phone call.
7. **Add `manageBookingState()` + `updateBookingTool()`/`cancelBookingTool()` + `IDENTITY_FALLBACK_FRAGMENT`
   + `CANCELLATION_POLICY_READOUT_FRAGMENT` to `generic.ts`**, matching every other `create_booking`
   vertical. File: `packages/templates/src/verticals/generic.ts`. Why: generic can create a booking but
   has no phone-based way to reschedule/cancel it, and never states the cancellation policy tenants are
   already forced to configure.
8. **Give `create_booking` (and generic's `intake` prompt) an explicit place for "reason for the call."**
   Files: `packages/templates/src/shared/tools.ts` (add a `reason`/`notes` field or explicit
   `structured_payload` guidance), `packages/templates/src/verticals/generic.ts`. Why: the intake state
   explicitly collects this field but nothing routes it anywhere durable once a booking is made.
9. **Deduplicate the compiled single-prompt escape sections and fix the "If \<Sentence\>., immediately:
   \<Sentence\>" grammar.** File: `packages/adapters/retell/src/compiler/single-prompt.ts:39-53`. Why:
   the warm-transfer text is currently repeated 3× verbatim in generic's ~970-word prompt, and the escape
   phrasing reads as a real bug on inspection — both a token-cost and a prompt-quality issue for the
   cheapest, highest-volume tier.
10. **Reconcile per-vertical config**: make `cancellation_policy` conditionally required (only for
    verticals whose compiled prompt actually reads `{{cancellation_policy_text}}`), and either add form
    inputs for `manager_name`/`manager_phone`/`parking_info`/`accessibility_notes`/`accepted_payment_types`
    or drop them from the schema/lint allowlist. Files:
    `apps/web/src/app/[locale]/(tenant)/dashboard/agent/vertical-details/page.tsx`,
    `packages/canonical-types/src/schemas/vertical-details.ts`. Why: generic tenants are currently forced
    to configure a field their agent never speaks, while having no way to set the fields it theoretically
    could.
11. **Sync `packages/canonical-types/src/tools.ts`'s `zCreateBookingRequest` with the deployed
    `supabase/functions/_shared/schemas/voice-tools.ts`** (missing `consent`), and settle which file is
    the actual source of truth. Why: two schemas both claim to be canonical and have already drifted —
    low risk today only because production code happens to use the correct one.
