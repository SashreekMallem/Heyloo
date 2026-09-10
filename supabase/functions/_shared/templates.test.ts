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

  it("renders owner_reply as a verbatim passthrough of the owner's typed text", () => {
    const result = renderTemplate("owner_reply", { body: "We'll see you at 3pm, thanks!" });
    expect(result.body).toBe("We'll see you at 3pm, thanks!");
  });

  it("returns an empty body for an unknown template key rather than throwing", () => {
    expect(() => renderTemplate("not_a_real_template", {})).not.toThrow();
    expect(renderTemplate("not_a_real_template", {}).body).toBe("");
  });
});
