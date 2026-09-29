import type { SignupBusinessType } from "@heyloo/canonical-types";

/**
 * Where `/signup/resume` sends a customer who just confirmed their email (or
 * clicked an old link, or came back from a cancelled Checkout while signed
 * in): pure so every branch is unit-tested (SIGNUP-BILL-FIX A).
 *
 * The wizard continues exactly where they left off:
 *  - no session          -> log in, then back here;
 *  - no tenant yet       -> checkout with the vertical / business name / plan
 *                           they chose (needs the draft; without one, step 1);
 *  - unpaid (`trialing`) -> checkout again (`api-checkout` reuses that tenant);
 *  - paid, line not live -> the provisioning timeline;
 *  - anything else       -> the dashboard.
 */
export interface ResumeInput {
  hasSession: boolean;
  tenant: { status: string } | null;
  draft: SignupBusinessType | null;
  lineReady: boolean;
  plan: { annual: boolean; white_glove: boolean };
}

export type ResumeDecision =
  | { kind: "redirect"; to: string }
  | { kind: "checkout"; annual: boolean; whiteGlove: boolean; businessName: string };

export function decideSignupResume(input: ResumeInput): ResumeDecision {
  if (!input.hasSession) {
    return { kind: "redirect", to: `/login?next=${encodeURIComponent("/signup/resume")}` };
  }

  const status = input.tenant?.status;
  if (input.tenant && status !== "trialing") {
    if (status === "active" && !input.lineReady) {
      return { kind: "redirect", to: "/signup/provisioning" };
    }
    return { kind: "redirect", to: "/dashboard" };
  }

  // No tenant yet, or one that never got paid.
  if (!input.draft) return { kind: "redirect", to: "/signup" };
  return {
    kind: "checkout",
    annual: input.plan.annual,
    whiteGlove: input.plan.white_glove,
    businessName: input.draft.business_name,
  };
}
