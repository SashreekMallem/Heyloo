-- OUTREACH-2: phone-complaint review scoring (docs/research/
-- CUSTOMER_ACQUISITION_TOOLS_2026.md recommendation #2,
-- docs/spec/API_AND_FLOWS.md Flow 5 step 2 — additive to `public.leads`
-- defined in 20260907130900_outreach.sql, CLAUDE.md Rule 2/4). A cheap
-- Claude pass reads a lead's Google reviews (fetched via Outscraper's
-- Reviews endpoint, `_shared/providers/outscraper.ts`) and scores how
-- strongly they signal "customers complain about phone access" — used to
-- re-rank the fetch batch before the personalization/send steps and to
-- sharpen the personalized opener itself (Flow 5 step 3).
--
-- `phone_complaint_score`/`phone_complaint_evidence` start null/empty for
-- every existing lead (no backfill — a lead is only ever scored going
-- forward by the new `job-outreach-review-score` cron job) and stay null
-- for a lead with no Google place id to fetch reviews for at all
-- (distinguishing "not yet scored" from "scored at 0" matters for the
-- job's own `where ... score is null` selection query below).

alter table public.leads
  add column phone_complaint_score numeric check (phone_complaint_score is null or (phone_complaint_score >= 0 and phone_complaint_score <= 1)),
  add column phone_complaint_evidence jsonb not null default '[]'::jsonb,
  add column reviews_analyzed_at timestamptz;

comment on column public.leads.phone_complaint_score is
  'OUTREACH-2: 0-1 confidence that this lead''s Google reviews complain about phone access (unanswered calls/voicemail/no callback/on hold/hard to reach) — null means not yet scored (job-outreach-review-score has not run for this lead, or it has no google_place_id in enrichment to fetch reviews for).';
comment on column public.leads.phone_complaint_evidence is
  'OUTREACH-2: jsonb array of {snippet, rating?, date?} — 1-3 quoted review snippets backing the score above. Every snippet is enforced (in job-outreach-review-score/handler.ts, not the database) to be a verbatim substring of a review this lead actually has; the classifier is never trusted to self-report that. Empty array when unscored or when nothing was found.';
comment on column public.leads.reviews_analyzed_at is
  'OUTREACH-2: when job-outreach-review-score last analyzed this lead''s reviews (set even when the resulting score is 0), so the job''s own selection query (`reviews_analyzed_at is null`) never re-spends an Outscraper Reviews call + an Anthropic call on the same lead twice.';

-- "index for ordering by score" (this task's own instruction, step 1) — the
-- admin outreach UI's score column sort/filter (step 3) and any future
-- CRON re-rank query both want "highest-scored leads first", nulls last.
create index idx_leads_phone_complaint_score
  on public.leads (phone_complaint_score desc nulls last);

-- Supporting index for job-outreach-review-score's own selection query
-- ("leads with a Google place id and no score yet") — a partial index on
-- the exact predicate that query filters on, so the job's per-run scan
-- stays cheap as the leads table grows past the free-tier-sized fixtures
-- this repo has today.
create index idx_leads_needs_review_score
  on public.leads ((enrichment ->> 'google_place_id'))
  where reviews_analyzed_at is null and enrichment ->> 'google_place_id' is not null;

-- `pipeline_costs.category` (20260907130900_outreach.sql) has no bucket for
-- this new spend line (Outscraper Reviews calls + the Anthropic
-- classification call) — task step 4 ("pipeline_costs recorded") needs
-- one. Widening a CHECK constraint's allowed value set is additive (never
-- narrows what already-written rows satisfy), so this drops and re-adds
-- the same constraint by its real (Postgres-assigned, confirmed via local
-- harness \d) name rather than touching any other column.
alter table public.pipeline_costs drop constraint pipeline_costs_category_check;
alter table public.pipeline_costs add constraint pipeline_costs_category_check
  check (category in ('list_cost','ai_personalization','sender_fee','domain_warmup','review_scoring'));
