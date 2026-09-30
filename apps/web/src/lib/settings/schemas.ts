import { faqItemSchema, verticalDetailsSchema } from "@heyloo/canonical-types";
import { z } from "zod";
import {
  CUSTOM_QUESTION_APPLIES_TO,
  CUSTOM_QUESTION_HINT_MAX_CHARS,
  CUSTOM_QUESTION_ID_PATTERN,
  CUSTOM_QUESTION_LABEL_MAX_CHARS,
  CUSTOM_QUESTIONS_MAX,
  questionWordingProblem,
} from "./custom-questions";
import { PHONE_ERROR_MESSAGE, zOptionalPhone, zPhoneFormField } from "./phone";
import { isValidTimezone } from "./timezone";

/**
 * SETTINGS-1 (docs/BUILD_NOTES.md): request schemas for the owner-settings
 * routes (server = the real boundary; the client form schemas below mirror
 * them so errors show inline before a round trip). Server schemas
 * normalize: blank text -> `null` (clears the stored value), phones ->
 * E.164 or 422, emails lower-cased.
 */

/**
 * Blank / whitespace-only / `null` -> `null` (clear), missing key ->
 * `undefined` (leave alone), otherwise the trimmed string.
 */
function zOptionalText(max: number) {
  return z
    .string()
    .max(max, `Keep this under ${max} characters.`)
    .nullish()
    .transform((value) => {
      if (value === undefined) return undefined;
      const trimmed = value?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : null;
    });
}

// ---------------------------------------------------------------------------
// Business profile — tenants.name / tenants.timezone
// ---------------------------------------------------------------------------

export const businessProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter your business name as callers know it.")
    .max(120, "Keep the name under 120 characters."),
  timezone: z.string().refine(isValidTimezone, "Pick a time zone from the list."),
});
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

// ---------------------------------------------------------------------------
// AI instructions + call routing — agent_configs columns + overrides
// ---------------------------------------------------------------------------

export const TRANSFER_WINDOWS = ["any_time", "business_hours"] as const;

export const instructionsRequestSchema = z.object({
  special_instructions: zOptionalText(4000),
  transfer_number: zOptionalPhone,
  voicemail_message: zOptionalText(1000),
  manager_name: zOptionalText(200),
  manager_phone: zOptionalPhone,
  parking_info: zOptionalText(1000),
  accessibility_notes: zOptionalText(1000),
  accepted_payment_types: z
    .array(z.string().trim().min(1).max(60))
    .max(20)
    .nullish()
    .transform((value) =>
      value === undefined ? undefined : value && value.length > 0 ? value : null,
    ),
  call_routing: z
    .object({
      transfer_window: z.enum(TRANSFER_WINDOWS),
      transfer_urgent: z.boolean(),
      after_hours_phone: zOptionalPhone,
    })
    .nullish(),
});
export type InstructionsRequest = z.output<typeof instructionsRequestSchema>;

export const instructionsFormSchema = z.object({
  special_instructions: z.string().max(4000, "Keep this under 4,000 characters."),
  transfer_number: zPhoneFormField,
  voicemail_message: z.string().max(1000, "Keep this under 1,000 characters."),
  manager_name: z.string().max(200),
  manager_phone: zPhoneFormField,
  parking_info: z.string().max(1000, "Keep this under 1,000 characters."),
  accessibility_notes: z.string().max(1000, "Keep this under 1,000 characters."),
  accepted_payment_types: z.string().max(1200),
  transfer_window: z.enum(TRANSFER_WINDOWS),
  transfer_urgent: z.boolean(),
  after_hours_phone: zPhoneFormField,
});
export type InstructionsFormValues = z.infer<typeof instructionsFormSchema>;

// ---------------------------------------------------------------------------
// Owner notifications — agent_configs.dynamic_variable_overrides.delivery
// (shape read by the MESSAGING-1 owner-alert fan-out)
// ---------------------------------------------------------------------------

export const notificationsRequestSchema = z.object({
  sms_enabled: z.boolean(),
  email_enabled: z.boolean(),
  alert_phone: zOptionalPhone,
  notification_email: z
    .string()
    .trim()
    .max(254)
    .nullish()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      if (!value) return null;
      const parsed = z.email().safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: "Enter a valid email address." });
        return z.NEVER;
      }
      return value.toLowerCase();
    }),
});
export type NotificationsRequest = z.output<typeof notificationsRequestSchema>;

export const notificationsFormSchema = z.object({
  sms_enabled: z.boolean(),
  email_enabled: z.boolean(),
  alert_phone: zPhoneFormField,
  notification_email: z
    .string()
    .trim()
    .max(254)
    .refine(
      (value) => value.length === 0 || z.email().safeParse(value).success,
      "Enter a valid email address.",
    ),
});
export type NotificationsFormValues = z.infer<typeof notificationsFormSchema>;

// ---------------------------------------------------------------------------
// Smaller settings
// ---------------------------------------------------------------------------

