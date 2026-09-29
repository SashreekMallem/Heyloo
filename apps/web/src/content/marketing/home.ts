/**
 * Home page copy (SITE-3). One source for the server-rendered markup, the
 * call script the motion runtime scrubs through, and the tests. English only:
 * `routing.locales` is `["en"]` today (src/i18n/routing.ts) and the marketing
 * pages keep their copy in content modules rather than `messages/*.json`.
 * The Spanish disclosure literal below is compiler-owned wording; a test
 * (`home.test.ts`) compares it with `packages/adapters/retell/src/compiler/opening.ts`.
 */

export const HOME_META = {
  title: "Heyloo — AI phone receptionist for small businesses",
  description:
    "Heyloo answers your business line day and night, books real open slots, and puts the transcript, recording and summary of every call in your dashboard. From $299 a month.",
} as const;

export const BUSINESS_NAME = "Riverside Auto Repair";

/** The one example call the whole page tells. `t0`/`t1` are seconds into the call. */
export interface CallLine {
  speaker: "ava" | "caller";
  t0: number;
  t1: number;
  text: string;
}

export const CALL_SECONDS = 58;

export const CALL_LINES: readonly CallLine[] = [
  {
    speaker: "ava",
    t0: 0,
    t1: 10.2,
    text: "Thanks for calling Riverside Auto Repair. This is Ava, their AI assistant — this call may be recorded. How can I help?",
  },
  {
    speaker: "caller",
    t0: 11,
    t1: 15.4,
    text: "Hi, my check engine light just came on. Can someone look at it?",
  },
  {
    speaker: "ava",
    t0: 16,
    t1: 20.4,
    text: "I can get that booked. What’s the year, make and model?",
  },
  { speaker: "caller", t0: 21, t1: 23.2, text: "It’s a 2019 Honda Civic." },
  {
    speaker: "ava",
    t0: 24,
    t1: 28.4,
    text: "Would you like to drop it off, or wait while we take a look?",
  },
  { speaker: "caller", t0: 29, t1: 30.6, text: "I’ll drop it off." },
  {
    speaker: "ava",
    t0: 31,
    t1: 35.4,
    text: "Wednesday at 10:30 a.m. is open. Should I hold it for you?",
  },
  { speaker: "caller", t0: 36, t1: 37.4, text: "Yes, that works." },
  { speaker: "ava", t0: 38, t1: 39.4, text: "And your name?" },
  { speaker: "caller", t0: 40, t1: 41.4, text: "Maria Alvarez." },
  {
    speaker: "ava",
    t0: 42,
    t1: 51.4,
    text: "Let me read that back. A check engine diagnostic for a 2019 Honda Civic, drop-off Wednesday at 10:30 a.m. Is that right?",
  },
  { speaker: "caller", t0: 52, t1: 53.4, text: "That’s right." },
  {
    speaker: "ava",
    t0: 54,
    t1: 57.6,
    text: "You’re booked. I’m texting a confirmation to this number now.",
  },
];

export const CALL_BEATS = [
  { title: "Says it’s an AI", detail: "Every call opens with the AI and recording disclosure." },
  { title: "Asks what the shop needs", detail: "Vehicle, symptom, drop-off or wait." },
  { title: "Finds an open slot", detail: "On the shop’s real calendar." },
  { title: "Reads it back", detail: "Before anything is booked." },
  { title: "Books and texts", detail: "The caller gets a confirmation by text." },
] as const;

export const CALL_TOOLS = [
  { at: 31, label: "Checked the shop calendar" },
  { at: 54, label: "Booked · Wed 10:30 AM" },
  { at: 54, label: "Text sent" },
] as const;

export const HERO = {
  labelLeft: "AI phone receptionist for small businesses",
  labelRight: "Example call · Tue 11:52 PM",
  lineOne: "Every call,",
  lineTwo: "answered.",
  lede: "Heyloo answers your business line day and night. It knows your hours, services and prices, books real open slots, and puts the transcript, recording and summary of every call in your dashboard.",
  price: "From $299 a month. Live the same day.",
  status: `${BUSINESS_NAME} · Answered`,
  cue: "Scroll to answer",
  demoCta: "Hear a live demo",
  signupCta: "Get started",
} as const;

export const HOURS = {
  label: "Nights and weekends",
  title: "Open all the hours you’re closed.",
  lede: "A shop open Monday to Friday, 8 to 6, has nobody at the desk for 118 hours a week. Heyloo answers all 168.",
  readoutTime: "168 of 168 hours",
  readoutStat: "Every hour of the week, answered",
  readoutTag: "Example call, Tue 11:52 PM",
  legendOpen: "Open, 50 hours",
  legendClosed: "Closed, 118 hours",
  note: "Example week for a shop open Monday to Friday, 8 a.m. to 6 p.m.",
  srSummary:
    "Example week. Open Monday to Friday, 8 a.m. to 6 p.m. Closed the other 118 hours. Heyloo answers all 168.",
} as const;

