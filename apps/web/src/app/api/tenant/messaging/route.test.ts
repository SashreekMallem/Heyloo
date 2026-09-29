import { describe, expect, it, vi } from "vitest";
import { textingState } from "@/lib/messaging/texting-setup";

function chain(result: unknown, onUpsert?: (payload: unknown, options: unknown) => void) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "maybeSingle"]) obj[method] = vi.fn(() => obj);
  obj["upsert"] = vi.fn((payload: unknown, options: unknown) => {
    onUpsert?.(payload, options);
    return obj;
  });
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
  (obj as { then: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return obj;
}

let claims: Record<string, unknown> = { tenant_id: "t1", role: "owner" };
let tables: Record<string, unknown> = {};
const upserts: Array<{ payload: unknown; options: unknown }> = [];

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: claims["tenant_id"] ? { id: "u1" } : null } }),
      getClaims: async () => ({ data: { claims: { app_metadata: claims } }, error: null }),
    },
    from: vi.fn((table: string) =>
      chain(tables[table] ?? { data: null, error: null }, (payload, options) => {
        upserts.push({ payload, options });
      }),
    ),
  }),
}));

const { GET, PUT } = await import("./route");

const PROFILE_ROW = {
  tenant_id: "t1",
  legal_name: "Riverside Auto Repair LLC",
  dba_name: null,
  business_type: "llc",
  ein: "123456789",
  website_url: null,
  street_line1: "1 Main St",
  street_line2: null,
  city: "Springfield",
  region: "IL",
  postal_code: "62701",
  country: "US",
  contact_first_name: "Dana",
  contact_last_name: "Lee",
  contact_email: "dana@example.com",
  contact_phone_e164: "+15551234567",
  monthly_volume_estimate: 1000,
  submitted_at: "2026-09-29T00:00:00Z",
};

const VALID_BODY = {
  legal_name: "Riverside Auto Repair LLC",
  business_type: "llc",
  ein: "12-3456789",
  street_line1: "1 Main St",
  city: "Springfield",
  region: "IL",
  postal_code: "62701",
  contact_first_name: "Dana",
  contact_last_name: "Lee",
  contact_email: "dana@example.com",
  contact_phone: "+15551234567",
  monthly_volume_estimate: 1000,
};

function put(body: unknown) {
  return new Request("http://localhost/api/tenant/messaging", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("textingState", () => {
  const sender = (registration_status: string) => ({
    e164: "+18885550100",
    kind: "toll_free" as const,
    registration_status,
    failure_reason: null,
  });

  it("walks not_started -> details_submitted -> in_review -> active, with action_needed on rejection", () => {
    expect(
      textingState({ a2pStatus: "pending_verification", sender: null, profileSubmitted: false }),
    ).toBe("not_started");
    expect(
      textingState({ a2pStatus: "pending_verification", sender: null, profileSubmitted: true }),
    ).toBe("details_submitted");
    expect(
      textingState({
        a2pStatus: "pending_verification",
        sender: sender("in_review"),
        profileSubmitted: true,
      }),
    ).toBe("in_review");
    expect(
      textingState({
        a2pStatus: "pending_verification",
        sender: sender("verified"),
        profileSubmitted: true,
      }),
    ).toBe("active");
    expect(
      textingState({
        a2pStatus: "pending_verification",
        sender: sender("failed"),
        profileSubmitted: true,
      }),
    ).toBe("action_needed");
  });
});

describe("GET /api/tenant/messaging", () => {
  it("401s without a session", async () => {
    claims = {};
    expect((await GET()).status).toBe(401);
  });

  it("returns the carrier status and the saved profile with a formatted EIN", async () => {
    claims = { tenant_id: "t1", role: "owner" };
    tables = {
      tenants: { data: { a2p_status: "pending_verification" }, error: null },
      messaging_senders: {
        data: [
          {
            e164: "+18885550100",
            kind: "toll_free",
            registration_status: "in_review",
            failure_reason: null,
            is_default: true,
          },
        ],
        error: null,
      },
      messaging_business_profiles: { data: PROFILE_ROW, error: null },
    };
    const res = await GET();
    const body = await res.json();
    expect(body.state).toBe("in_review");
    expect(body.sender).toEqual({
      e164: "+18885550100",
      kind: "toll_free",
      registration_status: "in_review",
      failure_reason: null,
    });
    expect(body.profile.ein).toBe("12-3456789");
    expect(body.profile.contact_phone).toBe("+15551234567");
    expect(body.can_edit).toBe(true);
  });
});

describe("PUT /api/tenant/messaging", () => {
  it("only lets the owner or an admin save business details", async () => {
    claims = { tenant_id: "t1", role: "member" };
    expect((await PUT(put(VALID_BODY))).status).toBe(403);
  });

  it("422s on an LLC without an EIN", async () => {
    claims = { tenant_id: "t1", role: "owner" };
    const { ein: _ein, ...noEin } = VALID_BODY;
    expect((await PUT(put(noEin))).status).toBe(422);
  });

  it("upserts the caller's own tenant row with the EIN stored as digits", async () => {
    claims = { tenant_id: "t1", role: "admin" };
    tables = { messaging_business_profiles: { data: null, error: null } };
    upserts.length = 0;
    const res = await PUT(put({ ...VALID_BODY, tenant_id: "someone-else" }));
    expect(res.status).toBe(200);
    expect(upserts[0]?.options).toEqual({ onConflict: "tenant_id" });
    expect(upserts[0]?.payload).toMatchObject({
      tenant_id: "t1",
      ein: "123456789",
      contact_phone_e164: "+15551234567",
      country: "US",
    });
    const saved = upserts[0]?.payload as { submitted_at?: string } | undefined;
    expect(saved?.submitted_at).toBeTruthy();
  });
});
