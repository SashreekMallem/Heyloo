# Set up email (owner steps)

MSG-3. Heyloo sends email from **your own domain mailbox** over SMTP. Two
separate things use it, and both are set up here:

| What | Sent by | Examples | Configured in |
|---|---|---|---|
| **Product email** | Heyloo's edge functions (`worker-messages-outbound`, `admin`) | owner alerts (new message, booking, urgent call), copies of texts that could not be sent | Supabase **Edge Function secrets** (part 3) |
| **Account email** | Supabase Auth | sign-up confirmation, password reset, team invites, magic links | Supabase **Auth SMTP settings** (part 4) |

Use the same mailbox for both. There is no texting provider at launch, so
until texting is set up **every owner alert goes by email**; if email is not
working, owners are not alerted. Do this before the first real customer.

Time: about 30 minutes plus DNS propagation (up to 48 hours before
deliverability is at its best). Everything below was checked against the
providers' current documentation on 2026-09-29; links are at the end.

---

## 1. Pick the mailbox provider

Heyloo's edge functions can only connect **out on port 465 (SMTP over TLS)**.
Supabase Edge Functions block outgoing ports 25 and 587
([limits](https://supabase.com/docs/guides/functions/limits)), and 587 is the
port most providers use for "STARTTLS" submission. Pick a provider that
offers port 465:

| Provider | Works | Host | Port | Notes |
|---|---|---|---|---|
| **Google Workspace** (recommended) | yes | `smtp.gmail.com` | 465 (SSL) | Needs an app password. 2,000 messages/day via the Gmail SMTP server. |
| **Zoho Mail** | yes | `smtp.zoho.com` (free/personal), `smtppro.zoho.com` (paid organization); other regions use their own host, check your Zoho account | 465 (SSL) | App-specific password if two-factor is on. |
| **Microsoft 365 / Exchange Online** | **no, not for product email** | `smtp.office365.com` | 587 only | Microsoft's SMTP AUTH client submission needs port 587 (or 25) and says an application that defaults to 465 "doesn't support the required versions of TLS". Both ports are blocked in Edge Functions, and Microsoft is retiring Basic authentication for it. It still works for **account email** (part 4), because Supabase Auth's mail server is not an Edge Function. For product email use **Microsoft Graph** instead (`EMAIL_PROVIDER=microsoft_graph`, sends over HTTPS: [SETUP_EMAIL_MICROSOFT.md](SETUP_EMAIL_MICROSOFT.md)), or a Google Workspace or Zoho mailbox. |

If you already have Microsoft 365 for your staff, you can still create
`alerts@yourdomain.com` on Google Workspace or Zoho **only if** the domain's
MX records point at that provider. Otherwise use a second domain or a
subdomain (for example `mail.yourdomain.com`) for the sending mailbox.

## 2. Create the sending mailbox and an app password

1. Create a mailbox such as `alerts@yourdomain.com` (display name "Heyloo" or
   your business name). It sends only; nobody needs to read it, but keep it: bounces
   and replies land there. Note the **full address**: it is the SMTP username.
2. Create an **app password** so Heyloo never holds the mailbox's real
   password:
   - Google: the account needs **2-Step Verification** on, then
     <https://myaccount.google.com/apppasswords>. Google shows a 16-character
     password in four groups; copy it **without the spaces**. If the page is
     missing, a Workspace admin has restricted it (security-key-only 2SV, or
     Advanced Protection also hide it): ask the admin to allow app passwords for
     this mailbox. App passwords stop working if the mailbox password changes.
   - Zoho: with two-factor on, create an application-specific password in
     Zoho Accounts (Security > App Passwords).

## 3. Product email: Supabase secrets

Set these once. Secrets are available to functions **immediately**, no
redeploy needed ([docs](https://supabase.com/docs/guides/functions/secrets)).
Only project Owners and Administrators can set them.

```bash
supabase secrets set \
  EMAIL_PROVIDER=smtp \
  SMTP_HOST=smtp.gmail.com \
  SMTP_PORT=465 \
  SMTP_USERNAME=alerts@yourdomain.com \
  SMTP_PASSWORD=<the app password, no spaces> \
  EMAIL_FROM_ADDRESS="Heyloo <alerts@yourdomain.com>"
```

(or Dashboard, Project, Edge Functions, **Secrets**.)

| Secret | Value |
|---|---|
| `EMAIL_PROVIDER` | `smtp` (the default is `resend`, which you are not using) |
| `SMTP_HOST` | `smtp.gmail.com` or `smtp.zoho.com`: a bare host name, no `smtps://`, no port |
| `SMTP_PORT` | `465`. Optional (465 is the default). **25 and 587 are rejected on purpose.** |
| `SMTP_USERNAME` | the full mailbox address |
| `SMTP_PASSWORD` | the app password |
| `EMAIL_FROM_ADDRESS` | the same mailbox, e.g. `Heyloo <alerts@yourdomain.com>`. Plain ASCII address. It **must** be that mailbox or an alias it is allowed to send as: Google and Zoho reject or rewrite anything else. |

If any value is missing or invalid the email provider reports "not
configured" and **nothing is sent or pretended**: queued messages wait
(15-minute rechecks) and are marked failed after 24 hours, with the reason
recorded on the message (`messages_outbound.error`). The `worker-messages-outbound` response lists
exactly which variable is unset or unusable (for example
`"SMTP_PORT (outgoing ports 25 and 587 are blocked ...)"`).

To go back to Resend later: set `EMAIL_PROVIDER=resend` plus its two
secrets. Nothing else changes.

## 4. Account email: Supabase Auth custom SMTP

Supabase's built-in email sender is for trying things out: **2 emails per
hour, and only to addresses on your Supabase team**
([docs](https://supabase.com/docs/guides/auth/auth-smtp)). Sign-up
confirmation, password reset and team invites will not reach real users until
you switch it to your mailbox.

1. Dashboard, **Authentication**, **Emails**, **SMTP Settings** (direct link:
   `https://supabase.com/dashboard/project/<project-ref>/auth/smtp`). Turn on
   **Enable custom SMTP**.
2. Fill in:

   | Field | Value |
   |---|---|
   | Sender email | `alerts@yourdomain.com` (the same mailbox) |
   | Sender name | Heyloo (or your business name) |
   | Host | `smtp.gmail.com` (or `smtp.zoho.com`) |
   | Port | `465` |
   | Username | the full mailbox address |
   | Password | the same app password |

   The 25/587 block applies to Edge Functions; Supabase Auth's own docs use
   port 587 in their example, so Auth is not under it. 465 is simply the
   port that works for both halves of this setup. (A Microsoft 365 mailbox,
   `smtp.office365.com` on 587, can therefore send account email, but keep
   product email on Google or Zoho. Microsoft is retiring Basic
   authentication for it: check the Microsoft link below first.)
3. Save. Supabase starts a custom-SMTP project at **30 emails per hour**.
   Raise it at **Authentication, Rate Limits**
   (`https://supabase.com/dashboard/project/<project-ref>/auth/rate-limits`,
   [docs](https://supabase.com/docs/guides/auth/rate-limits)) to
   match your sign-up volume, but stay within the mailbox's own cap (Google
   Workspace: 2,000 messages/day through `smtp.gmail.com`, shared with the
   product email above).
4. Test: Authentication, **Users**, "Invite user" to an address you own, or
   run "Forgot password" on the login page. The email must arrive from your
   mailbox, not from `noreply@mail.app.supabase.io`.

The email templates (subjects and wording) are under Authentication, Emails,
**Templates**; they are separate from this setup.

## 5. Deliverability: SPF, DKIM, DMARC (do this before launch)

Email from a brand-new domain lands in spam without these. Google requires
authentication for everyone sending to Gmail addresses (SPF **or** DKIM, TLS,
valid reverse DNS, spam rate under 0.3%) and all three (SPF, DKIM, DMARC)
above 5,000 messages/day ([sender guidelines](https://support.google.com/a/answer/81126)).
Owner alerts go to the owner's own address, often Gmail, so do all three now.
Records are added at your **domain registrar or DNS host**, not in Google or
Supabase. You need SPF and DKIM working 48 hours before DMARC.

Google Workspace (values from Google's own setup guides):

| Type | Host | Value |
|---|---|---|
| TXT (SPF) | `@` | `v=spf1 include:_spf.google.com ~all`. **One** SPF record per domain: if one exists, add `include:_spf.google.com` to it instead of creating a second. |
| TXT (DKIM) | `google._domainkey` (use the exact host name Google shows) | The long value from Admin console, Apps, Google Workspace, Gmail, **Authenticate email**, "Generate new record" (2048-bit). Then click **Start authentication**. Google says the key is not available until 24 to 72 hours after Gmail is turned on. |
| TXT (DMARC) | `_dmarc` | Start with `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com`, then move to `p=quarantine`, then `p=reject` once the reports show only your own mail passing. |

Zoho Mail: SPF `v=spf1 include:zohomail.com -all` (use the include value that
Zoho's Admin Console shows for your data center; keep to one SPF record and
add other senders' includes to it), DKIM from Admin Console, Domains, Email
Configuration, DKIM; DMARC as above.

Check the result: send an alert to a Gmail address, open it, "Show original":
it must say `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.

## 6. Verify end to end

1. Place a test call to the agent and leave a message (or make a test
   booking). The owner alert email should arrive within about a minute (the
   queue worker runs every minute).
2. Not arriving? Look at the result of `worker-messages-outbound`
   (Dashboard, Edge Functions, Logs) and the failed message's `messages_outbound.error`:

   | You see | Meaning | Fix |
   |---|---|---|
   | `"skipped": "not_configured"` with a `missing` list | a secret is unset or invalid | set it (part 3) |
   | `smtp_auth_failed` (535 / 534 "Application-specific password required") | wrong username or password | regenerate the app password, paste without spaces, username = full address |
   | 553 / 550 "sender not owned by user", or 5.7.60 | `EMAIL_FROM_ADDRESS` is not the authenticated mailbox or one of its aliases | make them match |
   | `smtp_timeout`, `smtp_network_error` | provider unreachable or a wrong host; retried automatically | check `SMTP_HOST`; if it persists, the provider blocks the connection |
   | 550 5.4.5 "Daily user sending limit exceeded" | the mailbox hit its daily cap | the message is parked and retried; reduce volume or add a second sending mailbox |

## Reference (fetched 2026-09-29)

- Supabase Edge Function limits (ports 25 and 587 blocked): <https://supabase.com/docs/guides/functions/limits>
- Supabase Auth custom SMTP: <https://supabase.com/docs/guides/auth/auth-smtp>, rate limits: <https://supabase.com/docs/guides/auth/rate-limits>
- Supabase secrets: <https://supabase.com/docs/guides/functions/secrets>
- Google SMTP server settings (`smtp.gmail.com`, 465 SSL, app password, 2,000/day): <https://knowledge.workspace.google.com/admin/gmail/send-email-from-a-printer-scanner-or-app>
- Google app passwords: <https://support.google.com/accounts/answer/185833>
- Google SPF / DKIM / DMARC: <https://knowledge.workspace.google.com/admin/security/set-up-spf>, <https://knowledge.workspace.google.com/admin/security/set-up-dkim>, <https://knowledge.workspace.google.com/admin/security/set-up-dmarc>
- Google sender requirements: <https://support.google.com/a/answer/81126>
- Zoho SMTP settings: <https://www.zoho.com/mail/help/zoho-smtp.html>, SPF: <https://www.zoho.com/mail/help/adminconsole/spf-configuration.html>
- Microsoft 365 SMTP AUTH client submission (587 only): <https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365>
