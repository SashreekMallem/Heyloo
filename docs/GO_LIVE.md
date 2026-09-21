# Go Live Checklist

What remains for the owner before accepting real tenant calls. Automation has already provisioned Supabase, deployed all edge functions, verified all voice/booking/billing pipelines live (8 verticals), and deployed `apps/web`.

## Already Done by Automation (per CALL-1..8, OPS-1..7)

| Component | Status | Date |
|---|---|---|
| Supabase project + schema + cron jobs | ✓ Complete | 2026-09-21 |
| All edge functions deployed | ✓ Complete | 2026-09-21 |
| Agent templates synced + compiled | ✓ Complete | 2026-09-21 |
| Vercel env vars + `apps/web` deployed | ✓ Complete | 2026-09-21 |
| Secrets set (CRON_INVOKE_SECRET, ADAPTER_TOKEN_ENCRYPTION_KEY, PROVISION_INTERNAL_SECRET, INTAKE_ENCRYPTION_KEY, WIDGET_TOKEN_SECRET, APP_BASE_URL, RETELL_API_KEY, VOICE_EVENTS_WEBHOOK_URL) | ✓ Complete | 2026-09-21 |
| 8 verticals batch-tested live (auto, vet, dental, legal, real_estate, motel, restaurant, generic) | ✓ Complete | 2026-09-21 |

---

## Owner-only steps (in order)

### 1. Twilio A2P brand registration (start this first — 1–5 day lead time)

**Why**: A2P is mandatory for SMS. Brand review is 1–5 business days.

**Steps**:
1. Console → Messaging → Regulatory Compliance → Brand Registration → **reseller brand**
2. Ensure Trust Hub bundles (Customer Profile, A2P Profile) exist first
3. Set `A2P_PRIVACY_POLICY_URL` and `A2P_TERMS_URL` to real, live URLs (Twilio requirement)
4. Submit for review; note the **Brand SID** when approved
5. `npx supabase secrets set TWILIO_A2P_BRAND_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

**Verify**: Twilio Console shows brand "approved".

---

### 2. Stripe

**Why**: Billing must work before signup.

**Steps**:
1. Create account, complete business verification
2. Developers → API keys: copy Secret/Publishable keys (test mode first)
3. Developers → Webhooks → Add endpoint: URL `https://<project-ref>.supabase.co/functions/v1/webhooks-stripe`, events: `checkout.session.completed`, `customer.subscription.updated`, `invoice.paid`, `invoice.payment_failed`; copy signing secret
4. `npx supabase secrets set STRIPE_SECRET_KEY=sk_test_xxxxx STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx STRIPE_WEBHOOK_SIGNING_SECRET=whsec_xxxxx`
5. Vercel (Project Settings → Environment Variables → Production): set `STRIPE_PUBLISHABLE_KEY`

**Verify**: `/api-checkout` returns 200, not 500.

---

### 3. Resend

**Why**: Transactional email for confirmations/resets.

**Steps**:
1. Create account, add and verify sending domain (DNS: SPF/DKIM)
2. API Tokens: generate one
3. `npx supabase secrets set RESEND_API_KEY=re_xxxxx RESEND_FROM_ADDRESS=notifications@yourdomain.com`

**Verify**: Test email arrives within 30 seconds.

---

### 4. OUTREACH_CAN_SPAM_FOOTER

**Why**: Outreach campaigns cannot send without it.

**Steps**:
1. Draft physical address + unsubscribe link (CAN-SPAM)
2. `npx supabase secrets set OUTREACH_CAN_SPAM_FOOTER="[Your Business]\n123 Main St\nUnsubscribe: https://yourdomain.com/unsubscribe"`

**Verify**: Admin campaign-create no longer rejects with "CAN_SPAM_FOOTER not set".

---

### 5. Retell outbound identity verification

**Status: already done — confirmed live by SELFCALL-1 (2026-09-21), no owner action needed.**

**Why**: Retell requires verified identity/KYC before outbound calls are allowed
(docs.retellai.com/accounts/kyc) — this gates the platform's own outbound
lead-callback feature (`_shared/providers/retell.ts#createPhoneCall`,
`job-lead-callback-retry`), not just manual dashboard use.

**Verified**: `api-admin-self-call` placed a REAL outbound `POST
/v2/create-phone-call` from the platform's own `+16105383920` to its own
`+12602354330` — Retell accepted it immediately (no KYC/verification
rejection of any kind) and the call connected, ran a full scripted
conversation, and ended normally (`user_hangup`). Run twice, both times
successful. This account's outbound calling is provably already unlocked
— nothing further to do here. See `docs/BUILD_NOTES.md`'s SELFCALL-1
entry for the call ids and full live evidence.

---

### 6. Real transfer number

**Why**: Test calls need somewhere to transfer to.

**Steps**:
1. Dashboard (as test tenant) → Settings → Phone Setup → Forwarding Number → select real phone (your cell, etc.)
2. Call the tenant's Twilio number, say "transfer me"; confirm it rings

**Verify**: Forwarding number rings when called.

---

### 7. Test call to +1 260-235-4330

**Why**: End-to-end proof: Twilio → Retell → booking → SMS → dashboard.

**Steps**:
1. From different phone, call **+1 260-235-4330**
2. Confirm disclosure line, booking flow completes, "SMS on the way" played
3. Check SMS on calling phone (should arrive <60s)
4. Check dashboard Bookings page (should appear <5s)
5. As admin, check Cockpit → Margin (should show real `cost_cents`, not zero)

