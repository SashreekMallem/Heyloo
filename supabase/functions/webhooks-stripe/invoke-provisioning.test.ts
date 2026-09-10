import { describe, expect, it, vi } from "vitest";
import { createInvokeProvisioning } from "./invoke-provisioning.ts";

function fakeFetch(response: { status: number; ok: boolean; body?: string }) {
  return vi.fn(async () => ({
    ok: response.ok,
    status: response.status,
    text: async () => response.body ?? "",
  })) as unknown as typeof fetch;
}

describe("createInvokeProvisioning", () => {
  it("sends an Authorization bearer header alongside x-internal-secret, so it clears api-provision's platform-level verify_jwt=true gateway", async () => {
    const fetchImpl = fakeFetch({ ok: true, status: 200 });
    const invokeProvisioning = createInvokeProvisioning({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "sb_secret_abc",
      internalSecret: "internal_xyz",
      fetchImpl,
    });

    await invokeProvisioning("t1");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://project.supabase.co/functions/v1/api-provision");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer sb_secret_abc");
    expect(headers["x-internal-secret"]).toBe("internal_xyz");
    expect(JSON.parse(init.body as string)).toEqual({ tenant_id: "t1" });
  });

  it("treats 409 (already provisioned) as ok", async () => {
    const invokeProvisioning = createInvokeProvisioning({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "sb_secret_abc",
      internalSecret: "internal_xyz",
      fetchImpl: fakeFetch({ ok: false, status: 409 }),
    });

    const result = await invokeProvisioning("t1");
    expect(result).toEqual({ ok: true, status: 409 });
  });

  it("propagates a non-2xx/409 failure with the response body", async () => {
    const invokeProvisioning = createInvokeProvisioning({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "sb_secret_abc",
      internalSecret: "internal_xyz",
      fetchImpl: fakeFetch({ ok: false, status: 401, body: "unauthorized" }),
    });

    const result = await invokeProvisioning("t1");
    expect(result).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });

  it("catches a network error and reports it without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const invokeProvisioning = createInvokeProvisioning({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "sb_secret_abc",
      internalSecret: "internal_xyz",
      fetchImpl,
    });

    const result = await invokeProvisioning("t1");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network down");
  });
});
