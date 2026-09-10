import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/marketing/legal-page";
import { getLegalDoc } from "@/lib/content/legal";

export const metadata: Metadata = { title: "Privacy Policy — Heyloo" };

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const doc = await getLegalDoc("privacy");
  return <LegalPage doc={doc} />;
}
