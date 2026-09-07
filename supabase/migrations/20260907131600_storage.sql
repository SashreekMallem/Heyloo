-- Storage. BACKEND_SPEC.md §6.
-- Bucket `recordings`, path convention recordings/{tenant_id}/{call_id}.wav
-- (mono) and recordings/{tenant_id}/{call_id}_stereo.wav. Private bucket;
-- all reads go through signed URLs minted server-side by an authenticated
-- edge function that itself checks call_logs.tenant_id = fn_jwt_tenant_id()
-- before minting — there is deliberately NO client-facing SELECT policy on
-- storage.objects for this bucket at all. `service_role` bypasses RLS by
-- default on a Supabase project, so recording archival (/voice/events
-- background work, T3) needs no explicit write policy either — RLS
-- enabled + zero matching permissive policy for authenticated/anon is the
-- "private, signed-URL-only" posture end to end.

insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- storage.objects already ships with RLS enabled by the Supabase Storage
-- platform; no additional policy is added here for authenticated/anon on
-- this bucket (default-deny is the desired behavior). Retention: the
-- nightly retention-sweep job (T4, BACKEND_SPEC §8) deletes objects older
-- than tenants.retention_days and nulls call_logs.recording_url/
-- stereo_recording_url — not implemented here (out of T1's §0-§6 scope).
