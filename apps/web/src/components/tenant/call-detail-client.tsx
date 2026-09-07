"use client";

import {
  AudioPlayer,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  type StateTraceEntry,
  StateTraceViewer,
  StatusBadge,
  type TranscriptTurn,
  TranscriptViewer,
} from "@heyloo/ui";
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
}

export function CallDetailClient({ call }: { call: CallDetailData }) {
  const [activeTs, setActiveTs] = useState<number | undefined>(undefined);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Call detail</h1>
        <div className="flex items-center gap-2">
          {call.classification && <StatusBadge variant="call-class" value={call.classification} />}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/support?call_id=${call.id}`}>Create support ticket</Link>
          </Button>
        </div>
      </div>

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
