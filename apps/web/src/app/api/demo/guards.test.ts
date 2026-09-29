import { beforeEach, describe, expect, it, vi } from "vitest";

const callEdgeFunction = vi.fn();
vi.mock("@/lib/edge-functions", () => ({
  callEdgeFunction: (...args: unknown[]) => callEdgeFunction(...args),
}));

const { POST: generate } = await import("./generate/route");
const { POST: confirm } = await import("./confirm/route");

const SESSION_ID = "0b0a3f8e-5c1a-4f57-9a44-0d6c3b1d9a11";

function req(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  callEdgeFunction.mockReset();
  callEdgeFunction.mockResolvedValue({ status: 200, body: { ok: true } });
});

describe("POST /api/demo/generate (SEC-04)", () => {
  it("rejects a non-http(s) website_url with 422 and never calls the edge function", async () => {
    const res = await generate(
      req(
        "/api/demo/generate",
        { business_name: "Acme", website_url: "file:///etc/passwd" },
        { "x-forwarded-for": "10.0.0.1" },
      ),
    );
    expect(res.status).toBe(422);
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin browser request with 403", async () => {
    const res = await generate(
      req(
        "/api/demo/generate",
        { business_name: "Acme", website_url: "https://acme.example" },
        { origin: "https://evil.example", "x-forwarded-for": "10.0.0.2" },
      ),
    );
    expect(res.status).toBe(403);
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it("throttles one IP with 429 + retry-after after its window budget", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await generate(
        req(
          "/api/demo/generate",
          { business_name: "Acme", website_url: "https://acme.example" },
          { "x-forwarded-for": "10.0.0.3" },
        ),
      );
      statuses.push(res.status);
      if (res.status === 429) expect(res.headers.get("retry-after")).toBe("600");
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(callEdgeFunction).toHaveBeenCalledTimes(5);
  });
});

describe("POST /api/demo/confirm (SEC-04)", () => {
  it("rejects a cross-origin request and a non-UUID session id", async () => {
    const cross = await confirm(
      req("/api/demo/confirm", { demo_session_id: SESSION_ID }, { origin: "https://evil.example" }),
    );
    expect(cross.status).toBe(403);
    const bad = await confirm(
      req("/api/demo/confirm", { demo_session_id: "nope" }, { "x-forwarded-for": "10.0.1.1" }),
    );
    expect(bad.status).toBe(422);
    expect(callEdgeFunction).not.toHaveBeenCalled();
  });

  it("throttles one IP with 429 after its window budget", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await confirm(
        req(
          "/api/demo/confirm",
          { demo_session_id: SESSION_ID },
          { "x-forwarded-for": "10.0.1.2" },
        ),
      );
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(8);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });
});
