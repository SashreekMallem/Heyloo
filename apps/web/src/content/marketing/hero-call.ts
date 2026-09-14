/**
 * The hero set piece's storyboarded call — single source of truth shared
 * by every tier that tells this same story: the non-qualifying/reduced-
 * motion/mobile fallback (`components/marketing/live-call-hero.tsx`) and
 * the qualifying-tier DOM overlay composited over the WebGL morph
 * (`components/motion/hero-story-overlay.tsx`). Both tiers must show the
 * identical business/transcript/booking content — WEBSITE_CREATIVE_BRIEF.md
 * §3's "current copy/CTAs unchanged" — so this is authored once, not
 * duplicated per component (docs/audit/SITE_REQUESTS.md's swap-in
 * contract: "the transcript... unchanged").
 *
 * Not real call data — a hand-authored storyboard, same as the two
 * components that render it.
 */

export interface HeroCallTurn {
  speaker: "caller" | "ai";
  text: string;
}

export const HERO_CALL_BUSINESS_NAME = "Riverside Auto Repair";

/**
 * `TURNS[1]` is the compiled-in AI + recording disclosure
 * (CLAUDE.md Rule 2: "Every agent greeting includes the compiled-in AI +
 * recording disclosure") — verbatim, never paraphrased between tiers.
 */
export const HERO_CALL_TURNS: HeroCallTurn[] = [
  { speaker: "caller", text: "Hi — my check engine light just came on, can someone look at it?" },
  {
    speaker: "ai",
    text: "This is Riverside Auto's AI receptionist — this call is recorded. I can get that booked. What's the year, make, and model?",
  },
  { speaker: "caller", text: "2019 Honda Civic." },
  { speaker: "ai", text: "Got it — one moment while I check tomorrow's bay availability." },
  { speaker: "ai", text: "We have 10:30 tomorrow morning open. Want me to hold that for you?" },
  { speaker: "caller", text: "Yes, please — that works." },
];

export const HERO_CALL_TOOL_CALL = "check_availability()";

export const HERO_CALL_BOOKING = {
  vehicle: "2019 Honda Civic",
  service: "Check engine diagnostic",
  time: "Tomorrow · 10:30 AM",
} as const;
