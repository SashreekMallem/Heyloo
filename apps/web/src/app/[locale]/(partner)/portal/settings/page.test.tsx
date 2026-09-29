import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let savedEmail: string | null = "saved@example.com";
const eqCalls: [string, string][] = [];

vi.mock("@/lib/auth/require-partner-session", () => ({
  requirePartnerSession: async () => ({
    partner: { id: "partner-1" },
    supabase: {
      from: () => ({
        select: () => ({
          eq: (col: string, value: string) => {
            eqCalls.push([col, value]);
            return {
              maybeSingle: async () => ({ data: { paypal_email: savedEmail }, error: null }),
            };
          },
        }),
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/browser", () => ({ supabaseBrowserClient: {} }));

const { default: PartnerSettingsPage } = await import("./page");

describe("PartnerSettingsPage (PT-02)", () => {
  it("renders the saved payout email in the field", async () => {
    savedEmail = "saved@example.com";
    render(await PartnerSettingsPage());
    expect(screen.getByLabelText("PayPal email")).toHaveValue("saved@example.com");
    expect(eqCalls).toContainEqual(["id", "partner-1"]);
  });

  it("renders an empty field for a partner with no saved email", async () => {
    savedEmail = null;
    render(await PartnerSettingsPage());
    expect(screen.getByLabelText("PayPal email")).toHaveValue("");
  });
});
