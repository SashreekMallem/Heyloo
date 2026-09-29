import { z } from "zod";
import { E164_PATTERN } from "../primitives.js";

/**
 * `/dashboard/delivery` "Text messaging setup" form — the end business's
 * own details that US carriers require before ANY provider may send texts
 * on its behalf (toll-free verification and 10DLC brand registration both
 * need the exact IRS legal name and, for every business type except sole
 * proprietor, the EIN; a Business Registration Number is mandatory for new
 * toll-free submissions since 2026-02-17). Stored in
 * `public.messaging_business_profiles`; see
 * docs/design/MESSAGING_PROVIDERS.md "Carrier registration".
 */

export const MESSAGING_BUSINESS_TYPES = [
  "sole_proprietor",
  "llc",
  "corporation",
  "partnership",
  "nonprofit",
] as const;
export type MessagingBusinessType = (typeof MESSAGING_BUSINESS_TYPES)[number];

/** 9 digits, optionally written `12-3456789`. */
export const EIN_PATTERN = /^\d{2}-?\d{7}$/;

const zPhoneString = z.string().regex(E164_PATTERN, "Use E.164 format, e.g. +15551234567");

export const messagingBusinessProfileSchema = z
  .object({
    legal_name: z
      .string()
      .trim()
      .min(2, "Enter the exact legal name on your IRS paperwork")
      .max(200),
    dba_name: z.string().trim().max(200).optional(),
    business_type: z.enum(MESSAGING_BUSINESS_TYPES),
    ein: z.string().trim().regex(EIN_PATTERN, "EIN is 9 digits, e.g. 12-3456789").optional(),
    website_url: z.url("Enter a full URL, e.g. https://example.com").optional(),
    street_line1: z.string().trim().min(3).max(200),
    street_line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(2).max(100),
    region: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/, "Use the 2-letter state code, e.g. CA"),
    postal_code: z
      .string()
      .trim()
      .regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code"),
    contact_first_name: z.string().trim().min(1).max(100),
    contact_last_name: z.string().trim().min(1).max(100),
    contact_email: z.email("Enter a valid email address"),
    contact_phone: zPhoneString,
    monthly_volume_estimate: z.number().int().min(1).max(1_000_000),
  })
  .refine((v) => v.business_type === "sole_proprietor" || !!v.ein, {
    path: ["ein"],
    message: "Carriers require an EIN for every business type except sole proprietor",
  });

export type MessagingBusinessProfile = z.infer<typeof messagingBusinessProfileSchema>;
