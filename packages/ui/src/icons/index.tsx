import type { Vertical } from "@heyloo/canonical-types";
import {
  AlertTriangle,
  BedDouble,
  Bell,
  Building2,
  Calendar,
  CalendarClock,
  Car,
  CheckCircle2,
  ChefHat,
  CircleDollarSign,
  Gauge,
  Globe,
  Headset,
  Home,
  Inbox,
  type LucideIcon,
  MessageSquare,
  Mic,
  Package,
  Phone,
  PhoneCall,
  PhoneForwarded,
  Plug,
  Scale,
  Settings,
  Smile,
  Sparkles,
  Stethoscope,
  Store,
  Truck,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";

/**
 * Icon policy (DESIGN BRIEF: "no emoji as icons — lucide-react icons
 * only"): every place the product needs an icon for a business type, a nav
 * item, or a status pulls from these curated maps rather than reaching for
 * an emoji or an ad-hoc lucide import — one vocabulary, reviewed once.
 */

export const VERTICAL_ICONS: Record<Vertical, LucideIcon> = {
  auto: Car,
  vet: Stethoscope,
  legal: Scale,
  // Literal dental glyph, not an abstract "AI sparkle" cliché
  // (WEBSITE_CREATIVE_BRIEF.md §7 anti-slop checklist forbids ✨-style
  // glyphs) — lucide-react has no dedicated tooth icon, so `Smile`
  // stands in as a literal, non-AI-coded object, matching the other
  // seven verticals' literal-object convention (Car, Stethoscope,
  // Scale, Home, BedDouble, ChefHat, Building2). SITE REPAIR finding
  // (blocker): the old `Sparkles` glyph appeared in the nav dropdown,
  // the home business-types grid, and the /dental hero badge.
  dental: Smile,
  real_estate: Home,
  motel: BedDouble,
  restaurant: ChefHat,
  generic: Building2,
};

export interface VerticalIconProps {
  vertical: Vertical;
  className?: string;
}

/** The one place a business-type glyph is chosen — replaces every emoji icon (auto/vet/etc. business-type glyphs) across signup, marketing, and the templates cockpit. */
export function VerticalIcon({ vertical, className }: VerticalIconProps) {
  const Icon = VERTICAL_ICONS[vertical] ?? Building2;
  return <Icon className={className} aria-hidden="true" />;
}

export const NAV_ICONS = {
  overview: Gauge,
  calls: PhoneCall,
  bookings: Calendar,
  customers: Users,
  messages: MessageSquare,
  orders: Package,
  delivery: Truck,
  billing: Wallet,
  team: Users,
  agent: Mic,
  phoneSetup: Phone,
  websiteWidget: Globe,
  integrations: Plug,
  support: Headset,
  settings: Settings,
  refer: Sparkles,
  inbox: Inbox,
  notifications: Bell,
  margin: CircleDollarSign,
  tenants: Store,
  scheduled: CalendarClock,
  forwarding: PhoneForwarded,
} as const satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;

export const STATUS_ICONS = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Bell,
} as const satisfies Record<string, LucideIcon>;

export type StatusIconName = keyof typeof STATUS_ICONS;
