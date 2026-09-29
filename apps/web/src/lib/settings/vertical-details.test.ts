import { describe, expect, it } from "vitest";
import { detailsRequestBody } from "./vertical-details";

describe("detailsRequestBody", () => {
  it("sends this vertical's emptied fields as null so the route clears them", () => {
    expect(
      detailsRequestBody("auto", {
        cancellation_policy: { window_hours: 24, text: "x" },
        tow_partner: { name: "", phone: "" },
        vehicle_makes_serviced: [],
      }),
    ).toEqual({
      cancellation_policy: { window_hours: 24, text: "x" },
      tow_partner: null,
      vehicle_makes_serviced: null,
    });
  });

  it("keeps filled values and never touches another vertical's keys", () => {
    expect(
      detailsRequestBody("restaurant", {
        cancellation_policy: { window_hours: 0, text: "" },
        menu_text: "Pizza",
        delivery_fee_cents: 0,
      }),
    ).toEqual({
      cancellation_policy: { window_hours: 0, text: "" },
      menu_text: "Pizza",
      delivery_fee_cents: 0,
      delivery_radius_m: null,
      min_order_cents: null,
      tax_rate_bps: null,
      prep_time_minutes: null,
    });
  });

  it("SETTINGS-1 review: an untouched contact ({name: undefined, phone: undefined}) is sent as null, not {}", () => {
    expect(
      detailsRequestBody("auto", {
        cancellation_policy: { window_hours: 24, text: "x" },
        tow_partner: { name: undefined, phone: undefined },
        vehicle_makes_serviced: ["Ford"],
      }),
    ).toEqual({
      cancellation_policy: { window_hours: 24, text: "x" },
      tow_partner: null,
      vehicle_makes_serviced: ["Ford"],
    });
    expect(
      detailsRequestBody("vet", {
        cancellation_policy: { window_hours: 24, text: "x" },
        emergency_referral: { name: "City ER", phone: undefined },
      })["emergency_referral"],
    ).toEqual({ name: "City ER", phone: undefined });
  });
});