export const CALL = {
  label: "How a call goes",
  title: "One call, start to finish.",
  lede: "A new caller reaches Riverside Auto Repair just before midnight. Scroll to follow the whole call.",
  stripLabel: "Example call",
  stripNumber: "(512) 555-0147",
  stripBusiness: `${BUSINESS_NAME} · Example`,
  skip: "Skip the call",
  smsLabel: "Text to (512) 555-0147",
  smsBody:
    "Riverside Auto Repair: you’re booked for a check engine diagnostic, Wed at 10:30 AM. 2019 Honda Civic, drop-off.",
  smsMeta: "Delivered · 11:53 PM",
} as const;

export const DASHBOARD = {
  label: "The next morning · Wed 7:04 AM",
  title: "The whole call, waiting in your dashboard.",
  words: [
    {
      key: "transcript",
      name: "Transcript.",
      body: "Every word, from both sides of the conversation.",
    },
    { key: "recording", name: "Recording.", body: "Listen back to any call." },
    {
      key: "summary",
      name: "Summary.",
      body: "What the caller wanted and what Heyloo did about it.",
    },
    { key: "booking", name: "Booking.", body: "The appointment or order, confirmed by text." },
  ],
  frameLabel: "Example dashboard",
  rail: [
    { when: "Tue 11:52 PM", who: "M. Alvarez", chips: ["Booked", "New caller"], on: true },
    { when: "Tue 9:14 PM", who: "T. Nguyen", chips: ["Returning caller", "Message"], on: false },
    { when: "Tue 4:02 PM", who: "(512) 555-0183", chips: ["Transferred"], on: false },
    { when: "Tue 1:37 PM", who: "J. Okafor", chips: ["Returning caller", "Booked"], on: false },
  ],
  detailMeta: "(512) 555-0147 · Tue 11:52 PM · 0:58 · English",
  summary:
    "New customer with a 2019 Honda Civic. Check engine light came on tonight. Booked a drop-off diagnostic for Wednesday at 10:30 a.m. and texted a confirmation.",
  booking: [
    ["Service", "Check engine diagnostic"],
    ["When", "Wed 10:30 AM, drop-off"],
    ["Vehicle", "2019 Honda Civic"],
    ["Text", "Confirmation sent"],
  ],
  day: ["9:00 AM", "10:00 AM", "10:30 AM", "11:00 AM", "12:00 PM"],
} as const;

export interface Trade {
  id: string;
  name: string;
  chip?: string;
  asks: readonly string[];
  example: readonly (readonly [speaker: string, text: string])[];
  /** Language of the example lines when it is not English. */
  lang?: string;
}

export const TRADES_COPY = {
  label: "Built for your business",
  title: "It asks what your business needs to know.",
  lede: "Eight kinds of business, each with its own first questions. Heyloo asks them, then books the appointment, takes the order or takes a message.",
  asksLabel: "It asks for",
  exampleLabel: "Example call, after the greeting",
  note: "Each business sets its line to English or Spanish. Businesses, prices and calls shown are examples.",
} as const;

export const TRADES: readonly Trade[] = [
  {
    id: "trade-auto",
    name: "Auto repair",
    asks: ["Year, make and model", "The symptom, in the caller’s words", "Drop-off or wait"],
    example: [
      ["Caller", "My brakes are grinding when I stop."],
      [
        "Assistant",
        "Sorry to hear that. What’s the year, make and model? And would you like to drop it off or wait?",
      ],
    ],
  },
  {
    id: "trade-dental",
    name: "Dental",
    chip: "Knows returning callers",
    asks: ["New or current patient", "Reason for the visit", "A time that works"],
    example: [
      ["Caller", "Hi, it’s Dana. I need a cleaning, whenever’s soonest."],
      ["Assistant", "Welcome back, Dana. Thursday at 8:40 a.m. is open. Should I book it?"],
    ],
  },
  {
    id: "trade-vet",
    name: "Veterinary",
    chip: "Transfers to a person",
    asks: ["Pet’s name and species", "What’s going on", "New or existing client"],
    example: [
      ["Caller", "My dog just ate a whole chocolate bar."],
      [
        "Assistant",
        "I’m connecting you with someone at the clinic right now. Please stay on the line.",
      ],
    ],
  },
  {
    id: "trade-legal",
    name: "Legal",
    asks: ["Type of matter", "A short summary", "A time for a consultation"],
    example: [
      ["Caller", "I was rear-ended last week and I don’t know what to do."],
      [
        "Assistant",
        "I can’t give legal advice, but I can set up a consultation with an attorney. Can you tell me briefly what happened?",
      ],
    ],
  },
  {
    id: "trade-realestate",
    name: "Real estate",
    asks: ["Which property", "Buying, selling or renting", "When they can see it"],
    example: [
      ["Caller", "I’m calling about the house on Alder Street."],
      [
        "Assistant",
        "Happy to help. Are you looking to buy? If so, I can book a showing for Saturday at 11 a.m.",
      ],
    ],
  },
  {
    id: "trade-motels",
    name: "Motels",
    chip: "Knows your prices",
    asks: ["Check-in and check-out dates", "Room type", "Number of guests"],
    example: [
      ["Caller", "Do you have a room for tonight?"],
      ["Assistant", "Yes, a queen room is open tonight for $89 plus tax. How many guests?"],
    ],
  },
  {
    id: "trade-restaurants",
    name: "Restaurants",
    chip: "Takes orders",
    asks: ["Items and changes", "Pickup or delivery", "A name for the order"],
    example: [
      ["Caller", "Two large pepperoni for pickup, please."],
      ["Assistant", "Two large pepperoni for pickup. Anything else, or is that everything?"],
    ],
  },
  {
    id: "trade-local",
    name: "Local services",
    chip: "Line set to Spanish",
    asks: ["What the job is", "Where and when", "The best number for a callback"],
    example: [
      ["Caller", "Hola, ¿limpian alfombras los sábados?"],
      ["Assistant", "Sí, los sábados de 9 a 2. ¿Quiere que le reserve una cita?"],
    ],
    lang: "es",
  },
];

