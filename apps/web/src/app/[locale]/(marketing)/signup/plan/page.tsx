import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PriceCardResponse } from "@/app/api/platform-settings/price-card/route";
import { PlanStepClient } from "@/components/signup/plan-step-client";
import { env } from "@/lib/env";
import { decodeSignupDraft, SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";

export const metadata: Metadata = { title: "Choose your plan — Heyloo" };

/** Signup step 2 (FRONTEND_SPEC.md §4.2). Guard: signed cookie present. */
export default async function SignupPlanPage() {
  const cookieStore = await cookies();
  const draft = decodeSignupDraft(cookieStore.get(SIGNUP_DRAFT_COOKIE.name)?.value);
  if (!draft) redirect("/signup");

  const res = await fetch(
    `${env.appBaseUrl}/api/platform-settings/price-card?vertical=${draft.business_type}`,
    { cache: "no-store" },
  );
  const priceCard = (await res.json()) as PriceCardResponse;

  return (
    <div className="px-4 py-16">
      <PlanStepClient priceCard={priceCard} />
    </div>
  );
}
