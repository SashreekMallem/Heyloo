import type { SupabaseServerClient } from "@heyloo/supabase-client";
import { beforeEach, describe, expect, it } from "vitest";
import { fake, fakeClient } from "@/test/fake-supabase";
import { checkNotHeylooNumber, syncTransferNumberToBusinessPhone } from "./business-phone";

const supabase = () => fakeClient() as unknown as SupabaseServerClient;

beforeEach(() => fake.reset());

describe("syncTransferNumberToBusinessPhone (transfer number follows the business phone while it is the default)", () => {
  it("fills a NULL transfer number, and follows one that equals the PREVIOUS business phone", async () => {
    fake.queue("agent_configs:update", { data: [], error: null }, { data: [{ id: "ac1" }] });
    const changed = await syncTransferNumberToBusinessPhone(
      supabase(),
      "t1",
      "+12627551967",
      "+14145550100",
    );
    expect(changed).toBe(true);
    const [fillNull, follow] = fake.callsTo("agent_configs", "update");
    expect(fillNull?.payload).toEqual({ transfer_number: "+14145550100" });
    expect(fillNull?.filters).toEqual([
      ["eq", "tenant_id", "t1"],
      ["is", "transfer_number", null],
    ]);
    expect(follow?.payload).toEqual({ transfer_number: "+14145550100" });
    expect(follow?.filters).toEqual([
      ["eq", "tenant_id", "t1"],
      ["eq", "transfer_number", "+12627551967"],
    ]);
  });

  it("never touches a deliberately different transfer number (both filtered updates match no row)", async () => {
    fake.queue("agent_configs:update", { data: [], error: null }, { data: [], error: null });
    const changed = await syncTransferNumberToBusinessPhone(
      supabase(),
      "t1",
      "+12627551967",
      "+14145550100",
    );
    expect(changed).toBe(false);
    // Every write is conditional on NULL or the previous business phone — never unconditional.
    for (const call of fake.callsTo("agent_configs", "update")) {
      expect(
        call.filters.some(([op, col]) => (op === "is" || op === "eq") && col === "transfer_number"),
      ).toBe(true);
    }
  });

  it("with no previous business phone only fills a NULL transfer number", async () => {
    fake.queue("agent_configs:update", { data: [{ id: "ac1" }], error: null });
    expect(await syncTransferNumberToBusinessPhone(supabase(), "t1", null, "+14145550100")).toBe(
      true,
    );
    expect(fake.callsTo("agent_configs", "update")).toHaveLength(1);
  });

  it("does nothing when the business phone is unchanged or cleared", async () => {
    expect(
      await syncTransferNumberToBusinessPhone(supabase(), "t1", "+12627551967", "+12627551967"),
    ).toBe(false);
    expect(await syncTransferNumberToBusinessPhone(supabase(), "t1", "+12627551967", null)).toBe(
      false,
    );
    expect(fake.callsTo("agent_configs")).toHaveLength(0);
  });

  it("reports no change when the update errors", async () => {
    fake.queue("agent_configs:update", { data: null, error: { message: "rls" } });
    expect(await syncTransferNumberToBusinessPhone(supabase(), "t1", null, "+14145550100")).toBe(
      false,
    );
  });
});

describe("checkNotHeylooNumber", () => {
  it("flags the tenant's own live Heyloo number, scoped to the tenant", async () => {
    fake.queue("phone_numbers:select", { data: [{ e164: "+15551230000" }], error: null });
    expect(await checkNotHeylooNumber(supabase(), "t1", "+15551230000")).toBe("heyloo_number");
    expect(fake.callsTo("phone_numbers")[0]?.filters).toEqual([
      ["eq", "tenant_id", "t1"],
      ["is", "released_at", null],
    ]);
  });

  it("allows any other number, and reports a failed read", async () => {
    fake.queue("phone_numbers:select", { data: [{ e164: "+15551230000" }], error: null });
    expect(await checkNotHeylooNumber(supabase(), "t1", "+12627551967")).toBe("ok");
    fake.queue("phone_numbers:select", { data: null, error: { message: "down" } });
    expect(await checkNotHeylooNumber(supabase(), "t1", "+12627551967")).toBe("error");
  });
});
