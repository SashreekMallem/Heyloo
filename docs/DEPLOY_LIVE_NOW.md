# DEPLOY_LIVE_NOW — Executor Runbook (live Supabase deployment)

You are a deployment executor for this finished codebase. Obey /CLAUDE.md.
The owner has pre-approved psql/curl/npx-supabase in `.claude/settings.json`
and provides `SUPABASE_ACCESS_TOKEN` in their prompt — export it in your
shell; NEVER write it into any repo file or commit.

TARGET: Supabase project ref `qulcubtwqsqgqpfgvorn` ("Heyloo", us-east-2,
Postgres 17).

STATE (verified by the owner's prior session): project wiped and empty —
public schema empty, `supabase_migrations` schema dropped, `auth.users`
empty. Storage still has 3 legacy buckets (`menus`, `voice-samples`,
`call-recordings`; 73 old objects) — owner approved deleting them. 14
legacy edge functions still deployed (retell-assistant, retell-events,
retell-tools, retell-manage, retell-numbers, pos-sync, pos-oauth,
pos-oauth-callback, pos-push, pos-push-square, pos-push-clover,
square-webhook, clover-webhook, parse-menu) — owner approved deleting all.

NETWORK: only HTTPS works (no direct Postgres TCP: `db.*.supabase.co` is
IPv6-only here and pooler ports are firewalled). Run ALL SQL via the
Management API query endpoint:

```
jq -Rs '{query: .}' < file.sql | curl -sS -w '\n%{http_code}' -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' --data-binary @- \
  https://api.supabase.com/v1/projects/qulcubtwqsqgqpfgvorn/database/query
```

HTTP 200/201 = success. Deploy edge functions with
`npx supabase functions deploy --use-api` (no Docker). Per CLAUDE.md Rule 1,
verify Management API endpoint shapes against current supabase.com docs
before relying on them.

## Steps, in order

1. **DB bookkeeping**: create schema `supabase_migrations` and table
   `schema_migrations(version text primary key, statements text[], name
   text)` (CLI-compatible).
2. **Migrations**: apply all 21 files in `supabase/migrations/*.sql` in
   filename order via the query endpoint; after each success, insert its
   version+name into `schema_migrations`. On any SQL error: STOP, diagnose
   against the file, report exactly which file/statement failed — never
   improvise schema changes against the live DB.
3. **Seed**: apply `supabase/seed/seed.sql`.
4. **Verify DB (read-only)**: ~49 tables present; `select tablename from
   pg_tables where schemaname='public' and rowsecurity=false` returns 0
   rows; functions `custom_access_token_hook`, `fn_jwt_tenant_id`,
   `fn_regenerate_availability_slots` exist; exclusion constraint
   `bookings_resource_id_during_excl` exists; `resources.buffer_minutes`
   exists; E.164 CHECK constraints exist; seed rows present
   (platform_settings price cards, templates); storage bucket `recordings`
   exists.
5. **Cleanup (owner-approved)**: DELETE the 14 legacy edge functions
   (`DELETE /v1/projects/{ref}/functions/{slug}`); delete legacy storage
   objects and the 3 legacy buckets (SQL on `storage.objects` /
   `storage.buckets` where bucket id in ('menus','voice-samples',
   'call-recordings'), or the Storage API if SQL is refused). Do NOT touch
   the `recordings` bucket created by the migration.
6. **Edge functions**: with `SUPABASE_ACCESS_TOKEN` exported, deploy ALL
   functions in `supabase/functions/` (skip `_shared`; respect
   `supabase/config.toml` per-function `verify_jwt`) using
   `npx supabase functions deploy --project-ref qulcubtwqsqgqpfgvorn
   --use-api`. Verify each shows ACTIVE via
   `GET /v1/projects/{ref}/functions`.
7. **Auth hook**: enable the Custom Access Token hook pointing at
   `public.custom_access_token_hook` via the Management API auth config
   (verify exact field names in current docs; typically
   `PATCH /v1/projects/{ref}/config/auth` with
   `hook_custom_access_token_enabled: true` and
   `hook_custom_access_token_uri:
   "pg-functions://postgres/public/custom_access_token_hook"`). Leave all
   other auth config untouched.
8. **Project keys + function secrets**: `GET /v1/projects/{ref}/api-keys`
   (NEW publishable/secret key system — never legacy anon/service_role).
   Do NOT print full secret values into logs or files. Cross-check
   `supabase/functions/_shared` and `.env.example` for the exact env var
   names the functions read, then set the secrets you can derive (e.g.
   project URL + secret key) via `npx supabase secrets set` or
   `POST /v1/projects/{ref}/secrets`. Provider secrets (RETELL_API_KEY,
   STRIPE_*, TWILIO_*, RESEND_*, PAYPAL_*, …) are NOT available yet — list
   which remain unset; do not invent values.
9. **Report**: update `docs/LAUNCH_STATUS.md` with a "Deployed to live
   project" section (date, migrations applied, functions deployed, auth
   hook status, remaining unset secrets — no secret values, no token).
   Commit and push to branch `claude/voice-ai-agent-architecture-dcw0n8`
   (`git push -u origin claude/voice-ai-agent-architecture-dcw0n8`, retry
   up to 4x with backoff on network errors only). NEVER create a pull
   request. NEVER push to any other branch.

## Constraints

- No destructive SQL beyond step 5's explicitly-approved deletions.
- No code changes except `docs/LAUNCH_STATUS.md` (and
  `docs/BUILD_NOTES.md` under task id DEPLOY-1 if a deploy step reveals a
  code bug — document and report rather than refactor).
- If a command is denied by a permission classifier: note it verbatim,
  skip, continue; end your final report with a clear list of anything not
  completed.
