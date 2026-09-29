import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { POST } = await import("./route");

const url = "/api/phone/port-in";
const valid = { current_number: "(610) 555-0122", account_number: "12345", carrier: "att" };

beforeEach(() => fake.reset());

describe("POST /api/phone/port-in (QA-1 F-15)", () => {
  it("401s signed out and 403s without a tenant", async () => {
    expect((await POST(jsonRequest(url, valid))).status).toBe(401);
    fake.signInAs({});
    expect((await POST(jsonRequest(url, valid))).status).toBe(403);
  });

  it("normalizes the current number to E.164 in the ticket and never asks for or stores a PIN", async () => {
    fake.signInAs(OWNER);
    fake.queue("support_requests:insert", { data: null, error: null });
    const res = await POST(jsonRequest(url, { ...valid, account_pin: "9999" }));
    expect(res.status).toBe(200);
    const insert = fake.callsTo("support_requests", "insert")[0];
    const payload = insert?.payload as { tenant_id: string; body: string };
    expect(payload.tenant_id).toBe("t1");
    expect(payload.body).toContain("Current number: +16105550122");
    expect(payload.body).toContain("Account number: 12345");
    expect(payload.body).not.toContain("9999");
    expect(payload.body).toMatch(/PIN: not collected here/);
  });

  it("422s a number that can't be normalized, with a current_number issue", async () => {
    fake.signInAs(OWNER);
    const res = await POST(jsonRequest(url, { ...valid, current_number: "555-01" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: Array<{ path: string[] }> };
    expect(body.issues[0]?.path).toEqual(["current_number"]);
    expect(fake.callsTo("support_requests", "insert")).toHaveLength(0);
  });

  it("422s a missing account number", async () => {
    fake.signInAs(OWNER);
    expect((await POST(jsonRequest(url, { ...valid, account_number: "" }))).status).toBe(422);
  });
});
