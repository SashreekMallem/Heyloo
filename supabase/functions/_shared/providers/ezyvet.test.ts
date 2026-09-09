import { describe, expect, it } from "vitest";
import {
  createEzyVetAppointment,
  findEzyVetContactByPhone,
  listEzyVetAppointmentTypes,
  refreshEzyVetToken,
  shouldRefreshEzyVetAuth,
} from "./ezyvet.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE_URL = "https://clinic.ezyvet.com/api/v1";

describe("shouldRefreshEzyVetAuth", () => {
  it("says yes with no stored expiry", () => {
    expect(shouldRefreshEzyVetAuth(null)).toBe(true);
  });

  it("says no with plenty of the 12h TTL left", () => {
    const now = () => Date.parse("2026-09-10T00:00:00Z");
    expect(shouldRefreshEzyVetAuth("2026-09-10T10:00:00Z", now)).toBe(false);
  });

  it("says yes once inside the proactive 2h refresh margin", () => {
    const now = () => Date.parse("2026-09-10T00:00:00Z");
    expect(shouldRefreshEzyVetAuth("2026-09-10T01:00:00Z", now)).toBe(true);
  });
});

describe("ezyVet REST calls", () => {
  it("listEzyVetAppointmentTypes hits the practice-specific base URL", async () => {
    let capturedUrl = "";
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ items: [] });
    }) as any;
    await listEzyVetAppointmentTypes(fetchImpl, BASE_URL, "token");
    expect(capturedUrl).toBe(`${BASE_URL}/appointmenttype`);
  });

  it("findEzyVetContactByPhone searches by mobile", async () => {
    let capturedUrl = "";
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ items: [] });
    }) as any;
    await findEzyVetContactByPhone(fetchImpl, BASE_URL, "token", "+15551234567");
    expect(capturedUrl).toContain("mobile=%2B15551234567");
  });

  it("createEzyVetAppointment carries the idempotency reference field", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ id: 99 });
    }) as any;
    await createEzyVetAppointment(fetchImpl, BASE_URL, "token", {
      contactId: "42",
      startAt: "2026-09-10T14:00:00Z",
      endAt: "2026-09-10T14:30:00Z",
      idempotencyKey: "call_1:slot_1",
    });
    expect(captured.reference).toBe("call_1:slot_1");
    expect(captured.contact_id).toBe("42");
  });

  it("refreshEzyVetToken mints a fresh token via client_credentials + partner_id", async () => {
    let capturedBody = "";
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body);
      return jsonResponse({ access_token: "new", expires_in: 43200 });
    }) as any;
    const result = await refreshEzyVetToken(fetchImpl, BASE_URL, {
      clientId: "c1",
      clientSecret: "s1",
      partnerId: "p1",
    });
    expect(result.ok).toBe(true);
    expect(capturedBody).toContain("grant_type=client_credentials");
    expect(capturedBody).toContain("partner_id=p1");
  });
});
