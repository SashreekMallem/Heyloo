import { describe, expect, it } from "vitest";
import { renderTemplate } from "./templates.ts";

describe("renderTemplate", () => {
  it("renders order_confirmation with a formatted dollar amount", () => {
    const result = renderTemplate("order_confirmation", { total_cents: 2160 });
    expect(result.body).toContain("$21.60");
  });

  it("renders payment_link with the checkout URL", () => {
    const result = renderTemplate("payment_link", {
      url: "https://pay.example/abc",
      amount_cents: 5000,
    });
    expect(result.body).toContain("https://pay.example/abc");
    expect(result.body).toContain("$50.00");
  });

  it("renders take_message with caller details", () => {
    const result = renderTemplate("take_message", {
      caller_name: "Jordan",
      caller_phone: "+15551234567",
      message_text: "Call me back",
    });
    expect(result.body).toContain("Jordan");
    expect(result.body).toContain("Call me back");
  });

  it("renders take_message with a callback_window when supplied", () => {
    const result = renderTemplate("take_message", {
      caller_name: "Jordan",
      caller_phone: "+15551234567",
      message_text: "Call me back",
      callback_window: "weekday afternoons",
    });
    expect(result.body).toContain("callback window: weekday afternoons");
  });

  it("omits the callback window segment cleanly when absent", () => {
    const result = renderTemplate("take_message", {
      caller_name: "Jordan",
      caller_phone: "+15551234567",
      message_text: "Call me back",
    });
    expect(result.body).not.toContain("callback window");
    expect(result.body).toBe('Jordan (+15551234567) left a message: "Call me back"');
  });

  it("renders dental_intake_link with the one-time intake URL", () => {
    const result = renderTemplate("dental_intake_link", {
      url: "https://app.heyloo.com/intake/abc123",
    });
    expect(result.body).toContain("https://app.heyloo.com/intake/abc123");
    expect(result.body.toLowerCase()).toContain("insurance");
  });

  it("renders owner_reply as a verbatim passthrough of the owner's typed text", () => {
    const result = renderTemplate("owner_reply", { body: "We'll see you at 3pm, thanks!" });
    expect(result.body).toBe("We'll see you at 3pm, thanks!");
  });

  it("renders order_ready with a non-empty body (FIX_REQUESTS.md)", () => {
    const result = renderTemplate("order_ready", {});
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.body.toLowerCase()).toContain("ready");
  });

  it("renders waitlist_slot_opened with a non-empty body including the freed start time (FIX_REQUESTS.md)", () => {
    const result = renderTemplate("waitlist_slot_opened", {
      start: "2026-02-01T18:00:00Z",
      waitlist_entry_id: "wl_1",
    });
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.body).toContain("2026-02-01T18:00:00Z");
  });

  it("returns an empty body for an unknown template key rather than throwing", () => {
    expect(() => renderTemplate("not_a_real_template", {})).not.toThrow();
    expect(renderTemplate("not_a_real_template", {}).body).toBe("");
  });
});
