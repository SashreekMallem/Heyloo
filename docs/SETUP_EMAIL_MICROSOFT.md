# Set up email with Microsoft 365 (owner steps)

EMAIL-MSGRAPH. Heyloo sends **all** its email from **one Microsoft 365
mailbox** (for testing: `ms@heycuey.com` on the domain `heycuey.com`, bought
through GoDaddy). Two things use it:

| What | Sent by | Examples |
|---|---|---|
| **Product email** | Heyloo's edge functions | owner alerts (new message, booking, urgent call), copies of texts that could not be sent |
| **Account email** | Supabase Auth, through Heyloo's `auth-send-email` function | sign-up confirmation, password reset, team invite, magic link, email-change confirmation, verification codes |

Supabase Edge Functions cannot open outgoing SMTP connections on ports 25 and
587 ([limits](https://supabase.com/docs/guides/functions/limits)), and
Microsoft 365 only offers those, so Heyloo talks to Microsoft over **HTTPS**
instead, using the Microsoft Graph `sendMail` API with an app registration
("the app"). That is safe only if the app is **locked to the one sending
mailbox**, which is the most important step below (Step 2).

Time: about 45 minutes, plus up to 2 hours for Microsoft to apply the mailbox
restriction. Everything here was checked against Microsoft's and Supabase's
current documentation on 2026-09-29 (links at the end); the DNS facts for
`heycuey.com` were read live on that date.

**What you need**

- The Microsoft 365 account that GoDaddy made **administrator** for
  `heycuey.com` (GoDaddy: Email & Office Dashboard > the user > Administrator
  permissions = Yes; GoDaddy calls this the *Global admin* role).
- A licensed mailbox to send from. Use a dedicated one (`ms@heycuey.com`), not
  a person's. Nobody reads it day to day, **but check it now and then:**
  bounces come back to its inbox, and Heyloo does not keep copies in Sent
  Items.
- Access to GoDaddy DNS for `heycuey.com` (Step 6).

---

## Step 0. Check you really have admin access (GoDaddy caveat)

Microsoft 365 bought through GoDaddy is often a **GoDaddy-managed
("federated") tenant**. In that case your admin account may open GoDaddy's
dashboard but **not** the full Microsoft admin centers, and the steps below
need two of them: **Microsoft Entra** (register the app) and **Exchange
Online PowerShell** (restrict it).

Test it in two minutes:

1. Open <https://entra.microsoft.com> and sign in with the admin account
   (`you@heycuey.com`).
2. Go to **Entra ID > App registrations**.
   - You see the list and a **New registration** button: good, continue to
     Step 1.
   - You are sent back to GoDaddy, get "you don't have access", or the menu
     items are missing: the tenant is GoDaddy-managed. Do the next part.

Also try <https://admin.exchange.microsoft.com>. GoDaddy documents that
"all Microsoft 365 email plans can access" the **Exchange** admin center
(Email & Office Dashboard > Admin > Advanced > Sign in) ([GoDaddy: advanced
admin centers](https://www.godaddy.com/help/access-advanced-admin-centers-32132)).
Exchange access alone is not enough, because you also need Entra.

**If Entra is blocked: ask GoDaddy to "defederate" the tenant.** A Microsoft
support engineer on Microsoft Q&A states this "can only be initiated by
GoDaddy since they control the federation settings", and that afterwards you
manage the tenant directly in the Microsoft 365 admin center ([Microsoft Q&A:
defederate from GoDaddy](https://learn.microsoft.com/en-us/answers/questions/5667563/i-want-to-defederate-my-account-from-godaddy)).
Microsoft has no single "GoDaddy" how-to page that we could find. The
technical operation underneath is converting the domain from federated to
managed authentication
([`Update-MgDomain -AuthenticationType Managed`](https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.directorymanagement/update-mgdomain?view=graph-powershell-1.0)),
which needs Global Administrator rights in the tenant; on a GoDaddy tenant
you do not have them, which is why GoDaddy has to do it. Step-by-step guides
from Microsoft partners describe the same route, including removing GoDaddy
as a delegated partner afterwards (third-party, not Microsoft:
[T-Minus 365](https://docs.tminus365.com/configurations/godaddy/defederating-godaddy-365),
[Sourcepass](https://www.sourcepass.com/godaddy-defederation)).

What to send GoDaddy support (chat or phone):

> Please defederate my Microsoft 365 tenant for the domain heycuey.com so I
> have full Global Administrator access to the Microsoft Entra and Microsoft
> 365 admin centers directly. I understand users may need to reset their
> passwords afterwards.

Before you ask, know that (from the partner guides, so confirm with GoDaddy):
users may have to set new passwords, the GoDaddy Email & Office Dashboard
stops managing users and billing stays with GoDaddy, and the mailboxes and
mail flow are unchanged. Do it outside business hours, and tell anyone using
a `@heycuey.com` mailbox first. For a test domain like `heycuey.com` this is
low risk.

*Plan B, unverified: we could not test this.* An app can be registered in a
different Entra tenant you fully control and made multi-tenant, then consented
in the GoDaddy tenant with the admin-consent link
`https://login.microsoftonline.com/<heycuey tenant id>/adminconsent?client_id=<app id>`
([docs](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent)).
This still needs Exchange PowerShell access in the GoDaddy tenant for Step 2,
and Heyloo's `MS_TENANT_ID` would then be the GoDaddy tenant while the secret
lives in the other one. Prefer defederation.

---

## Step 1. Register the app in Microsoft Entra

Sign in at <https://entra.microsoft.com> as an administrator.

1. **Entra ID > App registrations > New registration.**
2. **Name:** `Heyloo Mail Sender`.
3. **Supported account types:** **Single tenant only** (Microsoft recommends
   this for most apps).
4. Leave **Redirect URI** empty. Select **Register**.
5. On the app's **Overview** page, copy two values into a note (they are IDs,
   not secrets):
   - **Application (client) ID** -> Heyloo's `MS_CLIENT_ID`
   - **Directory (tenant) ID** -> Heyloo's `MS_TENANT_ID`

> **Do not add the Mail.Send permission here, and do not click "Grant admin
> consent".** Read Step 2 first. This is the opposite of what most tutorials
> say, and it is what keeps the app from sending as everyone in your company.

## Step 2. Lock the app to the one sending mailbox (Exchange RBAC for Applications)

**Why this matters.** The Graph application permission `Mail.Send` granted in
Entra means "send mail as **any** user in the tenant". Microsoft's own wording
for the role: "Allows the app to send mail as any user without a signed-in
user". Anyone holding this app's secret could send email as your CEO, your
bank contact, anyone with a mailbox in the tenant. So instead of granting
`Mail.Send` in Entra, we grant it **inside Exchange Online, scoped to one
mailbox**, using **RBAC for Applications**
([Microsoft docs](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)).
It does not need the Entra permission at all: Microsoft's guidance is that
organisation-wide permissions belong in Entra and resource-scoped ones in
RBAC for Applications, and that grants from the two systems **add up**, so
one unscoped Entra grant cancels the restriction.

RBAC for Applications **replaces** the older *Application Access Policies*
(`New-ApplicationAccessPolicy`); Microsoft says new configuration should not
use them because their deprecation "will be announced in the future".

You need the **Exchange Administrator** role in Entra (or membership of the
**Organization Management** role group in Exchange).

### 2a. Find the Enterprise application's Object ID

1. In Entra: **Entra ID > Enterprise apps > All applications**, search
   `Heyloo Mail Sender`, open it.
2. Copy its **Object ID** and its **Application ID** from the Overview page.

> Use the values from the **Enterprise applications** page. The **App
> registrations** page shows a *different* Object ID, and Exchange will
> reject or mis-bind it. (Microsoft: "Don't use the IDs from the App
> Registrations page".)

### 2b. Run these commands in Exchange Online PowerShell

Run them in PowerShell 7 (or Windows PowerShell) on any computer, signed in as
the administrator. Replace the three placeholders.

```powershell
# First time only
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline -UserPrincipalName you@heycuey.com

$AppId      = "<Application (client) ID>"
$SpObjectId = "<Object ID of the ENTERPRISE application>"

# 1. Tell Exchange about the app (a pointer to the Entra service principal)
New-ServicePrincipal -AppId $AppId -ObjectId $SpObjectId -DisplayName "Heyloo Mail Sender"

# 2. Find the sending mailbox's alias, used for the scope filter
Get-Mailbox ms@heycuey.com | Format-List Alias, PrimarySmtpAddress, UserPrincipalName

# 3. A scope that contains exactly that one mailbox (use the Alias printed above)
New-ManagementScope -Name "Heyloo sender mailbox" -RecipientRestrictionFilter "Alias -eq 'ms'"

# 4. Grant "send mail" to the app, only within that scope
New-ManagementRoleAssignment -App $SpObjectId -Role "Application Mail.Send" -CustomResourceScope "Heyloo sender mailbox"

# 5. Prove it: the sender must be in scope, everyone else out of scope
Test-ServicePrincipalAuthorization -Identity $SpObjectId -Resource ms@heycuey.com | Format-Table
Test-ServicePrincipalAuthorization -Identity $SpObjectId -Resource <any other mailbox>@heycuey.com | Format-Table
```

Expected: `InScope` is **True** for `ms@heycuey.com` and **False** for any other
mailbox. If the second one says True, stop and fix it before continuing.

`Test-ServicePrincipalAuthorization` bypasses Exchange's cache and looks only
at these RBAC grants. Real requests can take **30 minutes to 2 hours** to see a
change (Microsoft: the cache is reset after 30 minutes for an idle app and
kept up to 2 hours for an active one), so wait before the first live send.

Two more checks:

- **Entra must show no Mail permission for the app.** Entra ID > Enterprise
  apps > `Heyloo Mail Sender` > **Permissions**. The default `User.Read` is
  fine. If **Mail.Send** (or any `Mail.*`) is listed as granted, select it and
  **Revoke permission**, otherwise the scoping does nothing.
- `Get-ManagementRoleAssignment -RoleAssignee $SpObjectId` lists the one
  assignment, with your scope.

**Fallback if Microsoft ever rejects the RBAC-only setup.** In that (not
expected) case, the documented older way is: grant `Mail.Send` (Application) +
admin consent in Entra, put only the sending mailbox in a mail-enabled
security group, and run
`New-ApplicationAccessPolicy -AppId $AppId -PolicyScopeGroupId <group address> -AccessRight RestrictAccess`
([legacy docs](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-access-policies);
Microsoft warns changes can take over an hour to apply). Tell the developer
first; do not use it as a shortcut.

## Step 3. Create the client secret

Create it **after** Step 2, so a credential never exists while the app is
unrestricted.

1. Entra > **App registrations** > `Heyloo Mail Sender` > **Certificates &
   secrets > Client secrets > New client secret**.
2. Description `Heyloo production`. **Expires:** choose **12 months**
   (Microsoft recommends less than 12 months; 24 months is the maximum
   allowed).
3. Select **Add** and immediately copy the **Value** column. It is shown
   **once** and never again. (Do not copy the *Secret ID*; that is a
   different field and will not work.)
4. **Put the expiry date in your calendar now**, for about two weeks before.
   When a secret expires, every Heyloo email stops (product and account
   email) until a new one is set. Heyloo logs the reason as
   `ms_secret_expired` and, once enabled, alerts through Sentry.

Rotation without downtime: create the **new** secret first, update
`MS_CLIENT_SECRET` in Supabase, confirm a test email, then delete the old one.

Microsoft recommends a certificate rather than a client secret in production
([docs](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials)).
Heyloo supports a client secret today; a certificate is a later hardening
step.

## Step 4. Give Heyloo the credentials (not by chat)

Never paste the secret into chat, email, a ticket or a document. Put these in
the Supabase dashboard yourself: **Edge Functions > Secrets**
([docs](https://supabase.com/docs/guides/functions/secrets)), or hand them to
the developer through a password manager share.

| Secret name | Value |
|---|---|
| `EMAIL_PROVIDER` | `microsoft_graph` |
| `EMAIL_FROM_ADDRESS` | `Heyloo <ms@heycuey.com>` (the mailbox from Step 2; the part before `<` is the name people see) |
| `MS_TENANT_ID` | Directory (tenant) ID from Step 1 |
| `MS_CLIENT_ID` | Application (client) ID from Step 1 |
| `MS_CLIENT_SECRET` | the secret **Value** from Step 3 |

`EMAIL_FROM_ADDRESS` **must be the exact mailbox** you restricted the app to
(its user principal name). Heyloo refuses to send as any other address.

Tell the developer when it is done. They then:

1. deploy the function: `supabase functions deploy auth-send-email --no-verify-jwt`
   (or from the dashboard);
2. wait until Step 2's propagation window has passed;
3. run the switch-over script (dry-run first, then real):

   ```bash
   node --experimental-strip-types scripts/enable-auth-email-hook.ts           # shows the plan, changes nothing
   node --experimental-strip-types scripts/enable-auth-email-hook.ts --apply   # SUPABASE_ACCESS_TOKEN set
   ```

   It checks the function is deployed and an email provider is configured,
   generates the hook's signing secret itself, stores it as the function
   secret `SEND_EMAIL_HOOK_SECRET` **and** in the Auth settings, and never
   prints it. To go back to Supabase's built-in mailer at any time, add
   `--disable`: `... --disable --apply`.
4. test: request a password reset for an address you own and confirm the mail
   arrives from `ms@heycuey.com`; check spam once. If it does not, roll back
   with `--disable --apply` and read the `auth-send-email` function logs.

Turning the hook on **moves every account email onto Microsoft 365**, so do
Step 2's `Test-ServicePrincipalAuthorization` and a product-email test first.

## Step 5. Understand the sending limits

Exchange Online limits, per mailbox
([Exchange Online limits](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits)):

- **10,000 recipients per 24 hours**;
- **30 messages per minute** (excess is throttled, not dropped);
- a **tenant-wide external recipient limit** that depends on the number of
  licences (**5,000 external recipients per day on a trial tenant**).

Graph may also answer **429 Too Many Requests** with a `Retry-After` header
([throttling](https://learn.microsoft.com/en-us/graph/throttling)). Heyloo
honours it: the message is parked and retried after that delay, and an
account email is retried by Supabase Auth. This is plenty for launch (owner
alerts and account mail). Microsoft says Exchange Online "isn't suited to
accommodate bulk-mailing scenarios", so if you ever send marketing volume,
add a transactional provider (Resend) for that rather than raising these.

## Step 6. DNS for `heycuey.com` at GoDaddy (SPF, DKIM, DMARC)

What is published right now (read from public DNS on 2026-09-29):

| Record | Current value |
|---|---|
| MX `heycuey.com` | `0 heycuey-com.mail.protection.outlook.com` |
| TXT `heycuey.com` (SPF) | `v=spf1 include:secureserver.net -all` |
| TXT `_dmarc.heycuey.com` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` |
| CNAME `selector1._domainkey.heycuey.com` | `selector1-heycuey-com._domainkey.netorgft21060700.k-v1.dkim.mail.microsoft.` |
| CNAME `selector2._domainkey.heycuey.com` | `selector2-heycuey-com._domainkey.netorgft21060700.k-v1.dkim.mail.microsoft.` |

### SPF: already covers Microsoft, no change needed

`include:secureserver.net` looks like it only covers GoDaddy, but it does
not stop there: `secureserver.net` publishes
`v=spf1 include:spf-0.secureserver.net -all`, and `spf-0.secureserver.net`
publishes GoDaddy's IP ranges **followed by `include:spf.protection.outlook.com`**
(the Microsoft 365 record Microsoft requires). So mail sent by Exchange Online
passes SPF today. The whole chain costs 3 DNS lookups (the limit is 10) and
there is exactly one SPF record (more than one is an error), which is right.

**Recommended: leave it.** The one weakness is that the Microsoft part lives
inside GoDaddy's record, which GoDaddy could change. If you want it explicit
(and nothing but Microsoft 365 and GoDaddy's servers sends as `heycuey.com`),
you may replace the single TXT record's value with:

```
v=spf1 include:spf.protection.outlook.com include:secureserver.net -all
```

Edit the existing record in GoDaddy DNS (do not add a second one). Use `-all`
as it is: Microsoft recommends hard fail together with DKIM and DMARC. Never
"flatten" the Microsoft include into IP addresses; Microsoft's ranges change
([SPF for Microsoft 365](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-spf-configure)).
Re-check any time: `nslookup -type=TXT heycuey.com`.

### DKIM: the DNS records exist; check that signing is switched ON

The two CNAME records are already in GoDaddy DNS. Records alone do not sign
mail: DKIM signing for the custom domain has to be **enabled** in Microsoft
365. If it is off, Microsoft signs with the `onmicrosoft.com` domain, which
does not line up with `@heycuey.com` (DMARC alignment then rests on SPF alone).

Check and enable, either way:

- Portal: <https://security.microsoft.com/authentication?viewid=DKIM>
  (Defender > Email & collaboration > Policies & rules > Threat policies >
  Email authentication settings > **DKIM** tab). Select `heycuey.com`, switch
  **Sign messages for this domain with DKIM signatures** to **Enabled**.
- PowerShell (the session from Step 2):

  ```powershell
  Get-DkimSigningConfig -Identity heycuey.com | Format-List Name, Enabled, Status, Selector1CNAME, Selector2CNAME
  Set-DkimSigningConfig -Identity heycuey.com -Enabled $true
  ```

  `Selector1CNAME` / `Selector2CNAME` must equal the two CNAME values in the
  table above. If they differ, GoDaddy's copies are stale: in GoDaddy DNS edit
  the two CNAMEs, entering only `selector1._domainkey` / `selector2._domainkey`
  as the **Name** (GoDaddy appends the domain itself; typing the full name
  produces `...heycuey.com.heycuey.com`) and the exact target as the **Value**.

It can take a few minutes, or longer, for Microsoft to notice
([DKIM for Microsoft 365](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure)).

### DMARC: already there, keep it

`p=quarantine` with relaxed alignment is correct and needs no edit. Once DKIM
is on, both SPF and DKIM pass and align for mail from Heyloo. The reports
(`rua`) go to a GoDaddy address you cannot read; if you want to see them, add
your own address (for example `rua=mailto:dmarc_rua@onsecureserver.net,mailto:you@heycuey.com`).

---

## When something goes wrong

Heyloo records the reason in the function logs (Supabase dashboard > Edge
Functions > the function > Logs) and in Sentry when it is enabled. Secrets and
tokens never appear there.

| Error code | Meaning | Fix |
|---|---|---|
| `ms_invalid_client` | Microsoft rejected the client secret (wrong, or you pasted the Secret ID) | Step 3: create a new secret, paste the **Value** into `MS_CLIENT_SECRET` |
| `ms_secret_expired` | the secret's expiry date passed | Step 3: create a new secret, update `MS_CLIENT_SECRET` |
| `ms_app_not_found` / `ms_tenant_not_found` | `MS_CLIENT_ID` / `MS_TENANT_ID` wrong | copy them again from the app's Overview page (Step 1) |
| `ms_forbidden` (HTTP 403) | the app has no Mail.Send access to that mailbox | Step 2: role assignment missing, scoped to another mailbox, or still propagating (wait up to 2 hours); check `Test-ServicePrincipalAuthorization` |
| `ms_mailbox_not_found` (HTTP 404) | `EMAIL_FROM_ADDRESS` is not a mailbox in this tenant, or has no licence | use the mailbox's own address; assign an Exchange Online licence |
| `from_not_sending_mailbox` | the From address differs from the restricted mailbox | make `EMAIL_FROM_ADDRESS` the Step 2 mailbox |
| `ms_throttled` / `ms_unavailable` | Microsoft asked us to slow down | nothing to do: retried automatically after `Retry-After` |
| `ms_timeout`, `ms_network_error`, `ms_temporary_failure` | Microsoft or the network was slow or down | retried automatically |

Emails are accepted by Microsoft with a `202 Accepted`, which means "queued",
not "delivered". A bad recipient address shows up as a bounce in
`ms@heycuey.com`'s inbox.

## References

- Graph `sendMail`: <https://learn.microsoft.com/en-us/graph/api/user-sendmail>
- Client credentials flow: <https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow>
- Graph throttling: <https://learn.microsoft.com/en-us/graph/throttling>
- Exchange Online limits: <https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits>
- RBAC for Applications: <https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac>
- Application Access Policies (legacy): <https://learn.microsoft.com/en-us/exchange/permissions-exo/application-access-policies>
- Register an app: <https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app>
- App credentials: <https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials>
- Admin consent (and who can grant Graph application permissions): <https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent>
- SPF / DKIM for Microsoft 365: <https://learn.microsoft.com/en-us/defender-office-365/email-authentication-spf-configure>, <https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure>
- GoDaddy admin access: <https://www.godaddy.com/help/access-advanced-admin-centers-32132>, <https://www.godaddy.com/help/change-my-microsoft-365-users-admin-permissions-42235>
- GoDaddy defederation: <https://learn.microsoft.com/en-us/answers/questions/5667563/i-want-to-defederate-my-account-from-godaddy>, <https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.identity.directorymanagement/update-mgdomain?view=graph-powershell-1.0>
- Supabase Send Email Hook: <https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook>
- Supabase Edge Function secrets and limits: <https://supabase.com/docs/guides/functions/secrets>, <https://supabase.com/docs/guides/functions/limits>
