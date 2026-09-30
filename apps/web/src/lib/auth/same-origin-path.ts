/**
 * A `next` / return-to parameter is trusted only as a same-origin relative
 * path, never an absolute or protocol-relative URL (open-redirect guard shared
 * by `/auth/confirm`, the login page and the MFA challenge).
 *
 * The raw string is checked AND resolved against `origin`: a leading backslash
 * (`/\evil.com`), embedded tab/newline (`/\t/evil.com`) or similar URL-parser
 * quirks pass a naive `startsWith("/")` test yet resolve to another host, so
 * the resolved origin must equal ours. Returns `null` when unsafe.
 */
export function sameOriginPath(raw: string | null | undefined, origin: string): string | null {
  if (!raw?.startsWith("/") || raw.startsWith("//")) return null;
  // Backslashes and control characters are never part of a legitimate app
  // path, and WHATWG URL parsing treats `\` as `/` for special schemes.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    return new URL(raw, origin).origin === origin ? raw : null;
  } catch {
    return null;
  }
}
