/**
 * Fixture data for UI Preview Mode (docs/DESIGN_SYSTEM.md §UI Preview
 * Mode). Everything here is invented — no real tenant, customer, or call
 * data — and exists purely so real page components render something
 * realistic-looking with no auth and no network. See
 * `apps/web/src/lib/preview/README.md` for how this plugs into the fetch
 * interceptor and the three `requireXSession` mocks.
 */

const DAY_MS = 86_400_000;
export function daysAgoIso(days: number, hourOffset = 9): string {
  const d = new Date(Date.now() - days * DAY_MS);
  d.setUTCHours(hourOffset, 15, 0, 0);
  return d.toISOString();
}

export const PREVIEW_TENANT_ID = "11111111-1111-4111-8111-111111111111";
export const PREVIEW_ADMIN_USER_ID = "22222222-2222-4222-8222-222222222222";
export const PREVIEW_PARTNER_ID = "33333333-3333-4333-8333-333333333333";

/** Exact shape `requireTenantSession` selects — kept in sync by hand (docs/BUILD_NOTES.md DS entry). */
export const PREVIEW_TENANT = {
  id: PREVIEW_TENANT_ID,
  name: "Golden Fork Bistro",
  status: "active" as const,
  vertical: "restaurant" as const,
  business_hours: {
    mon: { open: "11:00", close: "21:00" },
    tue: { open: "11:00", close: "21:00" },
    wed: { open: "11:00", close: "21:00" },
    thu: { open: "11:00", close: "22:00" },
    fri: { open: "11:00", close: "23:00" },
    sat: { open: "10:00", close: "23:00" },
    sun: { open: "10:00", close: "20:00" },
  },
  branding: { logo_url: null, primary_color: null, accent_color: null },
  manual_mode: false,
  manual_mode_enabled_at: null,
  // Real column is a jsonb ARRAY — must stay `[]`, never fall through to
  // the generic string synthesizer (that produced a non-array value that
  // crashed `HoursEditor.exceptions.map`, round-3 tenant design review,
  // blocker).
  hours_exceptions: [] as { date: string; closed?: boolean; note?: string }[],
  usage_hard_cap_minutes: 6000,
  // Website widget + text agent (BUILD_PLAN Cluster W, BACKEND_SPEC.md
  // §13.2) — a plausible "already set up" state so the Install page and
  // Agent settings' Text agent tab preview with real-looking data rather
  // than every field empty.
  text_agent_enabled: true,
  text_agent_persona: { tone: "friendly", signOff: "— Golden Fork Bistro" },
  quiet_hours: { start: "21:00", end: "09:00", enabled: true },
  widget_enabled: true,
  widget_settings: {
    allowed_origins: ["https://goldenforkbistro.example"],
    accent: "#d96a3f",
    position: "bottom-right" as const,
    greeting: "Hi! Ask us about reservations or delivery.",
    modes: ["voice", "chat"] as const,
  },
  widget_public_key: "pk_preview_widget_key",
};

export const PREVIEW_TENANT_USER = {
  id: "44444444-4444-4444-8444-444444444444",
  email: "owner@goldenforkbistro.example",
  app_metadata: { tenant_id: PREVIEW_TENANT_ID, role: "owner" },
};

export const PREVIEW_ADMIN_USER = {
  id: PREVIEW_ADMIN_USER_ID,
  email: "admin@heyloo.example",
  app_metadata: { platform_admin: true },
};

export const CURRENT_FTC_POLICY_VERSION = "2026-09";

/** Exact shape `requirePartnerSession` selects. */
export const PREVIEW_PARTNER = {
  id: PREVIEW_PARTNER_ID,
  name: "Riverside Referral Co.",
  w9_status: "verified" as const,
  ftc_acknowledged_at: daysAgoIso(40),
  ftc_acknowledged_version: CURRENT_FTC_POLICY_VERSION,
  // `/portal/payouts` reads this straight through `.replace(/_/g, " ")`
  // (title-cased in the UI) — left unset, the generic synthesizer produced
  // the literal string "sample_payout_method", which rendered verbatim as
  // "Paid via Sample Payout Method" (round-2 admin-partner design review,
  // moderate). A real payout method value formats correctly.
  payout_method: "paypal",
};

export const PREVIEW_PARTNER_USER = {
  id: "55555555-5555-4555-8555-555555555555",
  email: "partner@riversidereferral.example",
  app_metadata: { referral_partner_id: PREVIEW_PARTNER_ID },
};

const CALL_CLASSES = [
  "new_booking",
  "reschedule",
  "question_faq",
  "sales_lead",
  "status_check",
  "transfer_request",
  "cancel",
  "wrong_number",
];

const CUSTOMER_NAMES = [
  "Priya Natarajan",
  "Marcus Webb",
  "Elena Diaz",
  "Sam O'Connor",
  "Grace Kim",
  "David Alvarez",
  "Hannah Fischer",
  "Jamal Carter",
];

