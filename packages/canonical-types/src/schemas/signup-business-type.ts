import { z } from "zod";
import { E164_PATTERN } from "../primitives.js";
import { zVertical } from "../vertical.js";

/**
 * `tenants.website_url`'s check constraint (migration
 * 20260930280000_business_phone_and_forwarding_test): http(s) scheme, then
 * no whitespace. Friendly input ("yourbusiness.com") is normalized before it
 * reaches this schema (apps/web `lib/settings/business-contact.ts`).
 */
export const WEBSITE_URL_PATTERN = /^https?:\/\/[^\s]+$/i;

/** Stored website shape: a parseable http(s) URL that also satisfies the DB check. */
export const zWebsiteUrl = z
  .url({ protocol: /^https?$/, error: "Enter a web address like https://yourbusiness.com" })
  .max(2048)
  .regex(WEBSITE_URL_PATTERN, "Enter a web address like https://yourbusiness.com");

/**
 * Signup step 1 (FRONTEND_SPEC.md §4.1). `business_type` reuses the canonical
 * 8-vertical + generic enum.
 *
 * `business_phone` (the number customers call today, which forwards to the
 * Heyloo number) and `website_url` are optional: a brand-new business may
 * have neither, and drafts saved before these fields existed must still
 * parse. Both are the STORED shapes (E.164 / http(s) URL) — the step-1 form
 * and `/api/signup/draft` normalize friendly input before it gets here.
 */
export const signupBusinessTypeSchema = z.object({
  business_type: zVertical,
  business_name: z.string().trim().min(1, "Business name is required").max(200),
  business_phone: z.string().regex(E164_PATTERN, "Use E.164 format, e.g. +12627551967").optional(),
  website_url: zWebsiteUrl.optional(),
});

export type SignupBusinessType = z.infer<typeof signupBusinessTypeSchema>;
