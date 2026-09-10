# Motel / small hotel vertical audit

Scope: `packages/templates/src/verticals/motel.ts` + shared template infra,
`packages/canonical-types`, `packages/adapters/retell/src/compiler`,
`supabase/migrations` (booking core / customers / money / messaging),
`apps/web` dashboard surfaces, `docs/SYSTEM_DESIGN.md` §4, `docs/spec/MASTER_SPEC.md`
§3, `docs/spec/BACKEND_SPEC.md` §7.2. `supabase/functions/voice-tools` and
`apps/web` are noted as in flux by a parallel fix wave; findings that touch
them are flagged as such and evidence is still cited because it reflects the
stable contract those files implement (schemas, table shapes) rather than
transient edits.

---

## Research summary

**Real-world motel/small-hotel front desk phone protocol** (WebSearch,
Sept 2026, plus domain knowledge where noted):

- Sources: [Hotel Front Desk SOP Pack](https://checklist.com/hotel/front-office),
  [Hotel Reservation SOP & Checklist](https://checklist.com/hotel/front-office/reservation),
  [Hotel Deposit & Security Hold Policy Guide (Mews)](https://www.mews.com/en/blog/hotel-deposit),
  [Hotel Front Desk Checklist (Canary)](https://www.canarytechnologies.com/post/hotel-front-desk-checklist),
  [Little Hotelier — Front desk responsibilities](https://www.littlehotelier.com/blog/running-your-property/hotel-front-desk-responsibilities/).
- A phone reservation collects: guest name, phone (and often email), arrival
  + departure date (nights auto-computed), room type + bed preference, number
  of rooms, rate quoted (confirmed back to the guest), payment/deposit method
  and amount, and any special requests (pets, extra person, early
  arrival/late departure, accessible room). Deposit/no-show/cancellation
  policy is stated and, for phone bookings, a card is typically authorized
  at booking time or a link is sent — never a spoken card number read into a
  recorded line.
- Domain knowledge (not confirmed by the above search, but standard
  independent/small-property practice): common phone-call branches are (a)
  new reservation, (b) modify/cancel an existing reservation, (c) rate/
  availability quote with no commitment ("just checking prices"), (d)
  walk-in-adjacent same-day/late availability, (e) group/multi-room block
  (usually escalated to a human/manager, not self-served), (f) complaint
  about a stay in progress or already completed (escalate, never argue),
  (g) vendor/solicitor calls, (h) wrong number, (i) after-hours message when
  the desk is unstaffed overnight. Common policy questions a real desk
  fields but a script frequently can't: pet policy + pet fee, extra-guest
  fee, smoking policy, pool/breakfast/parking availability, minimum age to
  book a room, ID requirement at check-in, early check-in/late check-out
  fee, group/event block rates.
- Downstream system: `docs/VERTICAL_RESEARCH.md` names **Cloudbeds** as the
  only self-serve motel PMS (owner self-generates an API key; Mews/SiteMinder
  are partner-gated) — but also records the binding **owner decision that
  motel ships Wave-3 "message-first"** (no PMS integration in v1; the agent
  quotes from an owner-maintained rate table and the desk confirms
  reservation requests itself) (`docs/VERTICAL_RESEARCH.md` line ~79). No
  Cloudbeds adapter exists in `packages/adapters/` today (only `shopmonkey`,
  `ezyvet`, `square`, `google-calendar`, `retell`) — consistent with that
  decision, not a bug. For forward reference: Cloudbeds'
  `postReservation` needs guest details, a **room-type/rate-plan ID**
  (distinct fields), check-in/check-out, and **adults/children counts per
  room** ([Cloudbeds developer docs](https://developers.cloudbeds.com/docs/reservation-faqs)) —
  none of which our canonical `bookings`/`create_booking` shape distinguishes
  today (single `party_size` int, `resource_id` with no room-type dimension).
  Not a current defect given the message-first decision, but worth flagging
  before any Cloudbeds push adapter is built (T7-style).

**Retell conversation_flow guidance** (WebSearch, `docs.retellai.com` — direct
fetch was egress-blocked from this environment, so this is search-snippet
level, not a full read of the current docs; flagged for re-verification per
Rule 1 alongside the repo's own existing `RETELL-VERIFY` note):
- Node types include a plain **Conversation Node** (dialogue only, no tool
  call), a distinct **Function Node** used "when a tool must always run at a
  fixed point in the flow", Code/SMS/MCP/Call-Transfer nodes, and **Global
  Node** (toggle + condition, reachable from anywhere).
- Transition conditions are either a natural-language **prompt** condition or
  a deterministic **equation** condition over dynamic variables.
- Function nodes can be configured `speak_during_execution`/
  `wait_for_result`; conversation nodes carry per-node speech overrides
  (interruption sensitivity 0–1, responsiveness, voice speed, whether keypad
  presses interrupt).
- This package's own compiler header comments (`compiler/types.ts` lines
  1–28) already record a `RETELL-VERIFY`-tagged conclusion that a plain
  `ConversationNode` has **no** per-node tool-restriction field, and that
  hard tool-locking exists only on a different node type (`SubagentNode`)
  this compiler doesn't emit. My search turned up a distinct **Function
  Node** type ("Conversation flow nodes and edges — pick the right node
  type") that the existing repo comment doesn't mention at all — it may be
  the real mechanism for "one tool per step," or it may be old
  terminology for the same `SubagentNode`/tool_ids concept already ruled out.
  I could not fetch the docs page directly to settle this (blocked), so I'm
  flagging it as a **re-verification item**, not overriding the existing
  `RETELL-VERIFY` conclusion — see Prioritized fix list.

---

## Data capture table

Legend: **OK** = fully wired end-to-end · **PARTIAL** = collected but not
fully propagated/typed/surfaced · **MISSING** = no field/mechanism exists.

| Real front-desk field | Template asks? (state/line) | Tool arg | DB column/jsonb key | Dashboard surfaced? | Integration adapter | Status |
|---|---|---|---|---|---|---|
| Guest name | `collect_dates`→ implied via `create_booking` state, no dedicated state | `create_booking.customer.name` | `customers.name` | Bookings list shows customer name (`bookings/page.tsx:99`) | none (Cloudbeds N/A, message-first) | **PARTIAL** — no explicit "collect name" state exists in `motel.ts` states[]; name is only ever asked implicitly inside `confirm_booking`'s prompt, unlike every field-specific state pattern used for dates/guests/room type |
| Phone number | not asked as its own state; assumed = caller ID | `create_booking.customer.phone` | `customers.phone_e164` | shown in booking detail sheet (`bookings/page.tsx:130-136`) | n/a | **PARTIAL** — fine for the common case (caller books for themself) but no state handles "booking for someone else"/a different callback number |
| Check-in date | `collect_dates` (`motel.ts:75-81`) | `create_booking.start` | `bookings.start_at` | booking list shows `start_at` only (`bookings/page.tsx:97`) | n/a | OK (capture) / **PARTIAL** (surface — see check-out below) |
| Check-out date | `collect_dates` (same state, "dates" plural) | `create_booking.end` | `bookings.end_at` | **never displayed anywhere in the dashboard** — `bookings/page.tsx` selects `id, start_at, status, customer_id` only, never `end_at` | n/a | **MISSING** on the surfacing side — a motel is a multi-night business; the front desk view can't tell a 1-night stay from a 5-night stay without opening Supabase directly |
| Number of guests | `collect_guests` (`motel.ts:83-86`) | `create_booking.party_size` | `bookings.party_size` | not selected/shown in `bookings/page.tsx` (`select("id, start_at, status, customer_id")`) | n/a | **PARTIAL** — captured, not surfaced |
| Room type | `collect_room_type` (`motel.ts:89-95`) | *(no dedicated field — see finding B1)* | — | not surfaced (see B1) | n/a | **MISSING** — see Conversation/Backend findings B1 |
| Nightly rate quoted | `collect_room_type` prompt line references `{{rate_table}}` | n/a (spoken only, not passed to `create_booking`) | not stored on `bookings` at all (no `rate_cents`/`total_cents` column on `bookings`) | not shown | n/a | **MISSING** — the rate the caller was quoted is never persisted; a dispute ("you told me $89, not $109") is unauditable from `bookings` (recording/transcript is the only fallback) |
| Deposit required / amount | `confirm_booking` state references `{{deposit_policy_text}}` | `send_payment_link.amount_cents` (model must supply the number itself) | `payment_links.amount_cents` when the call happens | shown in booking detail sheet, with resend (`bookings/page.tsx:377-411`) | n/a | **PARTIAL/BLOCKER** — dashboard surfacing is solid *if* `send_payment_link` is actually called, but the dynamic variable that's supposed to tell the agent the deposit amount/policy is never populated at call time (see Backend finding B2) |
| Cancellation policy | stated per `CANCELLATION_POLICY_READOUT_FRAGMENT` (`{{cancellation_policy_text}}`) | n/a (spoken only) | `agent_configs.dynamic_variable_overrides.cancellation_policy` (config-side only) | Settings → Vertical details tab has `cancellation_policy.text` editor (`vertical-details/page.tsx:270-285`) | n/a | **BLOCKER** — same as above: `{{cancellation_policy_text}}` is never injected as a dynamic variable by `voice-inbound/handler.ts` (see B2) |
| Consent (SMS/call) | `CONSENT_ASK_FRAGMENT` | `create_booking.consent` | `customers.consent` jsonb | not surfaced anywhere in dashboard (no consent badge on customer/booking views) | n/a | **PARTIAL** — captured and stored correctly (`create_booking.ts:72-79,94-98`); not visible to staff, so staff can't tell at a glance whether they're allowed to call a guest back |
| Special requests (pets, extra person, accessible room, early/late) | **not asked anywhere** | — | `bookings.structured_payload` jsonb exists as a free-form bucket but the template never instructs writing anything into it | n/a | n/a | **MISSING** |
| Amenity/policy FAQ (pool, pet policy, breakfast, parking, smoking, min age, ID at check-in) | **not asked or answerable** — only `parking_info`/`accessibility_notes` exist as base overrides | — | `agent_configs.dynamic_variable_overrides` has no `amenities`/`pet_policy`/`extra_guest_fee_cents` keys (unlike dental's `insurances_accepted`, vet's `species_treated`) | Vertical-details tab has no field for these either | n/a | **MISSING** — real callers ask these constantly; the agent has nothing to answer with beyond the two base fields |
| Waitlist when no availability | `check_time` offers `nearest_alternative` then falls to `take_message_fallback`; motel explicitly does **not** use `WAITLIST_OFFER_FRAGMENT` (confirmed absent from `motel.ts` imports, unlike auto/dental/vet/restaurant/generic/real-estate — `grep` for `WAITLIST_OFFER_FRAGMENT` across `packages/templates/src/verticals/*.ts`) | `take_message` (generic) | `call_logs.message_text` only — never a `waitlist_entries` row | Bookings page has a whole "Waitlist" card (`bookings/page.tsx:323-355`) that will **always be empty for motel tenants** | n/a | **PARTIAL by design, but weaker than documented** — the red-team suite explicitly exempts motel from the waitlist-offer check (`structural.test.ts:178-190`, "Motel's own explicit nearest_alternative UX stands in for a generic waitlist offer") — a deliberate, tested decision, not an oversight, but see Conversation finding C4 for why nearest_alternative is a materially weaker UX for a peak-weekend/event scenario, motel's single most common no-availability case |
| Room inventory / capacity setup (owner side) | n/a (owner-config, not call-time) | n/a | `resources` table (`type='room'`, `capacity`) | **no dashboard page reads or writes `public.resources` anywhere in `apps/web`** (`grep -rl "from(\"resources\")"` returns nothing); `offerings` UI (`agent/services/page.tsx`) is a generic name/duration/price editor with no room-type/capacity/resource-link fields | n/a | **BLOCKER** — see Backend finding B1 |

---

## Conversation design findings

**C1 — BLOCKER — no state ever explicitly collects the guest's name.**
`packages/templates/src/verticals/motel.ts:66-95` declares `greeting` →
`collect_dates` → `collect_guests` → `collect_room_type` → `check_time` →
`confirm_booking`. Every other booking-capable template (`auto-repair.ts`,
`dental.ts`, `restaurant.ts`) has a dedicated name/phone collection point or
folds it explicitly into an early state's prompt text; motel's only mention
of `customer.name`/`customer.phone` is the implicit requirement of the
`create_booking` tool schema at `confirm_booking`, whose prompt text
(`motel.ts:109-114`) never says "ask for the guest's name and phone" at all
— it only says "Read back dates, guests, room type, and rate... then create
the booking." A model executing this graph literally has no instruction
telling it to ask who is booking before calling `create_booking` with a
`required: ["resource_id", "start", "end", "customer"]` schema. In practice
the model will likely improvise and ask anyway, but this is exactly the kind
of implicit/model-discretionary behavior SYSTEM_DESIGN §4.1 says the graph
should never rely on ("model cannot invent... tool-backed nodes only" is the
stated design philosophy; an un-stated required field is the prompt-side
mirror of that same discipline gap).

**C2 — HIGH — room type is asked but never fed into `check_availability` or `create_booking` as a discriminable value.**
`collect_room_type`'s prompt (`motel.ts:89-95`) tells the agent to "ask
which room type they'd like, then quote the nightly rate... from
{{rate_table}}", then `check_time` calls `check_availability` — but the
`check_availability` tool schema (`shared/tools.ts:24-46`) only accepts a
coarse `resource_type` string (matched against `resources.type`, an enum of
`'chair'|'room'|'table'|'bay'|'staff'|'agent'` — `booking_core.sql:28`), not
a room *type* like "Queen" vs "King Suite". There is no field anywhere in
the tool schema, the `resources` table, or `check_availability`'s SQL
(`voice-tools/tools/check_availability.ts:31-53`) that lets a specific room
type be checked or reserved distinctly from any other room. The caller can
be quoted a King Suite rate and then handed whatever "room" resource happens
to be free — a silent correctness bug the conversation design can't fix on
its own (root cause is Backend finding B1).

**C3 — HIGH — the quoted rate is never passed to any tool, so it's unenforceable and unauditable.**
`confirm_booking`'s prompt says to read back "dates, guests, room type, and
rate" (`motel.ts:110`), but `createBookingTool`'s schema
(`shared/tools.ts:48-76`) has no `rate_cents`/`total_cents`/`nightly_rate`
argument at all, and `bookings` has no such column
(`booking_core.sql:64-91`). The rate lives only in the spoken conversation
and the transcript. If a guest disputes the quoted rate at check-in, or a
staff member wants to see what was promised, there is no queryable field —
only a manual transcript re-listen. Every other price-bearing tool in this
codebase (`create_order`, `send_payment_link`) does persist its amount;
`create_booking` alone does not, which is inconsistent within the same
codebase, not just against the general "money is authoritative data" spirit
of CLAUDE.md Rule 2.

**C4 — MEDIUM — `nearest_alternative` is a weaker no-availability UX than the waitlist every other booking vertical gets, for the vertical's single most common busy-day scenario.**
Confirmed deliberate design (`structural.test.ts:178-190` exempts motel by
name), so this is not a silent bug — but it's worth re-examining on the
merits. `check_availability`'s `nearest_alternative`
(`check_availability.ts:56-82`) is a single deterministic "earliest slot
after your requested window" lookup — it can't say "the Friday–Saturday you
actually want is full, but I can put you on a list in case of a
cancellation" the way `WAITLIST_OFFER_FRAGMENT` (used by restaurant/vet/
dental/auto/generic/real-estate) explicitly can. Weekend/event-driven demand
spikes are the textbook case a small motel's waitlist would exist for. Using
the same take-message fallback wording as every other after-hours case
(`takeMessageFallbackState()`, `utility-states.ts:73-85`) undersells what
staff can actually do (manually re-check nearer the date) versus what a
"we'll text you if it opens up" promise would do for conversion. (Note: even
if this were changed, `take_message` has no code path that writes a
`waitlist_entries` row for **any** vertical today — see Backend finding B4 —
so wiring motel into the shared fragment alone would not be sufficient.)

**C5 — MEDIUM — no path answers common non-booking amenity/policy questions.**
A caller asking "do you allow dogs?", "is there a pool?", "do I need to be
21 to book a room?", "is breakfast included?" has nowhere to go in the state
graph: `greeting`'s three transitions are `wants_to_book`,
`wants_to_reschedule_or_cancel`, and `after_hours_or_general_message`
(`motel.ts:125-131`). A pure FAQ falls through to
`take_message_fallback`, whose prompt text (`utility-states.ts:73-84`) is
framed entirely around "you were not able to complete this in real time" —
wrong framing for "just answer my question," and there is no dynamic
variable carrying amenity/pet-policy/extra-guest-fee text to answer with
even if a state existed (see data-capture table row "Amenity/policy FAQ").

**C6 — MEDIUM — "status check" call-taxonomy class (SYSTEM_DESIGN §4.2) has no clean route.**
A caller who already has a reservation and just wants to confirm it's still
on the books doesn't cleanly match `wants_to_book` or
`wants_to_reschedule_or_cancel` (that transition's own name implies an
intent to *change* something). It will likely be force-fit into
`manage_booking`, which is fine functionally (it has `lookup_customer`), but
the intent name and the shared state's prompt ("The caller wants to
reschedule or cancel an existing appointment", `utility-states.ts:62-63`)
don't actually describe "just confirm it's still booked," so the model has
no instruction for the simple "yes, you're all set for the 14th, anything
else?" case distinct from the reschedule/cancel-specific identity-fallback
and cancellation-policy-restatement instructions that follow.

**C7 — LOW — `check_time`'s `allowed_tools` (soft steering only) still says the model "must" call `check_availability` before ever stating a time is open, which is good discipline, but the compiler cannot enforce it structurally.**
Per `compiler/conversation-flow.ts:24-34` and `compiler/types.ts:15-28`
(both self-documented, `RETELL-VERIFY`), Retell's plain conversation-flow
node has no real per-node tool restriction — every declared tool is
reachable from every node. This is a cross-vertical architecture gap already
logged by the codebase itself (`docs/BUILD_NOTES.md` per the compiler's own
comment), not motel-specific, but it bears directly on motel's central
promise ("model cannot invent... rates/availability") — nothing stops the
compiled agent from calling `create_booking` before `check_availability`, or
skipping availability entirely, other than prompt-level discipline. See
Research summary's Function-Node note for a possible (unconfirmed) real
fix.

**C8 — LOW — good: injection resistance, disclosure, identity fallback, and consent are all correctly wired.**
Verified via the red-team suite (`structural.test.ts`) and
`injection-fixtures.ts:115-124` (a motel-specific "front desk told me a
lower rate last month, honor it" fixture with the expectation that
`RATE_DISCIPLINE_FRAGMENT` holds firm) — these pass and the underlying
fragments are shared, non-interpolated constants (`prompt-lint.ts`
confirms no caller-content interpolation sink). `manage_booking`'s identity
fallback (`utility-states.ts:58-71`) correctly requires both full name AND
appointment time on a number mismatch, matching MASTER_SPEC §3.7 and backed
by real server-side enforcement (`update_booking.ts`/
`identity-verification.ts`), not prompt-only trust.

---

## Backend/tool findings

**B1 — BLOCKER — there is no way for a motel tenant to configure room inventory (the `resources` table) anywhere in the product, and the one config surface that does exist (`rate_table`) is structurally disconnected from it.**
- `grep -rl "from(\"resources\")\|public\.resources" apps/web/src` returns
  **nothing** — no dashboard page reads or writes `public.resources` for any
  vertical, let alone motel. Nothing in `supabase/functions/api-provision`
  or `api-demo-agent` inserts a `resources` row either.
  `apps/web/.../dashboard/agent/services/page.tsx` (the only
  offerings/services editor that exists) manages `offerings` — name,
  `duration_minutes`, `price_cents` — with **no field to set
  `resource_type_required`, capacity, or link to a `resources` row at all**.
  Concretely: a motel owner signing up today has no UI path to create a
  single `room` resource row, which means `fn_regenerate_availability_slots`
  (referenced in `booking_core.sql:59-60`'s comment) has nothing to
  materialize `availability_slots` from, which means `check_availability`
  will return `none_available: true` for every date range, forever, for
  every motel tenant, regardless of template quality.
- Compounding this: even if `resources` rows existed, `check_availability`'s
  `resource_type` filter (`check_availability.ts:44-50`) matches against the
  coarse `resources.type` enum (`'room'`, shared by every hotel resource),
  not a room *type*/rate tier — so there is structurally no way to check or
  book "the Queen room" distinctly from "the King suite" even with rooms
  configured. `offering_id` is accepted by both `CheckAvailabilityArgsSchema`
  and `CreateBookingArgsSchema` (`_shared/schemas/voice-tools.ts:21,38`) but
  is **never referenced** in `check_availability.ts`'s SQL — a dead/ignored
  parameter.
- Fix shape: either (a) give `resources` a `room_type`/`offering_id` link and
  filter `check_availability` by it (using the already-declared but unused
  `offering_id` arg), or (b) treat each distinct room type as its own
  `resources.type` value tenant-scoped via `resources.metadata`, plus in
  either case a dashboard page to create/edit rooms. This blocks the vertical
  from functioning at all today, independent of template/prompt quality.

**B2 — BLOCKER — the vertical's own core promise ("rate only from
{{rate_table}}, never invented") cannot be honored because `{{rate_table}}`
is never populated as a call-time dynamic variable, and neither is
`{{deposit_policy_text}}` or `{{cancellation_policy_text}}`.**
`supabase/functions/voice-inbound/handler.ts:120-145` builds the
`dynamic_variables` object sent to Retell at call start. It includes
`business_name`, `assistant_name`, `greeting_hours_context`, `timezone`,
`special_instructions`, `is_manual_mode`, `language`, `disclosure_line`, and
conditionally `manager_name`/`manager_phone`/`parking_info`/
`accessibility_notes`/`accepted_payment_types` — **and nothing else**. It
never reads `overrides["rate_table"]`, `overrides["deposit_policy"]`, or
`overrides["cancellation_policy"]` (the `MotelOverrides`/base-overrides keys
defined in `canonical-types/agent-template.ts:310-322,288`), and it performs
no formatting step that would turn either into the flat string the prompt
fragments expect (`{{rate_table}}` used as prose in `motel.ts:49-51,92`;
`{{cancellation_policy_text}}` in `fragments.ts:91`;
`{{deposit_policy_text}}` in `motel.ts:112`). Concretely: on a real call,
Retell will either leave these placeholders as the literal un-substituted
string `{{rate_table}}` in the agent's spoken output, or (depending on
Retell's dynamic-variable-miss behavior — worth confirming, Rule 1) drop
them silently — either way the agent has **zero actual rate data** to work
from. Given the template's own hard rule is "if a room type isn't in
{{rate_table}}, say you'll need to check and take a message instead of
guessing" (`motel.ts:50-51`), the most likely real-world outcome is every
motel call for a quote falls through to a take-message, which defeats the
entire point of the vertical. This is the single highest-severity finding in
this audit — it is not a template-authoring gap, it's a template built
correctly against a contract (`dynamic_variable_overrides` → dynamic
variables) that the (non-flux) `voice-inbound` handler never actually
implements for any of the six typed per-vertical override groups
(`insurances_accepted`, `species_treated`/`emergency_referral`,
`tow_partner`/`vehicle_makes_serviced`, `practice_areas`/
`consult_fee_cents`, `deposit_policy`/`rate_table`, `delivery_radius_m`/
`min_order_cents` are ALL absent from `handler.ts`'s `dynamicVariables`
object) — so every vertical's "config is enumerated, not ad-hoc" promise
(MASTER_SPEC §3.5) is currently broken the same way, but motel is the
vertical whose entire pricing model depends on it.

**B3 — BLOCKER — `create_booking` always writes `status='confirmed'`, contradicting MASTER_SPEC §3.2's motel-specific "booking held `scheduled` until paid" requirement.**
`supabase/functions/voice-tools/tools/create_booking.ts:82-92` hard-codes
`'confirmed'` as the literal status value in every INSERT, with no
conditional on whether a deposit is required/paid. MASTER_SPEC §3.2
(`docs/spec/MASTER_SPEC.md:85-87`) is explicit: *"Motel deposits: agent
states policy, sends link, booking held `scheduled` until paid
(tenant-configurable hold window)."* `bookings.status` even has a
`'scheduled'` value in its own CHECK constraint
(`booking_core.sql:73-75`) that nothing ever sets. Combined with B2 (the
agent never actually learns whether a deposit is required, since
`deposit_policy` is never injected), the practical effect today is every
motel booking is immediately `confirmed` and the room is held via the GIST
exclusion constraint regardless of payment — i.e. a guest who never pays the
deposit still holds the room exactly as firmly as one who did, and there is
no automated release-on-non-payment path either (no code checks
`payment_links.status`/`expires_at` against a `scheduled` booking to expire
it). `voice-tools` is flagged as in-flux, but this is worth surfacing
explicitly since it directly contradicts a MASTER_SPEC decision specific to
this vertical.

**B4 — HIGH — the entire waitlist mechanism (`waitlist_entries`) has no write path from any voice tool, for any vertical, so the dashboard's "Waitlist" card is dead UI and the `WAITLIST_OFFER_FRAGMENT` promise ("someone will text you the moment something opens up") cannot be fulfilled.**
`grep -rn "waitlist" supabase/functions/voice-tools/` finds only a comment
in `cancel_booking.ts` referencing a trigger that "notifies matching
waitlist entries" — no tool ever INSERTs into `waitlist_entries`.
`take_message.ts` (the only tool the waitlist-offering fragments actually
invoke) writes to `call_logs.message_text` and `messages_outbound` only.
Motel doesn't use `WAITLIST_OFFER_FRAGMENT` (by design, per C4), so motel
itself never promises this — but it's directly relevant to this audit
because C4's alternative-fix ("just add motel to the shared waitlist
fragment like every other vertical") would not actually work without this
also being fixed, and it means `bookings/page.tsx`'s "Waitlist" card
(`bookings/page.tsx:323-355`) is unreachable dead code for every vertical
today, motel included.

**B5 — MEDIUM — `verticalDetailsSchema.deposit_policy`/`rate_table` (the tenant-facing form schema) has a different shape than `zMotelOverrides.deposit_policy`/`rate_table` (the schema the template/prompt actually expects).**
`canonical-types/schemas/vertical-details.ts:31-32`:
`deposit_policy: z.string().max(1000).optional()` and
`rate_table: z.record(z.string(), z.number()).optional()`. But
`canonical-types/agent-template.ts:310-322`'s `zMotelOverrides`:
`deposit_policy: {required: boolean, amount_cents?, hold_window_hours?,
text}` (an object, not a string) and `rate_table:
[{room_type, nightly_rate_cents}]` (an array of typed objects with
integer **cents**, not a flat `Record<string, number>` of presumably-dollar
floats — `apps/web/.../vertical-details/page.tsx:44-59`'s
`rateTableToLines`/`linesToRateTable` helpers treat the number as a raw
displayed value with no cents conversion). Concretely: the only UI a motel
owner has to set their deposit policy and rate table
(`vertical-details/page.tsx:446-478`) saves data in a shape the rest of the
system (the `zMotelOverrides` schema the template's own comments describe as
the source of truth, `motel.ts:8-17`) cannot consume as documented, and (even
setting B2 aside) there is no reconciliation between "the owner typed
`queen: 89.99`" and "the compiled prompt expects an integer-cents
`nightly_rate_cents` field on an array of `{room_type, nightly_rate_cents}}`
objects." This is a second, independent reason `{{rate_table}}`/
`{{deposit_policy_text}}` cannot work correctly even after B2 is fixed,
unless B5 is fixed too (both live on the boundary between apps/web, flagged
in-flux, and canonical-types, which is stable ground truth — the mismatch
itself is real regardless of which side moves).

**B6 — LOW — no `E.164` format enforcement at the Zod dispatch-envelope
boundary (`phone: z.string().min(3)` across `LookupCustomerArgsSchema`,
`TakeMessageArgsSchema`, `SendSmsConfirmationArgsSchema`,
`CustomerInputSchema`).** `normalizeE164()` is correctly applied inside the
handlers that write to `customers`/`payment_links`
(`create_booking.ts:39`, `send_payment_link.ts:36`), so the actual money/
booking paths are safe, but `lookup_customer.ts` compares
`args.phone`/`ctx.callerNumber` via `samePhone()` without first normalizing
`args.phone` from the model — worth confirming `samePhone()` itself
normalizes both sides (not read in this audit's scope but flagged since G6's
authorization guarantee depends on it comparing like-for-like formats).

---

## Lean/fast/secure/scalable findings

- **Tool-call count per successful motel booking**: `check_availability` →
  `create_booking` → (`send_payment_link` when a deposit applies) →
  `send_sms_confirmation` = 3–4 hot-path calls, in line with the other
  conversation_flow verticals and within the general shape SYSTEM_DESIGN §5
  budgets for. No motel-specific inefficiency found here.
- **Hot-path query shape for motel specifically**: `check_availability`'s SQL
  (`check_availability.ts:38-53`) is a single indexed
  `slot_range && tstzrange(...)` read exactly per SYSTEM_DESIGN §5 — good —
  but per B1, for a motel tenant this query will always scan zero rows
  (no `resources`/`availability_slots` ever populated), so the "fast" path is
  currently also the "always empty" path.
- **PII/PCI surface**: motel correctly avoids ever asking for a card number
  (`sendPaymentLinkTool`'s description explicitly forbids it,
  `shared/tools.ts:243-244`) and defers all payment to a Stripe-hosted link —
  right call for this vertical, no PCI-relevant data ever reaches the
  transcript/recording. No PHI-equivalent concern for motel (unlike dental).
- **Prompt length/token cost**: `SYSTEM_PROMPT` for motel
  (`motel.ts:53-59`) composes 4 shared fragments plus one vertical-specific
  rate-discipline fragment — comparable size to other conversation_flow
  templates (restaurant composes 6, auto/dental similar), not an outlier.
  10 states total (`motel.ts:65-123`) is a sane node count for latency,
  consistent with the other 4 conversation_flow verticals (auto ~9, dental
  ~9, restaurant ~13 given its two branches) — no motel-specific bloat.
- **Per-vertical config validation (MASTER_SPEC §3.5)**: `zMotelOverrides`
  itself is reasonably typed (deposit as a structured object with
  `amount_cents`/`hold_window_hours`, rate table as typed cents) — the
  *schema* is fine; B2/B5 are about the schema never actually reaching the
  agent, and the tenant-facing form not matching the schema, not about the
  schema's own design.
- **Scale**: `availability_slots` for motels is documented as
  precomputed 30 days ahead vs 21 for other verticals
  (`booking_core.sql:59-60` comment, MASTER_SPEC §2) — reasonable for
  multi-night lookahead and not itself a concern; the concern is upstream
  (B1) in whether any rows exist to precompute from.

---

## Strengths

- Rate-discipline is genuinely well-defended at the prompt layer: the
  never-invent-a-rate rule is a named, isolated fragment
  (`RATE_DISCIPLINE_FRAGMENT`) reinforced in two places (system prompt +
  `collect_room_type` state), covered by a dedicated red-team fixture
  (`injection-fixtures.ts:115-124`) and a dedicated structural test
  (`structural.test.ts:142-151`) — this is exactly the "structurally
  reinforced, not model-discretionary" bar SYSTEM_DESIGN §4.1 asks for, at
  the template layer (the gap is entirely that the variable it depends on is
  never populated — B2 — not that the template is careless).
- Identity fallback on reschedule/cancel (MASTER_SPEC §3.7) is correctly
  wired end-to-end: prompt instruction
  (`IDENTITY_FALLBACK_FRAGMENT`) → tool schema (`verify: {full_name,
  appointment_time}`) → real server-side enforcement
  (`identity-verification.ts` via `update_booking.ts`/`cancel_booking.ts`)
  → audit trail column (`bookings.identity_verified_by`). Nothing here is
  prompt-only trust.
- `transfer_call`'s zero-parameter, `tenant_config_only` design (G6) is
  airtight and shared identically across every template via
  `shared/tools.ts` — no caller-suppliable destination is even structurally
  expressible, confirmed by `structural.test.ts:67-77`.
- Consent capture (MASTER_SPEC §3.6) is asked exactly once, non-repeatably,
  and correctly threaded into `customers.consent` with `captured_at`/
  `call_id` provenance (`create_booking.ts:72-79,94-98`).
- The disclosure line is a genuinely non-tenant-editable, compiler-injected
  constant identical across all 8 templates, correctly prepended to the
  first node's instruction text by the compiler
  (`conversation-flow.ts:89-96`) rather than left to per-template prompt
  authoring — this closes off an entire class of "tenant edited the
  disclosure away" risk before it can exist.
- `create_booking`'s idempotency handling is properly race-proof (INSERT
  + exclusion-constraint-violation catch, never check-then-insert, matching
  CLAUDE.md Rule 2 and BACKEND_SPEC §7.2.2 exactly) — verified by reading
  the actual SQL, not just the doc comment.

---

## Prioritized fix list

1. **Build a `resources` (room inventory) management UI and wire
   `check_availability`/`create_booking` to a real room-type dimension.**
   Files: new `apps/web/.../dashboard/agent/rooms/` (or extend
   `agent/services/page.tsx`) page for CRUD on `public.resources`
   (`type='room'`, `capacity`, name); `supabase/functions/voice-tools/tools/
   check_availability.ts` to filter by the already-declared-but-unused
   `offering_id`/a room-type dimension instead of only the coarse
   `resources.type` enum. Why: without this, motel cannot take a single real
   booking today (B1) — this is the highest-leverage fix since everything
   else in the vertical assumes rooms exist.

2. **Populate `rate_table`, `deposit_policy`, and `cancellation_policy` as
   real dynamic variables at call time.** File:
   `supabase/functions/voice-inbound/handler.ts` (`dynamicVariables` object,
   ~line 120) — add a formatting step turning `zMotelOverrides.rate_table`
   into the flat `{{rate_table}}` prose string the prompt expects (and the
   equivalent for every other vertical's typed override keys, since all six
   are currently missing, not just motel's). Why: this is the mechanism the
   template's entire "never invent a rate" guarantee depends on (B2) — right
   now the guarantee is enforced against an empty variable.

3. **Reconcile `verticalDetailsSchema`'s `deposit_policy`/`rate_table` shape
   with `zMotelOverrides`'s shape** (string vs structured object; flat
   dollar record vs array of `{room_type, nightly_rate_cents}}`). Files:
   `packages/canonical-types/src/schemas/vertical-details.ts` and
   `apps/web/.../dashboard/agent/vertical-details/page.tsx`. Why: the only
   UI a motel owner has to configure pricing currently can't produce data the
   rest of the system can consume (B5) — this blocks fix #2 from being
   useful even once shipped.

4. **Make `create_booking` respect a `scheduled`-until-paid status when a
   deposit is required**, and add a job/trigger to release/expire an unpaid
   `scheduled` booking after its configured hold window. Files:
   `supabase/functions/voice-tools/tools/create_booking.ts` (accept/check a
   deposit-required signal, likely threaded through from `agent_configs` at
   dispatch time rather than trusted from the model), a new or existing
   scheduled job (`supabase/functions/job-*`) for the expiry sweep. Why:
   MASTER_SPEC §3.2's motel-specific requirement is currently silently
   unimplemented (B3) — every booking is `confirmed` regardless of payment.

5. **Add an explicit name/phone collection instruction to the motel template
   before `confirm_booking`**, matching the one-field-at-a-time pattern
   used for dates/guests/room type. File:
   `packages/templates/src/verticals/motel.ts` (either a new
   `collect_guest_info` state, or an explicit instruction added to
   `collect_dates`/`greeting`). Why: currently the only place `customer.
   name`/`customer.phone` are implied is the tool schema itself
   (C1) — the graph should say so structurally, not rely on the model
   inferring it from a required tool argument it hasn't been told to fill.

6. **Add a `rate_cents`/quoted-rate field to `create_booking`'s schema and
   `bookings` table**, so the rate actually quoted is persisted alongside
   the reservation. Files: `packages/canonical-types` `CanonicalTool`
   schema for `create_booking` (`shared/tools.ts:48-76`), a new migration
   adding e.g. `bookings.quoted_rate_cents`, and
   `supabase/functions/voice-tools/tools/create_booking.ts`. Why: currently
   unrecoverable except by re-listening to the call recording if a guest
   disputes the price (C3) — inconsistent with `create_order`/
   `send_payment_link` both persisting their amounts.

7. **Add motel-specific `dynamic_variable_overrides` keys for common
   amenity/policy questions** (e.g. `pet_policy`, `extra_guest_fee_cents`,
   `amenities_text`, `min_age_to_book`) plus a state/global-intent that
   answers from them, distinct from `take_message_fallback`'s "I couldn't
   help you in real time" framing. Files: `canonical-types/agent-
   template.ts` (`zMotelOverrides`), `vertical-details/page.tsx`,
   `packages/templates/src/verticals/motel.ts`. Why: real callers ask these
   constantly (Research summary, C5) and the agent currently has nothing to
   answer with.

8. **Give `take_message` a real write path into `waitlist_entries`** (a
   distinct tool, or a typed argument on `take_message` that the handler
   branches on) rather than relying on a "Waitlist request:" text-prefix
   convention that nothing parses. Files:
   `supabase/functions/voice-tools/tools/take_message.ts` (or a new
   `create_waitlist_entry.ts`), `packages/templates/src/shared/tools.ts`.
   Why: this unblocks a real waitlist experience for motel's peak-demand
   no-availability case (C4) and makes the existing dashboard "Waitlist"
   card (`bookings/page.tsx:323-355`) not dead UI, for every vertical that
   already promises it (B4).

9. **Re-verify Retell's current Function Node vs Conversation Node
   documentation directly** (egress was blocked in this environment) to
   settle whether a real hard per-node tool lock exists that this compiler
   isn't using, updating `packages/adapters/retell/src/compiler/types.ts`'s
   existing `RETELL-VERIFY` comment either way. Why: bears directly on
   whether "model cannot invent... tool-backed nodes only" (SYSTEM_DESIGN
   §4.1) is actually structurally enforceable for motel's `check_time`/
   `confirm_booking` states (C7), or remains prompt-only discipline as
   currently documented.
