import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/marketing/legal-page";
import { getLegalDoc } from "@/lib/content/legal";

export const metadata: Metadata = { title: "Data Processing Addendum — Heyloo" };

export default async function DpaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const doc = await getLegalDoc("dpa");
  return <LegalPage doc={doc} />;
}
