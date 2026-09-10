/**
 * Short scripted call scenarios per vertical, for the test-your-agent page
 * (Cluster H task brief item 2). Presentational copy only — authored here
 * rather than imported from `packages/templates` (not this cluster's
 * ownership, and that package's fragments are compiler input, not
 * caller-facing scripts).
 */
export interface TestScenario {
  title: string;
  script: string;
}

const SCENARIOS: Record<string, TestScenario[]> = {
  auto: [
    {
      title: "Book an oil change",
      script:
        '"Hi, I need an oil change for my 2019 Honda Civic — do you have anything this week?"',
    },
    {
      title: "Ask about a tow",
      script: '"My car broke down on the highway, can you send a tow truck?"',
    },
  ],
  vet: [
    {
      title: "Book a routine checkup",
      script: "\"I'd like to bring my dog in for a checkup — she's a 3-year-old lab.\"",
    },
    {
      title: "Report an emergency",
      script: '"My cat just ate something toxic, I need help right now."',
    },
  ],
  legal: [
    {
      title: "New client intake",
      script: '"I was in a car accident last week and want to talk to a lawyer."',
    },
    { title: "Leave a message", script: '"Can someone call me back about a contract dispute?"' },
  ],
  dental: [
    {
      title: "Book a cleaning",
      script: "\"I'd like to schedule a cleaning, I'm an existing patient.\"",
    },
    { title: "Report tooth pain", script: '"I have a really bad toothache, can I come in today?"' },
  ],
  real_estate: [
    {
      title: "Ask about a listing",
      script: '"I saw a listing on Maple Street, is it still available?"',
    },
    {
      title: "Schedule a showing",
      script: '"Can I schedule a showing for this Saturday afternoon?"',
    },
  ],
  motel: [
    {
      title: "Book a room",
      script: '"Do you have a room available for two nights starting Friday?"',
    },
    { title: "Ask about policies", script: '"What\'s your cancellation policy?"' },
  ],
  restaurant: [
    { title: "Place a to-go order", script: '"I\'d like to order two large pizzas for pickup."' },
    { title: "Book a table", script: '"Can I get a reservation for 4 people tonight at 7?"' },
  ],
  generic: [
    { title: "Ask a question", script: '"What are your hours today?"' },
    { title: "Leave a message", script: '"Can you have someone call me back?"' },
  ],
};

export function scenariosFor(vertical: string): TestScenario[] {
  return SCENARIOS[vertical] ?? SCENARIOS["generic"] ?? [];
}
