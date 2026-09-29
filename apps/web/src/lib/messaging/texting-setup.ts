import type { MessagingBusinessProfile } from "@heyloo/canonical-types";

/**
 * MESSAGING-1: shared shapes for `GET/PUT /api/tenant/messaging` and the
 * /dashboard/texting page (docs/design/MESSAGING_PROVIDERS.md).
 */

export type TextingState =
  | "not_started"
  | "details_submitted"
  | "in_review"
  | "active"
  | "action_needed";

export interface TextingSender {
  e164: string;
  kind: "toll_free" | "10dlc" | "short_code";
  registration_status: string;
  failure_reason: string | null;
}

export interface MessagingSetupResponse {
  state: TextingState;
  sender: TextingSender | null;
  /** Saved business details (null when none yet, or the caller isn't owner/admin). */
  profile: (MessagingBusinessProfile & { submitted_at: string | null }) | null;
  can_edit: boolean;
}

/** Where carrier approval stands, from the owner's point of view. */
export function textingState(input: {
  a2pStatus: string | null;
  sender: TextingSender | null;
  profileSubmitted: boolean;
}): TextingState {
  if (input.sender?.registration_status === "verified" || input.a2pStatus === "verified") {
    return "active";
  }
  if (input.sender?.registration_status === "failed" || input.a2pStatus === "failed") {
    return "action_needed";
  }
  if (
    input.sender?.registration_status === "submitted" ||
    input.sender?.registration_status === "in_review"
  ) {
    return "in_review";
  }
  return input.profileSubmitted ? "details_submitted" : "not_started";
}
