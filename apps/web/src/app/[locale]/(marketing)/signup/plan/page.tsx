import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PriceCardResponse } from "@/app/api/platform-settings/price-card/route";
import { PlanStepClient } from "@/components/signup/plan-step-client";
import { env } from "@/lib/env";
import { SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";
import { resolveSignupDraft } from "@/lib/signup/resolve-draft";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose your plan — Heyloo" };

/** Signup step 2 (FRONTEND_SPEC.md §4.2). Guard: signed cookie present. */
export default async function SignupPlanPage() {
  const cookieStore = await cookies();
  // A customer returning from a cancelled Stripe Checkout still has the draft
  // (the checkout route no longer clears it); one whose cookie expired falls
  // back to the copy saved on their account.
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const draft = resolveSignupDraft(cookieStore.get(SIGNUP_DRAFT_COOKIE.name)?.value, user);
  if (!draft) redirect("/signup");

  const res = await fetch(
    `${env.appBaseUrl}/api/platform-settings/price-card?vertical=${draft.business_type}`,
    { cache: "no-store" },
  );
  const priceCard = (await res.json()) as PriceCardResponse;

  return (
    <Section spacing="default" className="pb-24">
      <Container size="content">
        <PlanStepClient priceCard={priceCard} />
      </Container>
    </Section>
  );
}
