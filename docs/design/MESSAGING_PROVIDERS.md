# Messaging providers (SMS + email)

MESSAGING-1, 2026-09-29. How Heyloo sends and receives texts and emails
without core code knowing which vendor does it, how to switch vendors, what
each vendor needs from us, and what US carriers require no matter which
vendor we use.

## Why this exists

Nothing has ever been delivered. The Twilio account is blocked, the
`messages_outbound` worker required Twilio **and** Resend secrets together
(so email could not go out without Twilio), and both live numbers were
bought through Retell, so no provider account of ours can send from them.

The fix has two parts:

1. **A provider layer.** One interface, one adapter file per vendor, a
   registry that picks the vendor per message. Going from Telnyx (now) back
   to Twilio (later) is an env var plus a sender row, not a rewrite.
2. **Email as a first-class channel.** Resend needs no carrier approval,
   only a verified sending domain. Owner alerts go out by email today, and
   customer texts that can't be sent yet are copied to the owner by email.

## Layout

```
packages/canonical-types/src/messaging.ts          canonical types (Zod) — the contract
supabase/functions/_shared/providers/messaging/
  types.ts        port interfaces + Deno mirror of the canonical types
  registry.ts     provider selection, env wiring, fail-closed resolution
  telnyx.ts       Telnyx SMS adapter (send, Ed25519 webhooks, receipts)
  twilio.ts       Twilio SMS adapter (send, TwiML, receipts, 10DLC registration)
  twilio-signature.ts   X-Twilio-Signature verifier (moved, unchanged)
  resend.ts       Resend email adapter (send, idempotency, error classes)
  smtp.ts         SMTP email adapter: config validation, failure classes (MSG-3)
  microsoft-graph.ts  Microsoft Graph email adapter: token cache, sendMail, failure classes (EMAIL-MSGRAPH)
  smtp-client.ts  minimal SMTP-over-implicit-TLS client (EHLO/AUTH/DATA), injected socket
  smtp-message.ts RFC 5322 / MIME message builder (Message-ID, quoted-printable, RFC 2047)
  smtp-fake-server.ts   scripted SMTP server used by the tests only
  canonical-parity.test.ts   Deno mirror == canonical package
supabase/functions/_shared/owner-alerts.ts         owner alert kinds, preferences, producer helper
supabase/functions/_shared/sms-availability.ts     "can this tenant text right now" + what the model is told (MSG-3)
supabase/functions/auth-send-email/                Supabase Auth Send Email Hook: signature check, render, send through EmailProvider (EMAIL-MSGRAPH)
supabase/functions/_shared/auth-email/             renders each auth email (signup, recovery, invite, magic link, email change, reauthentication)
supabase/functions/_shared/standard-webhooks.ts    Standard Webhooks signature verifier (Web Crypto)
supabase/functions/worker-messages-outbound/       queue worker (uses only the interface)
supabase/functions/webhooks-sms/                   inbound + delivery receipts, any provider
supabase/functions/webhooks-twilio-sms/            legacy URL, thin alias of webhooks-sms (Twilio)
supabase/functions/api-a2p-register/               registration through SenderRegistrationApi
supabase/migrations/20260929150000_messaging_providers.sql
apps/web/.../dashboard/texting/                    owner-facing "Text messaging" setup page
apps/web/src/app/api/tenant/messaging/route.ts     GET status / PUT business details
```

Only files under `_shared/providers/**` read a vendor's field names
(`MessageSid`, `data.payload.to[].status`, Resend error `name`s, ...).
Everything else sees canonical types (CLAUDE.md Rule 2).

## The interface

```ts
interface SmsProvider {
  id: "telnyx" | "twilio";
  capabilities: MessagingProviderCapabilities;
  sendSms(req: SmsSendRequest): Promise<SendResult>;
  verifyInboundWebhook(req: RawWebhookRequest): Promise<WebhookVerification>; // raw body, fail closed
  parseInbound(req): CanonicalInboundSms | null;
  parseStatusCallback(req): CanonicalDeliveryStatus | null;
  webhookAck(replyBody?: string): WebhookAck;   // TwiML for Twilio, bare 200 for Telnyx
  registration?: SenderRegistrationApi;          // optional: submit/poll carrier registration
}

interface EmailProvider {
  id: "resend" | "smtp" | "microsoft_graph";
  capabilities: MessagingProviderCapabilities;
  sendEmail(req: EmailSendRequest): Promise<SendResult>;
}
```

Canonical types (`packages/canonical-types/src/messaging.ts`):

