/**
 * Copy for the home page's live demo ("Talk to Heyloo now"). Its own module
 * because the client island imports it and must not pull the rest of the home
 * copy into its chunk. `disclosure` is printed above the start button, so the
 * AI + recording notice is read before the browser's microphone prompt.
 */
export const TALK = {
  label: "Live demo",
  title: "Talk to Heyloo now.",
  lede: "Press the button and say hello. You reach Heyloo’s demo receptionist for a sample auto shop, live, in your browser. No signup.",
  start: "Talk to Heyloo",
  end: "End call",
  again: "Talk again",
  disclosure:
    "You’re talking to an AI assistant, and it says so when it picks up. This demo call is recorded. Your browser will ask to use your microphone.",
  limit: "Calls end on their own after 2 minutes.",
  ownAgent: "Build a demo for your own business",
  phoneLead: "Prefer the phone? Call",
} as const;
