/**
 * Copy for the live demo ("Talk to Heyloo now") on the home page and `/demo`.
 * Its own module because the client island imports it and must not pull the
 * rest of the home copy into its chunk. `disclosure` is printed above the start
 * button, so the AI + recording notice is read before the browser's microphone
 * prompt.
 */
export const TALK = {
  label: "Live demo",
  title: "Talk to Heyloo now.",
  lede: "Pick a kind of business, press the button and say hello. You reach Heyloo’s demo receptionist for that business, live, in your browser. No signup.",
  pick: "Pick a business",
  start: "Talk to Heyloo",
  end: "End call",
  again: "Talk again",
  disclosure:
    "You’re talking to an AI assistant, and it says so when it picks up. This demo call is recorded. Your browser will ask to use your microphone.",
  limit: "Calls end on their own after 30 seconds.",
  ownAgent: "Build a demo for your own business",
  phoneLead: "Prefer the phone? Call",
} as const;