| Type | Shape |
|---|---|
| `SmsSendRequest` | `{to, from (both E.164), body, idempotencyKey, statusCallbackUrl?}` |
| `EmailSendRequest` | `{to, from, subject, html, text, idempotencyKey, replyTo?}` |
| `SendResult` | `{ok: true, providerMessageId}` or `{ok: false, failure: permanent\|transient\|deferred, httpStatus, errorCode, detail, retryAfterSeconds?}` |
| `CanonicalInboundSms` | `{provider, eventId, providerMessageId, fromE164, toE164, body, providerHandledKeyword: stop\|start\|help\|null}` |
| `CanonicalDeliveryStatus` | `{provider, eventId, providerMessageId, status: queued\|sending\|sent\|delivered\|undelivered\|failed, errorCode}` |
| `SenderRegistration` | `{kind: toll_free\|10dlc\|short_code, status: not_submitted\|submitted\|in_review\|verified\|failed, failureReason}` |

Capability flags:

| Flag | Telnyx | Twilio | Resend | SMTP | Graph | Used for |
|---|---|---|---|---|---|---|
| `syncWebhookReply` | no | yes (TwiML) | — | — | — | reply inline vs queue the reply |
| `deliveryReceipts` | yes | yes | not consumed yet | no (acceptance only) | no (`202` = accepted only) | ask for status callbacks |
| `nativeOptOutHandling` | yes | yes | — | — | — | provider blocks sends after STOP |
| `senderRegistrationApi` | no (portal for now) | yes (legacy 10DLC) | — | — | — | `api-a2p-register` |
| `senderKinds` | toll_free, 10dlc | 10dlc, toll_free, short_code | — | — | — | documentation |

Failure classes: **permanent** (bad recipient, opted out, sender not
allowed) marks the row `failed` at once; **transient** (5xx, 429, network)
throws so the queue retries and dead-letters after 5 attempts; **deferred**
(Resend daily/monthly quota) parks the message for `retryAfterSeconds`
without spending an attempt.

## Choosing a provider

Per message, most specific first:

1. the sending number's own provider, `messaging_senders.provider` (a number
   can only be sent from the account that owns it);
2. the tenant override, `tenants.sms_provider`;
3. the platform default, `SMS_PROVIDER` env (default `telnyx`).

Email: `EMAIL_PROVIDER` (`resend` by default, `smtp` for the owner's own
mailbox over implicit TLS, `microsoft_graph` for a Microsoft 365 mailbox over
HTTPS) plus `EMAIL_FROM_ADDRESS` (`RESEND_FROM_ADDRESS` still accepted).

The registry **fails closed**. If the chosen provider has no secrets it
resolves to `provider_not_configured`; it never silently falls back to a
different vendor. The worker then **parks** the message: re-enqueues it
with a 15-minute delay (fresh `read_ct`, so parking never burns retry
attempts) until the row is 24 hours old, then dead-letters it with reason
`provider_not_configured` and marks the row `failed`. With no provider
configured at all, the OPS-8 sweep runs unchanged (never reads the queue,
dead-letters after 24 hours). With email alone configured, the leg runs.

## What the worker does with each row

- **Owner alerts** (`take_message`, `after_hours_message`, `owner_new_booking`,
  `owner_new_order`, `owner_urgent_call`, `owner_missed_transfer`): re-planned from the
  tenant's current preferences (see below). SMS to the alert phone when
  texting is on and the sender is approved, plus an idempotent email copy
  (`parent_message_id`) when email is on too. If SMS can't go out yet, the
  alert goes by email instead: never silently dropped.
