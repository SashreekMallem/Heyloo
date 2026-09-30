import "server-only";

import { decodeSignupDraft, type SignupDraft } from "./draft-cookie";
import { draftFromUserMetadata } from "./user-metadata";

/**
 * The signup draft for this request: the signed cookie when present (the
 * normal, same-browser case), else the copy saved on the user at signUp
 * (`user-metadata.ts`) — a customer who confirmed their email in another
 * browser, or whose cookie expired, still resumes with their vertical,
 * business name, business phone and website instead of a blank step 1.
 */
export function resolveSignupDraft(
  cookieValue: string | undefined,
  user: { user_metadata?: unknown } | null | undefined,
): SignupDraft | null {
  const fromCookie = decodeSignupDraft(cookieValue);
  if (fromCookie) return fromCookie;
  if (!user) return null;
  const fromMetadata = draftFromUserMetadata(user.user_metadata);
  return fromMetadata
    ? {
        business_type: fromMetadata.business_type,
        business_name: fromMetadata.business_name,
        ...(fromMetadata.business_phone ? { business_phone: fromMetadata.business_phone } : {}),
        ...(fromMetadata.website_url ? { website_url: fromMetadata.website_url } : {}),
      }
    : null;
}
