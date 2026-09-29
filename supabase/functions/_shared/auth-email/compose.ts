import { z } from "zod";
import { escapeHtml } from "../email-body.ts";

/**
 * Renders the Supabase Auth emails for the Send Email Hook
 * (`auth-send-email`): one payload in, one or two ready-to-send emails out.
 * Pure and portable (no Deno globals), so the whole matrix is unit-tested.
 *
 * Rule 1 (docs/VERIFY.md EMAIL-MSGRAPH), supabase.com/docs/guides/auth/
 * auth-hooks/send-email-hook (fetched 2026-09-29):
 * - payload `{user, email_data: {token, token_hash, redirect_to,
 *   email_action_type, site_url, token_new, token_hash_new}}`;
 * - `email_action_type`: signup, invite, magiclink, recovery, email_change,
 *   email, reauthentication, plus the *_notification types (only sent when
 *   the project enables those notifications);
 * - email change: "The token hash field names are reversed due to backward
 *   compatibility": `token_hash_new` goes with the CURRENT address
 *   (`user.email`) and `token`; `token_hash` goes with the NEW address
 *   (`user.new_email`) and `token_new`. With Secure Email Change enabled both
 *   pairs are present and two emails are sent; with it disabled only one pair
 *   is populated and one email goes to the new address.
 *
 * Links go to the web app's own `/auth/confirm` route with the token hash,
 * `type` (the `verifyOtp` type) and a same-origin `next` path, exactly like
 * `supabase/templates/*.html` (which the built-in mailer and local dev still
 * use; `compose.test.ts` fails if a template and this renderer drift apart):
 *
 *   {site_url}/auth/confirm?token_hash=<hash>&type=<type>&next=<path>
 *
 * `apps/web/src/app/auth/confirm/route.ts` accepts every `type` emitted here
 * (asserted by the test).
 */

const zOptionalString = z
  .string()
  .nullish()
  .transform((value) => value ?? "");

export const zAuthEmailHookPayload = z.object({
  user: z.object({
    id: z.string().min(1),
    email: zOptionalString,
    new_email: zOptionalString,
  }),
  email_data: z.object({
    token: zOptionalString,
    token_hash: zOptionalString,
    token_new: zOptionalString,
    token_hash_new: zOptionalString,
    redirect_to: zOptionalString,
    email_action_type: z.string().min(1),
    site_url: zOptionalString,
  }),
});
export type AuthEmailHookPayload = z.infer<typeof zAuthEmailHookPayload>;

/** `verifyOtp` types this renderer puts in links (all accepted by /auth/confirm). */
export const EMITTED_OTP_TYPES = [
  "email",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
] as const;
export type EmittedOtpType = (typeof EMITTED_OTP_TYPES)[number];

