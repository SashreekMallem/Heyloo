import { describe, expect, it } from "vitest";
import { type ChecklistInput, computeSettingsChecklist } from "./checklist";

const EMPTY: ChecklistInput = {
  vertical: "auto",
  transferNumber: null,
  businessHours: {},
  activeOfferings: 0,
  activeResources: 0,
  delivery: null,
  ownerTestPhone: null,
  publish: { publishedAt: null, pending: true, reasons: ["never_published"] },
  textingOn: false,
};

function byId(input: ChecklistInput) {
  return Object.fromEntries(computeSettingsChecklist(input).map((item) => [item.id, item]));
}

describe("computeSettingsChecklist", () => {
  it("marks every key setting as still empty for a blank tenant", () => {
    const items = byId(EMPTY);
    expect(items["transfer_number"]?.done).toBe(false);
    expect(items["business_hours"]?.done).toBe(false);
    expect(items["services"]?.done).toBe(false);
    expect(items["resources"]?.done).toBe(false);
    expect(items["notification_recipients"]?.done).toBe(false);
    expect(items["published"]?.done).toBe(false);
    expect(items["owner_test_phone"]?.optional).toBe(true);
  });

  it("marks everything done for a configured tenant, with owner-readable details", () => {
    const items = byId({
      ...EMPTY,
      transferNumber: "+16105550122",
      businessHours: { mon: [{ open: "08:00", close: "18:00" }], sun: [] },
      activeOfferings: 3,
      activeResources: 2,
      delivery: { sms_enabled: true, email_enabled: true, alert_phone: "+16105550199" },
      ownerTestPhone: "+16105550100",
      publish: { publishedAt: "2026-09-29T00:00:00Z", pending: false, reasons: [] },
      textingOn: true,
    });
    expect(Object.values(items).every((item) => item.done)).toBe(true);
    expect(items["transfer_number"]?.detail).toContain("(610) 555-0122");
    expect(items["business_hours"]?.detail).toBe("Open 1 day a week.");
    expect(items["notification_recipients"]?.detail).toBe("Texts to (610) 555-0199.");
  });

  it("treats the legacy closed-flag hours shape correctly", () => {
    const items = byId({
      ...EMPTY,
      businessHours: { sun: [{ open: "09:00", close: "13:00", closed: true }] },
    });
    expect(items["business_hours"]?.done).toBe(false);
  });

  it("MSG-3: with texting off, the alert phone is not described as a place alerts are texted", () => {
    const items = byId({
      ...EMPTY,
      delivery: { alert_phone: "+16105550199", notification_email: "owner@example.com" },
    });
    expect(items["notification_recipients"]?.done).toBe(true);
    expect(items["notification_recipients"]?.detail).toBe(
      "Texts to (610) 555-0199 (texting is off until it's set up, so alerts are emailed), email to owner@example.com.",
    );
  });

  it("counts an alert email alone as a recipient", () => {
    const items = byId({ ...EMPTY, delivery: { notification_email: "owner@example.com" } });
    expect(items["notification_recipients"]?.done).toBe(true);
    expect(items["notification_recipients"]?.detail).toBe("Email to owner@example.com.");
  });

  it("names resources by vertical", () => {
    expect(byId({ ...EMPTY, vertical: "restaurant" })["resources"]?.label).toBe("Bookable tables");
    expect(byId({ ...EMPTY, vertical: "legal" })["resources"]?.label).toBe(
      "Bookable staff members",
    );
  });

  it("explains why publishing is pending", () => {
    const items = byId({
      ...EMPTY,
      publish: {
        publishedAt: "2026-09-21T00:00:00Z",
        pending: true,
        reasons: ["language_changed"],
      },
    });
    expect(items["published"]?.detail).toMatch(/call language/);
  });
});