- **Customer SMS**: recipient normalized to E.164 (unparseable → `failed`,
  `invalid_recipient_phone`, never sent), opt-out check on the normalized
  number, then the tenant's sender. Not approved yet → the owner gets an
  email: "Text to +1... not sent yet — copy for you" (the BACKEND_SPEC
  §10.1 A2P fallback, now readable). Replies to an inbound text
  (`sms_reply`, `text_agent_reply`) are exempt from that reroute; the STOP
  confirmation and the HELP answer are exempt from the opt-out check (the
  provider's own block rule still applies). A one-time code
  (`chat_phone_verification`) is never rerouted to the owner.
- **Email**: to the row's recipient, HTML-escaped body,
  `messages_outbound.id` as the Resend `Idempotency-Key` (over SMTP, which has
  no such key, as the stable `Message-ID`; see "Email over SMTP").
- An unknown template (renders to an empty body) fails at once with
  `empty_rendered_body:<key>`; nothing empty is ever sent.
- **Stranded rows**: every tick, rows 2 minutes to 24 hours old in
  `queued`/`pending_verification` with no queue message (written by
  `send_sms_confirmation`, `fn_notify_waitlist_on_cancellation` and
  `dental-intake.ts`, none of which enqueue) are flipped to `queued` and
  enqueued, 50 per tick. Older rows are history and are left alone.

`messages_outbound` now records `provider` (who sent it), `sent_via` (the
channel it actually went out on: `channel=sms, sent_via=email` means
rerouted to the owner) and `delivered_at`.

## Owner alerts

| Event | Template | Producer |
|---|---|---|
| Message taken | `take_message` | `voice-tools/take_message` (VOICE-ALERTS-1: via `enqueueOwnerAlert`, whether or not a transfer number is set) |
| New booking | `owner_new_booking` | `voice-tools/create_booking` right after the booking commits (deferred past the response); `voice-events` `call_analyzed` sends the same alert for a booking made on the call, deduped per booking |
| New order | `owner_new_order` | `voice-tools/create_order` after the order commits (deferred past the response) |
| Urgent / emergency call | `owner_urgent_call` | `voice-events` `call_analyzed` (`emergency_detected` or classification `emergency`) |
| Missed transfer | `owner_missed_transfer` | `voice-events` `call_analyzed` (`disconnection_reason = transfer_cancelled`) |

Test calls never alert. Each alert is idempotent per booking or order when one is attached, else per (call, kind).

Preferences live at `agent_configs.dynamic_variable_overrides.delivery`
(canonical `deliveryPreferencesSchema`; written by the dashboard Delivery
page / `POST /api/tenant/settings/notifications`):

| Field | Meaning | Default |
|---|---|---|
| `sms_enabled` | text the owner | on |
| `email_enabled` | email the owner | on |
| `alert_phone` | where texts go | the agent's transfer number |
| `notification_email` | where emails go | the account owner's sign-in email |

Both on = both channels. Both off = the alert is recorded as
`owner_alerts_disabled` (still visible in the dashboard). SMS on but not
possible yet = email.

## Email over SMTP (MSG-3)

Owner decision: email is sent from the owner's own domain mailbox, not a
transactional-email API. `EMAIL_PROVIDER=smtp` selects the `smtp` adapter;
owner steps are in `docs/SETUP_EMAIL.md`.

| Variable | Meaning |
|---|---|
| `SMTP_HOST` | bare host name (`smtp.gmail.com`, `smtp.zoho.com`) |
| `SMTP_PORT` | default `465`; **25 and 587 are rejected at configuration time** |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | the mailbox and its app password |
| `EMAIL_FROM_ADDRESS` | the same mailbox (or an alias it may send as), ASCII |

- **Why 465 only.** Supabase Edge Functions block outgoing ports 25 and 587
  (supabase.com/docs/guides/functions/limits), so STARTTLS submission cannot
  work. The client speaks implicit TLS (RFC 8314) and always verifies the
  server certificate. An unusable `SMTP_PORT` makes the provider "not
  configured" with `SMTP_PORT (outgoing ports 25 and 587 are blocked ...)`
  in the registry's `missing()` list, rather than a connection that hangs.
- **Why a hand-written client.** `npm:nodemailer` (Supabase's own example)
  and `deno.land/x/denomailer` both run on the edge runtime, but neither can
  be driven by a fake server under this package's Node/Vitest harness, and
  denomailer is unversioned. `smtp-client.ts` is about 300 lines with no
  dependency and takes its socket as an injected `SmtpConnector`; the only
  runtime-specific line is `connectDenoTls` (`Deno.connectTls`, which both
  libraries use underneath). It was also run unmodified under Deno 2.9.6
  with `supabase/functions/deno.json` against a local TLS server
  (docs/VERIFY.md MSG-3).
- **Protocol.** Greeting, `EHLO`, `AUTH PLAIN` (initial response, 334
  fallback) or `AUTH LOGIN`, `SIZE` check, `MAIL FROM`, `RCPT TO`, `DATA`
  with CRLF normalization and dot-stuffing, `QUIT`. Timeouts: 10 s connect,
  15 s per reply, 30 s for the whole conversation. One connection per
  message; nothing is pooled.
- **Message.** RFC 5322 headers (`Date`, `From`, `To`, `Reply-To`, `Subject`,
  `Message-ID`, `MIME-Version`, `Auto-Submitted: auto-generated`),
  `multipart/alternative` text then HTML, quoted-printable UTF-8 bodies,
  RFC 2047 encoded subject and display name. Pure ASCII, so no SMTPUTF8 or
  8BITMIME needed; CR/LF/control characters can never reach a header or an
  SMTP command.
- **No idempotency key in SMTP.** The `Message-ID` is derived from
  `idempotencyKey` (`<messages_outbound.id@from-domain>`), so a retry after
  an ambiguous failure (connection lost after `DATA`, before the `250`)
  carries the same id and the receiving mailbox can discard the duplicate.
- **Failure classes.** Credentials rejected (535/534/530/538 at `AUTH`):
  **permanent**, `smtp_auth_failed`. 5xx at `MAIL FROM`/`RCPT TO`/`DATA`:
  **permanent** (`smtp_550`, ...). Our own config problems (no PLAIN/LOGIN
  offered, bad from address, empty body): **permanent**. 4xx (including 454
  "temporary authentication failure" and 421): **transient**. Timeouts,
  dropped connections, unparseable replies: **transient**. `550 5.4.5` /
  "daily sending limit exceeded": **deferred**, one hour (the worker parks
  the message instead of burning attempts).
- **What it cannot do.** Delivery status: a `250` means the mailbox provider
  accepted the message, not that it reached the inbox; bounces arrive in the
  sending mailbox. Microsoft 365 (`smtp.office365.com`) is not usable: its SMTP
  AUTH only offers 587/25. Google Workspace and Zoho both offer 465.

## Email over Microsoft Graph (EMAIL-MSGRAPH)

Owner decision: **all** email goes through the owner's Microsoft 365 mailbox
(`ms@heycuey.com` on `heycuey.com` for testing). Supabase Edge Functions block
outgoing ports 25 and 587 and Microsoft 365 only offers those for SMTP, so the
`microsoft_graph` adapter uses HTTPS only. `EMAIL_PROVIDER=microsoft_graph`
selects it; owner steps (Entra app, Exchange RBAC restriction, secret, DNS) are
in `docs/SETUP_EMAIL_MICROSOFT.md`.

| Variable | Meaning |
|---|---|
| `MS_TENANT_ID` | Entra directory (tenant) ID GUID, or a verified domain name |
| `MS_CLIENT_ID` | the app registration's Application (client) ID GUID |
| `MS_CLIENT_SECRET` | the client secret value (expires: max 24 months) |
| `EMAIL_FROM_ADDRESS` | the sending mailbox's own address, optionally `Name <addr>` (the name is the display name) |

- **Token.** `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`,
  form body `client_id`, `scope=https://graph.microsoft.com/.default`,
  `client_secret`, `grant_type=client_credentials`. The token is cached in
  module scope until **5 minutes before** its `expires_in`, requests in flight
  share one round trip, and a token that lives less than 5 minutes is not
  cached. There are no refresh tokens in this flow, so "refresh" is a new
  request.
- **Send.** `POST https://graph.microsoft.com/v1.0/users/{mailbox}/sendMail`,
  JSON `{message, saveToSentItems: false}`, `202 Accepted` with no body. The
  `providerMessageId` is `msgraph:<request-id header>` (falling back to our own
  `client-request-id`), because Graph returns no message id. The adapter only
  ever sends as the configured mailbox: a different `from` is a permanent
  `from_not_sending_mailbox`, never an attempt.
- **Body strategy.** Graph's JSON form takes **one** body. The request's `html`
  is sent as `HTML`; every HTML body in the repo is a simple layout whose links
  are also printed as text, so it reads in text-only clients. An empty `html`
  falls back to the `text` as a `Text` body. Real `multipart/alternative` would
  need the base64 MIME form of `sendMail`; we do not use it (it would put our
  own MIME builder in front of Graph's parser, and we cannot test that against
  a live tenant from CI). Revisit if deliverability data asks for it.
- **Failure classes.** `401`: get a new token and retry **once**, then
  permanent (`ms_unauthorized`). `403`: permanent `ms_forbidden` with an
  owner-facing reason (no `Mail.Send` access for this mailbox: RBAC role
  assignment missing or scoped elsewhere). `404`: permanent
  `ms_mailbox_not_found`. `429` and `503`: **deferred** for the `Retry-After`
  seconds (or an HTTP-date; default 60 s; capped at 1 h), which the worker
  turns into a park without spending an attempt. Other 5xx, 408, 409, 423,
  timeouts (2.5 s per request) and network errors: transient. `400` and other
  4xx: permanent. Token endpoint: `invalid_client` / `AADSTS7000215`,
  `AADSTS7000222` (expired secret), `AADSTS700016` (unknown app),
  `AADSTS90002` (unknown tenant): permanent, each with the fix in the message;
  429/503 deferred; 5xx transient. Secrets and tokens are never in a `detail`.
- **No idempotency key.** `sendMail` has none. A request that times out after
  Graph accepted it and is then retried can deliver twice. The 2.5 s timeouts
  keep that window small.
- **Limits that matter.** Exchange Online: 10,000 recipients per day and 30
  messages per minute per mailbox, plus the tenant external-recipient limit
  (5,000 per day on a trial tenant). Exchange Online is not built for bulk mail.
- **Least privilege.** The app must not hold the Entra `Mail.Send` grant: that
  lets it send as anyone. It gets the Exchange RBAC for Applications role
  `Application Mail.Send`, scoped to the one mailbox
  (`docs/SETUP_EMAIL_MICROSOFT.md` Step 2).

## Supabase Auth emails: `auth-send-email` (EMAIL-MSGRAPH)

Supabase's built-in mailer is replaced, not supplemented: with the Send Email
Hook enabled, Auth POSTs every account email to
`/functions/v1/auth-send-email`, which sends it through the **same
`EmailProvider` port** as owner alerts (Graph, SMTP or Resend all work).

```
Auth --POST--> auth-send-email
   1. standardwebhooks signature over the RAW body (SEND_EMAIL_HOOK_SECRET, fail closed)
   2. zod payload  {user, email_data{token, token_hash, token_new, token_hash_new, redirect_to, email_action_type, site_url}}
   3. render       _shared/auth-email/compose.ts  (one or two emails)
   4. send         registry.resolveEmail() -> provider.sendEmail(...)   (4.2 s of Auth's 5 s budget)
   5. answer       200 {}  |  {"error": {"http_code": n, "message": "..."}}
```

| `email_action_type` | verifyOtp `type` in the link | lands on (`next`) |
|---|---|---|
| `signup` | `email` | `/signup/resume` |
| `recovery` | `recovery` | `/reset-password/confirm` |
| `invite` | `invite` | `/dashboard` |
| `magiclink` | `magiclink` | `/dashboard` |
| `email` (OTP) | `email` (the code is shown too) | `/signup/resume` |
| `email_change` | `email_change` | `/dashboard` |
| `reauthentication` | no link, the 6-digit `token` only | n/a |
| `*_notification` (7 types, only if enabled in the project) | no link, a short notice | n/a |

`email_changed_notification` is addressed to `email_data.old_email` (the
address the account had BEFORE the change), not to `user.email`: by then
`user.email` is the new address, and the point of the notice is to warn the
previous one (confirmed against the supabase/auth mailer source, which sends it
to `oldEmail`). Without a usable `old_email` nothing is sent and the hook
answers 400. The other six notifications go to `user.email`.

Links are `{site_url}/auth/confirm?token_hash=<hash>&type=<type>&next=<path>`,
the same shape as `supabase/templates/*.html`. `next` is the `next` of the
app's own `redirect_to` (`<origin>/auth/confirm?next=...`) when it is a safe
same-origin path, else the default above.
`apps/web/src/app/auth/confirm/route.ts` accepts every type in the table (a
test reads the route's `VALID_TYPES`).

- **Email change.** Supabase's field names are reversed: `token_hash_new` goes
  with the **current** address (`user.email`) and `token`, `token_hash` with the
  **new** address (`user.new_email`) and `token_new`. With Secure Email Change
  on, both pairs are present and two emails go out (both must be confirmed);
  with it off, one email goes to the new address.
- **Templates stay in one place.** The renderer's HTML mirrors
  `supabase/templates/*.html`; `compose.test.ts` compares them (whitespace
  aside) so they cannot drift, and compares the subjects with
  `supabase/config.toml`. `reauthentication.html` was added for parity.
- **Errors.** Bad or missing signature: 401. Missing `SEND_EMAIL_HOOK_SECRET`
  or unconfigured provider: 500 (retrying cannot help). Provider throttling:
  429 with `Retry-After`. Provider slow or transient: 503 (Auth retries 429 and
  503 up to three times, but inside ONE 5-second budget shared with the first
  attempt, and this function already uses up to 4.2 s, so in practice a
  throttled or slow send is not retried and the user has to ask for the email
  again). Permanent provider failure: 500. Bad payload or an
  unknown `email_action_type`: 400. The message returned to Auth is generic;
  the real reason (`ms_forbidden`, ...) is in the function logs and Sentry.
- **Idempotency.** Each email carries `auth-email:<webhook-id>:<slot>`; Resend
  honours it. Graph and SMTP do not, so a retried hook can deliver twice.
- **Switching on/off.** `scripts/enable-auth-email-hook.ts` (dry-run default,
  `--apply`, `--disable --apply`). Local development: the commented
  `[auth.hook.send_email]` block in `supabase/config.toml`.

## No promise of a text without texting (MSG-3)

Owner decision: phone numbers are Retell-provided and there is **no texting
provider at launch** (no Telnyx/Twilio keys). Every live tenant is
`a2p_status = pending_verification` with no `messaging_senders` row. So the
product must never *say* it is texting.

**One definition of "can text".** `supabase/functions/_shared/sms-availability.ts`
(`resolveSmsRoute` moved out of the worker so both sides share it): a tenant can
text a customer only when it has a **carrier-verified** sender
(`messaging_senders.registration_status = 'verified'`; legacy fallback: primary
number + `tenants.a2p_status = 'verified'`) **and** that sender's provider
resolves in the registry (secrets set). `isSmsAvailable` is exactly the worker's
`resolveSmsRoute(..., { requireVerified: true }).ok`, so the tool-time answer can
never disagree with what the worker would do.

| Where | What changed |
|---|---|
| `voice-tools` `send_sms_confirmation` | `{ queued: false, reason: "sms_unavailable", texting_available: false, message }` and **nothing is queued** (no owner "text not sent" copy either). The message tells the model no text was sent and to confirm out loud. One indexed statement, asked only by the three text-promising tools (`send_sms_confirmation`, `send_payment_link`, `join_waitlist`), never by the other tools. |
| `send_payment_link` | Same answer, before any Stripe Checkout Session is created. |
| `join_waitlist` | Still joins; the result carries `texting_available: false` and a note not to promise a text. |
| `voice-inbound` | Per call `sms_enabled` (`"true"`/`"false"`) and `texting_policy_text`, dispatched in parallel with the customer lookup; a failed lookup reads as OFF, never delays the call. |
| Compilers (`template-compiler.ts` and the Node `owner-info.ts`, byte-identical) | The owner-info block carries `Text messages right now: {{texting_policy_text}}` (outside the owner-data fence; owner text cannot override it). `default_dynamic_variables` default to OFF, so a web call that never ran `/voice-inbound` is safe. `AGENT_COMPILER_VERSION` 1 -> 2 (the portal flags agents compiled before it). |
| Templates (`packages/templates` and the seeds copy) | Every line that promised a text is conditional ("if text messages are available"): confirmation states, the consent ask (asks only about calls when texting is off), the waitlist offer ("get in touch", "text you" only if available), the secure-link fallback, the dental form link, motel deposit link, restaurant prepayment link, and the `send_sms_confirmation` / `send_payment_link` / `join_waitlist` tool descriptions. |
| Text agent (SMS + web chat) | Same block and the same reused fragments; `engine.ts` resolves `texting_policy_text` per turn (SMS conversation = on; web chat = on only when the tenant is verified); `send_payment_link` answers `sms_unavailable` for an unverified web chat. |
| Portal | `/dashboard/texting`, Delivery preferences, the account and settings checklists, and the booking/order toasts say texting is off until set up and never claim a customer was texted or a link re-sent by SMS. |

**Red team.** `packages/templates/src/red-team/texting-lint.ts` is a sentence-level
checker: `findUngatedTextInstructions` (authored prompt text must gate every
send/offer/promise of a text on availability or be a prohibition) and
`findTextPromises` (no sentence may commit to or report a text, English or
Spanish). It runs over the canonical templates, and
`supabase/functions/_shared/compiler/texting-red-team.test.ts` runs it over every
seeded vertical x every compile target x both languages, rendered with the
per-call variables exactly as Retell substitutes them, over the text agent's
prompt and tools, and over every model-facing tool answer. It also pins the seeds
copy to the package's wording and the compiler defaults to the runtime constants.

**Owner alerts.** They already re-plan at send time: SMS only when the alert phone
exists, the sender is verified and its provider is configured; otherwise **email**
(even if the owner turned the email toggle off, because they asked to be alerted).
`worker-messages-outbound/handler.email-only.test.ts` drives every alert kind
through the real SMTP provider against the fake server for the launch state, the
verified-but-no-provider state, both preferences, a missing owner address (marked
failed with a reason, never "sent"), bad credentials, a transient 4xx, the daily
limit and an unconfigured mailbox.

**Known gaps (not changed here).** `create_order` still queues an
`order_confirmation` text on every order and the waitlist trigger, reminders and
review requests still queue texts; without a sender the worker turns each into an
"X not sent yet, copy for you" email to the owner (their reroute wording still says
"carrier approval pending"). The public home page still illustrates a confirmation
text (its pricing note already says texts start after carrier approval).

## Inbound texts and delivery receipts

```
POST /functions/v1/webhooks-sms/<provider>          inbound messages (and Telnyx receipts)
POST /functions/v1/webhooks-sms/<provider>/status   delivery receipts
POST /functions/v1/webhooks-twilio-sms              legacy Twilio inbound URL (alias)
```

Pipeline: the adapter verifies the signature on the raw body (503 when the
provider or its webhook secret isn't configured, 401 on a bad signature) →
parses to a canonical inbound message or receipt → `webhook_events`
dedup (`<provider>_sms` / `<provider>_sms_status`, `twilio_sms` unchanged) →
ack.

- **Twilio** (`syncWebhookReply`): processed inline and the reply goes back
  as TwiML, exactly as before.
- **Telnyx**: must get a 2xx within 2 seconds, so it is acked immediately
  and processed with `EdgeRuntime.waitUntil`; any reply becomes a queued
  `messages_outbound` send.
- **STOP/START/HELP**: opt-out state is always recorded, including when the
  provider matched the keyword itself (Telnyx `autoresponse_type`, also set
  by its opt-out intent classifier). That field marks a keyword **match**,
  not a reply: Telnyx's developer docs say it sends no auto-reply unless
  one is configured, and neither Telnyx source documents a default HELP
  reply. So HELP and START are always answered by us; only our STOP
  confirmation is skipped when Telnyx matched STOP, because its block rule
  would reject it (`40300`) and the provider / toll-free network sends its
  own. Configure the messaging profile's STOP auto-response in Telnyx
  (Advanced Opt-In/Out) so 10DLC numbers also confirm opt-outs.
- The number texted resolves the tenant: `messaging_senders.e164` first,
  then `phone_numbers.e164`.
- Receipts only change terminal state: `delivered` sets `delivered_at`;
  `undelivered`/`failed` set `failed` with `<provider>:delivery_<status>:<code>`
  (e.g. Twilio `30034` unregistered 10DLC, Telnyx `40008`). A delivered
  row is never downgraded.

## Switching provider

**Today (Telnyx):**

1. Create the Telnyx account and finish account verification (some
   messaging features need Telnyx "Level 2").
2. Create a messaging profile. Set its webhook URL to
   `https://<ref>.supabase.co/functions/v1/webhooks-sms/telnyx`.
3. Buy one toll-free number per tenant (SMS only; voice stays on the
   Retell number) and assign it to the profile.
4. Submit toll-free verification for that number with the tenant's details
   from `messaging_business_profiles` (the owner fills them in on
   /dashboard/texting). Telnyx: portal, or `POST /public/api/v2/requests`
   (not automated yet).
5. Insert the sender:
   `insert into messaging_senders (tenant_id, provider, e164, kind, registration_status) values (<tenant>, 'telnyx', '+1888...', 'toll_free', 'submitted');`
   Set `registration_status = 'verified'` when approved (this also flips
   `tenants.a2p_status`, which the text agent and dashboard read).
6. Secrets: `SMS_PROVIDER=telnyx`, `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`
   (base64 Ed25519 key from Mission Control → Keys & Credentials),
   optional `TELNYX_MESSAGING_PROFILE_ID`, `WEBHOOKS_SMS_BASE_URL`.
7. Email now: `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` on a Resend-verified
   domain, **or** (owner decision, MSG-3) `EMAIL_PROVIDER=smtp` with the
   `SMTP_*` secrets for the owner's own mailbox (`docs/SETUP_EMAIL.md`).
   Either alone turns on owner alerts by email.

**Back to Twilio later:** set `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`, point
the Twilio number's messaging webhook at `/webhooks-sms/twilio`, and either
insert `messaging_senders` rows with `provider = 'twilio'` (per number),
set `tenants.sms_provider = 'twilio'` (per tenant) or `SMS_PROVIDER=twilio`
(platform). No core or web code changes. Both providers can run side by
side, each tenant on its own.

**Adding a provider** (e.g. Plivo): one adapter file implementing
`SmsProvider`, add its id to `SMS_PROVIDER_IDS` in both type files (the
parity test enforces they match) and its required env vars to
`PROVIDER_REQUIRED_ENV`. Nothing else.

## What each provider needs from us

| | Telnyx | Twilio | Resend | SMTP (owner mailbox) | Microsoft Graph (owner's Microsoft 365) |
|---|---|---|---|---|---|
| Account | Telnyx account, verification (Level 2 for some messaging) | usable Twilio account (currently blocked) | account + verified sending domain (DNS) | a mailbox on Google Workspace or Zoho, an app password, SPF/DKIM/DMARC | a Microsoft 365 mailbox, an Entra app registration restricted to it (Exchange RBAC for Applications), a client secret, SPF/DKIM/DMARC |
| Secrets | `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` | `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `EMAIL_FROM_ADDRESS` | `EMAIL_PROVIDER=microsoft_graph`, `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `EMAIL_FROM_ADDRESS` |
| Webhook | messaging profile → `/webhooks-sms/telnyx` | number/Messaging Service → `/webhooks-sms/twilio` | none consumed yet | none | none |
| Sender | toll-free (verified) or 10DLC (brand + campaign) in our account | same, in our account | — | the mailbox itself (`alerts@<domain>`) | the mailbox itself (`ms@<domain>`) |
| Owner must give | legal name, EIN, address, contact, expected volume (the opt-in flow is ours: the AI asks consent on the call) | same | nothing | the mailbox, its app password, DNS access for SPF/DKIM/DMARC | tenant ID, client ID, client secret (via the Supabase secrets page), admin access to Entra and Exchange Online (GoDaddy-managed tenants may need defederation first) |
| Time to first text | toll-free: Telnyx says 1–2 weeks (help center: usually ≤5 business days) | toll-free ~3–5 business days; 10DLC vetting up to 5 business days + brand, 2–3+ weeks in backlogs | same day | same day (DNS records can take up to 48 h to settle) | same day once the RBAC scope has propagated (30 minutes to 2 hours) |
| Price (per research, verify before quoting) | $0.0055/part TF, $0.004 10DLC, + carrier fees | $0.0083/segment + carrier fees; TF number $2.15/mo | free 3,000/mo (100/day); Pro $20/mo for 50k | the mailbox seat; Google Workspace caps `smtp.gmail.com` at 2,000 messages/day | the mailbox licence; 10,000 recipients/day and 30 messages/minute per mailbox |

## Carrier registration: the truth

These are **carrier rules**; every provider must enforce them.

- Texting US handsets from a 10-digit number needs a TCR **brand plus a
  vetted campaign**. Unregistered or pending 10DLC traffic is blocked.
- A platform like ours (ISV/reseller) must register **each end business as
  its own brand**. One shared platform brand with per-tenant campaigns
  (what `api-a2p-register`'s legacy Twilio flow does with
  `TWILIO_A2P_BRAND_SID`) will be rejected. It is kept only for parity.
- Toll-free numbers need **toll-free verification** instead, carrying the
  end business's details. A Business Registration Number (EIN for US) is
  mandatory for new submissions since 2026-02-17.
- So onboarding must collect each tenant's exact IRS legal name, EIN (or
  sole-proprietor status), address, website and opt-in wording for **any**
  SMS path. That is the /dashboard/texting form. Telnyx's toll-free page
  lists the corporate website as required; the form keeps it optional, so
  ops must ask for it before submitting.
- Reported (third-party, not yet confirmed on a carrier or Telnyx page):
  toll-free submissions after 2026-09-15 also need a live privacy-policy
  URL (no sharing of consumer data for marketing) and terms URL with an SMS
  disclosure. Ours are the platform's `A2P_PRIVACY_POLICY_URL` /
  `A2P_TERMS_URL` pages; confirm they meet that wording.

What varies by provider: fees, review queues, APIs, account KYC, and how a
*pending* toll-free number is treated (Twilio hard-blocks it; Telnyx says
limited and filtered).

Fastest compliant path: a dedicated SMS-only **toll-free** number per
tenant, verified with the tenant's own details. Retell's native SMS is not
an alternative: it can't send our queued templates (reminders, owner
replies, post-call confirmations), needs the same carrier registration, and
doesn't support toll-free. The long-term "same number for voice and text"
setup is to own the number in our Telnyx/Twilio account, import it into
Retell over SIP, and register 10DLC per tenant on it.

## Open items

- Automate Telnyx toll-free verification submission/polling
  (`senderRegistrationApi` is false for Telnyx today).
- Resend delivery webhooks (Svix-signed) are not consumed.
- Microsoft Graph: certificate credentials instead of a client secret; a real
  `multipart/alternative` body through the MIME form of `sendMail`; a
  bounce reader for the sending mailbox. VERIFY items: docs/VERIFY.md
  "EMAIL-MSGRAPH".
- Plivo adapter not built (research: fine second choice).
- VERIFY items: docs/VERIFY.md "MESSAGING-1".
