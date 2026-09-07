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
} as const;
