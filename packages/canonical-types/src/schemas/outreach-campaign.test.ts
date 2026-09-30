import { describe, expect, it } from "vitest";
import { outreachCampaignSchema } from "./outreach-campaign.js";

const VALID = {
  name: "Q1 legal",
  vertical: "legal",
  sending_domain: "mail.heyloo.ai",
  daily_send_cap: 100,
  template_id: "",
  respect_suppression: true,
} as const;

// COCKPIT-F23
describe("outreachCampaignSchema", () => {
  it("accepts a well-formed campaign and lower-cases the domain", () => {
    const parsed = outreachCampaignSchema.parse({ ...VALID, sending_domain: " Mail.Heyloo.AI " });
    expect(parsed.sending_domain).toBe("mail.heyloo.ai");
  });

  it.each([
    "not a domain",
    "localhost",
    "http://mail.heyloo.ai",
    "mail.heyloo.ai/path",
    "-bad.example.com",
    "bad-.example.com",
    "a..example.com",
    "example.c",
    "user@example.com",
    "exa mple.com",
  ])("rejects the sending domain %j", (sending_domain) => {
    expect(outreachCampaignSchema.safeParse({ ...VALID, sending_domain }).success).toBe(false);
  });

  it("bounds the daily cap to 1..2000 integers", () => {
    for (const cap of [0, -5, 2001, 1e9, 1.5]) {
      expect(outreachCampaignSchema.safeParse({ ...VALID, daily_send_cap: cap }).success).toBe(
        false,
      );
    }
    for (const cap of [1, 2000]) {
      expect(outreachCampaignSchema.safeParse({ ...VALID, daily_send_cap: cap }).success).toBe(
        true,
      );
    }
  });

  it("template_id is optional/blank, otherwise a uuid", () => {
    expect(outreachCampaignSchema.safeParse({ ...VALID, template_id: undefined }).success).toBe(
      true,
    );
    expect(
      outreachCampaignSchema.safeParse({
        ...VALID,
        template_id: "3f2a9c1e-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
    expect(outreachCampaignSchema.safeParse({ ...VALID, template_id: "tmpl_1" }).success).toBe(
      false,
    );
  });

  it("locks respect_suppression to true", () => {
    expect(outreachCampaignSchema.safeParse({ ...VALID, respect_suppression: false }).success).toBe(
      false,
    );
  });
});
