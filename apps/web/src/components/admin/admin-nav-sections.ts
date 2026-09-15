import type { NavSection } from "@heyloo/ui/layout/app-sidebar-nav";
import {
  AlertTriangle,
  Bell,
  FlaskConical,
  Gauge,
  Handshake,
  Headset,
  LayoutTemplate,
  Megaphone,
  Settings,
  Sparkles,
  Store,
  Target,
  TrendingUp,
  Users,
  Waves,
} from "lucide-react";

/** Pure nav config + route-matching, split out of `admin-shell-client.tsx` (a "use client" component that pulls in next-intl navigation) so it can be unit-tested without a Next.js runtime. */
export const SECTIONS: NavSection[] = [
  {
    label: "Margin Cockpit",
    items: [
      { label: "Waterfall", href: "/cockpit/margin/waterfall", icon: Waves },
      { label: "Per-customer", href: "/cockpit/margin/customers", icon: Users },
      { label: "Per-call", href: "/cockpit/margin/calls", icon: Gauge },
      { label: "Repricing drift", href: "/cockpit/margin/drift", icon: TrendingUp },
      { label: "Config Lab", href: "/cockpit/config-lab", icon: FlaskConical },
      { label: "Referral P&L", href: "/cockpit/margin/referrals", icon: Sparkles },
      { label: "CAC", href: "/cockpit/margin/cac", icon: Target },
      { label: "Bottlenecks", href: "/cockpit/margin/bottlenecks", icon: AlertTriangle },
      { label: "Alerts", href: "/cockpit/alerts", icon: Bell },
    ],
  },
  {
    items: [
      { label: "Tenants", href: "/cockpit/tenants", icon: Store },
      { label: "Partners", href: "/cockpit/partners", icon: Handshake },
      { label: "Support", href: "/cockpit/support", icon: Headset },
      { label: "Outreach", href: "/cockpit/outreach", icon: Megaphone },
      { label: "Templates", href: "/cockpit/templates", icon: LayoutTemplate },
      { label: "Settings", href: "/cockpit/settings", icon: Settings },
    ],
  },
];

/**
 * Best-effort human label for the mobile desktop-gate — falls back to a
 * section-agnostic sentence when the current route isn't a recognized nav
 * item (e.g. a detail route like `/cockpit/partners/[id]`). Nav hrefs are
 * always rooted at `/cockpit/...`; the `(preview)/preview/cockpit/...`
 * mirror renders this same shell under a `/preview`-prefixed pathname, so
 * strip that prefix before matching rather than comparing raw pathnames.
 */
export function currentSectionLabel(pathname: string): string | null {
  const normalized = pathname.startsWith("/preview/cockpit")
    ? pathname.slice("/preview".length)
    : pathname;
  const allItems = SECTIONS.flatMap((section) => section.items);
  const match = allItems
    .filter((item) => normalized === item.href || normalized.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? null;
}
