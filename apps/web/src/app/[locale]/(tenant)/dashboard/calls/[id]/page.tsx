import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CallDetailClient, type CallDetailData } from "@/components/tenant/call-detail-client";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";
import { normalizeTranscript } from "@/lib/calls/transcript";

export const metadata: Metadata = { title: "Call detail — Heyloo" };

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenant } = await requireTenantSession(`/dashboard/calls/${id}`);

  const { data: call } = await supabase
    .from("call_logs")
    .select(
      "id, caller_number, started_at, classification, transcript, state_trace, recording_url, stereo_recording_url, duration_seconds, ended_at, structured_booking_payload, urgency_flag, call_summary, sentiment, follow_up_needed, legal_advice_given, extracted_entities, message_text, outcome",
    )
    .eq("tenant_id", tenant.id)
    .eq("id", id)
    .maybeSingle();

  if (!call) notFound();

  // Who called: match the caller's number to one of this tenant's customers.
  const { data: customer } = call.caller_number
    ? await supabase
        .from("customers")
        .select("id, name")
        .eq("tenant_id", tenant.id)
        .eq("phone_e164", call.caller_number)
        .maybeSingle()
    : { data: null };

  const recordingStatus: CallDetailData["recordingStatus"] = call.recording_url
    ? "ready"
    : // eslint-disable-next-line react-hooks/purity -- async Server Component, computed once per request (not a re-rendered client purity concern)
      call.ended_at && Date.now() - new Date(call.ended_at).getTime() < 10 * 60 * 1000
      ? "processing"
      : "none";

  const data: CallDetailData = {
    id: call.id,
    classification: call.classification,
    callerNumber: call.caller_number,
    startedAt: call.started_at,
    customer: customer ? { id: customer.id, name: customer.name } : null,
    // `call_logs.transcript` holds the provider's `{ role, content, words }` turns
    // for real calls (and canonical `{ speaker, text, ts }` elsewhere) — normalise
    // both so no row renders blank / "NaN:NaN" (QA-1 F-3 / MAP-02).
    transcript: normalizeTranscript(call.transcript),
    stateTrace: (call.state_trace ?? []).map((s) => ({ state: s.state, enteredAt: s.enteredAt })),
    // DASH-1 (docs/BUILD_NOTES.md): the raw `recording_url`/
    // `stereo_recording_url` columns are object paths in the PRIVATE
    // `recordings` Storage bucket — they must never reach the client
    // (this object becomes the Client Component's serialized props, i.e.
    // part of the page payload the browser receives). The client fetches
    // a short-lived signed URL on demand from
    // `/api/tenant/calls/[id]/recording` instead; only whether a stereo
    // file exists (a boolean, not the path) is needed to know whether to
    // offer the stereo toggle.
    hasStereoRecording: Boolean(call.stereo_recording_url),
    recordingStatus,
    durationSeconds: call.duration_seconds,
    linkedBookingId:
      call.structured_booking_payload && typeof call.structured_booking_payload === "object"
        ? ((call.structured_booking_payload as { booking_id?: string }).booking_id ?? null)
        : null,
    urgencyFlag: call.urgency_flag,
    callSummary: call.call_summary,
    sentiment: call.sentiment,
    followUpNeeded: call.follow_up_needed,
    legalAdviceGiven: call.legal_advice_given,
    outcome: call.outcome,
    messageText: call.message_text,
    structuredPayload:
      call.structured_booking_payload && typeof call.structured_booking_payload === "object"
        ? (call.structured_booking_payload as Record<string, unknown>)
        : null,
    extractedEntities:
      call.extracted_entities && typeof call.extracted_entities === "object"
        ? (call.extracted_entities as Record<string, unknown>)
        : null,
  };

  return <CallDetailClient call={data} />;
}
