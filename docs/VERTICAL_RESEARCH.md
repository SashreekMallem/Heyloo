# Vertical Selection Research — September 2026

Four parallel deep-research passes: restaurants (POS + reservations + middleware),
dental (PMS + aggregators + HIPAA), motels + real estate, and an adjacent-verticals
scan (home services, salons, auto repair, veterinary, legal, med spa). Selection
criteria: **(A) integration feasibility** — a representative platform with a
public, documented, self-serve API that can CREATE bookings and READ availability,
no partner gate; **(B) customer reachability** — many US SMBs, list-buildable,
acute missed-call pain, $299/mo budget, low voice-AI saturation.

## The decision matrix

| Rank | Vertical | Anchor platform | API access reality | A | B | Missed-call economics | Competition |
|---|---|---|---|---|---|---|---|
| 1 | **Auto repair** (independent shops) | **Shopmonkey** | Most open API found in the entire scan: available on every plan, admin self-generates token in <1 min, no partner program, no review | 9 | 8 | ~38% of calls missed ≈ **$135k/yr lost/shop**; 220–250k US shops | Moderate — incumbents (Numa/Kenect) chase dealerships, independents underserved |
| 2 | **Legal intake** (PI/general) | **Clio** | Grade-A API: self-serve dev portal, OAuth2, sandbox, free dev account; marketplace listing optional | 9 | 9 | Highest $/call anywhere: **$3.2–6.5k per missed intake call**, PI cases to $50k; 28–50% unanswered; ~418k US firms | Smith.ai ($293/mo) is human-hybrid, not pure AI — real gap |
| 3 | **Veterinary** | **ezyVet** (or Vetspire GraphQL) | Public docs (216 endpoints, OAuth2, sandbox), standard registration form — light gate, not partner-gated | 7 | 8 | Best per-clinic: **$100–182k/yr lost**, $8.2k LTV per missed new-patient call, 24–28% unanswered; 30k+ practices | Growing (VetRec, PupPilot, AgentZap) but fragmented |
| 4 | **Motels / small hotels** | **Cloudbeds** | Property owner self-generates an API key in their own dashboard — zero approval; `postReservation` + `getRatePlans`/`getRoomTypes` documented | 8 | 6 | Structural: single-person night shifts; missed 11pm call = booking lost to next motel | Lowest saturation at sub-50-room tier; competitors are enterprise-hotel or generalist |
| 5 | **Salon/any-Square-business wedge** | **Square Appointments (Bookings API)** | Most polished GA booking API found; `POST /v2/bookings`, full CRUD, sandbox, no gate | 8 | 6 | ~24–37% missed; ~$67k/yr/salon | Vagaro/Fresha/Booksy closed; Zenoti bundling its own AI |
| 6 | **Dental** | **NexHealth** (aggregator) | Only viable path: instant self-serve sandbox, `GET /appointment_slots` + `POST /appointments`, free tier then ~$0.10/call; real-practice onboarding 2–6 wks (verify). All direct PMSs partner-gated or on-prem | 6 | 7 | 30–38% missed, $75–180k/yr, patient LTV $5–8k; 178k practices | Crowded: 15–25 vendors (Arini ~$249, Annie $89, TrueLark/Weave) |
| 7 | **Restaurants** | **Square (Orders API)**; pilot **ItsaCheckmate** for Toast/Clover reach | Square = only self-serve POS (instant sandbox, `POST /v2/orders`, no gate) but ~13% share. Clover = weeks of review; Toast = months of partner cert; SpotOn/Lightspeed/TouchBistro gated. Reservations (OpenTable/Resy/SevenRooms/Yelp) closed everywhere | 6 | 7 | $20B/yr industry-wide; ~$28.7k/yr/location; saved phone order avg $48, no marketplace commission | **Most saturated vertical in the scan** (Loman at $299 exactly, Slang, ConverseNow, Popmenu…) |
| 8 | **Real estate** | **Follow Up Boss** | Fully self-serve, best CRM docs (+llms.txt); create people/events/appointments + webhooks. ShowingTime writes: closed — book onto CRM calendar instead. LionDesk is dead (2025) | 9 | 5 | Sharp pain: 917-min median response, 48% inquiries unanswered, $7.5k/missed lead | **Crowded at exactly $299** (Structurely, Ylopo rAIya, Roof.ai, CINC) |
| 9 | Home services | Jobber (GraphQL, self-serve) | ServiceTitan enterprise-gated; Housecall Pro API behind $279/mo tier | 7 | 5 | Extreme ($300–5k emergency jobs) | Brutal: Avoca $125M+ raised, ~$1B valuation |
| 10 | Med spa | — | Mindbody partner-gated; Zenoti customer-gated **and** shipping its own AI receptionist | 4 | 4 | Good economics, blocked access | Platform-native AI = worst position |

