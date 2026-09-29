import { redirect } from "@/i18n/navigation";

/** `/cockpit` has no landing page of its own — the margin waterfall is the cockpit's home (it previously 404'd). */
export default async function CockpitIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/cockpit/margin/waterfall", locale });
}
