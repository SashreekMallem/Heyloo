import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CallDetailClient, type CallDetailData } from "@/components/tenant/call-detail-client";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Call detail — Heyloo" };

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenant } = await requireTenantSession(`/dashboard/calls/${id}`);

  const { data: call } = await supabase
    .from("call_logs")
    .select(
      "id, classification, transcript, state_trace, recording_url, stereo_recording_url, duration_seconds, ended_at, structured_booking_payload",
    )
    .eq("tenant_id", tenant.id)
    .eq("id", id)
    .maybeSingle();

  if (!call) notFound();

  const recordingStatus: CallDetailData["recordingStatus"] = call.recording_url
    ? "ready"
    : // eslint-disable-next-line react-hooks/purity -- async Server Component, computed once per request (not a re-rendered client purity concern)
      call.ended_at && Date.now() - new Date(call.ended_at).getTime() < 10 * 60 * 1000
      ? "processing"
      : "none";

  const data: CallDetailData = {
    id: call.id,
    classification: call.classification,
    transcript: (call.transcript ?? []).map((t) => ({
      speaker: t.speaker,
      text: t.text,
      ts: t.ts,
    })),
    stateTrace: (call.state_trace ?? []).map((s) => ({ state: s.state, enteredAt: s.enteredAt })),
    recordingUrl: call.recording_url,
    stereoRecordingUrl: call.stereo_recording_url,
    recordingStatus,
    durationSeconds: call.duration_seconds,
    linkedBookingId:
      call.structured_booking_payload && typeof call.structured_booking_payload === "object"
        ? ((call.structured_booking_payload as { booking_id?: string }).booking_id ?? null)
        : null,
  };

  return <CallDetailClient call={data} />;
}
