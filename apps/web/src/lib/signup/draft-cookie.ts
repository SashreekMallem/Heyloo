import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "heyloo_signup_draft";
const MAX_AGE_SECONDS = 60 * 60; // 1 hour — pre-auth state only, per FRONTEND_SPEC.md §4 ("short-lived").

export interface SignupDraft {
  business_type: string;
  business_name: string;
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

/** Signed, short-lived cookie carrying pre-auth signup progress (FRONTEND_SPEC.md §4 DECIDE — avoids a `signup_drafts` table for pre-auth state; cleared once the real `tenants` row exists at step 3). */
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