/**
 * Hand-authored rows for the highest-traffic tables (top 10 `.from(...)`
 * call sites across apps/web/src by usage count, per
 * `docs/BUILD_NOTES.md`'s DS entry). Every other table falls back to
 * `synthesizeRow` in `mock-fetch.ts` — a plausible-but-generic row built
 * from the columns actually requested, never a crash.
 */
export const TABLE_FIXTURES: Record<string, Record<string, unknown>[]> = {
  tenants: [
    PREVIEW_TENANT,
    {
      ...PREVIEW_TENANT,
      id: "tenant-2",
      name: "Sunrise Auto Repair",
      vertical: "auto",
      status: "trialing",
    },
  ],

  phone_numbers: [
    {
      id: "phone-1",
      tenant_id: PREVIEW_TENANT_ID,
      e164: "+15125550142",
      forwarding_verified_at: daysAgoIso(60),
    },
  ],

  // Real `date` column is a `date` (YYYY-MM-DD), and the overview/billing
  // pages both compare it against `new Date().toISOString().slice(0, 10)`
  // and do numeric arithmetic on `total_calls`/`billable_minutes` — the
  // generic synthesizer produced literal strings like "Sample date" and
  // "Sample total calls" for these (no column-name pattern matched), which
  // never equalled "today" and coerced to `NaN`/0 everywhere, leaving the
  // Overview trend chart and Billing's usage meter looking empty/blank
  // even though nothing had crashed (round-3 tenant design review,
  // medium + low).
  // 14 days (not 8) so the Overview trend chart — and its "7d"/"30d" range
  // pills — has real variation to show a reviewer, not just a single flat
  // week (round-5/6 tenant design review).
  usage_daily: Array.from({ length: 14 }, (_, i) => {
    const day = 13 - i; // oldest first, day 0 = today
    const calls = [4, 7, 6, 9, 5, 11, 8, 6, 9, 5, 11, 8, 14, 10][i] ?? 8;
    return {
      tenant_id: PREVIEW_TENANT_ID,
      date: daysAgoIso(day).slice(0, 10),
      total_calls: calls,
      total_minutes: calls * 3,
      billable_minutes: calls * 3,
      total_bookings: Math.max(0, calls - 4),
    };
  }),

  call_logs: Array.from({ length: 8 }, (_, i) => ({
    id: `call-${i + 1}`,
    tenant_id: PREVIEW_TENANT_ID,
    classification: CALL_CLASSES[i % CALL_CLASSES.length],
    // Real calls/[id]/page.tsx maps `t.speaker` (not `t.role`) into the
    // turns it hands to `TranscriptViewer` — keep this key in sync with
    // that shape (round-3 tenant design review, blocker: a `role` key here
    // left every synthesized turn's `speaker` undefined and crashed
    // `turn.speaker.toLowerCase()`).
    transcript: [
      {
        speaker: "agent",
        text: "Thanks for calling Golden Fork Bistro — this call may be recorded. How can I help?",
        ts: 0,
      },
      { speaker: "caller", text: "Hi, I'd like a table for four tonight around 7.", ts: 4 },
      { speaker: "agent", text: "I can do 7:15 for four — would that work?", ts: 9 },
      { speaker: "caller", text: "Perfect, thank you.", ts: 14 },
    ],
    state_trace: [
      { state: "greeting", enteredAt: daysAgoIso(i, 9) },
      { state: "collect_party_size", enteredAt: daysAgoIso(i, 9) },
      { state: "book", enteredAt: daysAgoIso(i, 9) },
    ],
    recording_url: null,
    stereo_recording_url: null,
    duration_seconds: 48 + i * 17,
    ended_at: daysAgoIso(i),
    structured_booking_payload: { party_size: 2 + (i % 5), time: "19:15" },
    urgency_flag: i === 5,
    call_summary: "Booked a table for tonight.",
    sentiment: i % 3 === 0 ? "positive" : "neutral",
    follow_up_needed: i % 4 === 0,
    legal_advice_given: false,
    extracted_entities: { name: CUSTOMER_NAMES[i % CUSTOMER_NAMES.length] },
    message_text: null,
    outcome: "booked",
    customer_phone: `+1512555${String(1000 + i).padStart(4, "0")}`,
    // Real column tenant/customers/[id]/page.tsx joins recent calls on
    // (`.eq("caller_number", customer.phone_e164)`) — kept identical to
    // `customer_phone` above so that join actually resolves rows in preview.
    caller_number: `+1512555${String(1000 + i).padStart(4, "0")}`,
    started_at: daysAgoIso(i),
  })),

  customers: CUSTOMER_NAMES.map((name, i) => ({
    id: `customer-${i + 1}`,
    tenant_id: PREVIEW_TENANT_ID,
    name,
    phone_e164: `+1512555${String(1000 + i).padStart(4, "0")}`,
    email: `${name.split(" ")[0]?.toLowerCase()}@example.com`,
    // Real `CustomerSegment` enum values (packages/ui/src/custom/segment-badge.tsx)
    // — cycled so preview shows every badge variant, never a synthesized
    // placeholder string SegmentBadge doesn't recognize.
    segment: (["new", "returning", "loyal", "vip"] as const)[i % 4],
    lifetime_value_cents: 4500 + i * 3200,
    metadata: {},
    consent: { sms: i % 2 === 0, call: true, captured_at: daysAgoIso(30 + i) },
    // messages-list-client.tsx / message-thread-client.tsx select this
    // directly — leaving it unset fell through to the generic synthesizer,
    // which produced a truthy placeholder string and showed every
    // customer's message thread as "Opted out" (round-3 tenant design
    // review, adjacent to the "Sample from e164" low-severity finding).
    sms_opt_out: false,
    created_at: daysAgoIso(90 - i * 4),
  })),

  bookings: Array.from({ length: 6 }, (_, i) => ({
    id: `booking-${i + 1}`,
    tenant_id: PREVIEW_TENANT_ID,
    start_at: new Date(Date.now() + (i - 2) * 3 * 3_600_000).toISOString(),
    status: ["scheduled", "confirmed", "confirmed", "completed", "no_show", "cancelled"][i],
    customer_id: `customer-${(i % CUSTOMER_NAMES.length) + 1}`,
    resource_id: `resource-${(i % 3) + 1}`,
    party_size: 2 + (i % 5),
    structured_payload: { occasion: i % 2 === 0 ? "birthday" : null, seating: "booth" },
    quoted_rate_cents: null,
    identity_verified_by: i % 2 === 0 ? "phone_match" : null,
  })),

  payment_links: [
    {
      id: "paylink-1",
      tenant_id: PREVIEW_TENANT_ID,
      booking_id: "booking-1",
      amount_cents: 4500,
      purpose: "Deposit",
      status: "sent",
      created_at: daysAgoIso(1),
    },
  ],

  waitlist_entries: [
    {
      id: "waitlist-1",
      tenant_id: PREVIEW_TENANT_ID,
      customer_id: "customer-2",
      status: "active",
      window: "[2026-09-12T23:00:00Z,2026-09-13T01:00:00Z)",
      created_at: daysAgoIso(0),
    },
  ],

  availability_slots: Array.from({ length: 5 }, (_, i) => ({
    id: `slot-${i + 1}`,
    tenant_id: PREVIEW_TENANT_ID,
    resource_id: "resource-1",
    is_available: true,
    slot_range: `[${new Date(Date.now() + (i + 1) * 3_600_000).toISOString()},${new Date(Date.now() + (i + 1) * 3_600_000 + 1_800_000).toISOString()})`,
  })),

  resources: [
    {
      id: "resource-1",
      tenant_id: PREVIEW_TENANT_ID,
      name: "Patio table 4",
      type: "table",
      capacity: 4,
    },
    {
      id: "resource-2",
      tenant_id: PREVIEW_TENANT_ID,
      name: "Bar seating",
      type: "table",
      capacity: 2,
    },
  ],

  offerings: [
    {
      id: "offering-1",
      tenant_id: PREVIEW_TENANT_ID,
      name: "Prix fixe dinner",
      category: "Dinner menu",
      duration_minutes: 90,
      price_cents: 6500,
      resource_type_required: "table",
      metadata: {},
      active: true,
    },
    {
      id: "offering-2",
      tenant_id: PREVIEW_TENANT_ID,
      name: "Wine pairing add-on",
      category: "Add-ons",
      duration_minutes: null,
      price_cents: 2500,
      resource_type_required: null,
      metadata: {},
      active: true,
    },
  ],

  agent_configs: [
    {
      id: "agent-config-1",
      tenant_id: PREVIEW_TENANT_ID,
      greeting: "Thanks for calling Golden Fork Bistro — this call may be recorded for quality.",
      language: "en",
      manual_mode: false,
      transfer_number: "+15125559876",
      special_instructions:
        "If a caller asks about private events or buyouts, take a message instead of quoting pricing.",
      // Agent Settings -> AI Instructions reads manager_name/manager_phone/
      // voicemail_message/parking_info/accessibility_notes out of this jsonb
      // blob (aiInstructionsSchema) — left `{}` the tab rendered every one
      // of those fields blank, which looks unfinished next to the rest of
      // Agent Settings' realistic sample data (round-5/6 tenant design
      // review).
      dynamic_variable_overrides: {
        voicemail_message:
          "You've reached Golden Fork Bistro after hours. Leave your name and number and we'll call you back tomorrow.",
        manager_name: "Priya Natarajan",
        manager_phone: "+15125559876",
        parking_info:
          "Free lot parking behind the building, plus metered street parking on Main St.",
        accessibility_notes:
          "Step-free entrance on Main St.; two accessible tables near the host stand.",
      },
    },
  ],

  // Billing -> Invoices reads `period_start`/`period_end`/`total_cents`/
  // `status` and renders the first two as a raw `${a} – ${b}` string — with
  // no hand-authored fixture here, mock-fetch.ts's generic synthesizer (no
  // "period_start"/"period_end" column-name pattern matches its `_at`
  // check) produced the literal placeholder text "Sample period start –
  // Sample period end" for every invoice row (round-5/6 tenant design
  // review).
  billing_invoices: Array.from({ length: 3 }, (_, i) => {
    const periodStart = daysAgoIso(30 * (i + 1)).slice(0, 10);
    const periodEnd = daysAgoIso(30 * i).slice(0, 10);
    return {
      id: `invoice-${i + 1}`,
      tenant_id: PREVIEW_TENANT_ID,
      period_start: periodStart,
      period_end: periodEnd,
      total_cents: 24900 + i * 350,
      status: i === 0 ? "open" : "paid",
    };
  }),

  support_requests: [
    {
      id: "support-1",
      tenant_id: PREVIEW_TENANT_ID,
      tenant_name: PREVIEW_TENANT.name,
      subject: "Caller ID not showing our forwarded number",
      body: "Since we turned on forwarding, callers see our Twilio number instead of our own. Can this be fixed?",
      status: "open",
      priority: "high",
      created_at: daysAgoIso(2),
      updated_at: daysAgoIso(1),
    },
    {
      id: "support-2",
      tenant_id: PREVIEW_TENANT_ID,
      tenant_name: PREVIEW_TENANT.name,
      subject: "Add a second phone line",
      body: "We're opening a second location and would like a second forwarded number on the same account.",
      status: "resolved",
      priority: "normal",
      created_at: daysAgoIso(12),
      updated_at: daysAgoIso(10),
    },
  ],

  support_request_notes: [
    {
      id: "support-note-1",
      support_request_id: "support-1",
      body: "Escalated to the telephony team — checking the SIP trunk config.",
      created_at: daysAgoIso(1),
    },
  ],

  referral_partners: [PREVIEW_PARTNER],
  referral_links: [
    { id: "reflink-1", referral_partner_id: PREVIEW_PARTNER_ID, code: "RIVERSIDE10" },
  ],
  // `referred_tenant_id` points at real `tenants` fixture ids (not a
  // synthesized "referred_tenant-N" guess) so /portal/customers' server-role
  // `tenants` lookup (`.in("id", tenantIds)`) actually resolves a name
  // instead of falling back to the literal "Customer" placeholder.
  referrals: [
    {
      id: "referral-1",
      referral_partner_id: PREVIEW_PARTNER_ID,
      referred_tenant_id: PREVIEW_TENANT_ID,
      status: "paid",
      qualified_at: daysAgoIso(45),
      amount_cents_snapshot: 15000,
      created_at: daysAgoIso(50),
    },
    {
      id: "referral-2",
      referral_partner_id: PREVIEW_PARTNER_ID,
      referred_tenant_id: "tenant-2",
      status: "qualified",
      qualified_at: daysAgoIso(18),
      amount_cents_snapshot: 9000,
      created_at: daysAgoIso(20),
    },
    {
      id: "referral-3",
      referral_partner_id: PREVIEW_PARTNER_ID,
      referred_tenant_id: PREVIEW_TENANT_ID,
      status: "pending",
      qualified_at: null,
      amount_cents_snapshot: null,
      created_at: daysAgoIso(3),
    },
  ],

  commission_events: [
    {
      id: "commission-1",
      referral_id: "referral-1",
      referral_partner_id: PREVIEW_PARTNER_ID,
      period: daysAgoIso(30, 0).slice(0, 7),
      base_cents: 15000,
      rate_bps: 1000,
      amount_cents: 1500,
      status: "paid",
    },
  ],

  orders: Array.from({ length: 4 }, (_, i) => {
    const subtotal_cents = 9000 + i * 850;
    const tax_cents = 743 + i * 70;
    const tip_cents = 1500;
    const delivery_fee_cents = i % 2 === 0 ? 0 : 499;
    return {
      id: `order-${i + 1}`,
      tenant_id: PREVIEW_TENANT_ID,
      status: ["received", "preparing", "ready", "completed"][i],
      // Matches `customers` fixture ids exactly (not a synthesized "customer-N"
      // guess) so the order-detail page's follow-up customer lookup resolves.
      customer_id: `customer-${(i % CUSTOMER_NAMES.length) + 1}`,
      items: [
        {
          offering_id: "offering-1",
          name: "Prix fixe dinner",
          qty: 1 + (i % 2),
          unit_price_cents: 6500,
        },
        {
          offering_id: "offering-2",
          name: "Wine pairing add-on",
          qty: 1,
          unit_price_cents: 2500,
          modifiers: i % 2 === 0 ? ["No red wine"] : [],
        },
      ],
      fulfillment_type: i % 2 === 0 ? "pickup" : "delivery",
      delivery_address:
        i % 2 === 0
          ? null
          : { line1: "142 Riverside Dr", city: "Austin", state: "TX", zip: "78701" },
      subtotal_cents,
      tax_cents,
      tip_cents,
      delivery_fee_cents,
      // Always the sum of the line items above — a founder reviewing their
      // own order page notices a total that doesn't reconcile (round-3
      // tenant design review, low).
      total_cents: subtotal_cents + tax_cents + tip_cents + delivery_fee_cents,
      allergies: i === 1 ? ["peanuts"] : [],
      special_instructions: i === 2 ? "Please knock, don't ring the bell." : null,
      created_at: daysAgoIso(i),
    };
  }),

  // Column names match exactly what messages-list-client.tsx /
  // message-thread-client.tsx select (`from_e164`, `recipient`,
  // `template_key`/`payload`, `channel`, `handled`) — a mismatched shape
  // here (e.g. the old `to_phone`/`from_phone`/`body`-only rows) falls
  // through to mock-fetch.ts's generic synthesizer, which produced the
  // literal placeholder string "Sample from e164" (round-3 tenant design
  // review, low) and a truthy `sms_opt_out`-shaped fallback that showed
  // every customer as opted out.
  messages_outbound: [
    {
      id: "msg-out-1",
      tenant_id: PREVIEW_TENANT_ID,
      recipient: "+15125551000",
      channel: "sms",
      template_key: "booking_confirmation",
      payload: {},
      status: "delivered",
      created_at: daysAgoIso(1),
    },
  ],
  messages_inbound: [
    {
      id: "msg-in-1",
      tenant_id: PREVIEW_TENANT_ID,
      from_e164: "+15125551000",
      body: "Can we push to 7:30?",
      handled: true,
      created_at: daysAgoIso(0),
    },
  ],

  memberships: [
    {
      id: "member-1",
      tenant_id: PREVIEW_TENANT_ID,
      user_id: PREVIEW_TENANT_USER.id,
      email: "owner@goldenforkbistro.example",
      invited_email: "owner@goldenforkbistro.example",
      role: "owner",
      accepted_at: daysAgoIso(90),
      created_at: daysAgoIso(90),
    },
    {
      id: "member-2",
      tenant_id: PREVIEW_TENANT_ID,
      user_id: "66666666-6666-4666-8666-666666666666",
      email: "manager@goldenforkbistro.example",
      invited_email: "manager@goldenforkbistro.example",
      role: "admin",
      accepted_at: daysAgoIso(60),
      created_at: daysAgoIso(75),
    },
    {
      id: "member-3",
      tenant_id: PREVIEW_TENANT_ID,
      user_id: "77777777-7777-4777-8777-777777777777",
      email: null,
      invited_email: "new-hire@goldenforkbistro.example",
      role: "member",
      accepted_at: null,
      created_at: daysAgoIso(2),
    },
  ],
};

