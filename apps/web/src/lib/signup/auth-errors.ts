/**
 * Maps a Supabase Auth (GoTrue) `signUp` failure to a message a customer can
 * act on (SIGNUP-BILL-FIX A). Before this, every failure except "already
 * registered" was shown as "Something went wrong", which hid the one thing the
 * customer could fix (a rejected email, a weak password) and the one thing we
 * had to fix (mail delivery limits).
 *
 * Codes verified against the CURRENT Supabase Auth error-code reference
 * (supabase.com/docs/guides/auth/debugging/error-codes, fetched 2026-09-29):
 * `AuthApiError` always carries a machine-readable `code` and the HTTP
 * `status`. Matching is on `code`, never on the English message, which GoTrue
 * may reword.
 */

export type SignUpErrorKind =
  | "already_registered"
  | "invalid_email"
  | "weak_password"
  | "rate_limited"
  | "email_not_deliverable"
  | "signup_disabled"
  | "invalid_details"
  | "unknown";

export interface SignUpErrorLike {
  code?: string | undefined;
  status?: number | undefined;
  message?: string | undefined;
  /** `AuthWeakPasswordError.reasons`: "length" | "characters" | "pwned". */
  reasons?: readonly string[] | undefined;
}

export interface MappedSignUpError {
  kind: SignUpErrorKind;
  message: string;
}

const WEAK_PASSWORD_REASONS: Record<string, string> = {
  length: "it is too short",
  characters: "it needs a mix of lowercase, uppercase, numbers and symbols",
  pwned: "it appears in known data breaches",
};

export function mapSignUpError(error: SignUpErrorLike): MappedSignUpError {
  switch (error.code) {
    case "user_already_exists":
    case "email_exists":
      return {
        kind: "already_registered",
        message: "That email is already registered.",
      };
    case "email_address_invalid":
      return {
        kind: "invalid_email",
        message:
          "That email address can't be used. Enter your real business email (example and test domains are not accepted).",
      };
    case "weak_password": {
      const reasons = (error.reasons ?? [])
        .map((r) => WEAK_PASSWORD_REASONS[r])
        .filter((r): r is string => Boolean(r));
      return {
        kind: "weak_password",
        message:
          reasons.length > 0
            ? `Choose a stronger password: ${reasons.join(", and ")}.`
            : "Choose a stronger password (at least 8 characters, hard to guess).",
      };
    }
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return {
        kind: "rate_limited",
        message:
          "We've sent too many confirmation emails for now. Wait a little while (up to an hour), then try again.",
      };
    case "email_address_not_authorized":
      return {
        kind: "email_not_deliverable",
        message:
          "We can't send a confirmation email to that address right now. Please contact support and we'll set your account up by hand.",
      };
    case "signup_disabled":
    case "email_provider_disabled":
      return {
        kind: "signup_disabled",
        message: "New sign-ups are temporarily closed. Please contact support.",
      };
    case "validation_failed":
      return {
        kind: "invalid_details",
        message: "Please check the details you entered and try again.",
      };
    default:
      break;
  }

  // A 429 with a code we don't know yet is still a rate limit.
  if (error.status === 429) {
    return {
      kind: "rate_limited",
      message: "Too many attempts. Please wait a moment and try again.",
    };
  }

  const detail = error.message?.trim();
  return {
    kind: "unknown",
    message: detail
      ? `We couldn't create your account: ${detail}`
      : "We couldn't create your account. Please try again.",
  };
}

/**
 * With email confirmation on, GoTrue hides whether an address is registered
 * (anti-enumeration): `signUp` for an existing, confirmed address succeeds
 * with a user whose `identities` array is empty and sends no email. Without
 * this check the wizard would say "check your email" for a mail that will
 * never come (docs/VERIFY.md SIGNUP-BILL-FIX: supabase-js reference says only
 * that it "may" return an error hiding the account).
 */
export function isObfuscatedExistingUser(
  user: { identities?: readonly unknown[] | null } | null | undefined,
): boolean {
  return Array.isArray(user?.identities) && user.identities.length === 0;
}