export const testPhoneRequestSchema = z.object({ owner_test_phone: zOptionalPhone });

export const CALL_LANGUAGES = ["en", "es"] as const;
export const languageRequestSchema = z.object({ primary: z.enum(CALL_LANGUAGES) });

export const MAX_FAQ_ITEMS = 50;
export const MAX_FAQ_CHARS = 20_000;
/** Past this the FAQ text is large enough to add latency to every call turn (FRONTEND_SPEC §6.6). */
export const FAQ_SIZE_WARNING_CHARS = 3_000;

export const faqRequestSchema = z
  .object({
    items: z.array(faqItemSchema).max(MAX_FAQ_ITEMS, `Keep it to ${MAX_FAQ_ITEMS} questions.`),
  })
  .refine(
    (value) =>
      value.items.reduce((sum, item) => sum + item.question.length + item.answer.length, 0) <=
      MAX_FAQ_CHARS,
    { message: "Your FAQ is too long — shorten some answers.", path: ["items"] },
  );

/**
 * INTAKE-Q-1: the owner's custom intake questions (`POST
 * /api/tenant/agent/questions`). The whole list is saved at once; `position`
 * is the array order (reordering = sending the list in the new order), and a
 * question with no `id` is new (the route assigns one). Server-side limits
 * match the database CHECK (migration 20260930230000) and the runtime reader
 * (`supabase/functions/_shared/custom-questions.ts`).
 */
const customQuestionTextField = (max: number, what: string) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `Keep ${what} under ${max} characters.`));

export const customQuestionInputSchema = z.object({
  id: z.string().regex(CUSTOM_QUESTION_ID_PATTERN, "That question id isn't valid.").optional(),
  label: customQuestionTextField(CUSTOM_QUESTION_LABEL_MAX_CHARS, "the question")
    .pipe(z.string().min(1, "Write the question the AI should ask."))
    .superRefine((value, ctx) => {
      const problem = questionWordingProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  hint: customQuestionTextField(CUSTOM_QUESTION_HINT_MAX_CHARS, "the answer hint")
    .superRefine((value, ctx) => {
      const problem = value ? questionWordingProblem(value) : null;
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    })
    .nullish()
    .transform((value) => (value ? value : undefined)),
  required: z.boolean(),
  applies_to: z.enum(CUSTOM_QUESTION_APPLIES_TO),
  active: z.boolean().default(true),
});

export const customQuestionsRequestSchema = z
  .object({
    questions: z
      .array(customQuestionInputSchema)
      .max(CUSTOM_QUESTIONS_MAX, `Keep it to ${CUSTOM_QUESTIONS_MAX} custom questions.`),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.questions.forEach((question, index) => {
      if (!question.id) return;
      if (seen.has(question.id)) {
        ctx.addIssue({
          code: "custom",
          message: "Each question needs its own id.",
          path: ["questions", index, "id"],
        });
      }
      seen.add(question.id);
    });
  });
export type CustomQuestionsRequest = z.infer<typeof customQuestionsRequestSchema>;

/** Booking-window rules — `tenants.booking_min_notice_minutes` / `booking_horizon_days` (migration 20260929120000). */
export const bookingRulesRequestSchema = z.object({
  min_notice_minutes: z.number().int().min(0).max(10_080).nullable(),
  horizon_days: z.number().int().min(1).max(365).nullable(),
});
export type BookingRulesRequest = z.infer<typeof bookingRulesRequestSchema>;

/**
 * Vet emergency referral / auto tow partner: both a name and a phone, or
 * neither (the template's own `zContact` requires both, E.164). Blank ->
 * `null` so the route clears the stored contact.
 */
export const zContactRequest = z
  // SETTINGS-1 review: a missing half is treated as blank (an untouched
  // contact arrives as `{}`), so `{}` clears instead of 422ing the save.
  .object({ name: z.string().trim().max(200).optional(), phone: z.string().max(40).optional() })
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    const name = value?.name?.trim() ?? "";
    const rawPhone = value?.phone?.trim() ?? "";
    if (name.length === 0 && rawPhone.length === 0) return null;
    const phone = zOptionalPhone.safeParse(rawPhone);
    if (!phone.success || phone.data === null) {
      ctx.addIssue({ code: "custom", message: PHONE_ERROR_MESSAGE, path: ["phone"] });
      return z.NEVER;
    }
    if (name.length === 0) {
      ctx.addIssue({ code: "custom", message: "Add a name for this contact.", path: ["name"] });
      return z.NEVER;
    }
    return { name, phone: phone.data };
  });

/** A "one per line" list: `[]`/`null` -> `null` (clear), missing -> leave alone. */
const zOptionalList = z
  .array(z.string().trim().min(1).max(200))
  .max(100)
  .nullish()
  .transform((value) =>
    value === undefined ? undefined : value && value.length > 0 ? value : null,
  );

