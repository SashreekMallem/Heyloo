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

  call_logs: Array.from({ length: 8 }, (_, i) => ({
    id: `call-${i + 1}`,
    tenant_id: PREVIEW_TENANT_ID,
    classification: CALL_CLASSES[i % CALL_CLASSES.length],
    transcript: [
      {
        role: "agent",
        text: "Thanks for calling Golden Fork Bistro — this call may be recorded. How can I help?",
      },
      { role: "caller", text: "Hi, I'd like a table for four tonight around 7." },
      { role: "agent", text: "I can do 7:15 for four — would that work?" },
      { role: "caller", text: "Perfect, thank you." },
    ],
    state_trace: [{ state: "greeting" }, { state: "collect_party_size" }, { state: "book" }],
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
  })),

  customers: CUSTOMER_NAMES.map((name, i) => ({
    id: `customer-${i + 1}`,
    tenant_id: PREVIEW_TENANT_ID,
    name,
    phone_e164: `+1512555${String(1000 + i).padStart(4, "0")}`,
    email: `${name.split(" ")[0]?.toLowerCase()}@example.com`,
    consent: { sms: i % 2 === 0, call: true, captured_at: daysAgoIso(30 + i) },
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
      price_cents: 6500,
      active: true,
    },
    {
      id: "offering-2",
      tenant_id: PREVIEW_TENANT_ID,
      name: "Wine pairing add-on",
      price_cents: 2500,
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
    },
  ],

  support_requests: [
    {
      id: "support-1",
      tenant_id: PREVIEW_TENANT_ID,
      subject: "Caller ID not showing our forwarded number",
      status: "open",
      created_at: daysAgoIso(2),
    },
    {
      id: "support-2",
      tenant_id: PREVIEW_TENANT_ID,
      subject: "Add a second phone line",
      status: "resolved",
      created_at: daysAgoIso(12),
    },
  ],

  referral_partners: [PREVIEW_PARTNER],
  referral_links: [
    { id: "reflink-1", referral_partner_id: PREVIEW_PARTNER_ID, code: "RIVERSIDE10" },
  ],
  referrals: [
    {
      id: "referral-1",
      referral_partner_id: PREVIEW_PARTNER_ID,
      status: "paid",
      created_at: daysAgoIso(50),
    },
    {
      id: "referral-2",
      referral_partner_id: PREVIEW_PARTNER_ID,
      status: "qualified",
      created_at: daysAgoIso(20),
    },
    {
      id: "referral-3",
      referral_partner_id: PREVIEW_PARTNER_ID,
      status: "pending",
      created_at: daysAgoIso(3),
    },
  ],

  orders: Array.from({ length: 4 }, (_, i) => ({
    id: `order-${i + 1}`,
    tenant_id: PREVIEW_TENANT_ID,
    status: ["received", "preparing", "ready", "completed"][i],
    total_cents: 3200 + i * 850,
    created_at: daysAgoIso(i),
  })),

  messages_outbound: [
    {
      id: "msg-out-1",
      tenant_id: PREVIEW_TENANT_ID,
      to_phone: "+15125551000",
      body: "Your table is confirmed for 7:15pm tonight.",
      status: "delivered",
      created_at: daysAgoIso(0),
    },
  ],
  messages_inbound: [
    {
      id: "msg-in-1",
      tenant_id: PREVIEW_TENANT_ID,
      from_phone: "+15125551000",
      body: "Can we push to 7:30?",
      created_at: daysAgoIso(0),
    },
  ],

  memberships: [
    {
      id: "member-1",
      tenant_id: PREVIEW_TENANT_ID,
      email: "owner@goldenforkbistro.example",
      role: "owner",
    },
    {
      id: "member-2",
      tenant_id: PREVIEW_TENANT_ID,
      email: "manager@goldenforkbistro.example",
      role: "admin",
    },
  ],
};

/**
 * Hand-mapped responses for the internal `/api/**` routes with the
 * highest screenshot value. Anything not listed here falls back to a
 * generic, non-crashing shape in `mock-fetch.ts` (usually `{ rows: [] }`,
 * which renders as a real `EmptyState`, not a broken page).
 */
export const API_FIXTURES: Record<string, unknown> = {
  "/api/admin/admin-tenants": { rows: TABLE_FIXTURES["tenants"] },
  "/api/admin/admin-support-requests": { rows: TABLE_FIXTURES["support_requests"] },
  "/api/admin/admin-referral-partners": { rows: TABLE_FIXTURES["referral_partners"] },
};
