# Restaurant vertical audit (orders, delivery, pickup, reservations, enquiries)

Scope per instructions: `packages/templates` (restaurant.ts + shared), `packages/canonical-types`,
`packages/adapters/retell/src/compiler`, `supabase/migrations` (stable ground truth),
`docs/SYSTEM_DESIGN.md` §4, `docs/spec/BACKEND_SPEC.md`, `docs/spec/MASTER_SPEC.md` §3,
`docs/VERTICAL_RESEARCH.md`, `docs/LEGACY_LIVE_FINDINGS.md`. `supabase/functions/voice-tools` was
read too (needed to trace where template-asserted fields actually land) but is flagged in the task
brief as in-flux — findings there are evidence-based (file:line) and should be re-checked against
whatever the concurrent fix wave lands.

---

## Research summary

**Sources**: WebSearch (docs.retellai.com/build/conversation-flow/node; restaurantbusinessonline.com;
loman.ai; foodallergy.org; unileverfoodsolutions.us; pos.toasttab.com) + domain knowledge (labeled).

**What a competent phone order-taker/host actually does** (domain knowledge + search):
- Branches immediately: order vs. reservation vs. general question/hours vs. complaint vs.
  vendor/spam vs. "is this an emergency" (smoke/fire/medical — very rare but a real business phone
  can receive one). Restaurant's is a fast, low-friction call — most fields are transactional, not
  compliance-heavy like dental/legal.
