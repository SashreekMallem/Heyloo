/**
 * The 12-class call taxonomy — every call lands in exactly one class
 * (SYSTEM_DESIGN §4.2). In-call tools drive routing; post-call analysis
 * (`call_analyzed`) is the AUTHORITATIVE final classification — a call can
 * migrate class mid-call (e.g. starts as `new_booking`, caller reveals an
 * emergency red-flag, ends classified `emergency`).
 */

import { z } from "zod";

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

export type CallClassification = (typeof CALL_CLASSIFICATIONS)[number];

export const zCallClassification = z.enum(CALL_CLASSIFICATIONS);

/** Human-readable labels — dashboard/cockpit display only, never used for matching. */
export const CALL_CLASSIFICATION_LABELS: Readonly<Record<CallClassification, string>> = {
  new_booking: "New booking",
  reschedule: "Reschedule",
  cancel: "Cancel",
  question_faq: "Question / FAQ",
  status_check: "Status check",
  sales_lead: "Sales lead",
  solicitor: "Solicitor",
  wrong_number: "Wrong number",
  spam_robocall: "Spam / robocall",
  emergency: "Emergency",
  after_hours_message: "After-hours message",
  transfer_request: "Transfer request",
};