/**
 * Hand-mapped responses for the internal `/api/**` routes with the
 * highest screenshot value, keyed by exact pathname (query strings and
 * HTTP method are ignored for these — every one of these routes is a plain
 * GET). Anything not listed here falls back to a generic, non-crashing
 * shape in `mock-fetch.ts` (usually `{ rows: [] }`, which renders as a real
 * `EmptyState`, not a broken page) or to `API_FIXTURE_MATCHERS` below for
 * dynamic `[id]` paths and non-GET methods.
 */
export const API_FIXTURES: Record<string, unknown> = {
  // Overview + Billing both fall back to `?? 0` for `included_minutes`
  // when this route resolves to the generic `{ rows: [] }` default, which
  // is what produced Billing's "0 of 0 minutes used" placeholder (round-3
  // tenant design review, medium/low — same root cause class as the
  // missing `usage_daily` fixture above).
  "/api/platform-settings/tenant-plan": {
    vertical: "restaurant",
    included_minutes: 300,
    base_cents: 24900,
    overage_cents: 35,
    usage_alert_thresholds: { warn_pct: 0.8, critical_pct: 1.0 },
  },

  // Real `admin-tenants` list route (`supabase/functions/admin/handler.ts`)
  // responds `{ tenants: [...] }`, and its `select id, name, vertical,
  // status ...` never carries `plan_code`/`mrr_cents`/`margin_pct` (those
  // aren't columns on `public.tenants` at all — see the `admin-tenants/:id`
  // fixture below). The list PAGE still destructures those fields for its
  // MRR/Margin columns per FRONTEND_SPEC.md's "margin cockpit" design, so —
  // matching this file's existing "fixture matches the page" convention —
  // this fixture layers them onto `TABLE_FIXTURES.tenants` rather than
  // leaving every row blank (round-2 admin-partner design review, major:
  // list page showed "—" for every row while the detail page's own,
  // equally-fabricated fixture showed real numbers for the same tenant).
  // The second tenant is left without figures on purpose — it's `trialing`,
  // which realistically has no MRR yet — so the page's "—" fallback still
  // gets exercised for a case where it's actually correct.
  "/api/admin/admin-tenants": {
    tenants: TABLE_FIXTURES["tenants"]?.map((t, i) =>
      i === 0
        ? { ...t, plan_code: "growth", mrr_cents: 24900, margin_pct: 62 }
        : { ...t, plan_code: "trial", mrr_cents: null, margin_pct: null },
    ),
  },
  "/api/admin/admin-support-requests": { rows: TABLE_FIXTURES["support_requests"] },
  "/api/admin/admin-referral-partners": { rows: TABLE_FIXTURES["referral_partners"] },

  // Every one of these is a "use client" tenant-dashboard panel that
  // fetches its OWN `/api/tenant/**` route from the browser — UI Preview
  // Mode's fetch interceptor answers that fetch directly (see
  // `mock-fetch.ts`'s `isAppApiPath`), so the real Next.js Route Handler
  // (and its Supabase/service-role reads) never runs in preview at all.
  // These fixtures are hand-shaped to each route's own exported response
  // interface, not to the underlying tables, per
  // `docs/audit/DESIGN_REQUESTS.md` "cluster repair:tenant" /
  // round-3 tenant + admin-partner design reviews.
  "/api/tenant/setup-progress": {
    steps: [
      {
        id: "paid",
        label: "Add a payment method",
        description: "Your plan needs an active subscription before calls can bill.",
        href: "/dashboard/billing",
        done: true,
        optional: false,
      },
      {
        id: "agent_provisioned",
        label: "Publish your AI agent",
        description: "Your assistant needs to be compiled and published at least once.",
        href: "/dashboard/agent",
        done: true,
        optional: false,
      },
      {
        id: "business_hours",
        label: "Set your business hours",
        description: "Callers hear accurate hours and after-hours handling.",
        href: "/dashboard/agent/hours",
        done: true,
        optional: false,
      },
      {
        id: "services",
        label: "Add services or menu items",
        description: "Your AI can only book or sell what's configured here.",
        href: "/dashboard/setup/offerings",
        done: true,
        optional: false,
      },
      {
        id: "policies_reviewed",
        label: "Review your cancellation & booking policy",
        description: "The agent reads this back to callers verbatim.",
        href: "/dashboard/agent/vertical-details",
        done: false,
        optional: false,
      },
      {
        id: "test_call",
        label: "Test your agent",
        description: "Run a test call and confirm the transcript and booking look right.",
        href: "/dashboard/test-agent",
        done: true,
        optional: false,
      },
      {
        id: "forwarding",
        label: "Turn on call forwarding",
        description: "Forward your real business line so live calls reach your agent.",
        href: "/dashboard/phone-setup",
        done: true,
        optional: false,
      },
      {
        id: "delivery_preferences",
        label: "Set delivery preferences",
        description: "Choose how you're notified of new bookings, orders, and messages.",
        href: "/dashboard/delivery",
        done: false,
        optional: false,
      },
      {
        id: "team_invited",
        label: "Invite your team",
        description: "Give teammates their own dashboard sign-in.",
        href: "/dashboard/team",
        done: true,
        optional: true,
      },
      {
        id: "a2p",
        label: "Complete SMS registration (A2P 10DLC)",
        description: "Required by carriers before booking/order text messages can send.",
        href: "/dashboard/delivery",
        done: false,
        optional: false,
      },
      {
        id: "integrations",
        label: "Connect an integration (optional)",
        description: "Sync bookings to your existing calendar, POS, or CRM.",
        href: "/dashboard/integrations",
        done: false,
        optional: true,
      },
    ],
    requiredTotal: 8,
    requiredDone: 6,
    complete: false,
  },

  "/api/tenant/team": {
    members: [
      {
        id: "member-1",
        role: "owner",
        email: "owner@goldenforkbistro.example",
        invited_email: "owner@goldenforkbistro.example",
        accepted: true,
        created_at: daysAgoIso(90),
      },
      {
        id: "member-2",
        role: "admin",
        email: "manager@goldenforkbistro.example",
        invited_email: "manager@goldenforkbistro.example",
        accepted: true,
        created_at: daysAgoIso(75),
      },
      {
        id: "member-3",
        role: "member",
        email: null,
        invited_email: "new-hire@goldenforkbistro.example",
        accepted: false,
        created_at: daysAgoIso(2),
      },
    ],
  },

  "/api/tenant/delivery/airtable/status": {
    status: "connected",
    base_name: "Golden Fork Bistro Ops",
    last_synced_at: daysAgoIso(0, 6),
    sync_log: [
      {
        entity_type: "booking",
        entity_id: "booking-1",
        last_synced_at: daysAgoIso(0, 6),
        sync_conflict: false,
      },
      {
        entity_type: "customer",
        entity_id: "customer-1",
        last_synced_at: daysAgoIso(1, 9),
        sync_conflict: false,
      },
      {
        entity_type: "order",
        entity_id: "order-2",
        last_synced_at: daysAgoIso(2, 14),
        sync_conflict: true,
      },
    ],
  },

  "/api/tenant/integrations": {
    integrations: [
      {
        provider: "square",
        display_name: "Square",
        status: "connected",
        last_refreshed_at: daysAgoIso(0, 7),
        last_error: null,
        can_manage: true,
      },
      {
        provider: "google_calendar",
        display_name: "Google Calendar",
        status: "connected",
        last_refreshed_at: daysAgoIso(1, 8),
        last_error: null,
        can_manage: true,
      },
      {
        provider: "shopmonkey",
        display_name: "Shopmonkey",
        status: "error",
        last_refreshed_at: daysAgoIso(5, 11),
        last_error: "Access token expired — reconnect required.",
        can_manage: true,
      },
      {
        provider: "ezyvet",
        display_name: "ezyVet",
        status: "disconnected",
        last_refreshed_at: null,
        last_error: null,
        can_manage: true,
      },
    ],
  },
};