const zOptionalCents = z
  .number()
  .int("Use whole cents.")
  .nonnegative("Can't be negative.")
  .max(100_000_000)
  .nullish();

const zRateEntry = z.object({
  room_type: z.string().trim().min(1).max(100),
  nightly_rate_cents: z.number().int().nonnegative().max(10_000_000),
});

/**
 * `POST /api/tenant/agent/vertical-details` — `verticalDetailsSchema` plus
 * the SETTINGS-1 fixes: the vet emergency-referral and auto tow-partner
 * phones are E.164-validated/normalized (they were plain `z.string()` while
 * the template's own `zContact` requires E.164 — the AI read back whatever
 * was typed), and every optional field accepts `null` so an owner can
 * CLEAR it (before, an emptied field was simply dropped from the JSON and
 * the old value stayed live).
 */
export const verticalDetailsRequestSchema = verticalDetailsSchema.extend({
  emergency_referral: zContactRequest,
  tow_partner: zContactRequest,
  insurances_accepted: zOptionalList,
  species_treated: zOptionalList,
  vehicle_makes_serviced: zOptionalList,
  practice_areas: zOptionalList,
  consult_fee_cents: zOptionalCents,
  deposit_policy: z
    .object({
      required: z.boolean(),
      amount_cents: zOptionalCents.transform((v) => v ?? undefined),
      hold_window_hours: z
        .number()
        .int()
        .nonnegative()
        .max(720)
        .nullish()
        .transform((v) => v ?? undefined),
      text: z.string().trim().min(1, "Describe the deposit policy callers will hear.").max(1000),
    })
    .nullish(),
  rate_table: z
    .array(zRateEntry)
    .max(50)
    .nullish()
    .transform((value) =>
      value === undefined ? undefined : value && value.length > 0 ? value : null,
    ),
  delivery_radius_m: z.number().int().nonnegative().max(500_000).nullish(),
  min_order_cents: zOptionalCents,
  delivery_fee_cents: zOptionalCents,
  tax_rate_bps: z.number().int().min(0).max(10_000).nullish(),
  prep_time_minutes: z.number().int().nonnegative().max(1440).nullish(),
  menu_text: zOptionalText(4000),
});
export type VerticalDetailsRequest = z.output<typeof verticalDetailsRequestSchema>;

// ---------------------------------------------------------------------------
// Reminders & reviews — tenants columns
// ---------------------------------------------------------------------------

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

const REVIEW_URL_REQUIRED = "Add your review link to turn on review requests.";

/**
 * `POST /api/tenant/settings/reminders-review` — SETTINGS-1: a blank review
 * link now clears it (it used to fail `z.url()`), only https links are
 * accepted, and review requests can't be switched on without a link
 * (`job-review-request` silently sent nothing in that state).
 */
export const reminderReviewRequestSchema = z
  .object({
    voice_reminders_enabled: z.boolean(),
    review_request_enabled: z.boolean(),
    review_url: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((value, ctx) => {
        if (!value) return null;
        if (!isHttpsUrl(value)) {
          ctx.addIssue({ code: "custom", message: "Enter a full link starting with https://" });
          return z.NEVER;
        }
        return value;
      }),
    avg_transaction_value_cents: z.number().int().nonnegative().max(100_000_000),
  })
  .superRefine((value, ctx) => {
    if (value.review_request_enabled && !value.review_url) {
      ctx.addIssue({ code: "custom", message: REVIEW_URL_REQUIRED, path: ["review_url"] });
    }
  });

export const reminderReviewFormSchema = z
  .object({
    voice_reminders_enabled: z.boolean(),
    review_request_enabled: z.boolean(),
    review_url: z
      .string()
      .trim()
      .max(2000)
      .refine((v) => v.length === 0 || isHttpsUrl(v), "Enter a full link starting with https://"),
    avg_transaction_value_cents: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (value.review_request_enabled && value.review_url.length === 0) {
      ctx.addIssue({ code: "custom", message: REVIEW_URL_REQUIRED, path: ["review_url"] });
    }
  });
export type ReminderReviewFormValues = z.infer<typeof reminderReviewFormSchema>;

// ---------------------------------------------------------------------------
// Agent → Services dialog (client) — the server boundary is
// `api/tenant/offerings/schema.ts`'s `offeringWriteSchema`.
// ---------------------------------------------------------------------------

export const serviceDialogSchema = z.object({
  name: z.string().trim().min(1, "Give the service a name.").max(200),
  duration_minutes: z
    .number({ error: "Enter the length in minutes." })
    .int("Use whole minutes.")
    .min(5, "At least 5 minutes.")
    .max(1440, "At most 24 hours.")
    .optional(),
  price_cents: z
    .number()
    .int("Use whole cents.")
    .nonnegative("Price can't be negative.")
    .max(100_000_000)
    .optional(),
});
export type ServiceDialogValues = z.infer<typeof serviceDialogSchema>;
