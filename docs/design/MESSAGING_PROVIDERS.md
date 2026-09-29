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
  canonical-parity.test.ts   Deno mirror == canonical package
supabase/functions/_shared/owner-alerts.ts         owner alert kinds, preferences, producer helper
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
  id: "resend";
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

| Flag | Telnyx | Twilio | Resend | Used for |
|---|---|---|---|---|
| `syncWebhookReply` | no | yes (TwiML) | — | reply inline vs queue the reply |
| `deliveryReceipts` | yes | yes | not consumed yet | ask for status callbacks |
| `nativeOptOutHandling` | yes | yes | — | provider blocks sends after STOP |
| `senderRegistrationApi` | no (portal for now) | yes (legacy 10DLC) | — | `api-a2p-register` |
| `senderKinds` | toll_free, 10dlc | 10dlc, toll_free, short_code | — | documentation |

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

Email: `EMAIL_PROVIDER` (default `resend`) plus `EMAIL_FROM_ADDRESS`
(`RESEND_FROM_ADDRESS` still accepted).

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
  `owner_urgent_call`, `owner_missed_transfer`): re-planned from the
  tenant's current preferences (see below). SMS to the alert phone when
  texting is on and the sender is approved, plus an idempotent email copy
  (`parent_message_id`) when email is on too. If SMS can't go out yet, the
  alert goes by email instead: never silently dropped.
- **Customer SMS**: opt-out check, then the tenant's sender. Not approved
  yet → the owner gets an email: "Text to +1... not sent yet — copy for
  you" (the BACKEND_SPEC §10.1 A2P fallback, now readable). Replies to an
  inbound text (`sms_reply`, `text_agent_reply`) are exempt from that
  reroute; the STOP confirmation is exempt from the opt-out check.
- **Email**: to the row's recipient, HTML-escaped body,
  `messages_outbound.id` as the Resend `Idempotency-Key`.
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
| Message taken | `take_message` | `voice-tools/take_message` (row to the transfer number) |
| New booking | `owner_new_booking` | `voice-events` `call_analyzed` (booking with this call as `source_call_id`) |
| Urgent / emergency call | `owner_urgent_call` | `voice-events` `call_analyzed` (`emergency_detected` or classification `emergency`) |
| Missed transfer | `owner_missed_transfer` | `voice-events` `call_analyzed` (`disconnection_reason = transfer_cancelled`) |

Test calls never alert. Each alert is idempotent per (call, kind).

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
- **STOP/START/HELP**: opt-out state is always recorded. When the provider
  already handled the keyword (Telnyx `autoresponse_type`, including its
  opt-out intent classifier), we do not send a second confirmation.
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
   domain. This alone turns on owner alerts by email.

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

| | Telnyx | Twilio | Resend |
|---|---|---|---|
| Account | Telnyx account, verification (Level 2 for some messaging) | usable Twilio account (currently blocked) | account + verified sending domain (DNS) |
| Secrets | `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` |
| Webhook | messaging profile → `/webhooks-sms/telnyx` | number/Messaging Service → `/webhooks-sms/twilio` | none consumed yet |
| Sender | toll-free (verified) or 10DLC (brand + campaign) in our account | same, in our account | — |
| Owner must give | legal name, EIN, address, contact, expected volume (the opt-in flow is ours: the AI asks consent on the call) | same | nothing |
| Time to first text | toll-free: Telnyx says 1–2 weeks (help center: usually ≤5 business days) | toll-free ~3–5 business days; 10DLC vetting up to 5 business days + brand, 2–3+ weeks in backlogs | same day |
| Price (per research, verify before quoting) | $0.0055/part TF, $0.004 10DLC, + carrier fees | $0.0083/segment + carrier fees; TF number $2.15/mo | free 3,000/mo (100/day); Pro $20/mo for 50k |

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
  SMS path. That is the /dashboard/texting form.

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
- Plivo adapter not built (research: fine second choice).
- VERIFY items: docs/VERIFY.md "MESSAGING-1".
