import "@/components/marketing/home/home.css";

import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Call } from "@/components/marketing/home/call";
import { Dashboard } from "@/components/marketing/home/dashboard";
import { Finale } from "@/components/marketing/home/finale";
import { Hero } from "@/components/marketing/home/hero";
import { HomeMotion } from "@/components/marketing/home/home-motion";
import { Hours } from "@/components/marketing/home/hours";
import { HOME_BOOTSTRAP_SCRIPT } from "@/components/marketing/home/runtime/html-classes";
import { Setup } from "@/components/marketing/home/setup";
import { Trades } from "@/components/marketing/home/trades";
import { RoleGuardToast } from "@/components/shared/role-guard-toast";
import { HOME_META } from "@/content/marketing/home";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: HOME_META.title,
  description: HOME_META.description,
};

/**
 * `/` — Home (SITE-3, the approved premium design). Every word of it is
 * server-rendered, so it reads without JS and for crawlers; the motion runtime
 * (`HomeMotion`) and the 3D scene are lazy and start after first paint. The
 * page is one 7-chapter story (hero, hours, one call, the dashboard, business
 * types, setup, then the finale: trust, live demo, pricing, start).
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="hm">
      {/* Runs before first paint so the very first frame has its final layout. Static, non-user-controlled. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static bootstrap script, see runtime/html-classes.ts */}
      <script dangerouslySetInnerHTML={{ __html: HOME_BOOTSTRAP_SCRIPT }} />
      <Suspense fallback={null}>
        <RoleGuardToast />
      </Suspense>

      <div className="gl-wrap" aria-hidden="true">
        <canvas id="gl" />
      </div>
      <div className="fx-vig" aria-hidden="true" />
      <div className="fx-grain" aria-hidden="true" />
      <div className="vh-probe" aria-hidden="true" />

      <div className="hm-main">
        <Hero />
        <Hours />
        <Call />
        <Dashboard />
        <Trades />
        <Setup />
        <Finale demoPhone={env.demoPhoneE164} />
      </div>
      <HomeMotion />
    </div>
  );
}
