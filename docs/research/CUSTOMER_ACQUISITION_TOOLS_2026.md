# Customer Acquisition Tools — 2026 Landscape Scan

Research only — no code changes. Compiled 2026-09-11. Every price/claim below
is sourced with an access-date-equivalent citation; anything not confirmed
against an official vendor page, official docs, or a GitHub repo itself is
labeled **UNVERIFIED** (compiled from aggregator/blog search snippets, which
skew stale/SEO-optimized — re-verify against the vendor's own pricing page
before committing spend, per repo `CLAUDE.md` Rule 1's spirit).

**What we already have** (per `docs/spec/API_AND_FLOWS.md` Flow 5 —
"Outreach: lead fetch → personalize → send → reply → demo → customer" — and
`supabase/functions/api-outreach-fetch-leads`, `job-outreach-personalize`,
`webhooks-outreach`): Apollo People/Org Search + Enrichment for Apollo-strong
verticals, Outscraper/Apify Maps for Apollo-weak ones (restaurants/motels),
Claude Message Batches for personalization, Smartlead as the send provider
(Instantly coded as an alternative, provider TBD), Claude-based reply-intent
classification, and a demo-agent generator that seeds a live Retell agent
from the lead's own website. This already covers most of what commercial
"AI SDR" products sell as a bundle — the gaps are called out explicitly in
§4.

---

## 1. Open-source repos

### 1.1 Local-business finding / enrichment

| Repo | Stars / License / Activity | What it does | Setup effort (solo founder) | Running cost | Plug-in to our pipeline |
|---|---|---|---|---|---|
| [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper) | 5.8k★, MIT, active (329 commits) | Go CLI/web-UI/REST API/self-hosted SaaS; scrapes Google Maps at scale via headless Chromium; distributed mode via Postgres+Kubernetes | Low for basic use (single Docker `run` command); moderate for distributed/self-hosted-SaaS mode | Free (no API fee); optional paid proxies for volume (partner discounts listed in repo) | Yes — could sit behind a new `packages/adapters` fetch adapter as an Outscraper alternative/supplement for verticals Apollo is weak on. Self-hosting means proxy/IP-ban management becomes our problem instead of Outscraper's |
| [omkarcloud/google-maps-scraper](https://github.com/omkarcloud/google-maps-scraper) | 3.5k★, MIT, active | Desktop app (Mac/Win/Linux) + Python lib; 50+ data points incl. phone, website, social, and (enrichment step) email | Very low — download desktop app, type a query, click Run; free tier is 200 searches/mo (~20k+ results) | Free tier generous; paid $16/mo (5k searches) or $48/mo unlimited | Yes, same role as above; the desktop-app path is notably more solo-founder-friendly than gosom's CLI |
| [dancolta/trustpilot-outreach-automation](https://github.com/dancolta/trustpilot-outreach-automation) | 9★, ISC, unclear last-commit date | Self-hosted Node.js: scrapes 1–2★ Trustpilot reviews, has Gemini draft 3 personalized cold-email variants per lead as **Gmail drafts** (human sends every one — no autosend) | Moderate (~1hr): 3 OAuth connections (Gemini, Sheets, Gmail) + Node.js | Free/self-hosted; Gemini API calls are the only marginal cost | **Not directly** — it's Trustpilot-only (no Google Reviews support), and per its own docs "deliberately does not try to become a CRM." It's a useful *pattern reference* for our own "review-mining" build (see §4) but would need its scraper swapped out entirely for Google/Yelp reviews to be useful for auto shops/vet clinics, which live on Google not Trustpilot |
| [JosieBot26/prospector-mcp-email-finder](https://github.com/JosieBot26/prospector-mcp-email-finder) | small/new repo (exact star count not surfaced) | Free Hunter.io-alternative MCP server: scrapes a site + generates pattern-based email candidates + does its own DNS/MX + SMTP-handshake verification (no paid API) | Low if already running an MCP-capable agent; otherwise a new service to host | Free (your own IP/SMTP reputation absorbs verification traffic) | Possible supplement to Apollo enrichment for the smaller Google-Maps-only leads where Apollo has no contact record — UNVERIFIED reliability/deliverability of SMTP-handshake verification at scale (many mail servers now block/greylist probing SMTP handshakes, which can produce false negatives) |
| **Review-mining for phone/voicemail complaints** — no ready-made open-source tool found | — | Not found as a packaged repo; closest analog is the Trustpilot repo above (pattern only) | — | — | **Genuine build gap** — see §4. Would be a small custom script: pull Google reviews via an existing Maps/Places scraper (already in the pipeline via Outscraper, which returns review text), keyword/LLM-filter for phone/voicemail/"never called back"/"couldn't reach" language, rank leads by complaint density. This is cheap to build in-house since Outscraper already returns review text per the Flow 5 fetch step — no new vendor needed, just a filter added to `handleFetchLeads` or a follow-on job |

### 1.2 AI SDR / outbound agent frameworks (open-source)

| Repo | Stars / License | What it does | Setup effort | Cost | Fit for us |
|---|---|---|---|---|---|
| [crewAIInc/crewai](https://github.com/crewaiinc/crewai) | large, MIT-style (verify exact license on repo) | General multi-agent orchestration framework (not sales-specific out of the box); used as a substrate for many "AI SDR" tutorials/templates | Moderate-high — you build the sales workflow yourself | Free framework + your own LLM API cost | Overkill: we already have a working pipeline (Apollo→Claude→Smartlead→Claude-reply-classify); CrewAI would mean re-platforming logic we've already shipped for no clear gain |
| [MatthewDailey/open-sdr](https://github.com/MatthewDailey/open-sdr) | 25★, MPL-2.0 | CLI agent (MCP server) that researches companies/LinkedIn connections and drafts outreach with Claude | Moderate (Node/npm, LinkedIn login, `.env` with Firecrawl + Google Generative AI + Anthropic keys) | Paid Firecrawl + Gemini + Anthropic API usage — non-trivial for a hobby-scale repo (25★, likely under-maintained) | Weak fit — LinkedIn-account-in-the-loop scraping risks the account, and it duplicates functionality (research+draft) our pipeline already has via Apollo+Claude. Not recommended over building 20 more lines onto our own handler |
| Salesably/awesome-ai-agents-for-sales, ARUNAGIRINATHAN-K/awesome-ai-agents-2026 | curated lists, not tools | Directory/"awesome list" repos pointing at both open-source and commercial AI SDR projects | N/A | N/A | Useful as a discovery starting point only, not directly runnable |
| n8n templates (workflow JSON, not standalone repos) | N/A | n8n's public template library has ready-made "scrape Google Maps → enrich → email" and "review-monitoring → alert" flows; useful as **blueprints** even though we don't run n8n | N/A | N/A | We don't run n8n (per task framing) but the node graphs are a free source of "which APIs people actually chain together" — worth a 30-min skim before building the review-mining filter in §4, not worth standing up n8n itself just for this |

**Overall read on open-source "AI SDR" repos**: none is a drop-in replacement for
what's already built. The two Google Maps scrapers (§1.1) are the only
genuinely useful *adds* — as a cheaper/parallel data source alongside
Outscraper, not a replacement (Outscraper's hosted API + review text + phone
lookup already saves us the proxy/anti-bot maintenance burden these
self-hosted scrapers reintroduce).

### 1.3 Missed-call / voicemail-detection tooling — legality note

No open-source "is-it-voicemail" qualification tool specific to B2B lead
scoring was found; what exists is generic **Answering Machine Detection
(AMD)**, a standard feature of Twilio Voice and most dialers (SalesHive lists
several AMD-capable platforms).

- **Legality**: TCPA consent restrictions on autodialed/prerecorded calls
  apply to residential and consumer wireless lines; calling a business's
  main line (not a cell phone) for a B2B purpose is generally treated as
  outside core TCPA consent requirements — but AMD **false positives** can
  push a campaign over the FTC Telemarketing Sales Rule's 3%
  abandoned-call cap (a call answered by a human but misclassified as a
  machine and dropped counts as "abandoned"), and that exposure is real
  ($500–$1,500 per violating call) regardless of B2B status. [Callin.io: Twilio AMD 2025](https://callin.io/twilio-answering-machine-detection/), [Twilio AMD docs](https://www.twilio.com/docs/voice/answering-machine-detection), [Twilio AMD FAQ/best practices](https://www.twilio.com/docs/voice/answering-machine-detection-faq-best-practices), [Auto Interview AI — is AI cold calling legal 2026](https://www.autointerviewai.com/blog/is-ai-cold-calling-legal-tcpa-fcc-trai-compliance-2026), [SalesHive AMD platforms 2026](https://saleshive.com/blog/answering-machine-detection-platforms-help)
- **Appropriateness for us specifically**: the plan already treats AI-voice
  cold calling as off the table. Using AMD to silently qualify leads (call,
  detect voicemail, hang up, no message) is a **different, smaller**
  question — no AI voice content is played to anyone — but it still shows
  up on the called business's caller-ID/call log as an unexplained hang-up,
  which (a) risks the calling number getting carrier-flagged as spam if run
  at any volume — industry guidance caps this around ~75 calls/day per
  number before spam-filter risk rises, and recommends registered/rotated
  numbers ([ReadyMode](https://readymode.com/avoid-being-flagged-as-spam-in-outbound-calls/), [SquareTalk 2026](https://squaretalk.com/business-number-shows-as-spam-fix/)), and (b) burns the
  founder's own reputation/number before a single pitch is made. **UNVERIFIED
  recommendation**: don't automate this — the actual "missed-call test" pitch
  (calling a shop personally at lunch, getting voicemail, then leading the
  demo call with "I just tried to reach you — that's the pitch") is both
  cheaper and a stronger opener than any bulk-AMD pre-qualification, and a
  human founder doing 20–30 calls/day doesn't approach the volume where
  carrier spam-flagging becomes a real risk.

---

## 2. Commercial tools — 2026 pricing snapshot

All prices below are the vendor's current *list* self-serve price where one
exists; where a vendor is sales-quote-only, the table says so and cites the
best third-party estimate available (marked UNVERIFIED).

### 2.1 AI SDR / full-agent products

| Product | Price (2026) | Minimum commitment | What it adds beyond our pipeline | Compliance/deliverability stance | Reviews (label as shown) |
|---|---|---|---|---|---|
| **Artisan (Ava)** | Self-serve "Employee" plan ~$600/mo billed annually ($7.2k/yr); mid/enterprise tiers reported $1,000–$2,500+/mo, quote-based | Annual contract typical at upper tiers | Full-stack (data+writing+send+LinkedIn) in one UI, targeted at teams without any existing pipeline | Not independently verified here — UNVERIFIED | "Is Ava worth $280/mo" / "$2000+/mo shock" — mixed, largely aggregator-blog reviews, not primary G2/Reddit text — UNVERIFIED | [Landbase](https://www.landbase.com/blog/artisan-ai-pricing), [11x guide](https://www.11x.ai/guides/artisan-pricing), [Cleanlist pricing index](https://www.cleanlist.ai/blog/2026-07-23-ai-sdr-pricing-statistics) |
| **11x (Alice)** | ~$5,000–$15,000+/mo; UNVERIFIED annualized estimate ~$60k/yr incl. commitment; calling add-on (Julian) extra | Annual contract; reviewers report difficult opt-out | Full BDR replacement narrative (research+write+book meetings); explicitly **no calling** without add-on | Not detailed in sources reached — UNVERIFIED | Reported 5.7% reply rate / 4.3/5 personalization in one third-party test; multiple write-ups flag "simplistic" personalization and 2025–2026 churn/inflated-metric concerns — **UNVERIFIED**, treat as blog-sourced, not G2/Reddit primary | [MarketBetter pricing](https://marketbetter.ai/blog/11x-ai-pricing-2026/), [MarketBetter review](https://marketbetter.ai/blog/11x-ai-review-2026/) |
| **AiSDR** | Solo $250/mo, Explore $900/mo, Scale $2,500/mo (quarterly commitment; 20% off annual); managed-service add-on can reach $5,000/mo | Quarterly | Unlimited seats, message-volume pricing (not per-seat), no free trial | Not detailed here — UNVERIFIED | Publicly-listed pricing (unusually transparent vs peers) — a genuine differentiator for budget planning | [Landbase](https://www.landbase.com/blog/aisdr-pricing), [MarketBetter](https://www.marketbetter.ai/blog/aisdr-pricing-breakdown-2026/) |
| **Reply.io AI SDR** | Not independently pulled this pass — UNVERIFIED, budget similar tier to Instantly/Smartlead add-ons per aggregator mentions | — | — | — | — |

**Read for Heyloo**: every full "AI SDR" product in this tier starts at or
above our entire monthly tool budget (≤$300) for a *single* seat, and none
of them replaces the thing we actually need most (a cheap local-business
data source + a phone-complaint signal) — they replace generic B2B email
outreach, which we've already built cheaper ourselves on Apollo+Claude+
Smartlead. **None of these are recommended** at this budget/stage.

### 2.2 Cold-email sending infrastructure

| Product | Price (2026) | Notes |
|---|---|---|
| **Smartlead** (already integrated) | Base $39/mo (2k active leads/6k emails), Pro $94/mo (30k leads, CRM, webhooks/API), Unlimited Smart $174/mo, Unlimited Prime $379/mo; unlimited mailboxes+warmup on every tier; ~17% off annual | [Landbase](https://www.landbase.com/blog/smartlead-pricing), [Amplemarket](https://www.amplemarket.com/blog/how-much-does-smartlead-really-cost) |
| **Instantly** | Growth $47/mo, Hypergrowth $97/mo, Lightspeed $358/mo (Outreach product only); realistic all-in with Credits+CRM+Inbox Placement ~$94–$194/mo | [Landbase](https://www.landbase.com/blog/instantly-ai-pricing), [coldemailkit](https://coldemailkit.com/tools/instantly) |
| **Lemlist** | Email Pro ~$63–79/seat/mo (annual/monthly), Multichannel Expert ~$87–109/seat/mo | [Landbase](https://www.landbase.com/blog/lemlist-pricing), [Astra GTM](https://astragtm.io/guides/lemlist-pricing-2026) |
| **Salesforge** | Pro $40/mo, Growth $80/mo; realistic ~$90/mo with infra/domains; first-year solo TCO ~$920–1,080 | [11x guide](https://www.11x.ai/guides/salesforge-pricing) |

**Read**: Smartlead (already chosen) is priced competitively at our volume
(Base tier at $39/mo covers 2,000 active leads — plenty for a 14-day, 20-demo
push). No switch is warranted; Instantly remains a fine documented fallback
per the existing code's provider abstraction if Smartlead deliverability
underperforms.

### 2.3 Data enrichment / lead-list platforms

| Product | Price (2026) | Notes |
|---|---|---|
| **Apollo.io** (already integrated) | Free $0; Basic $49/user/mo annual ($59 monthly); Professional $79/user/mo annual; Organization $119/user/mo annual (3-user min); credits meter reveals/exports on top and can blow up real cost to $150–400/user if unmanaged | [Salesmotion](https://salesmotion.io/blog/apollo-pricing) |
| **Clay** | Launch $185/mo (2,500 data credits/15k actions), Growth $495/mo unlimited; legacy Starter $149/mo still available to existing customers | [Warmly](https://www.warmly.ai/p/blog/clay-pricing), [Cleanlist](https://www.cleanlist.ai/blog/2026-03-12-clay-pricing-changes-2026) |
| **Persana AI** | Starter $68/mo, Growth $151/mo, Pro $400/mo; credit-based (1 credit = 1 verified email, 10 credits/phone) | [TrustRadius](https://www.trustradius.com/products/persana-ai/pricing) |
| **Seamless.ai** | Basic $147/mo (annual); Pro/Enterprise quote-only; free 50-lifetime-credit tier | [Lindy](https://www.lindy.ai/blog/seamless-ai-pricing), [MarketBetter](https://marketbetter.ai/blog/seamless-ai-pricing-breakdown-2026/) |
| **Outscraper** (already integrated) | Pay-as-you-go, no subscription: first 500 Maps results free, $3/1,000 through 100k, $1/1,000 beyond; **add-ons stack**: email enrichment +$3/1,000, verification +$3/1,000, phone lookup +$5/1,000 — a fully contactable lead runs ~$6–14/1,000 | [gmapsscraper.io](https://gmapsscraper.io/blog/outscraper-google-maps-scraper-pricing-review), [scrap.io](https://scrap.io/outscraper-pricing) |
| **Apify (Google Maps actors)** | Multiple actors on the marketplace: official "Compass" extractor $2.10–$5/1,000 depending on tier; cheaper community actors advertise $0.40–$1.50/1,000 (verify data completeness — cheap actors often skip emails/reviews) | [Apify](https://apify.com/scraperlink/google-maps-scraper), [use-apify.com](https://use-apify.com/blog/best-google-maps-scrapers-2026) |
| **Scrap.io** | Basic $49/mo (10k credits, city-only), Pro $99/mo (20k, county+50km radius), Agency $199/mo (40k, state+100km) | [gmapsscraper.io](https://gmapsscraper.io/blog/scrapio-google-maps-scraper-pricing-review) |
| **D7 Lead Finder** | Starter $44.99/mo (15 searches/day), Agency $69.99/mo (30/day), Professional $119.99/mo (100/day); no free plan/trial, only 5 free searches (no export) | [FullEnrich](https://fullenrich.com/content/d7-lead-finder-pricing) |
| **BrightLocal** | Track $39/mo (self-serve GBP/rank tracking + audit), Manage $49/mo, Grow $59/mo, per location; managed local-SEO service $799–1,299/location/mo (not relevant at our stage) | [BrightLocal](https://www.brightlocal.com/pricing/), [Capterra](https://www.capterra.com/p/182621/BrightLocal/pricing/) |

**Read**: Outscraper (already integrated) remains the best per-lead economics
for Maps data specifically because we already own the code path and the
per-1,000 pricing is genuinely cheap at our volume (a 500-lead batch with
phone+email add-ons costs roughly $3–7 total). Apify's community actors are
worth a cheap side-test for a second Maps source but are not a clear win
over what's shipped. D7/Scrap.io/BrightLocal are redundant with what Apollo+
Outscraper already do for us — no reason to add a third data vendor.

---

## 3. Local-SMB-specific channels — evidence and cost

| Channel | Evidence found | Cost | Fit for auto shops / vet clinics |
|---|---|---|---|
| **Facebook groups** | Active, real communities exist: "Auto Shop Owners Group (ASOG)," "Auto Repair Shop Owners Mastermind," "Auto Repair Shop Owners Alliance" — all free to join; no quantified conversion data found (UNVERIFIED for actual sales results, but these are genuine owner-only communities, not marketing pages) | Free (time only) | Good direct fit — post the missed-call-test pitch as a value-first comment/thread, not a cold ad, per typical group norms | [Facebook: ASOG](https://www.facebook.com/groups/AutoShopOwnersGroup/), [autorepairseo.com](https://autorepairseo.com/facebook-group/) |
| **Trade associations (ASA, AAHA)** | ASA: membership ~$330/yr for shops (we're not a shop, so this is about *sponsorship*, not membership) — no published sponsor pricing found in reachable sources, requires direct outreach to ASA for a quote. AAHA: 4,500+ member practices, 60k+ email subscribers (21% open rate), no sponsorship pricing published either — same "contact them" gap | UNVERIFIED cost (likely $1k+ for any sponsored placement based on comparable association ad-rate norms — not confirmed) | Slower channel — a Week-1 email/call to both associations' sponsorship contacts is worth doing in parallel, but not part of the fast 14-day plan given unknown cost and lead time | [ASA sponsors page](https://www.asashop.org/asa-sponsors/), [AAHA advertising/sponsorship](https://www.aaha.org/about-aaha/veterinary-advertising-and-sponsorship-opportunities/) |
| **VHMA / VetPartners (vet practice-manager networks)** | Real, active associations specifically for vet practice managers (VHMA formed 1981); LinkedIn presence confirmed for individual practice managers and the associations themselves | Membership/sponsorship cost not published — UNVERIFIED | Good targeting proxy: search LinkedIn for "Certified Veterinary Practice Manager (CVPM)" titles directly rather than paying for association access | [VHMA](https://en.wikipedia.org/wiki/Veterinary_Hospital_Managers_Association), [VetPartners](https://www.linkedin.com/company/vetpartners) |
| **Google Local Services Ads** | Confirmed **not applicable to us**: LSA is Google's pay-per-lead product for ~80 *service trades* categories (HVAC, legal, home services, etc.) — it is a channel our own future *customers* (the auto shops/vets) might use, not a channel Heyloo itself can run to reach them, since we're a B2B SaaS, not a listed trade category | N/A | Not usable as a Heyloo acquisition channel | [Enrich Labs LSA guide 2026](https://www.enrichlabs.ai/blog/local-services-ads-complete-guide-2026), [Google LSA eligibility](https://adwords.google.com/localservices/signup/eligibility) |
| **Direct mail / postcards with QR to demo page** | Real 2025–2026 benchmark data exists: overall B2B direct mail response ~4.4% average (house lists 5–9%, cold prospect lists 2–5%); all-in cost $0.60/postcard, $0.81/letter; B2B prospect-list CPA benchmark ~$43; one report claims $416/lead in generated revenue and 3:1–7:1 acquisition ROI for B2B (UNVERIFIED source rigor — marketing-vendor blog, treat direction as plausible, magnitude as unconfirmed) | ~$0.60–1.00/piece + list cost | Strong fit conceptually — a QR-code postcard is inherently the "missed-call test in print," directly testable, cheap per-unit, and a good complement once a mailing list of local auto shops/vets exists (which the Outscraper/Apollo fetch already produces) | [PostcardMania stats 2025](https://www.postcardmania.com/blog/direct-mail-statistics/), [Doceo 2026 response rates](https://www.mydoceo.com/blog/direct-mail-response-rates-2026), [Manhattan Digital Direct 2026 B2B benchmarks](https://manhattandd.com/direct-mail-response-rates-and-roi-2026-benchmarks-for-b2b-marketers/) |
| **LinkedIn (direct, unpaid outreach to practice managers/owners)** | Confirmed real and searchable population (CVPM-titled practice managers, shop owners) exists on LinkedIn; no quantified conversion data found for this specific vertical (UNVERIFIED) | Free (LinkedIn Free/Sales-Navigator optional ~$99/mo — not required for a manual search-and-DM approach) | Reasonable low-cost fit, but LinkedIn skews toward practice managers more than owner-operators of small independent shops, who are less likely to be active there — better suited to the vet-clinic side of the vertical mix than single-bay auto shops | [VHMA/VetPartners LinkedIn presence, above] |
| **Door-to-door** | No cost/conversion data found this pass (not searched in depth given time budget) — UNVERIFIED entirely | Founder's time only | Plausible strong fit for the exact missed-call-test pitch (walk in after the voicemail call, demo it live) but not quantified here; flag as a good candidate for the founder's own qualitative testing rather than a sourced recommendation |

---

## 4. Recommendation — ranked shortlist (≤6, ≤$300/mo total)

**What's already built vs. genuine adds**, restated plainly:
- **Already built and should keep running as-is**: Apollo (people/org search
  + enrichment), Outscraper/Apify Maps (Apollo-weak verticals), Claude
  Message Batches (personalization), Smartlead (send), Claude reply-intent
  classification, Retell demo-agent generator.
- **Genuine adds identified by this research** (none require a new paid
  subscription beyond what's already budgeted):
  1. **Review-mining filter for phone/voicemail complaints** — no
     off-the-shelf tool exists; build a small filter step on top of the
     review text Outscraper already returns (keyword + a cheap Claude Haiku
     pass classifying "mentions unanswered calls/voicemail/couldn't reach"),
     ranking leads by that signal before the Claude personalization step.
     This is the single highest-leverage genuine add from this whole scan
     — it turns our best qualifying signal (the missed-call test) into an
     upstream *targeting* filter, not just a live-call opener.
  2. **A second, cheap Google-Maps data source** (gosom or omkarcloud
     self-hosted scraper, or a cheap Apify community actor) as a
     supplementary/backup fetch adapter behind the existing provider
     abstraction — free-to-cheap, reduces single-vendor dependency on
     Outscraper, but not urgent at current volume.
  3. **Direct-mail QR postcards** to the same Outscraper/Apollo-sourced
     list — genuinely new channel, cheap per-unit, plausible response rate
     given 2025–2026 B2B benchmarks, and thematically on-brand (the
     postcard *is* a printed version of the missed-call test).

### Ranked shortlist

| Rank | Tool/channel | Monthly cost | Already built? | Expected leads/wk | Expected demos/wk (assumptions) |
|---|---|---|---|---|---|
| 1 | Outscraper + Apollo fetch (existing pipeline) | ~$0–30 (pay-as-you-go, at 500–1,000 leads/batch) | **Yes — keep running** | 500–1,000 new local-business leads/wk, easily | — (feeds all rows below) |
| 2 | Review-mining phone-complaint filter (new, built in-house on top of #1) | ~$0–5 (Claude Haiku classification calls only) | **Genuine add — build this week** | Re-ranks the same 500–1,000/wk into a top ~50–100 high-intent subset | Assumption: complaint-flagged leads convert to demos at 2–3x the base rate of unfiltered leads (UNVERIFIED — founder's own hypothesis being tested, not sourced) |
| 3 | Smartlead send (existing) | $39 (Base tier) | **Yes — keep running** | Sends to the full weekly batch | Assumption: 25–35% open, 3–5% reply on personalized local-business copy → 15–35 replies/wk at 500–1,000 sends/wk (industry-typical cold-email benchmarks, not vertical-specific — UNVERIFIED for auto/vet specifically) |
| 4 | Manual missed-call test (founder calling 20–30 shops/day personally, no automation) | $0 (time + existing phone/Twilio minutes) | Partially new practice, zero new tooling | 100–150 calls/wk → most a "was that a voicemail?" opener | Assumption: 10–20% of voicemail-hit shops take a callback/demo when the founder leads with "I just tried to reach you" → 3–6 demos/wk from this channel alone |
| 5 | Facebook owner groups (ASOG, Auto Repair Shop Owners Alliance/Mastermind) | $0 | New, zero-cost channel | Founder's own posting cadence, not a lead-count metric | Assumption: 1–2 demos/wk from genuine value-first engagement (UNVERIFIED, community-norm dependent — don't hard-pitch) |
| 6 | Direct-mail QR postcards to the Outscraper list (small first batch, ~200–300 pieces) | ~$150–250 for a 200–300 piece test batch (printing+postage at $0.60–1.00/piece) | **Genuine add**, uses list already produced by #1 | 200–300 pieces/wk if run weekly | Assumption: 2–5% response on a cold prospect list per 2025–2026 B2B benchmarks → 4–15 responses, some fraction converting to demo call (UNVERIFIED magnitude, directionally sourced) |

**Total monthly cash cost across all six: roughly $200–300** (Smartlead $39
+ Outscraper/Apollo pay-as-you-go ~$0–50 + one postcard test batch
~$150–250, spread across the month) — within the ≤$300 budget, with #1–#5
costing next to nothing and #6 (postcards) as the one line item worth
capping/testing small first.

### 14-day "first 20 demos" plan (cheapest effective stack)

- **Days 1–2**: Run the existing Apollo+Outscraper fetch for a 1,000-lead
  batch (auto shops + vet clinics, target metro area). Build the
  review-mining filter (keyword pass + one Claude Haiku classification call
  per lead using Outscraper's returned review text) and re-rank the batch —
  this is the one net-new piece of code this plan depends on.
- **Days 2–3**: Push the top ~300 complaint-flagged leads through the
  existing Claude personalization → Smartlead send path (already built,
  just point it at the filtered subset first).
- **Days 1–14 (daily)**: Founder personally calls 20–30 shops/day at
  lunchtime from the same list (the actual missed-call test) — for anyone
  who's voicemail, the callback/demo pitch leads with "I just tried
  reaching you..."; for anyone who answers, pivot straight to a live pitch.
- **Days 3–4**: Join/post (once, value-first, not a pitch) in ASOG and the
  Auto Repair Shop Owners Alliance/Mastermind groups; identify 10–15
  CVPM-titled vet practice managers on LinkedIn from the same fetch list
  and send a handful of manual, personalized connection notes referencing
  their clinic by name.
- **Days 5–6**: Send a small (~200–300 piece) QR-postcard test batch to a
  subset of the same fetched list that hasn't replied to email yet — the
  QR code should land on the same demo page the sales-follow-up already
  uses (per Flow 5 step 7's demo-agent generator).
- **Days 7–14**: Triage Smartlead + postcard + LinkedIn + Facebook + manual-
  call responses through the existing reply-classification → demo-agent
  generator path daily; keep calling 20–30 shops/day the whole two weeks
  (it's free and it's the qualifying signal that works); by day 14 the
  target is 20 booked demo calls across all five converging channels, with
  the manual missed-call-test calls and the complaint-filtered email send
  expected to be the two highest-converting sources based on the
  assumptions above.

---

## Sources index (all URLs cited above, deduplicated)

- Repos: [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper), [omkarcloud/google-maps-scraper](https://github.com/omkarcloud/google-maps-scraper), [dancolta/trustpilot-outreach-automation](https://github.com/dancolta/trustpilot-outreach-automation), [JosieBot26/prospector-mcp-email-finder](https://github.com/JosieBot26/prospector-mcp-email-finder), [MatthewDailey/open-sdr](https://github.com/MatthewDailey/open-sdr), [crewAIInc/crewai](https://github.com/crewaiinc/crewai), [Salesably/awesome-ai-agents-for-sales](https://github.com/Salesably/awesome-ai-agents-for-sales)
- AMD/TCPA: [callin.io](https://callin.io/twilio-answering-machine-detection/), [Twilio AMD docs](https://www.twilio.com/docs/voice/answering-machine-detection), [Twilio AMD FAQ](https://www.twilio.com/docs/voice/answering-machine-detection-faq-best-practices), [Auto Interview AI 2026](https://www.autointerviewai.com/blog/is-ai-cold-calling-legal-tcpa-fcc-trai-compliance-2026), [SalesHive](https://saleshive.com/blog/answering-machine-detection-platforms-help)
- Caller-ID/spam risk: [ReadyMode](https://readymode.com/avoid-being-flagged-as-spam-in-outbound-calls/), [SquareTalk](https://squaretalk.com/business-number-shows-as-spam-fix/)
- AI SDR pricing: [Landbase Artisan](https://www.landbase.com/blog/artisan-ai-pricing), [MarketBetter 11x](https://marketbetter.ai/blog/11x-ai-pricing-2026/), [MarketBetter 11x review](https://marketbetter.ai/blog/11x-ai-review-2026/), [Landbase AiSDR](https://www.landbase.com/blog/aisdr-pricing), [MarketBetter AiSDR](https://www.marketbetter.ai/blog/aisdr-pricing-breakdown-2026/), [Cleanlist AI SDR pricing index](https://www.cleanlist.ai/blog/2026-07-23-ai-sdr-pricing-statistics)
- Send infra pricing: [Landbase Smartlead](https://www.landbase.com/blog/smartlead-pricing), [Amplemarket Smartlead](https://www.amplemarket.com/blog/how-much-does-smartlead-really-cost), [Landbase Instantly](https://www.landbase.com/blog/instantly-ai-pricing), [coldemailkit Instantly](https://coldemailkit.com/tools/instantly), [Landbase Lemlist](https://www.landbase.com/blog/lemlist-pricing), [Astra GTM Lemlist](https://astragtm.io/guides/lemlist-pricing-2026), [11x Salesforge](https://www.11x.ai/guides/salesforge-pricing)
- Data/enrichment pricing: [Salesmotion Apollo](https://salesmotion.io/blog/apollo-pricing), [Warmly Clay](https://www.warmly.ai/p/blog/clay-pricing), [Cleanlist Clay](https://www.cleanlist.ai/blog/2026-03-12-clay-pricing-changes-2026), [TrustRadius Persana](https://www.trustradius.com/products/persana-ai/pricing), [Lindy Seamless](https://www.lindy.ai/blog/seamless-ai-pricing), [MarketBetter Seamless](https://marketbetter.ai/blog/seamless-ai-pricing-breakdown-2026/), [gmapsscraper Outscraper](https://gmapsscraper.io/blog/outscraper-google-maps-scraper-pricing-review), [scrap.io Outscraper](https://scrap.io/outscraper-pricing), [Apify scraperlink](https://apify.com/scraperlink/google-maps-scraper), [use-apify best scrapers 2026](https://use-apify.com/blog/best-google-maps-scrapers-2026), [gmapsscraper Scrap.io](https://gmapsscraper.io/blog/scrapio-google-maps-scraper-pricing-review), [FullEnrich D7](https://fullenrich.com/content/d7-lead-finder-pricing), [BrightLocal pricing](https://www.brightlocal.com/pricing/), [Capterra BrightLocal](https://www.capterra.com/p/182621/BrightLocal/pricing/)
- Local channels: [Facebook ASOG](https://www.facebook.com/groups/AutoShopOwnersGroup/), [autorepairseo.com FB group](https://autorepairseo.com/facebook-group/), [ASA sponsors](https://www.asashop.org/asa-sponsors/), [AAHA advertising/sponsorship](https://www.aaha.org/about-aaha/veterinary-advertising-and-sponsorship-opportunities/), [VHMA wikipedia](https://en.wikipedia.org/wiki/Veterinary_Hospital_Managers_Association), [VetPartners LinkedIn](https://www.linkedin.com/company/vetpartners), [Enrich Labs LSA guide](https://www.enrichlabs.ai/blog/local-services-ads-complete-guide-2026), [Google LSA eligibility](https://adwords.google.com/localservices/signup/eligibility), [PostcardMania stats](https://www.postcardmania.com/blog/direct-mail-statistics/), [Doceo response rates 2026](https://www.mydoceo.com/blog/direct-mail-response-rates-2026), [Manhattan Digital Direct B2B benchmarks](https://manhattandd.com/direct-mail-response-rates-and-roi-2026-benchmarks-for-b2b-marketers/)

*Internal references (not web sources): `docs/spec/API_AND_FLOWS.md` Flow 5,
`supabase/functions/api-outreach-fetch-leads/handler.ts`,
`supabase/functions/job-outreach-personalize/handler.ts`,
`supabase/functions/webhooks-outreach/handler.ts` and `index.ts`.*