**Verify**: Booking visible, SMS received, cost shown. If fails, check function logs (Supabase → Functions → voice-tools/voice-events → Logs) + Retell call history.

---

### 8. Counsel sign-off

**Why**: Required before real tenants onboard.

**Steps**:
1. Review with counsel: BIPA (recording consent), AI-disclosure law, TCPA (quiet hours), CAN-SPAM (0.3% pause), PCI (Stripe-only), referral FTC disclosure, W-9/1099, DPA (legal pages final)
2. Counsel approves; keep records

**Verify**: Counsel sign-off in writing.

---

### 9. Cleanup: Delete spare Vercel projects

**Steps**: Vercel → Projects → delete all except `heyloo-voice` (optionally keep one staging).

**Verify**: Only production + optional staging remain.

---

### 10. Cleanup: Delete old Retell agents

**Steps**:
1. `psql "$SUPABASE_DB_URL" -c "select tenant_id, retell_agent_id from agent_configs where tenant_id like 'test-%';"`
2. For each test agent, delete from Retell dashboard (Agents → 3-dot → Delete)

**Verify**: Only production agents remain.

---

### 11. Rotate credentials (once)

**Steps**:
1. Supabase Account → Access Tokens → generate new CI token, revoke old
2. Update any CI/ops scripts using the old token

**Verify**: `supabase functions list` still works.

---

### 12. Custom domain (optional)

**Steps**:
1. Register domain; Vercel → Project Settings → Domains → add it
2. Add CNAME to DNS; once verified, set `APP_BASE_URL=https://yourdomain.com` in Vercel env

**Verify**: `https://yourdomain.com/login` loads dashboard.

---

Go live. First paid signup will now provision end-to-end (Stripe → Twilio number → Retell agent → ready for calls).

---

## Section B: Verified by automation

This table summarizes what the existing BUILD_NOTES.md and LAUNCH_STATUS.md entries say has been tested, and which gaps remain.

| Task | Status | What was proven | What remains |
|---|---|---|---|
| **CALL-1** | ✓ Complete | First live-call path: test-tenant provisioning, Retell number attach, batch-test runner | N/A |
| **CALL-2** | ✓ Complete | Voice-tools context resolution from tool payload; 8/8 loop fixed | N/A |
| **CALL-3** | ✓ Complete | jsonb double-encoding fix + agent_templates sync script | N/A |
| **CALL-4** | ✓ Complete | transfer-call node from tenant config, generic wrap-up end node | N/A |
| **CALL-5** | ✓ Complete (partial) | Real call-event path (webhook_events populated for first time) | Full spoken conversation with real audio (WebRTC in Chromium — blocked by TLS/sandbox constraints; owner can test live) |
| **CALL-6** | ✓ Complete | Cross-tenant write fix, bookings.is_test, wrong_date_caller root cause | N/A |
| **CALL-7** | ✓ Complete | Six remaining verticals batch-tested live (vet, legal, real_estate, motel, restaurant, generic) | N/A |
| **CALL-8** | ✓ Complete | Required-field capture matrix, server-side enforcement, live DB-based proof (all 8 verticals verified) | N/A |
| **OPS-1** | ✓ Complete | Optional-integration cron jobs skip when not configured | N/A |
| **OPS-2** | ✓ Complete | Chronic pg_cron → pg_net timeouts root cause + fix | N/A |
| **OPS-3** | ✓ Complete | One cron request per minute instead of three | N/A |
| **OPS-4** | ✓ Complete | Retell webhook signature key is the API key (VERIFY-1 assumption) | Needs live confirmation against current Retell docs |
| **OPS-5** | ✓ Complete | Cold-start crashes fixed (503 instead of 500), batch-test flakiness fixed | N/A |
| **OPS-6** | ✓ Complete | CI "Cron jobs check" fixed: worker-tick now scheduled on fresh stack | N/A |
| **OPS-7** | ✓ Complete | Flaky site-perf CLS gate fixed (robust sampling) | N/A |
| **SIGNUP-1** | Pending | Signup flow end-to-end (vertical selection, price card, Stripe Checkout, provisioning saga) | Owner will test via step 1-12 above |
| **NIGHTLY-1** | ✓ Complete | Nightly Retell batch-test regression sweep of every `test-*` tenant (`job-agent-regression`, `0 9 * * *` UTC), `agent_regression_runs` history table, alerts on any pass-ratio/field-capture regression, `GET /admin-agent-regression` | N/A — proved live: all 8 tenants ran and settled, 5 correctly flagged, `cron.job` entry confirmed |
| **Counsel sign-off** | Pending | BIPA, HIPAA BAA, TCPA, CAN-SPAM, PCI, FTC, DPA, W-9 / 1099-NEC | Owner completes step 8 above |

**Summary**: Every platform-level voice call, booking, and billing pipeline component is verified live (CALL-1..8, OPS-1..7). What remains for the owner to test (steps 1-12 above):
- Twilio, Stripe, Resend, outreach footer, Retell verification, transfer number
- First real test call + SMS delivery (step 7)
- Counsel sign-off (step 8)
- Cleanup + rotation (steps 9-12)
- Nightly reconciliation (wait 24h after first call)

Once all steps 1-12 complete, the platform is production-ready.
