import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, jsonRequest, MEMBER, OWNER } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { createSupabaseServerComponentClient: async () => fakeClient() };
});

const { POST } = await import("./route");

const url = "/api/tenant/settings/notifications";

beforeEach(() => fake.reset());

describe("POST /api/tenant/settings/notifications", () => {
  it("401s signed out, 403s for a member", async () => {
    const body = { sms_enabled: true, email_enabled: true };
    expect((await POST(jsonRequest(url, body))).status).toBe(401);
    fake.signInAs(MEMBER);
    expect((await POST(jsonRequest(url, body))).status).toBe(403);
  });

  it("422s on an invalid email or phone", async () => {
    fake.signInAs(OWNER);
    expect(
      (
        await POST(
          jsonRequest(url, { sms_enabled: true, email_enabled: true, notification_email: "x@" }),
        )
      ).status,
    ).toBe(422);
    expect(
      (await POST(jsonRequest(url, { sms_enabled: true, email_enabled: true, alert_phone: "12" })))
        .status,
    ).toBe(422);
  });

  it("writes overrides.delivery in the owner-alert shape, omitting blank recipients", async () => {
    fake.signInAs(OWNER);
    fake.queue("agent_configs:select", {
      data: {
        dynamic_variable_overrides: { faq_items: [], delivery: { alert_phone: "+16105550100" } },
      },
      error: null,
    });
    fake.queue("agent_configs:update", { data: [{ id: "ac1" }], error: null });
    const res = await POST(
      jsonRequest(url, {
        sms_enabled: true,
        email_enabled: false,
        alert_phone: "",
        notification_email: "Owner@Example.com",
      }),
    );
    expect(res.status).toBe(200);
    const update = fake.callsTo("agent_configs", "update")[0];
    expect(update?.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    expect(update?.payload).toEqual({
      dynamic_variable_overrides: {
        faq_items: [],
        delivery: {
          sms_enabled: true,
          email_enabled: false,
          notification_email: "owner@example.com",
        },
      },
    });
  });
});