- **Order fields collected**: item(s) + size/modifiers one at a time, explicit allergy question
  (industry guidance: ask even if not volunteered, flag it distinctly in the kitchen ticket — e.g.
  Toast/Aloha "allergen alert" flags in red — [Loman.ai](https://loman.ai/blog/how-to-handle-food-allergies-in-your-restaurant),
  [FoodAllergy.org](https://www.foodallergy.org/resources/calling-restaurants)), pickup vs. delivery
  vs. dine-in, full delivery address + landmark/apartment/gate code, name, callback phone,
  payment method / total read-back, estimated ready/delivery time, special instructions
  (utensils, extra sauce, "ring doorbell twice").
- **Reservation fields**: party size, date/time, name, phone, special occasion/high-chair/
  accessibility notes, and (for larger parties) a hold/deposit or cancellation policy read-out.
- **Repeat-caller shortcut**: caller-ID lookup (Toast's own "integrated caller ID ordering" feature)
  pulls name/order history/saved address so staff don't re-ask every field —
  [Toast POS](https://pos.toasttab.com/news/toast-pos-releases-integrated-caller-id-ordering).
- **Policies stated**: cancellation/no-show policy for reservations, delivery minimum/radius,
  never promising a price/item not on the actual menu.
- **Never say**: an invented price or menu item, a promise about ingredients when unsure of
  allergens (real hosts are trained to check with the kitchen rather than guess —
  [gofoodservice.com](https://www.gofoodservice.com/blog/navigating-food-allergies-in-restaurants)),
  a discount not authorized by policy.
- **Handoff triggers**: caller demands to speak to the manager/owner, angry complaint about a past
  order, catering/large-party requests beyond standard capacity, any real safety emergency.
- **Downstream systems**: Toast, Square, Clover, Aloha (POS) for order tickets; OpenTable/Resy/
  Yelp Reservations for tables. Fields those systems need: itemized order with modifiers,
  allergen flag, fulfillment type + address, ticket total, table/party size + time. This repo
  targets **Square** as its POS adapter (`packages/adapters/square`).

**Retell conversation_flow node types** (confirmed via
[docs.retellai.com/build/conversation-flow/node](https://docs.retellai.com/build/conversation-flow/node),
cross-checked with this repo's own RETELL-VERIFY notes in `compiler/types.ts`): Conversation node
(pure dialogue, can call functions per the SDK), Transfer Agent node, Press Digit (DTMF) node,
**Logic Split node** (branches immediately on a condition, no dialogue), End node
(`speak_during_execution` for a closing line), and the Global Node toggle (interruptible from any
node — this repo's `global_node_setting: {condition}`, confirmed against the SDK). This repo's
compiler (`conversation-flow.ts`) emits **only `type: "conversation"` nodes** — it never emits a
Logic Split node, so every transition (including ones that should be a deterministic check on a
tool's return value, e.g. "did `check_availability` come back `none_available`?") is lowered to the
same `type: "prompt"` transition condition as a free-text intent guess (see Finding C10 below).

---

## Data capture table

| Real-world field | Asked by template? (state:line) | Tool arg carrying it | DB column / jsonb key | Surfaced in dashboard? | Pushed to POS adapter? | Verdict |
|---|---|---|---|---|---|---|
| Order vs. reservation | `order_or_reservation` (restaurant.ts:81-87) | n/a (routing only) | n/a | n/a | n/a | OK |
| Menu items + qty + modifiers | `collect_items` (restaurant.ts:114-120), driven by `{{menu_text}}` | `create_order.items[]` (tools.ts:199-211) | `orders.items` jsonb (booking_core.sql:111,136) | `orders-list-client.tsx`/`order-detail-client.tsx:146-156` (name/qty/price) | via `pos` adapter push (create_order.ts:211-219) | **BLOCKER** — `{{menu_text}}` itself is never populated at call time (Finding B1); POS push is separately broken (Finding B2) |
| Food allergies (explicit ask) | `collect_allergies` (restaurant.ts:122-126), `ALLERGY_ASK_FRAGMENT` (restaurant.ts:49-51) | **none** — no `allergies`/`notes` field on `create_order` (tools.ts:189-236, voice-tools.ts:101-119) | **none** — `orders` table has no notes/allergy column (booking_core.sql:107-126) | not shown (order-detail-client.tsx has no allergy field) | not shown | **MISSING** (Finding B5) |
| Pickup / delivery / dine-in | `pickup_or_delivery` (restaurant.ts:128-132) | `create_order.fulfillment_type` (enum incl. `dine_in`, tools.ts:212) | `orders.fulfillment_type` | shown (orders-list-client.tsx:65-68, order-detail-client.tsx:127-129) | forwarded | OK (dine_in is schema-only dead branch, Finding L16) |
| Delivery address | `collect_delivery_address` (restaurant.ts:134-142) | `create_order.delivery_address{street,city,state,zip}` | `orders.delivery_address` jsonb | **PARTIAL** — street/city/state only, zip dropped (order-detail-client.tsx:133-138) | forwarded | PARTIAL |
| Saved default address (repeat caller) | template tells agent to reuse it (restaurant.ts:138-140) | n/a — `lookup_customer` never returns one | `customer_addresses` table exists (customers.sql:35-54) but **nothing ever inserts into it** | n/a | delivery-radius check reads it but it's always empty (create_order.ts:131-138) | **MISSING / stubbed** (Finding B4) |
| Delivery-radius check | implicit (server-side) | n/a | `agent_configs.dynamic_variable_overrides.tenant_geocode`/`delivery_radius_m` | n/a | decline surfaces as `out_of_delivery_radius`, handled in prompt (restaurant.ts:139-141) | PARTIAL — logic exists but can never actually run (no saved geocode ever exists, Finding B4) |
| Minimum order (delivery) | not explicitly asked, enforced server-side | `create_order` computes/declines (create_order.ts:111-115) | `agent_configs...min_order_cents` (validated, agent-template.ts:326) | not surfaced in dashboard | n/a | PARTIAL — decline has no scripted agent response (Finding H8) |
| Consent to text/call | `CONSENT_ASK_FRAGMENT` (fragments.ts:79-84), asked before "any booking or order" | `create_booking.consent` exists (tools.ts:66-71); **`create_order` has no `consent` field at all** (tools.ts:189-236) | `customers.consent` jsonb — written by `create_booking.ts:72-98`, **never written by `create_order.ts`** | n/a | n/a | **MISSING for orders** (Finding H6) |
| Order total / tax / read-back | `FULL_READBACK_FRAGMENT` (restaurant.ts:53-56) | `create_order` returns `total_cents` | `orders.subtotal_cents/tax_cents/total_cents` | shown (order-detail-client.tsx:160-179) | forwarded | OK, except `tax_rate_bps` has no validated config path (Finding H9) |
| Cancellation policy read-out (reservations) | `CANCELLATION_POLICY_READOUT_FRAGMENT` via `{{cancellation_policy_text}}` (fragments.ts:90-94) | n/a | `agent_configs...cancellation_policy` — settable in Settings UI (vertical-details/page.tsx:270-285) | n/a | n/a | **BLOCKER — never flattened into the actual Retell dynamic-variables map** (Finding B1) |
| Party size vs. table capacity | `collect_party_size` (restaurant.ts:90-94) | `check_availability.party_size`, `create_booking.party_size` (both accepted) | `bookings.party_size`, `resources.capacity` (booking_core.sql:29-30,76) | shown implicitly via structured_payload | n/a | **MISSING — never checked against capacity** (Finding B3) |
| Reservation confirmation SMS | `confirm_reservation` (restaurant.ts:104-111) | `send_sms_confirmation` | `messages_outbound` | shown (via messages) | n/a | OK |
| Waitlist request (no availability) | `WAITLIST_OFFER_FRAGMENT` (fragments.ts:114-121) | routed through `take_message`, not a real waitlist tool | `waitlist_entries` table exists (booking_core.sql:140-156) but is **never written** | not a dedicated dashboard surface | n/a | PARTIAL — feature exists in schema, not wired (Finding M11) |
| Reschedule/cancel identity check | `manage_booking` (utility-states.ts:58-71), `IDENTITY_FALLBACK_FRAGMENT` | `update_booking.verify`/`cancel_booking.verify` (tools.ts:78-129) | `bookings.identity_verified_by` (booking_core.sql:85) | not surfaced (minor) | n/a | OK, well-tested (structural.test.ts:166-176) |
| Payment link for prepaid order/deposit | `confirm_order` (restaurant.ts:144-153) | `send_payment_link` | `payment_links` table | shown + resend button (order-detail-client.tsx:199-236) | n/a | OK |
| Call classification (order vs. booking) | n/a | n/a | `call_logs.classification` enum has **no `new_order` value** (call-taxonomy.ts:11-24) | dashboard Calls list filters by this enum (calls-list-client.tsx:23) | n/a | **MEDIUM gap** (Finding H7) |

---

## Conversation design findings (severity, file:line)

**BLOCKER — B1: `{{menu_text}}` / `{{cancellation_policy_text}}` are never populated at call time.**
`restaurant.ts:45,61,117` and `fragments.ts:91` hard-reference `{{menu_text}}` and
`{{cancellation_policy_text}}` as Retell dynamic variables (and the red-team lint allowlists them,
`prompt-lint.ts:27,32`). But the runtime resolver that actually builds the dynamic-variables map sent
to Retell, `supabase/functions/voice-inbound/handler.ts:120-145`, only flattens
`manager_name`/`manager_phone`/`parking_info`/`accessibility_notes`/`accepted_payment_types` out of
`dynamic_variable_overrides` — `menu_text` and `cancellation_policy_text` are absent. Worse, they
aren't even *reachable*: the validated per-vertical override schema `zRestaurantOverrides`
(`agent-template.ts:324-327`) only defines `delivery_radius_m`/`min_order_cents`; the Settings UI
"Vertical details" tab for restaurant (`apps/web/.../vertical-details/page.tsx:480-525`) only renders
those same two fields — there is **no menu editor anywhere that produces a `menu_text` string**, and
no UI field for `cancellation_policy_text` either (the shared `cancellation_policy.text` field is
collected at `vertical-details/page.tsx:270-285` but is a *different* key than what the restaurant
template interpolates). Net effect: at call time Retell will either speak the literal string
`{{menu_text}}` or fail to substitute it — **the compiled restaurant agent cannot know its own menu
or cancellation policy through any implemented path.** This is a known, self-documented gap
(`docs/BUILD_NOTES.md:800-815`, "Dynamic-variable coverage gap") but it is not yet fixed, and it is a
correctness blocker specifically for this vertical (menu is the entire order-taking flow).

**BLOCKER — B3: `check_availability`/`create_booking` never check party size against table capacity.**
The reservation branch explicitly collects party size (`restaurant.ts:90-94`, `collect_party_size`)
and passes it to `check_availability` (`restaurant.ts:96-102`). `checkAvailabilityTool()`
(`tools.ts:24-46`) and `CheckAvailabilityArgsSchema` (`voice-tools.ts:19-26`) both declare
`party_size`, but the actual implementation (`supabase/functions/voice-tools/tools/check_availability.ts:31-89`)
never references `args.party_size` in its SQL — it filters only by `tenant_id`, `is_available`,
`slot_range`, and optionally `resource_type`. `resources.capacity` (`booking_core.sql:30`) is never
joined. A party of 8 can be confirmed into a 2-top table with no server-side or prompt-side
safeguard.

**BLOCKER — B4: the "saved default delivery address" UX the template promises does not exist.**
`collect_delivery_address`'s prompt (`restaurant.ts:134-142`) instructs: *"If lookup_customer
already returned a saved default address for this caller, confirm it back instead of asking from
scratch."* But `lookupCustomer()` (`supabase/functions/voice-tools/tools/lookup_customer.ts:42-83`)
selects only `id, name, segment, metadata` from `customers` — it never queries
`public.customer_addresses` and never returns an address field. And nothing writes to
`customer_addresses` either: grep across `supabase/functions` shows the table is only ever **read**
(by `create_order.ts:131-138`, for the delivery-radius check) — no insert path exists anywhere in the
runtime. MASTER_SPEC §3.1 explicitly specs this ("agent reuses default address on repeat delivery
callers... 'still to 42 Oak St?'"), so this is a spec-to-implementation gap, not just an
under-specified template. Consequence beyond the missing UX: the delivery-radius check
(`create_order.ts:110-157`) can *never* actually run for any caller, ever — it always falls through
to the "no saved geocode" branch and logs a warning (`create_order.ts:150-155`), silently skipping
the one safety check MASTER_SPEC §3.0 calls out as required for delivery orders.

**BLOCKER — B5: no structured field for the mandatory allergy answer.**
`ALLERGY_ASK_FRAGMENT` (`restaurant.ts:49-51`) and `collect_allergies` (`restaurant.ts:122-126`)
make asking about allergies non-optional (and it's unit-tested, `structural.test.ts:136-139`), but
`createOrderTool()`'s parameter schema (`tools.ts:189-236`) and its runtime twin
`CreateOrderArgsSchema` (`voice-tools.ts:101-119`) have no `allergies`/`notes`/`special_instructions`
field anywhere, and neither does the `orders` table (`booking_core.sql:107-126`, only
`items`/`fulfillment_type`/`delivery_address`/money columns). The only place free text could land is
per-item `modifiers: string[]` (`tools.ts:207`), which is scoped to one dish, not order-wide, and is
never rendered in the dashboard order detail view (`order-detail-client.tsx:146-156` shows only
name/qty/price, no modifiers, no notes). A caller's stated allergy has no reliable path to the
kitchen — this is the single most safety-relevant gap in the vertical (industry guidance is
explicit that allergy info must reach the kitchen in a flagged, visible way).

**HIGH — H6: order-path consent is asked but never persisted.**
`CONSENT_ASK_FRAGMENT` (`fragments.ts:79-84`) requires the consent question "before finalizing any
booking **or order**" and says to "pass the caller's answer as the `consent` field... on the booking
**or order** tool call." `createBookingTool()` has a `consent` property (`tools.ts:66-71`) and
`create_booking.ts:72-98` writes it to `customers.consent`. `createOrderTool()` (`tools.ts:189-236`)
declares `consent` too, but `CreateOrderArgsSchema` (`voice-tools.ts:101-119`) has **no `consent`
field** (only `.passthrough()`, so it'd be silently accepted and then dropped), and
`create_order.ts` never reads `args.consent` or touches `customers.consent`. For restaurant — where
orders are the dominant call type — the mandatory MASTER_SPEC §3.6 consent capture is asked out loud
and then thrown away for every order.

**HIGH — H8: two of `create_order`'s four failure reasons have no scripted agent recovery.**
`CreateOrderResult` (`create_order.ts:19-26`) can return `confirmed: false` with reason
`item_not_found`, `out_of_delivery_radius`, `below_minimum_order`, or `invalid_phone`. Only
`out_of_delivery_radius` gets prompt guidance (`restaurant.ts:139-141`, in
`collect_delivery_address`). `confirm_order`'s own prompt (`restaurant.ts:144-153`) says nothing
about what to do if `create_order` comes back declined at all — no instruction for `item_not_found`
(caller ordered something already removed from the live menu after `menu_text` staled) or
`below_minimum_order` (a very common real-world delivery decline, and the tool even returns
`pickup_offered: true` for it, which nothing in the prompt ever references).

**HIGH — H7: order calls are misclassified in the call taxonomy.**
`CALL_CLASSIFICATIONS` (`call-taxonomy.ts:11-24`) has `new_booking` but no `new_order` value. The
dashboard's Calls list filters and badges by this enum (`calls-list-client.tsx:23,113-125`). Every
restaurant order call either gets stuffed into `new_booking` (conflating it with table reservations
in the one taxonomy meant to let staff triage call types at a glance) or is left unclassified.

**MEDIUM — M9: `tax_rate_bps` has no validated config path.** `create_order.ts:159` reads
`overrides["tax_rate_bps"]` from `dynamic_variable_overrides`, but `zRestaurantOverrides`
(`agent-template.ts:324-327`) doesn't declare it, and the Settings UI (`vertical-details/page.tsx`)
has no field for it — it can only ever be set by someone writing to the jsonb column directly,
bypassing the app entirely (contradicts CLAUDE.md's "validated per-vertical by a Zod schema"
comment on the migration itself, `agent_templates.sql` line 42 area). Every tenant's tax defaults
silently to $0 tax otherwise.

**MEDIUM — M10: availability/decline branches use soft prompt conditions, not a deterministic Retell
Logic Split.** `check_time_reservation → confirm_reservation` on `predicate: "slot_selected"` and
`→ take_message_fallback` on `predicate: "none_available_and_caller_declines_waitlist"`
(`restaurant.ts:183-192`) both compile through `conversation-flow.ts:74-85` to a
`transition_condition: {type: "prompt", prompt: "..."}` — the identical mechanism used for
free-text intent transitions. Retell's documented Logic Split node exists precisely to branch
deterministically on a structured condition right after a tool call
([docs.retellai.com/build/conversation-flow/node](https://docs.retellai.com/build/conversation-flow/node))
but this compiler never emits one (confirmed in `compiler/types.ts` header, "no per-node tool
restriction... every node effectively has access to every tool"). Whether the caller actually gets
routed to `confirm_reservation` after a real open slot, versus hallucinated by the model, is only as
reliable as the LLM's own recall of the tool result mid-conversation.

**MEDIUM — M11: the waitlist is not a real feature.** `WAITLIST_OFFER_FRAGMENT`
(`fragments.ts:114-121`) routes a "yes" through `take_message` with a `"Waitlist request:"` prefix.
A real `waitlist_entries` table exists with matching logic implied in its own comment
(`booking_core.sql:140-156`, "the booking-cancellation trigger matches active entries by window
overlap and enqueues an SMS") but there is no `join_waitlist` voice tool and `take_message.ts` never
inserts into `waitlist_entries` — every restaurant waitlist request becomes an ordinary staff
message with no automatic slot-opened notification, contradicting the table's own documented
purpose. (Already logged generically in `docs/BUILD_NOTES.md:780-788`; restated here with
restaurant-specific evidence since restaurant is one of the two verticals — with motel — where this
matters most.)

**MEDIUM — M12: `allowed_tools` is not structurally enforced in the compiled graph.** Confirmed by
the compiler's own docstring (`compiler/types.ts:15-28`, `conversation-flow.ts:15-34`): a plain
Retell `ConversationNode` has no per-node tool-restriction field, so every one of restaurant's 13
compiled nodes (including `greeting`) technically has model-level access to
`cancel_booking`/`update_booking`/`send_payment_link`/`create_order`, not just the tools listed in
that state's `allowed_tools`. This directly contradicts SYSTEM_DESIGN §4.1's "tool-backed nodes
only... model cannot invent" goal for this vertical. Already logged as a cross-cutting architecture
gap in BUILD_NOTES (RETELL-VERIFY) rather than silently redesigned, which is the correct call per
CLAUDE.md Rule 4 — but it remains a real, currently-unmitigated exposure for restaurant specifically
(a caller could plausibly talk the agent into attempting `cancel_booking` mid-order-taking).

**MEDIUM — M13: the menu catalog itself carries no structured allergen/dietary metadata.**
`offeringSchema` (`packages/canonical-types/src/schemas/offering.ts:5-10`) is `name`,
`duration_minutes`, `price_cents`, `resource_id` — no allergen tags, no ingredient list, no
"contains nuts/dairy/gluten" flag. Even once B1 (menu_text wiring) is fixed, the model has no
authoritative structured source to check a stated allergy against — it would have to reason over
free text in `{{menu_text}}`, which is exactly the kind of "the model might get it wrong" surface a
food-safety-relevant answer shouldn't depend on.

**LOW — L14: dashboard order detail drops delivery zip and delivery instructions.**
`order-detail-client.tsx:130-141` renders only `street, city, state` from `deliveryAddress`, silently
omitting `zip` (which IS captured, `voice-tools.ts:104-116`) and `delivery_instructions` (captured on
`customer_addresses` but never even reaches the `orders.delivery_address` jsonb payload in the first
place, since `create_order` only stores what the model passes, and the template's ask
(`restaurant.ts:136`) doesn't request apartment/gate-code/delivery-instructions at all).

**LOW — L15: `confirm_reservation` doesn't explicitly say to carry forward `resource_id`.**
`restaurant.ts:104-111` reads back party size/date/time and asks consent, but never explicitly
instructs the model to pass the exact `resource_id` `check_availability` returned
(`check_availability.ts:85-88`) into `create_booking` (`tools.ts:55`, required field) — this relies
on the model's own short-term memory of the prior tool result rather than an explicit carry-forward
instruction.

**LOW — L16: `dine_in` is a schema-only dead branch.** `createOrderTool()`'s
`fulfillment_type` enum includes `"dine_in"` (`tools.ts:212`), but `pickup_or_delivery`
(`restaurant.ts:127-132`) only ever asks pickup vs. delivery — there is no conversational path that
reaches `dine_in`, and no transition targets it. Likely intentional for a phone channel, but worth a
BUILD_NOTES entry rather than silent dead code, per CLAUDE.md Rule 3 (no dead paths).

---

## Backend/tool findings

- **`check_availability`** (`voice-tools.ts:19-26`, `check_availability.ts`): party_size accepted,
  never used (B3, above). Query shape is otherwise lean — single indexed `tstzrange` overlap read,
  bounded `limit 20`/`limit 1` for nearest-alternative, no ORM. Good hot-path shape.
- **`create_booking`**: idempotent (unique `(tenant_id, idempotency_key)`), race-proofed via the
  GIST exclusion constraint rather than check-then-insert (`create_booking.ts:81-128`, matches
  CLAUDE.md Rule 2's mandate exactly). Consent handled correctly for bookings.
- **`create_order`** (`create_order.ts`): idempotent (unique on `(tenant_id, idempotency_key)`,
  concurrent-race handled at `catch` on `23505`, lines 186-198). Item pricing is genuinely
  server-validated against `offerings` (never model-invented — the one real backstop against the
  price-invention red-team fixture, `injection-fixtures.ts:104-114`). Gaps: no `consent` (H6), no
  `allergies`/`notes` (B5), delivery-radius check that can never fire (B4), `tax_rate_bps` with no
  config path (M9), and the adapter-push wiring bug below.
- **POS adapter push is broken for every restaurant order.** `create_order.ts:211-219` builds
  `AdapterPushQueueMsg{adapter: "pos", entity_type: "order", ...}` and enqueues it. But
  `ADAPTER_PUSHERS` in `supabase/functions/worker-adapter-push/handler.ts:606-611` is keyed by
  `square`, `shopmonkey`, `ezyvet`, `google_calendar` — **there is no `"pos"` key.**
  `pushToAdapter()` (`handler.ts:613-628`) looks up `ADAPTER_PUSHERS[msg.adapter]`, finds nothing,
  logs `adapter_push_not_implemented`, and returns `false` — every time, for every tenant, even one
  with a fully-connected Square account. `pushToSquare()` (`handler.ts:224-303`) already has a
  working order-push branch (falls through past its `entity_type === "booking"` check to load and
  push the order) — it is simply never reached, because the message's `adapter` field says `"pos"`
  instead of `"square"`. This is a one-line-cause, whole-feature-broken bug: restaurant orders never
  reach the tenant's POS regardless of connection status. **This should be flagged for the
  in-flight fix wave immediately** (it's a `create_order.ts` / `worker-adapter-push` mismatch, both
  outside this audit's read-only mandate to fix, but concrete enough to hand off as-is).
- **`lookup_customer`** (`lookup_customer.ts:42-83`): the one tool whose authorization scope is
  enforced in code, not just documented (`samePhone(args.phone, ctx.callerNumber)` check, line 48) —
  a genuine strength (see Strengths). Gap: never returns `customer_addresses` (B4) despite the
  restaurant template assuming it does.
- **`send_payment_link`**: no card data ever spoken/stored, matches MASTER_SPEC §3.2 exactly.
- **`take_message`**: plain message-taking, no waitlist-specific handling (M11).
- **Money**: all cents-integer throughout `orders`/`payment_links` — no floats. Good.
- **Phones**: `normalizeE164` used consistently in `create_order.ts:60`, `create_booking.ts:39`.
  Good.
- **Missing tools this vertical could use**: a `get_menu`/`get_rate_table`-style tool call was
  explicitly considered and rejected in favor of dynamic variables per SYSTEM_DESIGN §5 (documented
  trade-off, not a gap by itself) — but see B1: the dynamic-variable side of that trade-off was
  never finished, so right now the vertical has *neither* a tool-backed menu lookup *nor* a working
  dynamic-variable menu. A `join_waitlist` tool (M11) and a way to persist a caller's spoken
  delivery address into `customer_addresses` (B4) are the two other concrete missing tools/write
  paths for this vertical specifically.

---

## Lean / fast / secure / scalable findings

- **Prompt length/token cost**: `system_prompt` for restaurant is 7 fragments concatenated
  (`buildSystemPrompt` + 6 extras, `restaurant.ts:58-67`) — comparable to other verticals, not
  bloated. Per-state `prompt_fragment`s are short (1-3 sentences). Reasonable token cost per turn.
- **Tool calls per order**: `lookup_customer` (optional) → `create_order` → `send_payment_link`
  (conditional) → `send_sms_confirmation` = 2-4 calls, in line with BACKEND_SPEC's hot-path
  expectations. Reservation path: `check_availability` → `create_booking` → `send_sms_confirmation`
  = 3 calls. Lean.
- **Hot-path query shape**: `check_availability` and `create_order`/`create_booking` are each a
  handful of single, indexed, parameterized queries — no ORM, matches CLAUDE.md Rule 2's p95 < 500ms
  mandate structurally, modulo B3's missing capacity join (a cheap fix, not a latency problem).
- **PII/PHI leaking into transcripts**: restaurant carries no PHI-equivalent (no medical/insurance
  info), but delivery addresses and full names/phones do land in the recorded transcript and
  `call_logs.transcript`/`extracted_entities` — same general handling as every other vertical, no
  vertical-specific extra exposure identified.
- **Per-vertical config (MASTER_SPEC §3.5) completeness**: `zRestaurantOverrides` covers only
  `delivery_radius_m`/`min_order_cents` of what the template actually needs (`menu_text`,
  `cancellation_policy_text`, `tax_rate_bps`, `tenant_geocode` are all referenced by
  code/prompt but absent from the validated schema) — this is the same B1/M9 gap restated as a
  config-completeness finding. This is the standout "not lean/not scalable" issue for the vertical:
  every restaurant tenant's core menu today can only be entered via direct DB write, which doesn't
  scale to self-serve onboarding at all.
- **Idempotency / retries**: both `create_order` and `create_booking` handle Retell's documented
  retry-on-timeout behavior correctly (idempotency key lookup before insert, unique-violation
  recovery after). Good, and consistently applied.

---

## Strengths

- Compiled-in disclosure line + gate (`compiler/disclosure-gate.ts`, tested) — cannot be talked out
  of it by a prompt-override attack (verified against `injection-fixtures.ts`'s `prompt_override`
  fixture).
- Catalog-discipline is genuinely backstopped server-side: even though `menu_text` itself is broken
  (B1), the *fallback* the template's own comment describes ("create_order's existing server-side
  item validation as the real backstop regardless of what the model says") is real and tested
  (`create_order.ts:90-103` rejects any `offering_id` not in the tenant's active `offerings`).
- Idempotent, race-proofed writes for both `orders` and `bookings` — no check-then-insert anywhere,
  matching CLAUDE.md Rule 2 exactly.
- `lookup_customer`'s `caller_number` authorization scope is enforced in code (not just documented),
  and is asserted structurally for every template by the red-team suite
  (`structural.test.ts:57-65`).
- `transfer_call` has zero parameters and `tenant_config_only` scope — structurally impossible for a
  caller to redirect a transfer, asserted for every template (`structural.test.ts:67-77`) and
  exercised by a dedicated injection fixture.
- Global safety/human/solicitor intents present, `reachable_from: "any"`, tested
  (`structural.test.ts:37-55`).
- Identity fallback for reschedule/cancel is well-specified (`IDENTITY_FALLBACK_FRAGMENT`) and
  tested (`structural.test.ts:166-176`).
- One-field-at-a-time + explicit digit/date read-back discipline is shared and consistent across
  every state that collects a phone/date/time.
- A real red-team fixture targets restaurant specifically (`injection-fixtures.ts:104-114`, price
  manipulation via a claimed verbal discount) and the property it depends on (server-side item/price
  validation) is real, not just asserted.

---

## Prioritized fix list

1. **Wire `menu_text` and `cancellation_policy_text` into the actual dynamic-variables map.**
   Files: `supabase/functions/voice-inbound/handler.ts` (flatten these two — and, ideally, every
   `ALLOWED_DYNAMIC_VARIABLES` name — out of `dynamic_variable_overrides`), plus
   `packages/canonical-types/src/agent-template.ts` (`zRestaurantOverrides`, add `menu_text` sourced
   from `offerings`, or a computed field, and `cancellation_policy_text`/`cancellation_policy.text`
   reconciled to one key), plus a real menu editor in
   `apps/web/.../dashboard/agent/vertical-details/page.tsx` (or reuse the existing `offerings` CRUD
   page and render `menu_text` FROM those rows server-side rather than as tenant free text). Why:
   without this the restaurant agent cannot state its own menu or cancellation policy — the vertical
   is non-functional for its primary purpose.

2. **Fix the POS adapter-push key mismatch.** File:
   `supabase/functions/voice-tools/tools/create_order.ts:211-219` — change `adapter: "pos"` to the
   tenant's actually-connected provider key (`"square"`, looked up from `adapter_connections`, the
   same way `worker-adapter-push/handler.ts`'s `loadConnection(sql, tenantId, "square")` does) rather
   than a hardcoded literal that matches no entry in `ADAPTER_PUSHERS`
   (`worker-adapter-push/handler.ts:606-611`). Why: every restaurant order silently fails to reach
   the POS today, with only a debug-level log line as evidence.

3. **Filter `check_availability` by party size vs. `resources.capacity`, and validate it again in
   `create_booking`.** File: `supabase/functions/voice-tools/tools/check_availability.ts:38-53`
   (add a join/filter on `resources.capacity >= args.party_size` when `party_size` is given) and
   `create_booking.ts` (reject if `party_size` exceeds the target resource's capacity). Why: today a
   large party can be silently double-booked into a small table.

4. **Add an `allergies`/`special_instructions` field to `create_order` end-to-end.** Files:
   `packages/templates/src/shared/tools.ts` (`createOrderTool`'s parameters), `supabase/functions/
   _shared/schemas/voice-tools.ts` (`CreateOrderArgsSchema`), `supabase/migrations` (a new
   `orders.allergies`/`orders.notes` column, additive migration per CLAUDE.md Rule 2), and
   `apps/web/.../orders/[id]/order-detail-client.tsx` (render it, ideally with a visually distinct
   allergy flag matching industry practice). Why: this is the one safety-relevant field the
   conversation mandates asking but has nowhere to put.

5. **Add `consent` to `create_order`'s schema and persist it, mirroring `create_booking.ts:72-98`.**
   Files: `packages/templates/src/shared/tools.ts` (already declares it — no change needed there),
   `supabase/functions/_shared/schemas/voice-tools.ts` (`CreateOrderArgsSchema`, add `consent`), and
   `supabase/functions/voice-tools/tools/create_order.ts` (write to `customers.consent` the same way
   `create_booking.ts` does). Why: MASTER_SPEC §3.6 consent is currently asked and silently dropped
   for every restaurant order.

6. **Implement the "saved default address" read path (and a write path for it).** Files:
   `supabase/functions/voice-tools/tools/lookup_customer.ts` (join `customer_addresses` where
   `is_default`, return it), and a new write path — either a settings-time address-save step or
   updating `create_order.ts` to upsert the caller's spoken delivery address into
   `customer_addresses` (with geocoding) after a successful order — so the delivery-radius check
   (`create_order.ts:110-157`) can ever actually fire for a real caller. Why: this is spec'd in
   MASTER_SPEC §3.1, referenced explicitly by the template's own prompt text, and currently 100%
   nonfunctional.

7. **Give `confirm_order` explicit recovery instructions for `item_not_found` and
   `below_minimum_order`.** File: `packages/templates/src/verticals/restaurant.ts` (`confirm_order`
   state, ~line 144-153) — add a fragment analogous to the existing `out_of_delivery_radius` handling
   in `collect_delivery_address` (lines 139-141), explicitly using the tool's `pickup_offered` flag
   for `below_minimum_order`. Why: two of `create_order`'s four decline reasons currently have no
   scripted agent behavior.

8. **Add `new_order` to the call classification taxonomy** (or otherwise distinguish order calls
   from booking calls in `call_logs`). File:
   `packages/canonical-types/src/call-taxonomy.ts:11-24`, plus the dashboard filter list in
   `apps/web/.../calls-list-client.tsx:23`. Why: restaurant's dominant call type currently has no
   distinct classification value in the one taxonomy meant to let staff triage calls at a glance.

9. **Give `tax_rate_bps` a real, validated config surface.** Files:
   `packages/canonical-types/src/agent-template.ts` (`zRestaurantOverrides`, add the field) and
   `apps/web/.../vertical-details/page.tsx` (add the input, restaurant section). Why: it's read at
   the hot path (`create_order.ts:159`) but has no way to ever be set through the app.

10. **Log a BUILD_NOTES follow-up (or fix) for `allowed_tools` not being structurally enforced on
    conversation_flow nodes**, specifically calling out restaurant's `create_order`/
    `send_payment_link`/`cancel_booking` co-existing on one flat tool list reachable from every node
    (`conversation-flow.ts:44-108`). This is a cross-vertical architecture gap already logged
    generically; restaurant is a concrete example worth naming if/when `SubagentNode` (or an
    equivalent hard per-node tool scope) gets built.
