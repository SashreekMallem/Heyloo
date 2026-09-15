"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  type StateTraceEntry,
  StateTraceViewer,
  StatusBadge,
  type TranscriptTurn,
  TranscriptViewer,
} from "@heyloo/ui";
import { AudioPlayer } from "@heyloo/ui/audio-player";
import { useState } from "react";
import { Link } from "@/i18n/navigation";

export interface CallDetailData {
  id: string;
  classification: string | null;
  transcript: TranscriptTurn[];
  stateTrace: StateTraceEntry[];
  recordingUrl: string | null;
  stereoRecordingUrl: string | null;
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

function keyValueEntries(payload: Record<string, unknown>): [string, string][] {
  return Object.entries(payload)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]): [string, string] => [
      k.replace(/_/g, " "),
      Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v),
    ]);
}

export function CallDetailClient({ call }: { call: CallDetailData }) {
  const [activeTs, setActiveTs] = useState<number | undefined>(undefined);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Call detail"
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

      {call.structuredPayload && keyValueEntries(call.structuredPayload).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Captured on the call</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1 text-sm">
              {keyValueEntries(call.structuredPayload).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt className="capitalize text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
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
            <Link href="/dashboard/bookings" className="text-sm underline">
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
              No recording for this call (by design — very short/spam calls aren&apos;t archived).
            </p>
          )}
          {call.recordingStatus === "ready" && call.recordingUrl && (
            <AudioPlayer
              src={call.recordingUrl}
              stereoSrc={call.stereoRecordingUrl ?? undefined}
              duration={call.durationSeconds ?? undefined}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Transcript</h2>
          <TranscriptViewer turns={call.transcript} activeTs={activeTs} onSeek={setActiveTs} />
        </div>
        <div>
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
