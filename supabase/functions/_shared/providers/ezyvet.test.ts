import { describe, expect, it } from "vitest";
import {
  createEzyVetAppointment,
  createEzyVetContact,
  type EzyVetFetch,
  findEzyVetContactByPhone,
  isEzyVetApiUrl,
  isEzyVetDomainUrl,
  listEzyVetAppointmentChanges,
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

/** ezyVet's documented production API base (developers.ezyvet.com "Servers"). */
const BASE_URL = "https://api.ezyvet.com/v1";
/** The older per-practice shape some stored rows may hold. */
const PRACTICE_BASE_URL = "https://clinic.ezyvet.com/api/v1";

/** A fetch that records every URL + init it is called with. */
function recordingFetch(answer: unknown = { items: [] }) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: EzyVetFetch = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(answer);
  };
  return { fetchImpl, calls };
}

const PARTNER = { clientId: "c1", clientSecret: "s1", partnerId: "p1" };

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
  it("listEzyVetAppointmentTypes hits the connection's base URL", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await listEzyVetAppointmentTypes(fetchImpl, BASE_URL, "token");
    expect(calls[0]?.url).toBe(`${BASE_URL}/appointmenttype`);
  });

  it("findEzyVetContactByPhone searches by mobile", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await findEzyVetContactByPhone(fetchImpl, BASE_URL, "token", "+15551234567");
    expect(calls[0]?.url).toContain("mobile=%2B15551234567");
  });

  it("createEzyVetAppointment carries the idempotency reference field", async () => {
    const { fetchImpl, calls } = recordingFetch({ id: 99 });
    await createEzyVetAppointment(fetchImpl, BASE_URL, "token", {
      contactId: "42",
      startAt: "2026-09-10T14:00:00Z",
      endAt: "2026-09-10T14:30:00Z",
      idempotencyKey: "call_1:slot_1",
    });
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent["reference"]).toBe("call_1:slot_1");
    expect(sent["contact_id"]).toBe("42");
  });

  it("still serves a stored per-practice ezyvet.com base URL for data calls", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const result = await listEzyVetAppointmentChanges(fetchImpl, PRACTICE_BASE_URL, "token");
    expect(result.ok).toBe(true);
    expect(calls[0]?.url.startsWith(`${PRACTICE_BASE_URL}/appointment?`)).toBe(true);
  });

  const FOREIGN_HOSTS = [
    "https://evil.example.com/api/v1",
    "https://clinic.ezyvet.com.evil.example/api/v1",
    "https://notezyvet.com/api/v1",
    "http://api.ezyvet.com/v1",
    "https://api.ezyvet.com:8443/v1",
    "https://user:pw@api.ezyvet.com/v1",
    "not a url",
  ];

  const DATA_CALLS: Array<[string, (f: EzyVetFetch, baseUrl: string) => Promise<unknown>]> = [
    ["listEzyVetAppointmentTypes", (f, b) => listEzyVetAppointmentTypes(f, b, "token")],
    ["findEzyVetContactByPhone", (f, b) => findEzyVetContactByPhone(f, b, "token", "+15551234567")],
    [
      "createEzyVetContact",
      (f, b) =>
        createEzyVetContact(f, b, "token", {
          firstName: "Jane",
          lastName: "Doe",
          mobile: "+15551234567",
          email: "jane@example.com",
        }),
    ],
    [
      "createEzyVetAppointment",
      (f, b) =>
        createEzyVetAppointment(f, b, "token", {
          contactId: "42",
          startAt: "2026-09-10T14:00:00Z",
          endAt: "2026-09-10T14:30:00Z",
          idempotencyKey: "k1",
        }),
    ],
    ["listEzyVetAppointmentChanges", (f, b) => listEzyVetAppointmentChanges(f, b, "token")],
  ];

  describe.each(DATA_CALLS)("CONNECT-SAFE-1: %s", (_name, call) => {
    it.each(FOREIGN_HOSTS)(
      "never sends customer data or the token to %s (no refresh needed to hit it)",
      async (baseUrl) => {
        const { fetchImpl, calls } = recordingFetch();
        expect(await call(fetchImpl, baseUrl)).toEqual({ ok: false, status: 0, body: undefined });
        expect(calls).toHaveLength(0);
      },
    );
  });

  it("refreshEzyVetToken mints at the documented token URL via client_credentials + partner_id", async () => {
    const { fetchImpl, calls } = recordingFetch({ access_token: "new", expires_in: 43200 });
    const result = await refreshEzyVetToken(fetchImpl, BASE_URL, PARTNER);
    expect(result.ok).toBe(true);
    expect(calls[0]?.url).toBe("https://api.ezyvet.com/v1/oauth/access_token");
    const sent = String(calls[0]?.init?.body);
    expect(sent).toContain("grant_type=client_credentials");
    expect(sent).toContain("partner_id=p1");
  });

  it.each([
    ...FOREIGN_HOSTS,
    // CONNECT-SAFE-1 review: only the two documented API hosts may receive
    // the partner secret, not any other ezyvet.com subdomain.
    PRACTICE_BASE_URL,
    "https://status.ezyvet.com/v1",
    "https://ezyvet.com/v1",
    "https://api.ezyvet.com./v1",
  ])("CONNECT-SAFE-1: refreshEzyVetToken never sends the partner secret to %s", async (baseUrl) => {
    const { fetchImpl, calls } = recordingFetch({ access_token: "stolen" });
    const result = await refreshEzyVetToken(fetchImpl, baseUrl, PARTNER);
    expect(result).toEqual({ ok: false, status: 0, body: undefined });
    expect(calls).toHaveLength(0);
  });
});

describe("isEzyVetApiUrl (CONNECT-SAFE-1)", () => {
  it.each([
    "https://api.ezyvet.com/v1",
    "https://api.trial.ezyvet.com/v1",
    "https://API.EzyVet.com/v1",
  ])("accepts ezyVet's documented API host %s", (url) => {
    expect(isEzyVetApiUrl(url)).toBe(true);
  });

  it.each([
    "https://clinic.ezyvet.com/api/v1",
    "https://ezyvet.com/v1",
    "https://api.ezyvet.com./v1",
    "https://evil.example.com",
    "https://ezyvet.com.evil.example",
    "https://user:pw@api.ezyvet.com/v1",
    "https://api.ezyvet.com:8443/v1",
    "http://api.ezyvet.com/v1",
    "ftp://api.ezyvet.com",
    "",
  ])("rejects %s", (url) => {
    expect(isEzyVetApiUrl(url)).toBe(false);
  });
});

describe("isEzyVetDomainUrl (CONNECT-SAFE-1)", () => {
  it.each([
    "https://api.ezyvet.com/v1",
    "https://clinic.ezyvet.com/api/v1",
    "https://ezyvet.com/api",
  ])("accepts an ezyVet-domain host %s", (url) => {
    expect(isEzyVetDomainUrl(url)).toBe(true);
  });

  it.each([
    "https://evil.example.com",
    "https://clinic.ezyvet.com.evil.example",
    "https://notezyvet.com",
    "https://user:pw@clinic.ezyvet.com",
    "https://clinic.ezyvet.com:8443",
    "http://clinic.ezyvet.com",
    "",
  ])("rejects %s", (url) => {
    expect(isEzyVetDomainUrl(url)).toBe(false);
  });
});
