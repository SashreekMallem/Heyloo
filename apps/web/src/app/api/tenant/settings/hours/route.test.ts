import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});
const regenerate = vi.fn(async (_tenantId: string) => ({ resources: 3, failed: 0 }));
vi.mock("@/lib/settings/availability", () => ({
  regenerateTenantAvailability: (tenantId: string) => regenerate(tenantId),
}));

const { POST } = await import("./route");

const url = "/api/tenant/settings/hours";
const open = { closed: false, windows: [{ open: "08:00", close: "18:00" }] };
const closed = { closed: true, windows: [{ open: "09:00", close: "13:00" }] };
const validBody = {
  hours: { mon: open, tue: open, wed: open, thu: open, fri: open, sat: open, sun: closed },
  exceptions: [{ date: "2026-11-26", closed: true, windows: [], note: "Thanksgiving" }],
};

beforeEach(() => {
  fake.reset();
  regenerate.mockClear();
});

describe("POST /api/tenant/settings/hours", () => {
  it("401s when signed out", async () => {
    expect((await POST(jsonRequest(url, validBody))).status).toBe(401);
  });

  it("422s on a blank exception date (would abort the nightly rollforward for every tenant)", async () => {
    fake.signInAs(OWNER);
    const res = await POST(
      jsonRequest(url, {
        ...validBody,
        exceptions: [{ date: "", closed: true, windows: [], note: "" }],
      }),
    );
    expect(res.status).toBe(422);
    expect(fake.callsTo("tenants", "update")).toHaveLength(0);
  });

  it("422s when closing is before opening", async () => {
    fake.signInAs(OWNER);
    const res = await POST(
      jsonRequest(url, {
        ...validBody,
        hours: {
          ...validBody.hours,
          mon: { closed: false, windows: [{ open: "18:00", close: "08:00" }] },
        },
      }),
    );
    expect(res.status).toBe(422);
  });

  it("stores the canonical shape (closed day = []) and regenerates availability now", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [{ id: "t1", vertical: "auto" }], error: null });
    const res = await POST(jsonRequest(url, validBody));
    expect(res.status).toBe(200);
    const update = fake.callsTo("tenants", "update")[0];
    expect(update?.filters).toContainEqual(["eq", "id", "t1"]);
    expect(update?.payload).toEqual({
      business_hours: {
        mon: [{ open: "08:00", close: "18:00" }],
        tue: [{ open: "08:00", close: "18:00" }],
        wed: [{ open: "08:00", close: "18:00" }],
        thu: [{ open: "08:00", close: "18:00" }],
        fri: [{ open: "08:00", close: "18:00" }],
        sat: [{ open: "08:00", close: "18:00" }],
        sun: [],
      },
      hours_exceptions: [{ date: "2026-11-26", closed: true, note: "Thanksgiving" }],
    });
    expect(regenerate).toHaveBeenCalledWith("t1");
    expect(await res.json()).toEqual({ ok: true, availability: { resources: 3, failed: 0 } });
  });

  it("skips regeneration for motels (their nightly slots ignore hours)", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: [{ id: "t1", vertical: "motel" }], error: null });
    const res = await POST(jsonRequest(url, validBody));
    expect(res.status).toBe(200);
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("500s when the update errors", async () => {
    fake.signInAs(OWNER);
    fake.queue("tenants:update", { data: null, error: { message: "db down" } });
    expect((await POST(jsonRequest(url, validBody))).status).toBe(500);
  });
});
