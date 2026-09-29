import { signupBusinessTypeSchema } from "@heyloo/canonical-types";
import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccountStepClient } from "@/components/signup/account-step-client";
import { SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";
import { resolveSignupDraft } from "@/lib/signup/resolve-draft";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Create your account — Heyloo" };

export default async function SignupAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ annual?: string; white_glove?: string }>;
}) {
  const cookieStore = await cookies();
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const draft = resolveSignupDraft(cookieStore.get(SIGNUP_DRAFT_COOKIE.name)?.value, user);
  const parsedDraft = signupBusinessTypeSchema.safeParse(draft);
  if (!parsedDraft.success) redirect("/signup");

  const { annual, white_glove: whiteGlove } = await searchParams;
  return (
    <Section spacing="default" className="pb-24">
      <Container size="content">
        <AccountStepClient
          annual={annual === "1"}
          whiteGlove={whiteGlove === "1"}
          draft={parsedDraft.data}
          signedInEmail={user?.email ?? undefined}
        />
      </Container>
    </Section>
  );
}