/**
 * Method-aware / dynamic-path `/api/**` fixtures — `API_FIXTURES` above
 * only exact-matches a fixed GET pathname, which can't express a `[id]`
 * detail route (`/api/admin/admin-tenants/demo`) or a POST-only endpoint
 * (`/api/tenant/refer/ensure-link`). Matched in `mock-fetch.ts` after an
 * `API_FIXTURES` miss, in array order, first match wins. Each `build`
 * result is shaped to exactly what the calling page destructures (grepped
 * from each page's `useAdminQuery`/`useQuery` call site), not to the real
 * backend's own response envelope, which several of these deliberately
 * differ from (e.g. `admin-tenants/:id` — see comment below).
 */
export interface ApiFixtureMatcher {
  method: "GET" | "POST" | "PATCH" | "*";
  pattern: RegExp;
  build: (match: RegExpMatchArray) => unknown;
}

export const API_FIXTURE_MATCHERS: ApiFixtureMatcher[] = [
  // `TenantDetailPage` (apps/web/.../cockpit/tenants/[id]/page.tsx) reads
  // `{ tenant, metrics }` — matching the real `admin-tenants/:id` edge
  // function, which wraps the raw row in `tenant` and computes MRR/
  // margin/minutes server-side (from `v_tenant_margin`/`usage_daily`,
  // since `tenants` itself has no such columns) into a separate `metrics`
  // object (admin-partner design review round 5, major: page/API contract
  // mismatch — fixed for real in `supabase/functions/admin/handler.ts`,
  // this fixture now mirrors that same shape).
  {
    method: "GET",
    pattern: /^\/api\/admin\/admin-tenants\/([^/]+)$/,
    build: () => ({
      tenant: {
        id: PREVIEW_TENANT_ID,
        name: PREVIEW_TENANT.name,
        status: PREVIEW_TENANT.status,
        plan_code: "growth",
        vertical: PREVIEW_TENANT.vertical,
      },
      metrics: {
        mrr_cents: 24900,
        margin_pct: 62,
        minutes_used: 340,
      },
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/admin-referral-partners\/([^/]+)$/,
    build: () => ({
      partner: {
        id: PREVIEW_PARTNER_ID,
        name: PREVIEW_PARTNER.name,
        email: "partner@riversidereferral.example",
        rate_bps: 1000,
        commission_base: "gross_profit",
        duration_months: 12,
      },
      overrides: [
        {
          vertical: "restaurant",
          rate_bps: 1200,
          commission_base: "gross_profit",
          duration_months: 12,
        },
      ],
    }),
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/admin-support-requests\/([^/]+)\/notes$/,
    build: () => ({ notes: TABLE_FIXTURES["support_request_notes"] }),
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/admin-support-requests\/([^/]+)$/,
    build: () => {
      const ticket = TABLE_FIXTURES["support_requests"]?.[0] as Record<string, unknown>;
      return {
        ticket: {
          id: ticket?.["id"],
          tenant_name: ticket?.["tenant_name"],
          tenant_vertical: PREVIEW_TENANT.vertical,
          subject: ticket?.["subject"],
          body: ticket?.["body"],
          status: ticket?.["status"],
          priority: ticket?.["priority"],
          created_at: ticket?.["created_at"],
        },
        notes: TABLE_FIXTURES["support_request_notes"]?.map((n) => ({
          ...n,
          author_id: PREVIEW_ADMIN_USER_ID,
        })),
      };
    },
  },
  // `TemplateEditorPage` (cockpit/templates/[vertical]) — same
  // generic-fallback gap as the routes below: with no matcher, the "System
  // prompt"/"States (JSON)" textareas' `defaultValue` was always
  // `undefined`, rendering as empty with no indication anything was
  // supposed to be there (admin-partner design review round 5, major).
  // Content below is representative of the real compiled templates
  // (`packages/templates/src/verticals/*.ts`, not imported directly — this
  // package has no dependency on `@heyloo/templates` and fixtures here are
  // hand-authored, matching the file's own convention) so every vertical
  // renders a plausible, non-empty template rather than one hardcoded
  // vertical's content leaking onto every other vertical's detail page.
  {
    method: "GET",
    pattern: /^\/api\/admin\/admin-templates\/([^/]+)$/,
    build: (match) => {
      const vertical = decodeURIComponent(match[1] ?? "generic").replace(/_/g, " ");
      return {
        system_prompt:
          `You are the friendly front-desk assistant for a ${vertical} business. Your job is ` +
          "a new booking, a reschedule/cancel, a status check, or a message — never advice or " +
          "a firm quote over the phone; the business's own staff handles that in person. " +
          "Always disclose upfront that you are an AI assistant and that this call may be " +
          "recorded. Stay within the business's configured hours and services; if a caller " +
          "asks for something out of scope, offer to take a message instead.",
        states: [
          { name: "greeting", type: "conversation", next: ["collect_caller_info"] },
          {
            name: "collect_caller_info",
            type: "slot_fill",
            slots: ["name", "phone"],
            next: ["identify_need"],
          },
          {
            name: "identify_need",
            type: "conversation",
            next: ["check_availability", "take_message", "transfer_to_human"],
          },
          {
            name: "check_availability",
            type: "tool",
            tool: "check_availability",
            next: ["book"],
          },
          { name: "book", type: "tool", tool: "create_booking", next: ["confirm"] },
          { name: "confirm", type: "conversation", next: [] },
          { name: "take_message", type: "tool", tool: "take_message", next: [] },
          { name: "transfer_to_human", type: "tool", tool: "transfer_call", next: [] },
        ],
        transitions: [
          { from: "greeting", to: "collect_caller_info", on: "caller_responds" },
          { from: "identify_need", to: "check_availability", on: "wants_booking" },
        ],
        tools: ["check_availability", "create_booking", "take_message", "transfer_call"],
      };
    },
  },
  // `CampaignDetailPage` (cockpit/outreach/campaigns/[id]) — this dynamic
  // route wasn't in `API_FIXTURE_MATCHERS`, so it fell through to the
  // generic `{ rows: [] }` default below, which the page has no use for
  // (it destructures `name`/`status`/`funnel`/`leads`, not `rows`) — every
  // field read undefined, rendering "Unnamed campaign" / an "Unknown"
  // status badge (round-2 admin-partner design review, moderate).
  {
    method: "GET",
    pattern: /^\/api\/admin\/admin-outreach\/campaigns\/([^/]+)$/,
    build: () => ({
      name: "Spring Vet Clinics Outreach",
      status: "active",
      funnel: [
        { label: "Sent", count: 480 },
        { label: "Opened", count: 210 },
        { label: "Replied", count: 34 },
        { label: "Qualified", count: 12 },
        { label: "Signed up", count: 4 },
      ],
      leads: [
        {
          id: "lead-1",
          companyName: "Sunrise Animal Hospital",
          contactName: "Dr. Priya Nair",
          email: "priya@sunriseanimalhospital.example",
          status: "replied",
          suppressed: false,
          isDuplicate: false,
        },
        {
          id: "lead-2",
          companyName: "Lakeside Vet Care",
          contactName: "Tom Hendricks",
          email: "tom@lakesidevet.example",
          status: "sent",
          suppressed: false,
          isDuplicate: false,
        },
        {
          id: "lead-3",
          companyName: "Maple Street Animal Clinic",
          contactName: null,
          email: "hello@maplestreetanimal.example",
          status: "suppressed",
          suppressed: true,
          isDuplicate: false,
        },
      ],
    }),
  },
  // `TenantMarginDetailPage` (cockpit/margin/customers/[tenantId]) — same
  // generic-fallback gap as the outreach campaign detail route above.
  {
    method: "GET",
    pattern: /^\/api\/admin\/admin-cockpit\/per-customer-margin\/([^/]+)$/,
    build: () => ({
      calls: Array.from({ length: 5 }, (_, i) => ({
        call_id: `call-${i + 1}`,
        cost_cents: 180 + i * 12,
        billed_cents: 250,
        delta_cents: 250 - (180 + i * 12),
      })),
      suggestedAction:
        "Cost per call is trending up — consider moving this tenant to the Growth plan.",
    }),
  },
  // Tenant "refer & earn" find-or-create (Cluster H item 4) — POST-only,
  // never a GET, so it can't live in the exact-match `API_FIXTURES` map
  // above (whose entries are all read via GET).
  {
    method: "POST",
    pattern: /^\/api\/tenant\/refer\/ensure-link$/,
    build: () => ({
      code: "RIVERSIDE10",
      partner_id: PREVIEW_PARTNER_ID,
      funnel: { signups: 3, qualified: 2, paid: 1 },
      w9_status: "verified",
      ytd_payout_cents: 15000,
      approaching_w9_threshold: false,
    }),
  },
];
