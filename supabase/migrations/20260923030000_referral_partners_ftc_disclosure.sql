-- QA-PORTAL (docs/BUILD_NOTES.md, docs/VERIFY.md T5 row): adds the
-- `referral_partners.ftc_acknowledged_at`/`ftc_acknowledged_version`
-- columns FRONTEND_SPEC.md §8.4 and `apps/web/src/app/api/partner/
-- disclosure/route.ts` / `apps/web/src/lib/auth/require-partner-session.ts`
-- have both read and written since T5 without them ever existing —
-- flagged there ("this write will fail until that column pair is added"),
-- never picked up since. Without this migration the ENTIRE partner portal
-- is unreachable for every real referral partner: `requirePartnerSession`
-- selects both columns on every `(partner)` layout render; PostgREST
-- errors that select (unknown column) on a table with row-level security,
-- so `.maybeSingle()` returns `{data: null}`, and the layout treats a null
-- `partner` as "not a partner at all" (`redirect("/?toast=no_access")`) —
-- confirmed live this session (QA-PORTAL) against the real
-- `referral_partners` table schema.
--
-- Additive only (CLAUDE.md Rule 2) — both columns nullable, matching
-- "not yet acknowledged" as their natural zero state (`requirePartnerSession`
-- already treats a null `ftc_acknowledged_at` as unacknowledged).
alter table public.referral_partners
  add column if not exists ftc_acknowledged_at timestamptz,
  add column if not exists ftc_acknowledged_version text;
