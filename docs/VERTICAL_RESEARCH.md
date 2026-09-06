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

## Install-base & money model (follow-up research pass)

A second research pass answered "does the anchor actually conquer its market?"
with hard install-base numbers. Assumptions: ~$500/mo effective ARPU
($299 base + usage); target 50 clients / $25k MRR. **Fallback mode** = the
agent serves any business without deep integration (answer, capture, book onto
our calendar, SMS the business) — the anchor caps *deep integration*, not sales.

| Vertical | Anchor US install base (confidence) | MRR @1% capture | $25k from anchor alone? | Deep integration needed to close? | Competition |
|---|---|---|---|---|---|
| Auto repair | Tekmetric **15,000+** shops (med-high), Shopmonkey ~5-6k (med); only ~10-13% of 230k shops on any cloud SMS | $75k (Tek) / $30k (SM) | **Yes — <0.5% needed** | No — SMS'd booking acceptable | Moderate, no dominant incumbent |
| Veterinary | ezyVet ~3-4k US + Vetspire ~800 (low conf); **25k+ of 30-33k clinics on legacy AVImark/Cornerstone** → fallback-mode market | $20-25k | Marginal (~1%) | Moderate — fallback fine for intake | Moderate, no scaled incumbent |
| Real estate | FUB ~8-10k paying team accounts (low conf, extrapolated); fallback mode addresses full ~100k-team market | $40-50k | ~At the line | **Low — fallback nearly as good** | High — crowded at exactly $299 |
| Legal | Clio 400k professionals **global** ($5B valuation) — **no verified US account count** | speculative | Plausible, unverifiable | Low-moderate | Smith.ai incumbent at $293 + attorney trust friction |
| Dental | NexHealth **5,000** practices (~3% of 170k) | $25k exactly | Needs exactly 1% | Mod-high (patients expect real slots) | **Worst — 15-25 vendors**, NexHealth confers no moat (rivals use it too) |
| Home services | Jobber 100k+ accounts — but solo crews already paying Jobber $169-599/mo | $350k+ on paper | Yes on paper | High (dispatch expectations) | **Severe — Avoca, $125M raised, $1B valuation** |
| Restaurants | Square-restaurant count unverifiable (6sense's 1.7k is a severe undercount) | unreliable | Unknown | High | Worst crowding + 3-5% margins |
| Motels | Cloudbeds **2,337 US** (high conf — cross-checked) | $11.7k | **No — 2% capture still <$25k** | Moderate | Moderate, but mom-and-pop budgets |

## Recommended launch order (final, money-weighted)

**Wave 1: Auto repair + Veterinary.**
- **Auto** is the clearest path to $25k MRR in the study: Tekmetric's 15k+
  shops alone need <0.5% capture; Shopmonkey adds ~6k with the most open API
  found anywhere; the ~200k legacy-SMS shops are fallback-mode market; no
  funded incumbent owns independents. Build **Shopmonkey first** (confirmed
  self-serve booking writes), verify Tekmetric's write API in week 1 (its
  public docs confirm reads; writes need confirmation) and add it fast.
- **Vet** rides on fallback mode: 25k+ clinics sit on legacy systems *no*
  competitor can deep-integrate with either — the sale is "we answer and book;
  ezyVet users get slots written into their PIMS." Best per-clinic loss
  economics ($100-182k/yr) and no scaled voice-AI incumbent.

**Wave 2: Real estate (Follow Up Boss, teams-only angle) — fallback-first.**
The FUB write is trivial and barely needed; the whole ~100k-team market is
addressable. Enter only with differentiation (teams/brokerages, speed-to-lead
metrics), because Structurely/Ylopo/Roof.ai already sell at $299.
**Legal (Clio)** is the alternative Wave-2 pick — huge on paper, but US
numbers are unverified and Smith.ai + attorney trust friction are real;
validate with 10 discovery calls before committing the adapter.

**Wave 3 / opportunistic:**
- **Dental via NexHealth** — huge pain and LTV, but NexHealth's 5k practices
  give no moat (competitors plug into it too) and the field has 15-25 vendors;
  requires Retell BAA + validated NexHealth production onboarding. Enter only
  with a wedge.
- **Square Appointments wedge** — cheap add once Square auth exists.
- **Restaurants** — keep the ported Square adapter for the existing live client
  and inbound demand only; do not lead GTM (worst crowding, thinnest margins,
  unverifiable anchor numbers).
- **Home services** — despite Jobber's 100k accounts, deprioritized: Avoca
  ($125M raised, $1B valuation) owns this lane and Jobber's solo-crew users
  are the hardest $299/mo budget conversation.
- **Motels via Cloudbeds** — **dropped from launch**: anchor confirmed too
  small (2,337 US properties; 2% capture still misses $25k MRR). Revisit only
  as fallback-mode territory or if a second PMS partnership lands.

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
