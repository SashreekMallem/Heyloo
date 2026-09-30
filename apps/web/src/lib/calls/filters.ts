/**
 * Shared call-list filtering (QA-1 F-15 / F-17): the Calls page and the CSV
 * export apply the SAME classification / search / date-range rules, so an
 * export always matches what the owner is looking at.
 */
import { E164_PATTERN } from "@heyloo/canonical-types";
import { escapeLike } from "@/lib/customers/search";

/** The 12 values of the `call_logs.classification` CHECK constraint. */
export const CALL_CLASSIFICATIONS = [
  "new_booking",
  "reschedule",
  "cancel",
  "question_faq",
  "status_check",
  "sales_lead",
  "solicitor",
  "wrong_number",
  "spam_robocall",
  "emergency",
  "after_hours_message",
  "transfer_request",
] as const;

export type CallClassificationValue = (typeof CALL_CLASSIFICATIONS)[number];

export function parseClassification(
  raw: string | null | undefined,
): CallClassificationValue | null {
  return (CALL_CLASSIFICATIONS as readonly string[]).includes(raw ?? "")
    ? (raw as CallClassificationValue)
    : null;
}

export interface CallSearchTerm {
  /** Digits of the term when there are enough to match a phone number (>= 3). */
  digits: string | null;
  /** ILIKE pattern for `customers.name`, or null when the term has no letters. */
  namePattern: string | null;
}

export function parseCallSearch(raw: string): CallSearchTerm {
  const term = raw.trim();
  if (!term) return { digits: null, namePattern: null };
  const digits = term.replace(/\D/g, "");
  return {
    digits: digits.length >= 3 ? digits : null,
    namePattern: /[^\d\s()+.-]/.test(term) ? `%${escapeLike(term)}%` : null,
  };
}

/**
 * PostgREST `.or()` expression matching `caller_number` by digits and/or by the
 * E.164 numbers of customers whose name matched. Built ONLY from digits and
 * validated E.164 numbers — no user-controlled text reaches the filter
 * grammar (see SEC-15). `null` = the term can match nothing.
 */
export function buildCallOrFilter(term: CallSearchTerm, customerPhones: string[]): string | null {
  const parts: string[] = [];
  if (term.digits) parts.push(`caller_number.ilike.%${term.digits}%`);
  const phones = customerPhones.filter((p) => E164_PATTERN.test(p));
  if (phones.length) parts.push(`caller_number.in.(${phones.join(",")})`);
  return parts.length ? parts.join(",") : null;
}

/** ISO instant or null — for `started_after` / `started_before` query params. */
export function parseIsoInstant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
