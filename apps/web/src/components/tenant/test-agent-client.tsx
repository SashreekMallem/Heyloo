"use client";

import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  PageHeader,
  PhoneInput,
  TranscriptViewer,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { scenariosFor } from "@/components/tenant/test-agent-scenarios";
import { Link } from "@/i18n/navigation";
import { normalizeTranscript } from "@/lib/calls/transcript";
import { saveErrorMessage, sendJson } from "@/lib/settings/client";
import { isBlankOrValidPhone, PHONE_ERROR_MESSAGE } from "@/lib/settings/phone";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

interface LatestTestCall {
  id: string;
  started_at: string | null;
  ended_at: string | null;
  classification: string | null;
  call_summary: string | null;
  message_text: string | null;
  structured_booking_payload: Record<string, unknown> | null;
  /** Stored provider-shaped or canonical turns — always read through `normalizeTranscript`. */
  transcript: unknown;
  duration_seconds: number | null;
}

export function TestAgentClient({
  tenantId,
  vertical,
  phoneNumberId,
  liveNumber,
  forwardingVerified,
  agentPublished,
}: {
  tenantId: string;
  vertical: string;
  phoneNumberId: string | null;
  liveNumber: string | null;
  forwardingVerified: boolean;
  agentPublished: boolean;
}) {
  const queryClient = useQueryClient();
  const [testPhone, setTestPhone] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [waitingForCall, setWaitingForCall] = useState(false);
  const [webCallState, setWebCallState] = useState<
    "idle" | "starting" | "connecting" | "active" | "ended" | "error" | "unavailable"
  >("idle");
  const webCallClientRef = useRef<import("retell-client-js-sdk").RetellWebClient | null>(null);

  useQuery({
    queryKey: ["tenant", tenantId, "owner_test_phone"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("tenants")
        .select("owner_test_phone")
        .eq("id", tenantId)
        .maybeSingle();
      setTestPhone(data?.owner_test_phone ?? "");
      return data?.owner_test_phone ?? null;
    },
  });

  // SETTINGS-1: saved as E.164 through `POST /api/tenant/settings/test-phone`
  // — `voice-events` compares it to the normalized caller ID, so a
  // formatted "(555) 123-4567" never matched and test calls were billed.
  async function saveTestPhone() {
    if (!isBlankOrValidPhone(testPhone)) {
      setPhoneError(PHONE_ERROR_MESSAGE);
      return;
    }
    setPhoneError(null);
    setSavingPhone(true);
    const result = await sendJson<{ owner_test_phone: string | null }>(
      "/api/tenant/settings/test-phone",
      { owner_test_phone: testPhone },
    );
    setSavingPhone(false);
    if (!result.ok) {
      setPhoneError(result.issues[0]?.message ?? null);
      toast.error(saveErrorMessage(result));
      return;
    }
    const saved = result.body?.owner_test_phone ?? null;
    setTestPhone(saved ?? "");
    toast.success(
      saved
        ? "Test number saved — calls from it are marked as tests."
        : "Test number removed — calls are no longer marked as tests.",
    );
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "settings_checklist"] });
  }

  const latestCallQuery = useQuery({
    queryKey: ["tenant", tenantId, "latest_test_call", phoneNumberId],
    queryFn: async (): Promise<LatestTestCall | null> => {
      if (!phoneNumberId) return null;
      const { data } = await supabaseBrowserClient
        .from("call_logs")
        .select(
          "id, started_at, ended_at, classification, call_summary, message_text, structured_booking_payload, transcript, duration_seconds",
        )
        .eq("tenant_id", tenantId)
        .eq("phone_number_id", phoneNumberId)
        .eq("is_test_call", true)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as unknown as LatestTestCall) ?? null;
    },
    enabled: !!phoneNumberId,
    // A function (not the raw `waitingForCall` flag) so this also stops polling the
    // instant the fetched call itself shows `ended_at` — no separate effect needed to
    // flip `waitingForCall` back off in response to query data changing.
    refetchInterval: (query) => (waitingForCall && !query.state.data?.ended_at ? 4000 : false),
  });

  function startWaiting() {
    setWaitingForCall(true);
    window.setTimeout(() => setWaitingForCall(false), 3 * 60_000);
  }

  const latestCall = latestCallQuery.data ?? null;

  async function startWebCall() {
    setWebCallState("starting");
    try {
      const res = await fetch("/api/tenant/test-agent/web-call", { method: "POST" });
      if (!res.ok) {
        setWebCallState("unavailable");
        return;
      }
      const body = (await res.json()) as { access_token?: string; call_id?: string };
      if (!body.access_token) {
        setWebCallState("unavailable");
        return;
      }
      const { RetellWebClient } = await import("retell-client-js-sdk");
      const client = new RetellWebClient();
      webCallClientRef.current = client;
      client.on("call_started", () => setWebCallState("active"));
      client.on("call_ended", () => {
        setWebCallState("ended");
        void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "latest_test_call"] });
      });
      client.on("error", () => setWebCallState("error"));
      setWebCallState("connecting");
      await client.startCall({ accessToken: body.access_token });
    } catch {
      setWebCallState("error");
    }
  }

  function endWebCall() {
    webCallClientRef.current?.stopCall();
    setWebCallState("ended");
  }

  const testCallDone = !!latestCall?.ended_at;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Test your agent"
        description="Try a real scenario, then review exactly what your agent heard and did before turning on live call forwarding."
      />

      {!agentPublished && (
        <Callout tone="warning">
          Your agent hasn&apos;t been published yet —{" "}
          <Link href="/dashboard/agent" className="underline">
            publish it first
          </Link>{" "}
          before testing.
        </Callout>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Try a scenario</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {scenariosFor(vertical).map((s) => (
            <div key={s.title} className="rounded-md border border-border p-3">
              <p className="text-sm font-medium">{s.title}</p>
              <p className="mt-1 text-sm italic text-muted-foreground">{s.script}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Web call</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={startWebCall}
            disabled={
              !agentPublished ||
              webCallState === "starting" ||
              webCallState === "connecting" ||
              webCallState === "active"
            }
          >
            {webCallState === "starting" || webCallState === "connecting"
              ? "Starting…"
              : webCallState === "active"
                ? "Call in progress…"
                : "Start a web call test"}
          </Button>
          {webCallState === "active" && (
            <Button variant="ghost" onClick={endWebCall}>
              End call
            </Button>
          )}
          {webCallState === "connecting" && (
            <p className="text-xs text-muted-foreground">
              Allow microphone access in your browser to talk to the test agent.
            </p>
          )}
          {webCallState === "ended" && (
            <p className="text-sm text-muted-foreground">
              Call ended — check &ldquo;Latest test call&rdquo; below for the transcript.
            </p>
          )}
          {webCallState === "error" && (
            <p className="text-sm text-warning">
              We couldn&apos;t complete the web call — try the phone test below instead.
            </p>
          )}
          {webCallState === "unavailable" && (
            <p className="text-sm text-muted-foreground">
              Web call testing isn&apos;t available yet — try the phone test below instead.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Phone call</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="owner-test-phone">
              Your phone number (so we recognize your test calls)
            </Label>
            <div className="flex gap-2">
              <PhoneInput
                id="owner-test-phone"
                placeholder="(610) 555-0100"
                value={testPhone}
                onChange={setTestPhone}
              />
              <Button variant="outline" onClick={() => void saveTestPhone()} disabled={savingPhone}>
                Save
              </Button>
            </div>
            {phoneError && (
              <p className="text-xs text-destructive" role="alert">
                {phoneError}
              </p>
            )}
          </div>

          {liveNumber ? (
            <div className="space-y-2">
              <p className="text-sm">
                Call{" "}
                <a
                  href={`tel:${liveNumber}`}
                  className="font-medium underline"
                  onClick={startWaiting}
                >
                  {liveNumber}
                </a>{" "}
                from the number above and try one of the scenarios.
              </p>
              {waitingForCall && !testCallDone && (
                <p className="text-sm text-muted-foreground">Waiting for your call to finish…</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your phone number hasn&apos;t been provisioned yet.
            </p>
          )}
        </CardContent>
      </Card>

      {latestCall && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Latest test call</CardTitle>
            {latestCall.classification && (
              <Badge variant="secondary">{latestCall.classification}</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!latestCall.ended_at && (
              <p className="text-sm text-muted-foreground">Call in progress…</p>
            )}
            {latestCall.call_summary && <p className="text-sm">{latestCall.call_summary}</p>}
            {latestCall.message_text && (
              <div className="rounded-md border border-border p-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground">Message taken</p>
                <p className="mt-1">{latestCall.message_text}</p>
              </div>
            )}
            {latestCall.structured_booking_payload && (
              <div className="rounded-md border border-border p-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground">
                  Booking details captured
                </p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(latestCall.structured_booking_payload, null, 2)}
                </pre>
              </div>
            )}
            {normalizeTranscript(latestCall.transcript).length > 0 && (
              <TranscriptViewer turns={normalizeTranscript(latestCall.transcript)} />
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" asChild>
          <Link href="/dashboard/agent/instructions">Adjust instructions</Link>
        </Button>
        {testCallDone && !forwardingVerified && (
          <Button asChild>
            <Link href="/dashboard/phone-setup">Turn on forwarding</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
