import { describe, expect, it, vi } from "vitest";

const call = {
  id: "c1",
  caller_number: "+15125551000",
  started_at: "2026-09-29T15:30:00Z",
  classification: "new_booking",
  // What voice-events actually stores today: the provider's transcript_object verbatim.
  transcript: [
    { role: "agent", content: "Hi, thanks for calling.", words: [{ word: "Hi", start: 0.4 }] },
    { role: "user", content: "I need a table.", words: [{ word: "I", start: 5.5 }] },
  ],
  state_trace: [],
  recording_url: null,
  stereo_recording_url: null,
  duration_seconds: 62,
  ended_at: "2026-09-29T15:31:02Z",
  structured_booking_payload: { booking_id: "b1" },
  urgency_flag: false,
  call_summary: null,
  sentiment: null,
  follow_up_needed: false,
  legal_advice_given: false,
  extracted_entities: null,
  message_text: null,
  outcome: null,
};

let customerRow: { id: string; name: string | null } | null = { id: "cu1", name: "Jamie Cruz" };
const selects: string[] = [];

function chain(table: string) {
  const obj: Record<string, unknown> = {};
  for (const m of ["eq"]) obj[m] = vi.fn(() => obj);
  obj["select"] = vi.fn((cols: string) => {
    if (table === "call_logs") selects.push(cols);
    return obj;
  });
  obj["maybeSingle"] = vi.fn(async () => ({
    data: table === "call_logs" ? call : customerRow,
    error: null,
  }));
  return obj;
}

vi.mock("@/lib/auth/require-tenant-session", () => ({
  requireTenantSession: async () => ({
    supabase: { from: (table: string) => chain(table) },
    tenant: { id: "t1" },
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/tenant/call-detail-client", () => ({ CallDetailClient: () => null }));

import CallDetailPage from "./page";

async function props() {
  const el = (await CallDetailPage({ params: Promise.resolve({ id: "c1" }) })) as {
    props: { call: Record<string, unknown> };
  };
  return el.props.call;
}

describe("CallDetailPage data (QA-1 F-06 / F-3 / MAP-02)", () => {
  it("selects the caller number and start time and passes the matching customer", async () => {
    customerRow = { id: "cu1", name: "Jamie Cruz" };
    const data = await props();
    expect(selects[0]).toContain("caller_number");
    expect(selects[0]).toContain("started_at");
    expect(data["callerNumber"]).toBe("+15125551000");
    expect(data["startedAt"]).toBe("2026-09-29T15:30:00Z");
    expect(data["customer"]).toEqual({ id: "cu1", name: "Jamie Cruz" });
  });

  it("passes null when the number matches no customer", async () => {
    customerRow = null;
    expect((await props())["customer"]).toBeNull();
  });

  it("normalises the provider-shaped transcript so no turn is blank or NaN", async () => {
    const data = await props();
    expect(data["transcript"]).toEqual([
      { speaker: "AI assistant", text: "Hi, thanks for calling.", ts: 0.4 },
      { speaker: "Caller", text: "I need a table.", ts: 5.5 },
    ]);
  });
});
