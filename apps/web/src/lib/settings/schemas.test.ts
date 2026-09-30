import { describe, expect, it } from "vitest";
import { mergeOverrides } from "./route-auth";
import {
  bookingRulesRequestSchema,
  businessProfileSchema,
  faqRequestSchema,
  instructionsFormSchema,
  instructionsRequestSchema,
  notificationsFormSchema,
  notificationsRequestSchema,
  reminderReviewFormSchema,
  reminderReviewRequestSchema,
  verticalDetailsRequestSchema,
  zContactRequest,
} from "./schemas";

describe("businessProfileSchema", () => {
  it("accepts a name and an IANA zone", () => {
    expect(
      businessProfileSchema.parse({ name: "  Riverside Auto  ", timezone: "America/Chicago" }),
    ).toEqual({ name: "Riverside Auto", timezone: "America/Chicago" });
  });

  it("rejects a one-letter name and an unknown zone", () => {
    expect(
      businessProfileSchema.safeParse({ name: "R", timezone: "America/Chicago" }).success,
    ).toBe(false);
    expect(
      businessProfileSchema.safeParse({ name: "Riverside", timezone: "Mars/Base" }).success,
    ).toBe(false);
  });
});

describe("instructionsRequestSchema", () => {
  it("normalizes phones, trims text, and turns blanks into null (clear)", () => {
    const parsed = instructionsRequestSchema.parse({
      special_instructions: "  Ask if the car is driveable.  ",
      transfer_number: "(610) 555-0122",
      voicemail_message: "",
      manager_name: "   ",
      manager_phone: "",
      accepted_payment_types: [],
      call_routing: {
        transfer_window: "business_hours",
        transfer_urgent: true,
        after_hours_phone: "610-555-0199",
      },
    });
    expect(parsed).toEqual({
      special_instructions: "Ask if the car is driveable.",
      transfer_number: "+16105550122",
      voicemail_message: null,
      manager_name: null,
      manager_phone: null,
      accepted_payment_types: null,
      call_routing: {
        transfer_window: "business_hours",
        transfer_urgent: true,
        after_hours_phone: "+16105550199",
      },
    });
  });

  it("clears the transfer number when sent blank (it used to be impossible to remove)", () => {
    expect(instructionsRequestSchema.parse({ transfer_number: "" }).transfer_number).toBeNull();
  });

  it("rejects a partial transfer number", () => {
    expect(instructionsRequestSchema.safeParse({ transfer_number: "610555" }).success).toBe(false);
  });

  it("form schema flags a bad phone inline", () => {
    const result = instructionsFormSchema.safeParse({
      special_instructions: "",
      transfer_number: "+1610",
      voicemail_message: "",
      manager_name: "",
      manager_phone: "",
      parking_info: "",
      accessibility_notes: "",
      accepted_payment_types: "",
      transfer_window: "any_time",
      transfer_urgent: false,
      after_hours_phone: "",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["transfer_number"]);
  });
});

describe("notifications schemas", () => {
  it("normalizes the alert phone and lower-cases the email", () => {
    expect(
      notificationsRequestSchema.parse({
        sms_enabled: true,
        email_enabled: true,
        alert_phone: "(610) 555-0199",
        notification_email: "Owner@Example.com",
      }),
    ).toEqual({
      sms_enabled: true,
      email_enabled: true,
      alert_phone: "+16105550199",
      notification_email: "owner@example.com",
    });
  });

  it("rejects a bad email on both sides", () => {
    expect(
      notificationsRequestSchema.safeParse({
        sms_enabled: true,
        email_enabled: true,
        notification_email: "not-an-email",
      }).success,
    ).toBe(false);
    expect(
      notificationsFormSchema.safeParse({
        sms_enabled: true,
        email_enabled: true,
        alert_phone: "",
        notification_email: "nope",
      }).success,
    ).toBe(false);
  });
});

describe("faqRequestSchema", () => {
  it("requires a question and an answer per row", () => {
    expect(
      faqRequestSchema.safeParse({ items: [{ question: "Hours?", answer: "" }] }).success,
    ).toBe(false);
    expect(
      faqRequestSchema.safeParse({ items: [{ question: "Do you do tires?", answer: "Yes." }] })
        .success,
    ).toBe(true);
  });

  it("caps total size", () => {
    const big = Array.from({ length: 20 }, (_, i) => ({
      question: `Question ${i}?`,
      answer: "x".repeat(1_500),
    }));
    expect(faqRequestSchema.safeParse({ items: big }).success).toBe(false);
  });
});

describe("bookingRulesRequestSchema", () => {
  it("accepts null (vertical default) and bounded integers", () => {
    expect(
      bookingRulesRequestSchema.safeParse({ min_notice_minutes: null, horizon_days: null }).success,
    ).toBe(true);
    expect(
      bookingRulesRequestSchema.safeParse({ min_notice_minutes: 120, horizon_days: 60 }).success,
    ).toBe(true);
    expect(
      bookingRulesRequestSchema.safeParse({ min_notice_minutes: -5, horizon_days: 60 }).success,
    ).toBe(false);
    expect(
      bookingRulesRequestSchema.safeParse({ min_notice_minutes: 0, horizon_days: 0 }).success,
    ).toBe(false);
  });
});

describe("zContactRequest", () => {
  it("normalizes a full contact, clears a blank one, rejects half of one", () => {
    expect(zContactRequest.parse({ name: " Ace Towing ", phone: "610 555 0199" })).toEqual({
      name: "Ace Towing",
      phone: "+16105550199",
    });
    expect(zContactRequest.parse({ name: "", phone: "" })).toBeNull();
    // SETTINGS-1 review: an untouched contact arrives as `{}` — clear, don't 422.
    expect(zContactRequest.parse({})).toBeNull();
    expect(zContactRequest.safeParse({ name: "Ace Towing" }).success).toBe(false);
    expect(zContactRequest.safeParse({ phone: "6105550199" }).success).toBe(false);
    expect(zContactRequest.parse(undefined)).toBeUndefined();
    expect(zContactRequest.safeParse({ name: "Ace Towing", phone: "" }).success).toBe(false);
    expect(zContactRequest.safeParse({ name: "", phone: "6105550199" }).success).toBe(false);
  });
});

describe("verticalDetailsRequestSchema", () => {
  it("keeps absent keys absent and turns cleared ones into null", () => {
    const parsed = verticalDetailsRequestSchema.parse({
      cancellation_policy: { window_hours: 24, text: "24 hours notice." },
      menu_text: "",
      species_treated: [],
    });
    expect(parsed).toEqual({
      cancellation_policy: { window_hours: 24, text: "24 hours notice." },
      menu_text: null,
      species_treated: null,
    });
    expect("tow_partner" in parsed).toBe(false);
  });

  it("E.164-validates the vet emergency referral phone", () => {
    expect(
      verticalDetailsRequestSchema.safeParse({
        cancellation_policy: { window_hours: 24, text: "" },
        emergency_referral: { name: "City Animal ER", phone: "call us" },
      }).success,
    ).toBe(false);
  });
});

describe("reminder/review schemas", () => {
  const base = {
    voice_reminders_enabled: false,
    review_request_enabled: true,
    avg_transaction_value_cents: 12000,
  };

  it("requires a review link when review requests are on", () => {
    expect(reminderReviewRequestSchema.safeParse({ ...base, review_url: "" }).success).toBe(false);
    expect(reminderReviewFormSchema.safeParse({ ...base, review_url: "" }).success).toBe(false);
  });

  it("clears a blank link when review requests are off, and only accepts http(s)", () => {
    expect(
      reminderReviewRequestSchema.parse({ ...base, review_request_enabled: false, review_url: "" })
        .review_url,
    ).toBeNull();
    expect(
      reminderReviewRequestSchema.safeParse({ ...base, review_url: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      reminderReviewRequestSchema.parse({ ...base, review_url: "https://g.page/r/abc" }).review_url,
    ).toBe("https://g.page/r/abc");
  });
});

describe("QA-1 F-17: the review link is https-only, as its own error message says", () => {
  const base = {
    voice_reminders_enabled: false,
    review_request_enabled: true,
    avg_transaction_value_cents: 0,
  };

  it("rejects http:// on the server and in the form", () => {
    const review_url = "http://g.page/r/abc";
    expect(reminderReviewRequestSchema.safeParse({ ...base, review_url }).success).toBe(false);
    expect(reminderReviewFormSchema.safeParse({ ...base, review_url }).success).toBe(false);
  });

  it("still accepts https:// on both", () => {
    const review_url = "https://g.page/r/abc";
    expect(reminderReviewRequestSchema.safeParse({ ...base, review_url }).success).toBe(true);
    expect(reminderReviewFormSchema.safeParse({ ...base, review_url }).success).toBe(true);
  });
});

describe("mergeOverrides", () => {
  it("sets, deletes on null, and leaves undefined keys and siblings alone", () => {
    expect(
      mergeOverrides(
        { manager_name: "Sam", faq_items: [1], delivery: { sms_enabled: true } },
        { manager_name: null, parking_info: "Lot B", faq_items: undefined },
      ),
    ).toEqual({ faq_items: [1], delivery: { sms_enabled: true }, parking_info: "Lot B" });
  });

  it("tolerates a non-object existing value", () => {
    expect(mergeOverrides(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergeOverrides([1, 2], { a: 1 })).toEqual({ a: 1 });
  });
});