## Recommended launch order

**Wave 1 (launch verticals): Auto repair (Shopmonkey) + Legal intake (Clio).**
Both have the two things that matter most for a solo builder: truly self-serve
booking-write APIs (prototype in days, no waiting on a partner queue) and
underserved buyers with brutal missed-call economics. Legal has the single best
ROI pitch in the study; auto has the single most open API and no runaway
incumbent.

**Wave 2: Veterinary (ezyVet) + Motels (Cloudbeds).** Vet has the best
per-clinic loss numbers and a light registration gate. Motels are the
lowest-competition wedge from the original brief — but the addressable base at
launch is Cloudbeds' ~2,300 US properties, so it's a beachhead, not a TAM.

**Wave 3 / opportunistic:**
- **Dental via NexHealth** — still attractive (huge pain, huge LTV) but enter
  knowing it's a knife-fight with 15+ funded vendors; requires Retell BAA +
  BAA chain, and NexHealth production onboarding must be validated first.
- **Square Appointments wedge** — one adapter that serves any Square-running
  service business (salons, barbers, detailers); cheap to add since we already
  build Square auth for restaurants.
- **Restaurants** — keep the (ported) Square adapter to serve the existing live
  client and any inbound demand, but **do not lead GTM here**: most saturated
  vertical found, and only ~13% of the market is reachable without partner gates.
- **Real estate via Follow Up Boss** — easiest build in the study; enter later
  only with a differentiated angle (teams/brokerages, not solo agents).

## What changed vs the original brief

| Brief said | Research says |
|---|---|
| Restaurants, dental, motels, real estate | Auto repair, legal, veterinary, motels — restaurants/dental/real-estate demoted for saturation + gated APIs |
| Toast/Square for restaurants | Toast is a months-long partner cert — **not viable early**. Square only; ItsaCheckmate ($0.12/order, cap $15/mo/location) piloted as the Toast/Clover backdoor |
| Dental PMS direct | All direct PMSs gated or on-prem; **NexHealth aggregator is the only realistic path** |
| Motel PMS | Confirmed: **Cloudbeds**, uniquely self-serve (owner generates key) — Mews needs Enterprise-tier properties, SiteMinder/others partner-gated |
| Real-estate CRM | Confirmed FUB is wide open — but the vertical is the most price-point-crowded of the four |
| Apollo for all outreach | Apollo is weak for restaurants (owners not on LinkedIn) and mediocre for motels; strong for legal (bar directories), real estate, and decent for auto/vet. Blend with Yelp/Maps/license-roll data per vertical |

## Architecture implications (feeds MASTER_PLAN)

1. All Wave-1/2 anchors are **appointment/reservation-shaped**, validating the
   generic `bookings` + `availability` + `resources` core. Restaurants (orders)
   become the specialization, not the template.
2. Adapter interface must support two integration shapes: **direct booking write**
   (Shopmonkey, Clio calendar, ezyVet, Cloudbeds, Square) and **lead-capture +
   calendar event** (FUB; legal intake before conflict checks). Both map onto
   `pushBooking` + `createContact`.
3. Per-vertical agent templates differ mainly in intake scripts (auto: vehicle/
   symptom; legal: matter type/conflict screen; vet: patient/species; motel:
   dates/room type) — confirming template-per-vertical in DB is the right design.
4. HIPAA posture needed only when dental/medical launches (Retell BAA is free
   when we do). Legal needs confidentiality positioning but not HIPAA.
5. Onboarding flow must handle "customer self-generates an API key in their own
   dashboard and pastes it" (Cloudbeds, Shopmonkey pattern) in addition to OAuth
   (Square, Clio, Jobber) — two connection modes in the connect-integration step.
