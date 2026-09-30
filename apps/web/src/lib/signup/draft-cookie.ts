import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "heyloo_signup_draft";
// 24 hours. The draft must outlive the trip to Stripe Checkout and back
// (cancel lands on /signup/plan, which needs it) and the wait for the
// confirmation email; it is removed explicitly once the tenant is active
// (`DELETE /api/signup/draft`, called when provisioning completes), and the
// TTL is only the backstop for a customer who never comes back.
const MAX_AGE_SECONDS = 60 * 60 * 24;

export interface SignupDraft {
  business_type: string;
  business_name: string;
  /** E.164 (normalized by `/api/signup/draft`); absent when left blank or on a draft saved before step 1 asked for it. */
  business_phone?: string;
  /** http(s) URL (normalized by `/api/signup/draft`); absent when left blank. */
  website_url?: string;
  demo_id?: string;
}

function secret(): string {
  const value = process.env.SIGNUP_DRAFT_SECRET;
  if (!value) throw new Error("Missing required env var: SIGNUP_DRAFT_SECRET");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Signed cookie carrying signup progress (FRONTEND_SPEC.md §4 DECIDE — avoids a `signup_drafts` table). Kept until the tenant is ACTIVE, not merely created: creating the checkout session no longer clears it, so cancelling at Stripe returns to a filled-in wizard. */
export function encodeSignupDraft(draft: SignupDraft): string {
  const payload = Buffer.from(JSON.stringify(draft)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSignupDraft(cookieValue: string | undefined): SignupDraft | null {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as SignupDraft;
  } catch {
    return null;
  }
}

export const SIGNUP_DRAFT_COOKIE = { name: COOKIE_NAME, maxAge: MAX_AGE_SECONDS };
