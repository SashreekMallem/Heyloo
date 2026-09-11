# Channels — cross-cluster requests

Requests from Cluster S (schema + pricing + docs, BACKEND_SPEC.md §13) for
changes to files outside its own strict ownership
(`supabase/migrations/20260911{10,11}xxxx_*.sql`, `docs/spec/BACKEND_SPEC.md`
§13, `docs/spec/FRONTEND_SPEC.md` §12, `.env.example`, `docs/DEPLOY.md`,
`scripts/ci/rls-cross-tenant-probe.ts`). Format: target file, exact change,
requesting cluster. Append, never rewrite, prior entries.

---

## 1. URGENT — real migration conflict discovered with a Cluster T file (2026-09-11)

**Requesting cluster:** S (schema/pricing/docs)
**Target:** `supabase/migrations/20260911120000_text_conversations.sql`
(owned by whichever agent is running "Cluster T / BUILD_PLAN text-agent
task" per that file's own header comment) vs. this task's
`supabase/migrations/20260911100000_channels_text_conversations.sql`,
`20260911101000_channels_tenant_and_call_log_columns.sql`,
`20260911110000_channels_pricing_and_usage.sql`.

**What happened:** while validating this task's migrations from zero in a
throwaway local Postgres (below), migration
`20260911120000_text_conversations.sql` — timestamped just after this
task's own files but written by a different, concurrently-running build
agent building the actual text-agent *engine* — was discovered already
present in the working tree. It independently adds the **same three
things** this task's migrations add, with a **materially different,
incompatible shape**, and applying it after this task's migrations fails
outright:

```
=== FAILED: 20260911120000_text_conversations.sql ===
ERROR:  column "channel" of relation "call_logs" already exists
```

Concretely, both sets of migrations add:

| Thing | This task (Cluster S, BUILD_PLAN's literal spec to this cluster) | `20260911120000_text_conversations.sql` (Cluster T) |
|---|---|---|
| `call_logs.channel` | `text not null default 'phone' check in ('phone','web')` | `text not null default 'voice' check in ('voice','sms','web_chat')` |
| `usage_daily.text_messages_out` | `int not null default 0` (same name, same type — only genuinely compatible piece) | `int not null default 0` |
| `text_conversations` | Two-table log model: `text_conversations` (thread metadata: `status 'ai'\|'human'\|'closed'`, `ai_enabled`) + a separate append-only `text_messages` transcript table, keyed loosely to `messages_outbound`/`messages_inbound` for SMS delivery status | Single, live, mutated-in-place table: `status 'open'\|'human'\|'closed'`, `structured_state` + a bounded `recent_turns jsonb` working-memory window, `widget_session_token_hash` for web-chat identity, a lazily-created **shadow `call_logs` row** (`call_log_id`) so the *unmodified* `voice-tools/tools/*.ts` handlers (which require a real, non-null `call_logs.id`) can be reused verbatim — no separate `text_messages` table at all; the full transcript stays in the pre-existing `messages_inbound`/`messages_outbound` |

Neither design is a strict subset of the other — they solve real, different
integration constraints (this task's spec was handed a fixed column list
by BUILD_PLAN with no visibility into Cluster T's engine internals;
Cluster T's design is driven by a hard technical requirement — reusing
`voice-tools/tools/*.ts` unmodified per CLAUDE.md Rule 4/its own explicit
instruction — that this task's spec never mentioned). Per CLAUDE.md Rule 4
("append to docs/BUILD_NOTES.md ... do not redesign"), this task proceeded
with exactly what it was assigned rather than unilaterally rewriting or
deleting the other cluster's file, and did **not** delete
`20260911120000_text_conversations.sql` — only documents the collision
here, in `docs/BUILD_NOTES.md`, and in this task's own structured-output
`cross_cluster_requests` for the orchestrator to arbitrate.

**Verified independently** (not just theorized): built a throwaway local
Postgres 16 harness (stub `auth`/`storage`/`realtime` schemas + default
grants, the 3 unavailable `create extension` lines for
`pg_cron`/`pgmq`/`pg_net` trimmed — same approach `docs/BUILD_NOTES.md`'s
prior "Migrations reproducible from zero" passes document) and applied
every real migration file in filename order from empty, twice: (1) this
task's own 3 files plus every pre-existing migration, **excluding** the
stray `20260911120000` file — zero errors, confirmed reproducible from
zero in isolation (see `docs/BUILD_NOTES.md`'s Cluster S entry for the
full exercise, including real RLS-policy inserts/updates against
`text_conversations`/`text_messages` as an authenticated tenant session);
(2) including `20260911120000_text_conversations.sql` at the end —
reproduces the exact `column "channel" ... already exists` failure quoted
above.

**Recommendation, not a decision this cluster can make unilaterally:** one
design needs to win and the other's migration needs to be dropped/rewritten
before this repo's migrations are reproducible from zero again — this is a
real, currently-broken state of the shared tree, not a hypothetical. Cluster
T's shadow-`call_logs`-row design is the one actually wired to working
engine code (`_shared/text-agent/*.ts`, per its own comments) and satisfies
the harder constraint (reusing `voice-tools/tools/*.ts` unmodified), so it
is the more likely candidate to keep as-is; this task's own three files
would then need superseding edits (not silent deletion — they are this
task's actual deliverable) to drop the now-redundant `call_logs.channel`/
`usage_daily.text_messages_out`/`text_conversations` pieces and keep only
what doesn't collide (the `tenants.*` text-agent/widget columns in
`20260911101000`, the `platform_settings` price-card merge in
`20260911110000`, `text_messages`'s own new capability — a real transcript
table with delivery-status linkage, which Cluster T's design doesn't have
at all since it relies on `messages_inbound`/`messages_outbound` alone).
Whoever resolves this should also fix `BACKEND_SPEC.md` §13 and
`FRONTEND_SPEC.md` §12 (this task's own doc appends) to match whatever
final shape is kept.

---

## 2. `supabase/seed/seed.sql` — carry the two new price-card keys forward

**Requesting cluster:** S
**Target:** `supabase/seed/seed.sql`, the `price_card_<vertical>` insert
block (`insert into public.platform_settings (key, value) values (...)  on
conflict (key) do update set value = excluded.value, updated_at = now();`).
**Exact change:** add `"included_text_conversations":200,
"text_conversation_overage_cents":5` (matching
`20260911110000_channels_pricing_and_usage.sql`'s own defaults) into each
of the eight `price_card_<vertical>` jsonb literals in that file.
**Why this is a real, verified problem, not a hypothetical:** confirmed
directly in the same throwaway-Postgres harness above: migrations alone
correctly merge the two new keys into every `price_card_<vertical>` row
(idempotent `jsonb ||` merge, §13.3), but running `supabase/seed/seed.sql`
straight afterward — exactly what a local `supabase db reset` does — wipes
them back out, because seed.sql's own `on conflict (key) do update set
value = excluded.value` REPLACES the whole jsonb value with its own
literal, which doesn't have the two new keys:
```
 price_card_auto | {"base_cents": 29900, "overage_cents": 35, "included_minutes": 300}
```
(no `included_text_conversations`/`text_conversation_overage_cents` — confirmed empirically after applying both files in order). This cluster does not own `supabase/seed/seed.sql` and did not edit it directly.

---

## 3. `supabase/functions/webhooks-twilio-sms` + widget chat edge function — write into the new tables

**Requesting cluster:** S
**Target:** `supabase/functions/webhooks-twilio-sms/handler.ts` (existing)
and whichever edge function ends up serving the widget's chat mode.
**Exact change:** in addition to the existing `messages_inbound` write
(MASTER_SPEC §3.3, unchanged), also upsert/create a `text_conversations`
row (by `tenant_id + phone_e164 + channel='sms'`) and insert a
`text_messages` row for each inbound/outbound SMS turn — full contract in
`BACKEND_SPEC.md` §13.1's "How the two layers connect" subsection
(`messages_outbound_id` linkage for outbound delivery status,
`provider_message_id` = the Twilio SID for inbound). **Superseded by
request #1 above if Cluster T's single-table design is the one kept** —
in that case this request is moot and should be marked so by whoever
resolves #1, since Cluster T's own migration comment states its engine
(`_shared/text-agent/*.ts`) already owns this write path end to end.

---

## 4. Widget ↔ `api-text-chat` request/response contract (posted early per BUILD_PLAN's own instruction)

**Requesting/posting cluster:** W (website widget + dashboard)
**For:** whichever agent builds `supabase/functions/api-text-chat` (referred
to as "Cluster T" elsewhere in this file — `_shared/text-agent/engine.ts`'s
`handleInboundText`/`WebChatTurnInput` is already built and this is its
obvious HTTP entrypoint, but the function itself does not exist in the tree
yet as of this post). Cluster W's widget calls this function **directly
from the browser** (cross-origin, from an arbitrary tenant's own site) —
per this task's own ownership text ("Chat mode calls supabase function
api-text-chat"), not through an `apps/web` proxy — so two things beyond the
request/response shape are load-bearing and easy to miss:

**1. CORS.** The browser will send a preflight `OPTIONS` request and the
real `POST` cross-origin from whatever the tenant's site origin is (not
`app.heyloo.*`). The function must respond to `OPTIONS` with
`Access-Control-Allow-Origin` (echo the request `Origin` — never `*` if
credentials/cookies are ever added later, though this contract uses none),
`Access-Control-Allow-Methods: POST, OPTIONS`,
`Access-Control-Allow-Headers: content-type`, and include
`Access-Control-Allow-Origin` on the real response too. `verify_jwt` should
be `false` (there is no Supabase user session here at all) — auth is the
`widget_token` below, not a bearer JWT.

**2. Auth — `widget_token`.** `api-text-chat` must never trust a
client-supplied `tenant_id` directly (CLAUDE.md Rule 2). Cluster W's
`POST /api/widget/session` (origin-allowlist + `widget_public_key` checked
against `tenants.widget_settings.allowed_origins`/`tenants.widget_public_key`
first) mints a short-lived (15 min) HMAC-signed token via the existing
`WIDGET_TOKEN_SECRET` (`.env.example`, already present) — construction:
`base64url(JSON{tenant_id, widget_public_key, origin, iat, exp}) + "." +
hex(hmacSha256(secret, thatBase64urlPayload))`, exactly the
`encodeSignupDraft`/`SIGNUP_DRAFT_SECRET` pattern in
`apps/web/src/lib/signup/draft-cookie.ts`, ported to a bearer-token shape
instead of a cookie — reference implementation:
`apps/web/src/lib/widget/session-token.ts` (`mintWidgetToken`/
`verifyWidgetToken`). `api-text-chat` re-verifies this HMAC + expiry itself
(constant-time compare, `_shared/crypto.ts` already has `sha256Hex`/HMAC
primitives to port the same construction to Deno) before trusting the
`tenant_id` inside it — the token is the only thing standing between an
arbitrary site and free Anthropic calls against a tenant's text agent,
since the function itself is publicly reachable with `verify_jwt: false`.

**Request** (`POST {SUPABASE_URL}/functions/v1/api-text-chat`):
```
{
  "widget_token": string,          // see above; required every call
  "message": string,               // 1..2000 chars, the customer's chat text
  "conversation_token"?: string    // handleInboundText's own WebChatTurnInput.sessionToken —
                                    // omit on the first turn; echo back verbatim on every later turn
}
```

**Response 200**:
```
{
  "conversation_token": string,       // TextAgentTurnResult.widgetSessionToken — save and resend
  "reply": string | null,
  "sent": boolean,
  "reason"?: "human_handoff" | "a2p_not_verified" | "opted_out" | "rate_limited"
           | "closed" | "engine_error" | "verification_pending"
}
```
This is a direct passthrough of `TextAgentTurnResult` (`_shared/text-agent/
types.ts`) — `conversationId` is internal-only and not exposed to the
browser; `widgetSessionToken` is renamed `conversation_token` in the wire
shape only for naming clarity on the two different "token" concepts in
play (widget auth vs. conversation continuity). When `sent: false`, the
widget shows a neutral "we'll follow up" / "still setting up" state, never
a raw error — matching this codebase's graceful-fallback convention
(`_shared/responses.ts`).

**Response 4xx** (widget_token missing/invalid/expired, or `message`
fails validation): `{ "error": "invalid_widget_token" | "expired_widget_token"
| "invalid_request" }`. The widget's chat UI re-mints one `widget_token` (a
fresh `POST /api/widget/session`) and retries the send exactly once before
surfacing "chat is temporarily unavailable" to the visitor.

**Built against this contract (with the function itself not existing
yet):** `packages/widget/src/chat.ts` (fetch call + response handling),
`apps/web/src/lib/widget/session-token.ts` (the token both sides need —
please port its HMAC construction rather than inventing a second one).
Widget-side tests mock the fetch response against this exact shape; no
end-to-end run against a real `api-text-chat` was possible since it isn't
built yet. If the eventual real function's shape differs, the mismatch is
isolated to `packages/widget/src/chat.ts`'s response parsing (one file).

---

## 5. Dashboard "AI vs. human vs. customer" message authorship — blocked on request #1's unresolved conflict

**Requesting cluster:** W
**Target:** the eventual resolution of request #1 above (Cluster S's
`text_conversations` + `text_messages` — the latter has a per-row `author
('ai'|'human'|'customer')` column — vs. Cluster T's single
`text_conversations` table, which has no separate message-transcript table
or `author` column at all; SMS transcript stays in `messages_inbound`
(always customer-authored) / `messages_outbound` (no column distinguishing
an AI-generated reply from a dashboard operator's manual reply)).

This task's own brief (`dashboard/messages/** ... thread shows AI vs human
vs customer authors, 'Take over'/'Hand back to AI' controls`) is
**literally impossible to build correctly against Cluster T's schema as it
stands** — there is no data anywhere that records whether a given outbound
SMS was AI-generated or a human dashboard reply once request #1's
conflicting `20260911120000_text_conversations.sql` is the one kept, since
`messages_outbound` has no author-like column and Cluster T's design has no
`text_messages` table to add one to. Cluster S's `text_messages.author`
(§13.1 of `BACKEND_SPEC.md`, which this task's brief explicitly names as
required reading) is the only one of the two schemas that carries this
information at all today.

Per CLAUDE.md Rule 4, this task proceeds on the documented assumption that
Cluster S's `text_conversations`/`text_messages` shape (or a future
resolution of request #1 that preserves an `author`-tagged transcript
table — even one that supersedes `text_messages`'s exact name/columns) is
what dashboard/messages ends up reading, since it is the only currently-
existing schema that can satisfy this task's own literal requirement — see
`docs/BUILD_NOTES.md`'s Cluster W entry for exactly what was built against
it and what would need to change if request #1 resolves the other way.

---

## 6. Cluster T update — responses to items 1, 3, 4, 5 (2026-09-11)

**Requesting/posting cluster:** T (text-agent engine)

**Re item 1 (migration-filename conflict)**: confirmed independently —
`docs/BUILD_NOTES.md`'s Cluster T entry has the full verification detail
(a real throwaway Postgres 16 run, not just theorized). One ADDITIONAL
finding item 1's own comparison table didn't have visibility into:
`20260911101000_channels_tenant_and_call_log_columns.sql`'s
`call_logs.channel` (`'phone'|'web'`, default `'phone'`) is not actually
describing the SAME axis as this cluster's `call_logs.channel`
(`'voice'|'sms'|'web_chat'`, default `'voice'`) — Cluster S's column
distinguishes a real VOICE call's origination (a Twilio number vs. the
embeddable widget's voice mode), while this cluster's distinguishes
whether a `call_logs` row is a real call AT ALL vs. a shadow row this
cluster's engine creates for a text conversation. Both are genuinely
needed simultaneously — a `call_logs` row can be: a real PSTN voice call,
a real widget voice call, an SMS shadow row, or a web-chat shadow row.
Neither existing 2-value enum is wrong; the actual reconciled shape is
most likely a single 4-value `channel` column (`'phone'|'web_voice'|
'sms'|'web_chat'`, naming TBD) — a bigger structural change than "pick
one file, drop the other" as item 1's own recommendation assumed, and
still not something this cluster can arbitrate unilaterally (it doesn't
own Cluster S's migration and Cluster S's migration wasn't visible to
this cluster until this cluster went looking for the conflict item 1
flagged). Left as-is, same as item 1 already established, pending
orchestrator arbitration — flagged again in this task's own structured
`cross_cluster_requests`.

**Re item 3 (webhooks-twilio-sms + widget chat write into the new
tables)**: superseded — confirmed. This cluster's own engine
(`_shared/text-agent/*.ts`, wired into `webhooks-twilio-sms/handler.ts`
and the now-built `api-text-chat`) owns this write path end to end,
including a new full-transcript table (`text_conversation_messages`,
below) that supersedes the specific `text_messages` shape item 3
described, whichever `call_logs`/`usage_daily`/`text_conversations` shape
item 1 eventually keeps.

**Re item 4 (widget <-> api-text-chat contract)**: BUILT exactly as
posted. `api-text-chat` now exists, accepts `{widget_token, message,
conversation_token?}`, verifies `widget_token` server-side via a new
Deno-portable port of `apps/web`'s HMAC construction
(`_shared/text-agent/widget-token.ts`, cross-checked in
`widget-token.test.ts` against a token minted with Node's own
`node:crypto` the exact way `mintWidgetToken` does — not just round-
tripped against itself), responds to `OPTIONS` with the specified CORS
headers and echoes `Access-Control-Allow-Origin` on the real response,
and returns exactly `{conversation_token, reply, sent, reason?}` /
`{error:"invalid_widget_token"|"expired_widget_token"|"invalid_request"}`.
`packages/widget/src/api.ts`'s `sendChatMessage` and `packages/widget/src/
types.ts`'s `WidgetChatResponse`/`WidgetErrorResponse` should now work
against the real function unchanged — no request/response shape drift
found while implementing it.

**Re item 5 (dashboard AI/human/customer authorship — blocked on item
1)**: no longer fully blocked. New migration
`supabase/migrations/20260911130000_text_conversation_messages.sql`
(additive, self-contained — references only this cluster's own
`text_conversations` table content, deliberately does not touch
`call_logs`/`usage_daily` again) adds `text_conversation_messages
(id, tenant_id, conversation_id, author 'customer'|'ai'|'human', body,
created_at)` — the full, unbounded transcript for BOTH sms and web_chat,
which `text_conversations.recent_turns` (a bounded working-memory window)
and `messages_inbound`/`messages_outbound` (SMS-only, no author column)
never provided. `_shared/text-agent/conversation-store.ts`'s
`saveConversationPatch` writes a row here for every turn (author derived
from role: 'user' -> 'customer', 'assistant' -> 'ai'); the migration's own
RLS insert policy permits a tenant member/admin to insert `author='human'`
rows directly for their own tenant's conversations — the dashboard's
"take over"/reply write path (Cluster W's own UI) can build directly
against this without needing this cluster to build anything further.
Still genuinely blocked on item 1's resolution for the OTHER half of the
dashboard's data model (`text_conversations.status`/`ai_enabled`-shaped
fields, and whichever `call_logs`/`usage_daily` shape survives) — only the
message-authorship gap specifically is resolved.

---

## 6. `docs/DEPLOY.md` — widget build step + new edge function env vars

**Requesting cluster:** W
**Target:** `docs/DEPLOY.md`.
**Exact change, two additions:**

1. A note that `packages/widget` must be built (`pnpm --filter @heyloo/widget
   build`) BEFORE `apps/web`'s own build/deploy — `apps/web/src/app/
   widget.js/route.ts` and `.../widget-voice.js/route.ts` read
   `packages/widget/dist/{widget,voice-runtime}.global.js` from disk at
   request time (never `import`ed), so the widget serving routes 404 if
   that package hasn't been built into the same deploy. `apps/web/
   package.json` now lists `@heyloo/widget` as a `devDependency` (unused
   in code — added purely so turbo's own dependency graph, `build:
   {dependsOn: ["^build"]}` in `turbo.json`, orders the two builds
   correctly) and `apps/web/next.config.ts`'s new
   `outputFileTracingIncludes` entries pin those two dist files into a
   standalone build's traced output — both already verified working via a
   real `next build --webpack` in this task's own session (see
   `docs/BUILD_NOTES.md`'s Cluster W entry), so this is a docs-only gap,
   not a functional one.
2. `supabase/config.toml` already carries the new
   `[functions.api-widget-voice-token]` entry (`verify_jwt = false`, added
   by this task) — it needs the same `RETELL_API_KEY`/`WIDGET_TOKEN_SECRET`
   secrets `docs/DEPLOY.md`'s existing Supabase Edge Function secrets list
   already documents for other functions (`WIDGET_TOKEN_SECRET` is already
   listed there per this task's own env-var addition; `RETELL_API_KEY` is
   presumably already listed for the pre-existing Retell-touching
   functions) — worth a one-line cross-reference so whoever runs the actual
   deploy doesn't have to rediscover this function needs the same two
   secrets as `api-tenant-test-call`/`api-demo-agent`.

This cluster does not own `docs/DEPLOY.md` and did not edit it directly.

---

## 7. Update to item 4 — contract adopted, `api-text-chat` now exists and matches

**Posted by:** W
Cluster T's own `docs/BUILD_NOTES.md` entry ("CLUSTER T — Text agent
engine") confirms `supabase/functions/api-text-chat/**` now exists and was
rebuilt mid-task to match item 4's contract exactly —
`{widget_token, message, conversation_token?}` in,
`{conversation_token, reply, sent, reason?}` out — after discovering this
request. It also independently arrived at, and then adopted, this
cluster's own `_shared/widget-token.ts` (built for
`api-widget-voice-token`) rather than shipping a second copy of the same
HMAC-verification logic — confirmed directly in this session:
`_shared/widget-token.ts` is unchanged from what this cluster wrote, and
`api-text-chat/handler.ts` imports it verbatim. `packages/widget/src/
api.ts`'s `sendChatMessage`/`types.ts`'s `WidgetChatResponse` (built
against this contract before `api-text-chat` existed, per item 4's own
note) need no changes as a result — closing the loop this item opened.
Also worth noting for whoever resolves item 1: Cluster T's follow-up
`20260911130000_text_conversation_messages.sql` migration (additive, only
touches its own `text_conversations` table, never `call_logs`/
`usage_daily` again) fills the exact gap item 5 flagged — full detail in
`docs/BUILD_NOTES.md`'s own Cluster W entry rather than duplicated here.

## 8. Integrator resolution of items 1/6 (2026-09-11) + one new gap found while resolving it

**Posted by:** integrator pass (applying every unapplied request in this
file after clusters S/T/W finished).

**Item 1/6 (the migration collision) is RESOLVED.** Full detail in
`docs/BUILD_NOTES.md`'s "Integrator — Channels migration-collision
resolution" entry rather than duplicated here; short version: Cluster T's
`text_conversations`/`text_conversation_messages` design is kept (it's the
only one wired to working engine + dashboard code — independently
confirmed, not just asserted, before touching anything), `call_logs.channel`
is reconciled to a single 4-value enum (`'phone'|'web_voice'|'sms'|
'web_chat'`) per Cluster T's own recommendation in item 6, and
`usage_daily.text_messages_out` is now owned exclusively by Cluster T's
direct per-message increment (Cluster S's rollup-function version of that
column was silently resetting it to 0 on every cron run — a real bug, not
just a naming conflict, closed as part of this fix). Verified end-to-end
against a real throwaway Postgres 16: all 50 migrations + `seed.sql` apply
cleanly from zero, plus a live insert/upsert smoke test of the reconciled
columns. Item 2 (seed.sql price-card keys) and item 6 (DEPLOY.md widget
build step + secrets cross-reference) are also applied — see BUILD_NOTES.

**New gap found while verifying, not fixed in this pass** (RESOLVED —
see `docs/BUILD_NOTES.md`'s "REPAIR — Cluster S/W widget-voice
`channel='web_voice'` gap: fixed" entry; `voice-events/handler.ts`'s
`resolveTenantForCall` now falls back to `agent_id ->
agent_configs.retell_agent_id -> tenant_id` when `to_number` is absent,
and both insert paths tag `channel='web_voice'` on that path): a widget
**voice** call never reaches a tagged `call_logs` row at all, not just an
untagged one. `api-widget-voice-token/handler.ts` mints a Retell web-call
token but (by its own comment) relies on `voice-events` to create/tag the
`call_logs` row once Retell's webhook fires. But `voice-events/handler.ts`'s
`resolveTenantForCall` resolves the tenant by looking up `public.
phone_numbers` via `call.to_number` — a widget voice call has no
`to_number` (there's no Twilio number involved), so tenant resolution
almost certainly fails silently (`voice_events_call_started_unresolved_
tenant` warn-log, early return) for every widget voice call today, meaning
no `call_logs` row is created at all, `channel = 'web_voice'` never gets
set anywhere, and no usage/cost is recorded for widget voice calls. Fixing
this needs `voice-events` to resolve tenant via the Retell `agent_id` (or
similar) as a fallback when `to_number` is absent/unmatched — a real engine
change to `voice-events`, out of scope for an "apply the unapplied
requests" pass. Whoever owns the widget voice feature (or the next
Channels-adjacent build task) should pick this up; until then, widget voice
calls silently don't appear in the dashboard's call log at all (worth a
manual smoke test before advertising widget voice mode as usable).
