import { describe, expect, it } from "vitest";
import { buildApiCheckoutRequest } from "./build-request";

/**
 * Seam contract test (E2E_FLOWS_AUDIT B1): the body this builder produces
 * MUST match `supabase/functions/_shared/schemas/checkout.ts`'s
 * `CheckoutRequestSchema` field-for-field — `vertical` (one of the 8
 * canonical short-form values), `business_name` (string), `email` (string),
 * `timezone` (optional string). Kept as a fixture-based check rather than
 * importing that Zod schema directly since `apps/web` and
 * `supabase/functions` are separate pnpm workspace packages with no shared
 * runtime import across the Node/Deno boundary (see that schema file's own
 * docstring).
 */
describe("buildApiCheckoutRequest", () => {
  it("passes the draft's fields through with the exact api-checkout field names", () => {
    const body = buildApiCheckoutRequest(
      { business_type: "auto", business_name: "Joe's Garage" },
      "joe@example.com",
      "America/Chicago",
    );
    expect(body).toEqual({
      vertical: "auto",
      business_name: "Joe's Garage",
      email: "joe@example.com",
      timezone: "America/Chicago",
    });
  });

  it("omits timezone entirely when none is supplied, matching the schema's optional field", () => {
    const body = buildApiCheckoutRequest(
      { business_type: "restaurant", business_name: "Pasta Place" },
      "owner@example.com",
    );
    expect(body).toEqual({
      vertical: "restaurant",
      business_name: "Pasta Place",
      email: "owner@example.com",
    });
    expect("timezone" in body).toBe(false);
  });

  it("never re-derives or maps the vertical (draft.business_type is already the canonical short form CheckoutRequestSchema expects)", () => {
    const body = buildApiCheckoutRequest(
      { business_type: "vet", business_name: "Vertical Test" },
      "a@b.com",
    );
    expect(body.vertical).toBe("vet");
  });

  it("never includes a tenant_id field — the caller cannot spoof one (FRONTEND_AUDIT checkout tenant_id trust gap)", () => {
    const body = buildApiCheckoutRequest(
      { business_type: "generic", business_name: "Anyco" },
      "a@b.com",
    );
    expect("tenant_id" in body).toBe(false);
  });
});
