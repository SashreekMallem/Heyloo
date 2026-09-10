import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/marketing/legal-page";
import { getLegalDoc } from "@/lib/content/legal";

export const metadata: Metadata = { title: "Terms of Service — Heyloo" };

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const doc = await getLegalDoc("terms");
  return <LegalPage doc={doc} />;
}
