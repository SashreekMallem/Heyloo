import { signupBusinessTypeSchema } from "@heyloo/canonical-types";
import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ResumeCheckoutClient } from "@/components/signup/resume-checkout-client";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";
import { getLineReadiness } from "@/lib/signup/line-readiness";
import { resolveSignupDraft } from "@/lib/signup/resolve-draft";
import { decideSignupResume } from "@/lib/signup/resume-decision";
import { planFromUserMetadata } from "@/lib/signup/user-metadata";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Continue signup — Heyloo" };

/**
 * Where the confirmation email lands (via `/auth/confirm`, which has just
 * verified the token and set the session cookies): continues the wizard exactly
 * where the customer left off — vertical, business name and plan come from the
 * signed draft cookie or, if they opened the email elsewhere, from the copy
 * saved on their account at signUp — straight into Stripe Checkout
 * (SIGNUP-BILL-FIX A). Before this, a confirmed customer with no tenant hit
 * `/dashboard`'s guard and landed on `/?toast=no_access` with nothing resuming
 * the signup.
 */
export default async function SignupResumePage() {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const claims = user ? await claimsFromSupabaseClient(supabase) : {};
  const tenant =
    user && claims.tenant_id
      ? ((
          await supabase
            .from("tenants")
            .select("id, status")
            .eq("id", claims.tenant_id)
            .maybeSingle()
        ).data ?? null)
      : null;

  const cookieStore = await cookies();
  const draftRaw = resolveSignupDraft(cookieStore.get(SIGNUP_DRAFT_COOKIE.name)?.value, user);
  const parsedDraft = signupBusinessTypeSchema.safeParse(draftRaw);
  const lineReady = tenant ? (await getLineReadiness(supabase, tenant.id)).ready : false;

  const decision = decideSignupResume({
    hasSession: Boolean(user),
    tenant,
    draft: parsedDraft.success ? parsedDraft.data : null,
    lineReady,
    plan: planFromUserMetadata(user?.user_metadata),
  });

  if (decision.kind === "redirect") redirect(decision.to);

  return (
    <Section spacing="default" className="pb-24">
      <Container size="content">
        <ResumeCheckoutClient
          annual={decision.annual}
          whiteGlove={decision.whiteGlove}
          businessName={decision.businessName}
        />
      </Container>
    </Section>
  );
}
