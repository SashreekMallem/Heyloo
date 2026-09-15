/** Home page static content (FRONTEND_SPEC.md §3.1) — RSC, no dynamic data. */
export const HOME_CONTENT = {
  heroStats: [
    "Auto shops miss ~38% of calls — ~$135k/yr",
    "Vet clinics lose $100k–$182k/yr to unanswered calls",
    "A missed legal intake call can cost $3.2k–$6.5k",
    "Real estate leads go cold after a 917-minute average response time",
  ],
  howItWorks: [
    {
      title: "Forward your number",
      description:
        "Two minutes, works with any carrier — your existing number keeps ringing your business.",
    },
    {
      title: "Your AI answers",
      description:
        "Every call gets answered, every time, with a disclosed AI greeting and your business's real hours and services.",
    },
    {
      title: "Bookings land in your dashboard",
      description:
        "Confirmed appointments, orders, and messages — synced to your calendar, delivered by SMS and email.",
    },
  ],
  /**
   * The single booking shown twice further down the page — once as the
   * `DashboardPreview` "Latest booking" panel, once as the lock-screen
   * notification in `OwnerPhoneReveal` (WEBSITE_CREATIVE_BRIEF.md §1 beat
   * 6, "Reach the owner": "the SAME booking the hero and dashboard show").
   * One source of truth so the two panels can never drift apart — `day`/
   * `time` are kept separate rather than one pre-joined string because the
   * two panels format them differently (`DashboardPreview`'s `DataList`:
   * "Tomorrow, 10:30 AM"; the notification body: "Tomorrow 10:30 AM").
   * Mirrors (but does not import — `content/marketing/hero-call.ts` is
   * HERO-FILM's file) the hero transcript's own booking facts
   * (`HERO_CALL_BOOKING`: same vehicle/service/time) plus the customer
   * name the hero transcript never states aloud.
   */
  booking: {
    customer: "M. Alvarez",
    vehicle: "2019 Honda Civic",
    service: "Check engine diagnostic",
    day: "Tomorrow",
    time: "10:30 AM",
  },
  /**
   * `DashboardPreview`'s four `MetricCard` end values — named constants
   * (not inline magic numbers in the component) so they read from one
   * place and stay fixed across renders (round-4 review: "make every
   * number/row a fixed constant from the content module — no
   * Math.random, no Date.now-derived values").
   */
  dashboardMetrics: {
    callsToday: 14,
    bookingsToday: 5,
    minutesUsed: 182,
    answerRatePercent: 100,
  },
} as const;