export const SETUP = {
  label: "Setup",
  title: "Live the same day.",
  lede: "Three steps, and your customers keep dialing the number they already know.",
  exampleTag: "Example",
  live: "Answering calls the same day.",
  steps: [
    {
      title: "Sign up.",
      body: "Tell Heyloo your hours, services and prices. It uses them on every call.",
      rows: [
        ["Hours", "Mon to Fri, 8:00 AM to 6:00 PM"],
        ["Services", "Diagnostics, brakes, tires, oil"],
        ["Transfers", "Sam, service desk"],
      ],
    },
    {
      title: "Get a local number.",
      body: "Heyloo gives you a local phone number that is ready to answer.",
      rows: [
        ["Your Heyloo number", "(512) 555-0142", "big"],
        ["Type", "Local, Austin area"],
        ["Status", "Ready to answer"],
      ],
    },
    {
      title: "Forward your line.",
      body: "Turn on call forwarding from your business number to your Heyloo number.",
      rows: [
        ["Your line", "(512) 555-0100"],
        ["Forwards to", "(512) 555-0142"],
        ["Forwarding", "On"],
      ],
    },
  ],
} as const;

/**
 * The two disclosure lines. `en` and `es` are the compiler's own wording for
 * `Thanks for calling {{business_name}}. This is {{assistant_name}}, their AI
 * assistant — this call may be recorded.` with the example business and
 * assistant filled in; `home.test.ts` keeps them in step with
 * `packages/adapters/retell/src/compiler/opening.ts`. The `mark` ranges are the
 * two phrases the page underlines.
 */
export const TRUST = {
  label: "Trust",
  title: "It always says it’s an AI.",
  en: {
    caption: "In English",
    before: "Thanks for calling Riverside Auto Repair. This is Ava, their ",
    marks: ["AI assistant", "may be recorded"],
    between: " — this call ",
    after: ".",
  },
  es: {
    caption: "En español",
    before: "Gracias por llamar a Riverside Auto Repair. Le atiende Ava, su ",
    marks: ["asistente de inteligencia artificial", "puede ser grabada"],
    between: "; esta llamada ",
    after: ".",
  },
  note: "The business name and assistant name are set by each business. Example shown.",
  points: [
    { title: "Said on every call.", body: "Built into every greeting. It cannot be turned off." },
    { title: "English or Spanish.", body: "Each business sets its line to one language." },
    {
      title: "Transfers you choose.",
      body: "When a caller needs a person, Heyloo transfers to the number you set. It never sends callers anywhere else.",
    },
    {
      title: "Your number is yours.",
      body: "It belongs to your business. If you leave, Heyloo ports it to your new provider.",
    },
  ],
} as const;

export const PRICING = {
  label: "Pricing",
  srTitle: "From $299 a month",
  from: "From",
  number: "$299",
  per: "a month",
  lede: "Hear it answer a call first. When you’re ready, it can be answering your line the same day.",
  listLabel: "What Heyloo does",
  list: [
    "Answers every call, 24/7",
    "Books appointments into open slots",
    "Takes orders and messages",
    "Transfers to a person when needed",
    "Recognizes returning callers",
    "Transcript, recording and summary of every call",
    "Text confirmations to callers",
    "English or Spanish, set per line",
  ],
  note: "Texts to callers start once your texting number is carrier approved, usually 1 to 2 weeks. Until then you get the details by email.",
  seePlans: "See plans and pricing",
} as const;

export const START = {
  label: "Start today",
  lineOne: "Tonight’s calls,",
  lineTwo: "answered.",
  lede: "Sign up, get a local number and forward your line. Heyloo can be answering the same day.",
} as const;

export const FOOTER_BLURB =
  "Heyloo is an AI phone receptionist for small businesses. On every call it tells the caller it’s an AI and that the call may be recorded.";
export const FOOTER_FINE = "Businesses, names and calls shown are examples.";
