/**
 * Static marketing content per vertical (FRONTEND_SPEC.md §3.2) — not
 * DB-backed, marketing copy is a content/config concern, not tenant data.
 * Stats summarized from `docs/VERTICAL_RESEARCH.md`'s decision matrix.
 * `slug` here is the MARKETING URL slug, distinct from the canonical
 * `Vertical` enum used by the DB/app (`@heyloo/canonical-types`) and from
 * `tenants.vertical`'s DB spelling — see
 * `packages/supabase-client/src/vertical-mapping.ts` for why there are two
 * spellings and `verticalSlugToVertical` below for the mapping used here.
 */
import type { Vertical } from "@heyloo/canonical-types";

export interface VerticalContent {
  slug: string;
  vertical: Vertical;
  displayName: string;
  heroStat: string;
  painStats: string[];
  intakeSummary: string[];
  competitorAnchor: string;
}

export const VERTICAL_CONTENT: VerticalContent[] = [
  {
    slug: "auto-repair",
    vertical: "auto",
    displayName: "Auto Repair Shops",
    heroStat:
      "On a busy bay day a shop can miss more than a third of its calls, and each one is a repair order for the next shop.",
    painStats: [
      "Roughly a third of calls can go unanswered during a busy bay day",
      "Hundreds of thousands of independent shops compete for the same callers",
      "A missed call is rarely a callback — it's a booking at the next shop",
    ],
    intakeSummary: [
      "Vehicle year/make/model and the symptom",
      "Drop-off vs. wait-in-lobby preference",
      "Appointment time against real bay availability",
    ],
    competitorAnchor:
      "Most answering services quote a per-call rate that punishes your busiest days.",
  },
  {
    slug: "veterinary",
    vertical: "vet",
    displayName: "Veterinary Clinics",
    heroStat: "Missed new-patient calls can cost a clinic six figures a year.",
    painStats: [
      "Roughly a quarter of calls can go unanswered at a busy clinic",
      "A new patient is worth thousands of dollars over their lifetime",
      "Tens of thousands of practices compete for the same pet owners",
    ],
    intakeSummary: [
      "Species and reason for visit",
      "New vs. existing patient",
      "Emergency triage with a same-call referral if you're closed",
    ],
    competitorAnchor:
      "Human answering services can't tell an emergency from a routine question at 2am.",
  },
  {
    slug: "legal-intake",
    vertical: "legal",
    displayName: "Legal Intake",
    heroStat:
      "A missed intake call can cost a firm thousands of dollars in fees, and personal-injury cases run far higher.",
    painStats: [
      "Small and mid-size firms can miss a large share of inbound calls",
      "Hundreds of thousands of US law firms compete for the same callers",
      "Case values make every missed intake call unusually expensive",
    ],
    intakeSummary: [
      "Matter type and a plain-language case summary",
      "Conflict-check-safe intake questions",
      "Consultation scheduling with disclosure of what the AI can and can't advise on",
    ],
    competitorAnchor:
      "Human-hybrid intake services bill per minute and still miss calls after hours.",
  },
  {
    slug: "dental",
    vertical: "dental",
    displayName: "Dental Practices",
    heroStat:
      "Unanswered calls can cost a dental practice tens of thousands of dollars a year, and a patient is worth thousands over their lifetime.",
    painStats: [
      "Roughly a third of calls can go unanswered on a busy day",
      "More than 100,000 practices compete for the same patients",
      "A crowded field of point solutions that don't touch your actual schedule",
    ],
    intakeSummary: [
      "New vs. existing patient and insurance accepted",
      "Appointment type and preferred time window",
      "Emergency triage with same-day slot offers",
    ],
    competitorAnchor:
      "Most dental answering tools stop at scheduling — yours also handles insurance FAQs.",
  },
  {
    slug: "real-estate",
    vertical: "real_estate",
    displayName: "Real Estate Teams",
    heroStat:
      "Most inquiries wait hours for a reply, and many never get one, by which time the buyer has called someone else.",
    painStats: [
      "Response to a new lead is often measured in hours, not minutes",
      "A large share of inquiries never get a reply at all",
      "A lead that goes cold is a commission that goes to a competitor",
    ],
    intakeSummary: [
      "Property of interest and buyer/seller/renter intent",
      "Timeline and financing status",
      "Showing requests routed to the right agent",
    ],
    competitorAnchor: "Lead-routing tools don't answer the phone — this does, in under two rings.",
  },
  {
    slug: "motels",
    vertical: "motel",
    displayName: "Motels & Small Hotels",
    heroStat:
      "A missed 11pm call is a booking lost to the motel down the road — every single time.",
    painStats: [
      "Single-person night shifts mean the front desk simply can't answer",
      "No after-hours coverage at the properties that need it most",
      "Same-night bookings are the most price-sensitive and the most abandoned",
    ],
    intakeSummary: [
      "Check-in/check-out dates and room type",
      "Rate quote and deposit policy, stated up front",
      "Reservation held pending a payment link for the deposit",
    ],
    competitorAnchor:
      "Generic hotel chatbots don't take a real reservation against your actual rooms.",
  },
  {
    slug: "restaurants",
    vertical: "restaurant",
    displayName: "Restaurants",
    heroStat:
      "Every missed call during peak service is a lost order or reservation — on margins as thin as 3–5%.",
    painStats: [
      "Phones go unanswered during the exact rush that needs them answered",
      "Thin margins mean a handful of missed orders a week is real money",
      "Most phone-order tools don't check your delivery radius or minimums",
    ],
    intakeSummary: [
      "Order items, modifiers, and quantities against your real menu",
      "Pickup vs. delivery with a radius check and address read-back",
      "Reservation requests with party size and time",
    ],
    competitorAnchor:
      "Delivery-app phone lines don't know your menu — this reads it straight from your settings.",
  },
  {
    slug: "generic",
    vertical: "generic",
    displayName: "Any Service Business",
    heroStat:
      "Businesses that don't answer the phone lose the customer who called next door instead.",
    painStats: [
      "Missed calls are missed revenue, in every service business",
      "After-hours and lunch-rush coverage gaps are the most common leak",
      "A human answering service costs more and still can't book directly into your calendar",
    ],
    intakeSummary: [
      "Caller's need in plain language",
      "Appointment or callback scheduling against your real availability",
      "A message taken and delivered the moment the call ends",
    ],
    competitorAnchor: "Most answering services charge per call and still just take a message.",
  },
];

export function getVerticalContent(slug: string): VerticalContent | undefined {
  return VERTICAL_CONTENT.find((v) => v.slug === slug);
}

export function verticalSlugFromVertical(vertical: Vertical): string {
  return VERTICAL_CONTENT.find((v) => v.vertical === vertical)?.slug ?? "generic";
}

/**
 * Shown under every vertical page's pain points. The figures above are
 * deliberately qualitative: exact numbers in earlier copy came from research
 * notes compiled partly from search snippets and had no citation (QA F-17), so
 * they are not printed until each one has a source (docs/VERTICAL_RESEARCH.md).
 */
export const STATS_DISCLAIMER =
  "General industry estimates for illustration, not measurements of your business or a guarantee of results.";
