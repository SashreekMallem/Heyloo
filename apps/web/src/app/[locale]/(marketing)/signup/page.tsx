import { signupBusinessTypeSchema, type Vertical } from "@heyloo/canonical-types";
import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { BusinessTypeForm } from "@/components/signup/business-type-form";
import { getVerticalContent } from "@/content/marketing/verticals";
import { decodeSignupDraft, SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";

export const metadata: Metadata = {
  title: "Sign up — Heyloo",
  description:
    "Set up your Heyloo AI receptionist in minutes: pick your business type, choose a plan and go live.",
  alternates: { canonical: "/signup" },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Signup step 1 (FRONTEND_SPEC.md §4.1). Guard: none. `middleware.ts` sends an already-signed-in tenant member on to `/signup/resume`. Prefilled from the signed draft cookie so Back from a later step keeps the answers. */
export default async function SignupStep1Page({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string; demo_id?: string }>;
}) {
  const { vertical, demo_id } = await searchParams;
  const cookieStore = await cookies();
  const draft = decodeSignupDraft(cookieStore.get(SIGNUP_DRAFT_COOKIE.name)?.value);
  const content = vertical ? getVerticalContent(vertical) : undefined;
  const draftVertical = signupBusinessTypeSchema.shape.business_type.safeParse(
    draft?.business_type,
  );

  return (
    <Section spacing="default" className="pb-24">
      <Container size="content">
        <BusinessTypeForm
          initialVertical={
            (content?.vertical as Vertical | undefined) ??
            (draftVertical.success ? draftVertical.data : undefined)
          }
          {...(draft?.business_name ? { initialBusinessName: draft.business_name } : {})}
          {...(draft?.business_phone ? { initialBusinessPhone: draft.business_phone } : {})}
          {...(draft?.website_url ? { initialWebsiteUrl: draft.website_url } : {})}
          demoId={demo_id && UUID.test(demo_id) ? demo_id : undefined}
        />
      </Container>
    </Section>
  );
}
