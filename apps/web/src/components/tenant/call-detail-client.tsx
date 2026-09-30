"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  formatDuration,
  formatPhoneDisplay,
  PageHeader,
  type StateTraceEntry,
  StateTraceViewer,
  StatusBadge,
  type TranscriptTurn,
  TranscriptViewer,
} from "@heyloo/ui";
import { AudioPlayer } from "@heyloo/ui/audio-player";
import { useEffect, useState } from "react";
import { CustomAnswersList } from "@/components/tenant/custom-answers";
import { Link } from "@/i18n/navigation";
import { readCustomAnswers, withoutCustomAnswers } from "@/lib/settings/custom-questions";

export interface CallDetailData {
  id: string;
  /** E.164 caller number (`call_logs.caller_number`). */
  callerNumber: string | null;
  startedAt: string | null;
  /** The tenant customer whose number matches `callerNumber`, when there is one. */
  customer: { id: string; name: string | null } | null;
  classification: string | null;
  transcript: TranscriptTurn[];
  stateTrace: StateTraceEntry[];
  /** Whether `stereo_recording_url` is set — never the path itself (DASH-1, docs/BUILD_NOTES.md). */
  hasStereoRecording: boolean;
  recordingStatus: "processing" | "none" | "ready";
  durationSeconds: number | null;
  linkedBookingId: string | null;
  urgencyFlag: boolean;
  callSummary: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  followUpNeeded: boolean;
  legalAdviceGiven: boolean;
  outcome: string | null;
  messageText: string | null;
  structuredPayload: Record<string, unknown> | null;
  extractedEntities: Record<string, unknown> | null;
}

const SENTIMENT_VARIANT: Record<string, "success" | "secondary" | "destructive"> = {
  positive: "success",
  neutral: "secondary",
  negative: "destructive",
};

/** Keys that are internal identifiers (`booking_id`, `question_id`, `id`, ...): noise to the owner. */
function isIdKey(key: string): boolean {
  return /(^|_)id$/i.test(key) || /Id$/.test(key);
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Payload -> readable label/value rows: nested objects are flattened into
 * "parent child" labels (never "[object Object]"), id fields are hidden and
 * empty values are skipped (QA-1 F-18).
 */
export function keyValueEntries(payload: Record<string, unknown>, prefix = ""): [string, string][] {
  const rows: [string, string][] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined || v === "" || isIdKey(k)) continue;
    const label = `${prefix}${k.replace(/_/g, " ")}`;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      rows.push(...keyValueEntries(v as Record<string, unknown>, `${label} `));
    } else {
      rows.push([label, formatValue(v)]);
    }
  }
  return rows;
}

/** Why there is no recording, worded by the reason we can actually infer (QA-1 F-18). */
export function noRecordingMessage(durationSeconds: number | null): string {
  if (durationSeconds == null || durationSeconds < 10) {
    return "No recording — the call ended before there was anything to record.";
  }
  return "No recording is available for this call. If you expected one, contact support and quote the call ID.";
}

interface RecordingSignedState {
  status: "idle" | "loading" | "ready" | "error";
  url?: string;
  stereoUrl?: string;
}

async function fetchSignedRecordingUrl(callId: string, channel?: "stereo"): Promise<string | null> {
  const query = channel ? `?channel=${channel}` : "";
  const res = await fetch(`/api/tenant/calls/${callId}/recording${query}`);
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { url?: string } | null;
  return body?.url ?? null;
}

/**
 * DASH-1 (docs/BUILD_NOTES.md): mints a short-lived signed URL for the
 * recording on demand instead of the dashboard ever holding the private
 * bucket path — the route (`/api/tenant/calls/[id]/recording`) re-checks
 * the caller's own tenant_id server-side (AUTH-1 pattern) before signing.
 */
