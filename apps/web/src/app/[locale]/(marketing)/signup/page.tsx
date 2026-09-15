import type { Vertical } from "@heyloo/canonical-types";
import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import type { Metadata } from "next";
import { BusinessTypeForm } from "@/components/signup/business-type-form";
import { getVerticalContent } from "@/content/marketing/verticals";

export const metadata: Metadata = { title: "Sign up — Heyloo" };

/** Signup step 1 (FRONTEND_SPEC.md §4.1). Guard: none — redirect handled by middleware if already authenticated with an active tenant. */
export default async function SignupStep1Page({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string; demo_id?: string }>;
}) {
  const { vertical, demo_id } = await searchParams;
  const content = vertical ? getVerticalContent(vertical) : undefined;

  return (
    <Section spacing="default" className="pb-24">
      <Container size="content">
        <BusinessTypeForm
          initialVertical={content?.vertical as Vertical | undefined}
          demoId={demo_id}
        />
      </Container>
    </Section>
  );
}
