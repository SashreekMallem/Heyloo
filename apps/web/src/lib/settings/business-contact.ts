import { zWebsiteUrl } from "@heyloo/canonical-types";
import { z } from "zod";
import { normalizePhone } from "./phone";

/**
 * The business's own contact details (`tenants.business_phone` /
 * `tenants.website_url`, migration 20260930280000), asked at signup step 1
 * and editable in Agent → Business and phone setup. One friendly rule for
 * every place they are typed, mirroring `./phone.ts`'s split: plain-string
 * form fields (react-hook-form keeps input and output shapes equal) and
 * server-boundary transforms that store only the normalized shape.
 */

/**
 * The business phone is the line that forwards to the Heyloo number, which
 * the forwarding test dials — US/Canada only at launch (SYSTEM_DESIGN §1),
 * so an otherwise valid international number is refused here rather than
 * later by the test.
 */
export const BUSINESS_PHONE_ERROR_MESSAGE =
  "Enter your US or Canadian business number, e.g. (262) 755-1967.";

export const WEBSITE_ERROR_MESSAGE = "Enter your website, e.g. yourbusiness.com.";

/** Friendly input -> `+1XXXXXXXXXX`, or `null` when blank or not a US/Canada number. Reuses the portal-wide `normalizePhone`. */
export function normalizeBusinessPhone(raw: string | null | undefined): string | null {
  const e164 = normalizePhone(raw);
  return e164?.startsWith("+1") ? e164 : null;
}

/**
 * "yourbusiness.com" -> "https://yourbusiness.com". An explicit http(s)
 * scheme is kept; any other scheme ("ftp://", "javascript:"), whitespace
 * inside the address, or a host without a dot is refused (`null`). The
 * result always satisfies `tenants_website_url_format_chk`.
 */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0 || /\s/.test(trimmed)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  let candidate: string;
  if (/^https?:\/\//i.test(trimmed)) {
    candidate = trimmed.replace(/^https?/i, (scheme) => scheme.toLowerCase());
  } else if (hasScheme && !/^[^:/]+:\d+(\/|$)/.test(trimmed)) {
    // A non-web scheme — but "example.com:8080" is a host with a port, not a scheme.
    return null;
  } else {
    candidate = `https://${trimmed.replace(/^\/\/+/, "")}`;
  }
  let host: string;
  try {
    host = new URL(candidate).hostname;
  } catch {
    return null;
  }
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) return null;
  return zWebsiteUrl.safeParse(candidate).success ? candidate : null;
}

/** Client form field: blank allowed, otherwise must normalize. */
export const zBusinessPhoneFormField = z
  .string()
  .trim()
  .max(40)
  .refine(
    (value) => value.length === 0 || normalizeBusinessPhone(value) !== null,
    BUSINESS_PHONE_ERROR_MESSAGE,
  );

/** Client form field: blank allowed, otherwise must normalize. */
export const zWebsiteFormField = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => value.length === 0 || normalizeWebsiteUrl(value) !== null,
    WEBSITE_ERROR_MESSAGE,
  );

/**
 * Server boundary: blank / `null` -> `null` (clears the stored value), a
 * missing key stays `undefined` (leave it alone), anything else -> E.164 or
 * a 422 issue on the field.
 */
export const zOptionalBusinessPhone = z
  .string()
  .max(40)
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null || value.trim().length === 0) return null;
    const e164 = normalizeBusinessPhone(value);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: BUSINESS_PHONE_ERROR_MESSAGE });
      return z.NEVER;
    }
    return e164;
  });

/** Server boundary for the website, same blank/missing semantics as the phone. */
export const zOptionalWebsite = z
  .string()
  .max(2048)
  .nullish()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null || value.trim().length === 0) return null;
    const url = normalizeWebsiteUrl(value);
    if (!url) {
      ctx.addIssue({ code: "custom", message: WEBSITE_ERROR_MESSAGE });
      return z.NEVER;
    }
    return url;
  });