function useSignedRecording(callId: string, ready: boolean, hasStereo: boolean) {
  const [state, setState] = useState<RecordingSignedState>({ status: "idle" });

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: resets to "loading" synchronously at the start of every fetch run so a stale "ready"/"error" state from a PRIOR call id is never shown while this one's signed URL is still in flight.
    setState({ status: "loading" });
    (async () => {
      try {
        const [url, stereoUrl] = await Promise.all([
          fetchSignedRecordingUrl(callId),
          hasStereo ? fetchSignedRecordingUrl(callId, "stereo") : Promise.resolve(undefined),
        ]);
        if (cancelled) return;
        if (!url) {
          setState({ status: "error" });
          return;
        }
        setState({ status: "ready", url, stereoUrl: stereoUrl ?? undefined });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, ready, hasStereo]);

  return state;
}

export function CallDetailClient({ call }: { call: CallDetailData }) {
  const [activeTs, setActiveTs] = useState<number | undefined>(undefined);
  const recording = useSignedRecording(
    call.id,
    call.recordingStatus === "ready",
    call.hasStereoRecording,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          call.customer?.name?.trim() ||
          (call.callerNumber ? formatPhoneDisplay(call.callerNumber) : "Unknown caller")
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {call.customer?.name?.trim() && call.callerNumber && (
              <span>{formatPhoneDisplay(call.callerNumber)}</span>
            )}
            <span>
              {call.startedAt ? new Date(call.startedAt).toLocaleString() : "Call in progress"}
            </span>
            {call.durationSeconds != null && <span>{formatDuration(call.durationSeconds)}</span>}
            {call.customer && (
              <Link
                href={`/dashboard/customers/${call.customer.id}`}
                className="text-accent-text underline underline-offset-2"
              >
                View customer
              </Link>
            )}
          </span>
        }
        actions={
          <>
            {call.urgencyFlag && <Badge variant="destructive">Urgent</Badge>}
            {call.legalAdviceGiven && <Badge variant="destructive">Legal advice given</Badge>}
            {call.classification && (
              <StatusBadge variant="call-class" value={call.classification} />
            )}
            {call.sentiment && (
              <Badge variant={SENTIMENT_VARIANT[call.sentiment] ?? "outline"}>
                {call.sentiment}
              </Badge>
            )}
            {call.followUpNeeded && <Badge variant="warning">Follow-up needed</Badge>}
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/support?call_id=${call.id}`}>Create support ticket</Link>
            </Button>
          </>
        }
      />

      {(call.callSummary || call.outcome || call.messageText) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {call.callSummary && <p>{call.callSummary}</p>}
            {call.outcome && (
              <p>
                <span className="text-muted-foreground">Outcome</span> {call.outcome}
              </p>
            )}
            {call.messageText && (
              <p>
                <span className="text-muted-foreground">Message left</span> {call.messageText}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {call.structuredPayload && readCustomAnswers(call.structuredPayload).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Answers to your questions</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomAnswersList payload={call.structuredPayload} />
          </CardContent>
        </Card>
      )}

      {call.structuredPayload &&
        keyValueEntries(withoutCustomAnswers(call.structuredPayload)).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Captured on the call</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1 text-sm">
                {keyValueEntries(withoutCustomAnswers(call.structuredPayload)).map(
                  ([label, value]) => (
                    <div key={label} className="flex justify-between gap-2">
                      <dt className="capitalize text-muted-foreground">{label}</dt>
                      <dd className="text-right">{value}</dd>
                    </div>
                  ),
                )}
              </dl>
            </CardContent>
          </Card>
        )}

      {call.extractedEntities && keyValueEntries(call.extractedEntities).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Extracted entities</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1 text-sm">
              {keyValueEntries(call.extractedEntities).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt className="capitalize text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {call.linkedBookingId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Linked booking</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={`/dashboard/bookings?booking=${encodeURIComponent(call.linkedBookingId)}`}
              className="text-sm underline"
            >
              View booking
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recording</CardTitle>
        </CardHeader>
        <CardContent>
          {call.recordingStatus === "processing" && (
            <p className="text-sm text-muted-foreground">
              Still processing — recordings are typically available within 10 minutes of the call
              ending.
            </p>
          )}
          {call.recordingStatus === "none" && (
            <p className="text-sm text-muted-foreground">
              {noRecordingMessage(call.durationSeconds)}
            </p>
          )}
          {call.recordingStatus === "ready" && recording.status === "loading" && (
            <p className="text-sm text-muted-foreground">Loading recording…</p>
          )}
          {call.recordingStatus === "ready" && recording.status === "error" && (
            <p className="text-sm text-muted-foreground">
              Recording not available yet — try refreshing in a moment.
            </p>
          )}
          {call.recordingStatus === "ready" && recording.status === "ready" && recording.url && (
            <AudioPlayer
              src={recording.url}
              stereoSrc={recording.stereoUrl}
              duration={call.durationSeconds ?? undefined}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Transcript</h2>
          <TranscriptViewer turns={call.transcript} activeTs={activeTs} onSeek={setActiveTs} />
        </div>
        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Conversation states</h2>
          <StateTraceViewer
            trace={call.stateTrace}
            onSeek={(entry) => {
              const turn = call.transcript.find(
                (t) => t.text && new Date(entry.enteredAt).getTime() / 1000 <= t.ts,
              );
              if (turn) setActiveTs(turn.ts);
            }}
          />
        </div>
      </div>
    </div>
  );
}