export interface ComposedEmail {
  /** Stable per-recipient slot, for idempotency keys and logs. */
  slot: "primary" | "current" | "new";
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type ComposeResult = { ok: true; emails: ComposedEmail[] } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const DEFAULT_NEXT: Record<EmittedOtpType, string> = {
  email: "/signup/resume",
  recovery: "/reset-password/confirm",
  invite: "/dashboard",
  magiclink: "/dashboard",
  email_change: "/dashboard",
};

/** A same-origin relative path: one leading slash, no scheme/host tricks. */
export function isSafeNextPath(value: string): boolean {
  if (value.length === 0 || value.length > 512) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return false;
  return true;
}

/**
 * Where the link lands after verification. The app's own signup, reset and
 * invite flows pass `redirect_to = <origin>/auth/confirm?next=<path>`; that
 * `next` wins when it is a safe same-origin path. Anything else (another
 * origin, a `//host` or `\` trick, a loop back into /auth/) falls back to the
 * per-type default.
 */
export function resolveNext(otpType: EmittedOtpType, redirectTo: string, siteUrl: string): string {
  const fallback = DEFAULT_NEXT[otpType];
  if (!redirectTo) return fallback;
  try {
    const redirect = new URL(redirectTo);
    if (redirect.origin !== new URL(siteUrl).origin) return fallback;
    if (redirect.pathname !== "/auth/confirm") return fallback;
    const next = redirect.searchParams.get("next");
    if (next && isSafeNextPath(next) && !next.startsWith("/auth/")) return next;
  } catch {
    // unparseable redirect_to: use the default
  }
  return fallback;
}

/** http(s) origin + optional path prefix, no trailing slash; `null` if unusable. */
export function normalizeSiteUrl(siteUrl: string): string | null {
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function buildConfirmLink(
  siteUrl: string,
  tokenHash: string,
  otpType: EmittedOtpType,
  next: string,
): string {
  // `/` stays literal in `next` (legal in a query string, matches the templates).
  const encodedNext = encodeURIComponent(next).replace(/%2F/gi, "/");
  return `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${otpType}&next=${encodedNext}`;
}

// ---------------------------------------------------------------------------
// Copy (mirrors supabase/templates/*.html; compose.test.ts diffs them)
// ---------------------------------------------------------------------------

interface Content {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string };
  showCode?: boolean;
  footer: string;
}

const CONTENT = {
  confirmation: {
    subject: "Confirm your Heyloo account",
    heading: "Confirm your email",
    paragraphs: [
      "Thanks for signing up. Confirm your email and we’ll take you straight to payment, with your business details already filled in.",
    ],
    cta: { label: "Confirm my email" },
    footer: "Didn’t sign up for Heyloo? You can ignore this email.",
  },
  recovery: {
    subject: "Reset your Heyloo password",
    heading: "Reset your password",
    paragraphs: [
      "We got a request to reset the password for your Heyloo account. Choose a new one with the button below. The link works once and expires soon.",
    ],
    cta: { label: "Choose a new password" },
    footer: "Didn’t ask for this? Ignore this email and your password stays the same.",
  },
  invite: {
    subject: "You're invited to Heyloo",
    heading: "You’re invited to Heyloo",
    paragraphs: [
      "You’ve been invited to join a team on Heyloo. Accept the invitation to set up your login and open the dashboard.",
    ],
    cta: { label: "Accept the invitation" },
    footer: "Weren’t expecting this? You can ignore this email.",
  },
  magic_link: {
    subject: "Your Heyloo sign-in link",
    heading: "Your Heyloo sign-in link",
    paragraphs: [
      "Use the button below to sign in to Heyloo. The link works once and expires soon.",
    ],
    cta: { label: "Sign in" },
    footer: "Didn’t request this? You can ignore this email.",
  },
  email_change_new: {
    subject: "Confirm your new Heyloo email address",
    heading: "Confirm your new email address",
    // `{new}` is replaced with the (escaped) new address.
    paragraphs: [
      "You asked to change the email address on your Heyloo account to {new}. Confirm the change with the button below.",
    ],
    cta: { label: "Confirm new email" },
    footer: "Didn’t ask for this? Ignore this email and your address stays the same.",
  },
  // Secure Email Change only: the message to the CURRENT address.
  email_change_current: {
    subject: "Approve your Heyloo email change",
    heading: "Approve your email change",
    paragraphs: [
      "You asked to change the email address on your Heyloo account to {new}. Approve the change from your current address with the button below. We also sent a confirmation to the new address, and the change completes once both are confirmed.",
    ],
    cta: { label: "Approve email change" },
    footer: "Didn’t ask for this? Ignore this email and your address stays the same.",
  },
  // `email` action type: an email sign-in with a 6-digit code and a link.
  email_code: {
    subject: "Your Heyloo sign-in code",
    heading: "Your Heyloo sign-in code",
    paragraphs: [
      "Enter this code to sign in to Heyloo, or use the button below. Both work once and expire soon.",
    ],
    cta: { label: "Sign in" },
    showCode: true,
    footer: "Didn’t request this? You can ignore this email.",
  },
  reauthentication: {
    subject: "Your Heyloo verification code",
    heading: "Confirm it’s you",
    paragraphs: ["Enter this code in Heyloo to continue. It works once and expires soon."],
    showCode: true,
    footer: "Didn’t ask for this? Someone may know your password. Change it right away.",
  },
} satisfies Record<string, Content>;
export type ContentKey = keyof typeof CONTENT;

/** Security notifications (sent only when the project turns them on). */
const NOTIFICATIONS: Record<string, { subject: string; heading: string; body: string }> = {
  password_changed_notification: {
    subject: "Your Heyloo password was changed",
    heading: "Your password was changed",
    body: "The password for your Heyloo account was just changed.",
  },
  email_changed_notification: {
    subject: "Your Heyloo email address was changed",
    heading: "Your email address was changed",
    body: "The email address on your Heyloo account was just changed.",
  },
  phone_changed_notification: {
    subject: "Your Heyloo phone number was changed",
    heading: "Your phone number was changed",
    body: "The phone number on your Heyloo account was just changed.",
  },
  identity_linked_notification: {
    subject: "A sign-in method was added to your Heyloo account",
    heading: "A sign-in method was added",
    body: "A new sign-in method was just linked to your Heyloo account.",
  },
  identity_unlinked_notification: {
    subject: "A sign-in method was removed from your Heyloo account",
    heading: "A sign-in method was removed",
    body: "A sign-in method was just removed from your Heyloo account.",
  },
  mfa_factor_enrolled_notification: {
    subject: "Two-step verification was added to your Heyloo account",
    heading: "Two-step verification was added",
    body: "A new two-step verification method was just added to your Heyloo account.",
  },
  mfa_factor_unenrolled_notification: {
    subject: "Two-step verification was removed from your Heyloo account",
    heading: "Two-step verification was removed",
    body: "A two-step verification method was just removed from your Heyloo account.",
  },
};
const NOTIFICATION_FOOTER =
  "If this wasn’t you, reset your password right away and reply to this email.";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STYLE = {
  brand: "margin:0 0 4px;font-size:14px;font-weight:600;letter-spacing:0.02em;color:#57534e;",
  h1: "margin:0 0 16px;font-size:22px;line-height:1.3;",
  body: "margin:0 0 24px;font-size:16px;line-height:1.5;",
  code: "margin:0 0 24px;font-size:28px;font-weight:700;letter-spacing:0.2em;font-family:'SF Mono',Menlo,Consolas,monospace;color:#1c1917;",
  button:
    "display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 24px;border-radius:8px;",
  small: "margin:0 0 8px;font-size:13px;line-height:1.5;color:#57534e;",
  link: "margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;color:#57534e;",
  footer: "margin:0;font-size:13px;line-height:1.5;color:#78716c;",
};

/** HTML-escape, then use the entity the templates use for typographic quotes. */
function h(text: string): string {
  return escapeHtml(text).replace(/’/g, "&rsquo;");
}

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

function render(
  content: Content,
  values: { newEmail?: string; link?: string; code?: string },
): Rendered {
  const withNew = (text: string) => text.replaceAll("{new}", values.newEmail ?? "");
  const paragraphs = content.paragraphs.map(withNew);

  const htmlParts: string[] = [
    `<p style="${STYLE.brand}">Heyloo</p>`,
    `<h1 style="${STYLE.h1}">${h(content.heading)}</h1>`,
    ...paragraphs.map((p) => `<p style="${STYLE.body}">${h(p)}</p>`),
  ];
  if (content.showCode && values.code) {
    htmlParts.push(`<p style="${STYLE.code}">${h(values.code)}</p>`);
  }
  if (content.cta && values.link) {
    htmlParts.push(
      `<p style="margin:0 0 24px;"><a href="${h(values.link)}" style="${STYLE.button}">${h(content.cta.label)}</a></p>`,
      `<p style="${STYLE.small}">${h("If the button doesn’t work, paste this link into your browser:")}</p>`,
      `<p style="${STYLE.link}">${h(values.link)}</p>`,
    );
  }
  htmlParts.push(`<p style="${STYLE.footer}">${h(content.footer)}</p>`);

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f5f4;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;">
            <tr>
              <td>
                ${htmlParts.join("\n                ")}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  const textParts: string[] = ["Heyloo", content.heading, ...paragraphs];
  if (content.showCode && values.code) textParts.push(`Your code: ${values.code}`);
  if (content.cta && values.link) textParts.push(`${content.cta.label}: ${values.link}`);
  textParts.push(content.footer);

  return { subject: content.subject, html, text: `${textParts.join("\n\n")}\n` };
}

function renderNotification(type: string): Rendered | null {
  const entry = NOTIFICATIONS[type];
  if (!entry) return null;
  return render(
    {
      subject: entry.subject,
      heading: entry.heading,
      paragraphs: [entry.body],
      footer: NOTIFICATION_FOOTER,
    },
    {},
  );
}

/** For tests: the same renderer the hook uses, with explicit values. */
export function renderContent(
  key: ContentKey,
  values: { newEmail?: string; link?: string; code?: string },
): Rendered {
  return render(CONTENT[key], values);
}

export const AUTH_EMAIL_SUBJECTS: Record<ContentKey, string> = Object.fromEntries(
  (Object.keys(CONTENT) as ContentKey[]).map((key) => [key, CONTENT[key].subject]),
) as Record<ContentKey, string>;

// ---------------------------------------------------------------------------
// Payload -> emails
// ---------------------------------------------------------------------------

const EMAIL_SHAPE = z.email();

export function composeAuthEmails(payload: AuthEmailHookPayload): ComposeResult {
  const { user, email_data: data } = payload;
  const type = data.email_action_type;

  if (!EMAIL_SHAPE.safeParse(user.email).success) {
    return { ok: false, reason: "user has no deliverable email address" };
  }

  const notification = renderNotification(type);
  if (notification) {
    return { ok: true, emails: [{ slot: "primary", to: user.email, ...notification }] };
  }

  const siteUrl = normalizeSiteUrl(data.site_url);
  const linkFor = (hash: string, otpType: EmittedOtpType): string | null =>
    siteUrl && hash
      ? buildConfirmLink(siteUrl, hash, otpType, resolveNext(otpType, data.redirect_to, siteUrl))
      : null;
  const need = (what: string): ComposeResult => ({
    ok: false,
    reason: `${type}: missing ${what}`,
  });

  switch (type) {
    case "signup": {
      const link = linkFor(data.token_hash, "email");
      if (!link) return need("token_hash or a valid site_url");
      return single(user.email, render(CONTENT.confirmation, { link }));
    }
    case "recovery": {
      const link = linkFor(data.token_hash, "recovery");
      if (!link) return need("token_hash or a valid site_url");
      return single(user.email, render(CONTENT.recovery, { link }));
    }
    case "invite": {
      const link = linkFor(data.token_hash, "invite");
      if (!link) return need("token_hash or a valid site_url");
      return single(user.email, render(CONTENT.invite, { link }));
    }
    case "magiclink": {
      const link = linkFor(data.token_hash, "magiclink");
      if (!link) return need("token_hash or a valid site_url");
      return single(user.email, render(CONTENT.magic_link, { link }));
    }
    case "email": {
      const link = linkFor(data.token_hash, "email");
      if (!link || !data.token) return need("token, token_hash or a valid site_url");
      return single(user.email, render(CONTENT.email_code, { link, code: data.token }));
    }
    case "reauthentication": {
      if (!data.token) return need("token");
      return single(user.email, render(CONTENT.reauthentication, { code: data.token }));
    }
    case "email_change": {
      if (!EMAIL_SHAPE.safeParse(user.new_email).success) return need("user.new_email");
      const newEmail = user.new_email;
      // Field names are reversed (see the header comment): `token_hash_new`
      // belongs with the CURRENT address, `token_hash` with the NEW one.
      if (data.token_hash && data.token_hash_new) {
        const currentLink = linkFor(data.token_hash_new, "email_change");
        const newLink = linkFor(data.token_hash, "email_change");
        if (!currentLink || !newLink) return need("a valid site_url");
        return {
          ok: true,
          emails: [
            {
              slot: "current",
              to: user.email,
              ...render(CONTENT.email_change_current, { newEmail, link: currentLink }),
            },
            {
              slot: "new",
              to: newEmail,
              ...render(CONTENT.email_change_new, { newEmail, link: newLink }),
            },
          ],
        };
      }
      // Secure Email Change off: one pair, one email, to the new address.
      const hash = data.token_hash || data.token_hash_new;
      const link = linkFor(hash, "email_change");
      if (!link) return need("token_hash or a valid site_url");
      return {
        ok: true,
        emails: [
          {
            slot: "new",
            to: newEmail,
            ...render(CONTENT.email_change_new, { newEmail, link }),
          },
        ],
      };
    }
    default:
      return { ok: false, reason: `unsupported email_action_type "${type.slice(0, 64)}"` };
  }
}

function single(to: string, rendered: Rendered): ComposeResult {
  return { ok: true, emails: [{ slot: "primary", to, ...rendered }] };
}
