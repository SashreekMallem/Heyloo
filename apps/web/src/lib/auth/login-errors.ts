/** The bits of a Supabase `AuthError` the login form maps to copy. */
export interface SignInFailure {
  status?: number | undefined;
  code?: string | undefined;
  name?: string | undefined;
}

export const LOGIN_ERROR_MESSAGES = {
  invalid: "Incorrect email or password.",
  rateLimited: "Too many attempts. Wait a minute, then try again.",
  unconfirmed: "Confirm your email first. Check your inbox for the link we sent you.",
  network: "Connection problem. Check your internet and try again.",
} as const;

/**
 * Maps a failed `signInWithPassword` to user-facing copy (AUTH-06). Every
 * failure used to read "Incorrect email or password.", which told a rate-limited
 * or offline user to retype a correct password. Codes per supabase.com/docs
 * (auth error codes): `over_request_rate_limit` (HTTP 429),
 * `email_not_confirmed`; auth-js raises `AuthRetryableFetchError` (status 0
 * or 5xx) when the request never got a usable answer.
 */
export function loginErrorMessage(failure: SignInFailure): string {
  if (failure.status === 429 || failure.code === "over_request_rate_limit") {
    return LOGIN_ERROR_MESSAGES.rateLimited;
  }
  if (failure.code === "email_not_confirmed") return LOGIN_ERROR_MESSAGES.unconfirmed;
  if (
    failure.name === "AuthRetryableFetchError" ||
    failure.status === 0 ||
    (typeof failure.status === "number" && failure.status >= 500)
  ) {
    return LOGIN_ERROR_MESSAGES.network;
  }
  return LOGIN_ERROR_MESSAGES.invalid;
}
