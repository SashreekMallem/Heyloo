"use client";

import { CARRIERS } from "@heyloo/canonical-types";
import { Button, CarrierForwardingCard, Input, Label, WizardStepper } from "@heyloo/ui";
import { Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  BUSINESS_PHONE_ERROR_MESSAGE,
  normalizeBusinessPhone,
} from "@/lib/settings/business-contact";
import { saveErrorMessage, sendJson } from "@/lib/settings/client";
import { formatPhoneDisplay } from "@/lib/settings/format";
import { CARRIER_CODES, CARRIER_LABELS, dialableNumber, displayNumber } from "./carrier-codes";
import { PortInForm } from "./port-in-form";

type Stage = "carrier" | "verify" | "success" | "port_in";
type TestState = "idle" | "starting" | "calling" | "failed";

/** `forwarding-verify` status `reason` -> what the owner should do about it. */
const FAILURE_MESSAGES = {
  answered:
    "Your phone (or its voicemail) picked up instead of forwarding. Check the forwarding code was dialed from your business phone, then try again without answering.",
  no_answer:
    "Your phone rang but never forwarded. The forwarding code may not be active yet — dial it again and retry.",
  busy: "Your line was busy. Try again in a moment.",
  invalid_number: "We couldn't reach that number. Check your business phone number.",
  not_forwarded:
    "The call didn't reach your AI receptionist. Check the forwarding code and try again.",
} as const;

export function forwardingFailureMessage(reason: unknown): string {
  return typeof reason === "string" && reason in FAILURE_MESSAGES
    ? FAILURE_MESSAGES[reason as keyof typeof FAILURE_MESSAGES]
    : FAILURE_MESSAGES.not_forwarded;
}

/** `forwarding-verify` start errors (422/429/502/404) -> plain copy. */
export function forwardingStartErrorMessage(body: {
  error?: unknown;
  retry_after_s?: unknown;
}): string {
  switch (body.error) {
    case "business_phone_missing":
      return "We don't have your business phone yet. Go back, add it, then try again.";
    case "business_phone_not_allowed":
      return "We can only test a US or Canadian business number, and not your Heyloo number itself. Check your business phone number.";
    case "test_in_progress": {
      const wait =
        typeof body.retry_after_s === "number" && body.retry_after_s > 0
          ? `${Math.ceil(body.retry_after_s)} seconds`
          : "a minute";
      return `A test call is already running. Try again in ${wait}.`;
    }
    case "call_failed":
      return "We couldn't place the test call. Try again in a moment.";
    case "tenant_number_not_found":
      return "Your Heyloo number isn't ready yet. Try again in a minute.";
    default:
      return "We couldn't start the test. Try again in a moment.";
  }
}

const NO_TEST_RUNNING_MESSAGE = "The test ended before we got a result. Try again.";

export interface PhoneSetupWizardProps {
  tenantId: string;
  forwardingNumber: string;
  onboarding: boolean;
  forwardingVerifiedAt?: string | null;
  /** `tenants.business_phone` (E.164): the line that forwards here, which the test calls. */
  businessPhone?: string | null;
  /** Status poll cadence (default 3 s); overridable for tests. */
  pollIntervalMs?: number;
  /** Client-side give-up for a test that never reports back (default 120 s). */
  pollTimeoutMs?: number;
}

interface TestResponse {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/**
 * Wall-clock for the poll deadline. Only ever called from the Start click and
 * the poll timer, never during render; kept outside the component so the
 * React Compiler's purity rule doesn't mistake the handlers for render code.
 */
function nowMs(): number {
  return Date.now();
}

async function postForwardingTest(payload: Record<string, unknown>): Promise<TestResponse> {
  const res = await fetch("/api/phone/forwarding-test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, body: body ?? {} };
}

/** Same wizard for signup step 6 and `/dashboard/phone-setup` (FRONTEND_SPEC.md §4.6/§6.7); `onboarding` swaps first-run copy and removes the "skip" framing. */
export function PhoneSetupWizard({
  tenantId,
  forwardingNumber,
  onboarding,
  forwardingVerifiedAt,
  businessPhone,
  pollIntervalMs = 3_000,
  pollTimeoutMs = 120_000,
}: PhoneSetupWizardProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(forwardingVerifiedAt ? "success" : "carrier");
  const [carrier, setCarrier] = useState<(typeof CARRIERS)[number]>("att");
  const [mode, setMode] = useState<"conditional" | "full">("conditional");

  // The business phone: shown prefilled, editable inline, saved server-side
  // (same rules + transfer-number sync as Agent → Business).
  const [savedPhone, setSavedPhone] = useState<string | null>(businessPhone ?? null);
  const [editingPhone, setEditingPhone] = useState(!businessPhone);
  const [phoneInput, setPhoneInput] = useState(
    businessPhone ? formatPhoneDisplay(businessPhone) : "",
  );
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);

  // The forwarding test: START places a call to the business phone from the
  // platform's test line, then STATUS is polled until it reports back.
  const [testState, setTestState] = useState<TestState>("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [callingNumber, setCallingNumber] = useState<string | null>(null);
  const runIdRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopPolling() {
    runIdRef.current += 1;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }
  // Leaving the page (skip, navigation) stops the poll loop.
  useEffect(
    () => () => {
      runIdRef.current += 1;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    },
    [],
  );

  async function saveBusinessPhone(event: FormEvent) {
    event.preventDefault();
    if (!normalizeBusinessPhone(phoneInput)) {
      setPhoneError(BUSINESS_PHONE_ERROR_MESSAGE);
      return;
    }
    setSavingPhone(true);
    setPhoneError(null);
    const result = await sendJson<{ business_phone?: string }>(
      "/api/tenant/settings/business-phone",
      { business_phone: phoneInput },
    );
    setSavingPhone(false);
    const saved = result.body?.business_phone;
    if (!result.ok || !saved) {
      setPhoneError(result.issues[0]?.message ?? saveErrorMessage(result));
      return;
    }
    setSavedPhone(saved);
    setPhoneInput(formatPhoneDisplay(saved));
    setEditingPhone(false);
  }

  function fail(message: string) {
    stopPolling();
    setTestState("failed");
    setTestMessage(message);
  }

  async function startTest() {
    stopPolling();
    const runId = runIdRef.current;
    setTestState("starting");
    setTestMessage(null);
    let res: TestResponse;
    try {
      res = await postForwardingTest({
        tenant_id: tenantId,
        action: "start",
        carrier_hint: carrier,
      });
    } catch {
      if (runId === runIdRef.current) fail(forwardingStartErrorMessage({}));
      return;
    }
    if (runId !== runIdRef.current) return;
    if (!res.ok || res.body["started"] !== true) {
      fail(forwardingStartErrorMessage(res.body));
      return;
    }
    const calling = res.body["calling"];
    setCallingNumber(typeof calling === "string" ? calling : savedPhone);
    setTestState("calling");
    schedulePoll(runId, nowMs() + pollTimeoutMs);
  }

  function schedulePoll(runId: number, deadline: number) {
    pollTimerRef.current = setTimeout(() => void poll(runId, deadline), pollIntervalMs);
  }

  async function poll(runId: number, deadline: number) {
    if (runId !== runIdRef.current) return;
    let res: TestResponse | null = null;
    try {
      res = await postForwardingTest({ tenant_id: tenantId, action: "status" });
    } catch {
      // A dropped poll is not a result: keep asking until the deadline.
    }
    if (runId !== runIdRef.current) return;
    if (res?.ok && res.body["state"] === "verified") {
      stopPolling();
      setTestState("idle");
      setStage("success");
      if (onboarding) setTimeout(() => router.push("/dashboard"), 1800);
      return;
    }
    if (res?.ok && res.body["state"] === "failed") {
      fail(forwardingFailureMessage(res.body["reason"]));
      return;
    }
    if (res?.status === 404 && res.body["error"] === "no_test_running") {
      fail(NO_TEST_RUNNING_MESSAGE);
      return;
    }
    if (nowMs() >= deadline) {
      fail(FAILURE_MESSAGES.not_forwarded);
      return;
    }
    schedulePoll(runId, deadline);
  }

  const steps = ["Carrier", "Codes", "Verify", "Done"];
  const currentIndex =
    stage === "carrier" ? 0 : stage === "verify" ? 2 : stage === "success" ? 3 : 1;

  if (stage === "port_in") {
    return <PortInForm onBack={() => setStage("carrier")} />;
  }

  // Never render forwarding codes without a number: "*71" alone would send the
  // customer's calls nowhere (SIGNUP-BILL-FIX C). The number is bought by the
  // provisioning saga, so until it exists there is nothing to forward to.
  if (!forwardingNumber) {
    return (
      <div className="mx-auto max-w-lg space-y-4 text-center" data-testid="number-not-ready">
        <p className="font-medium">Your phone number isn&apos;t ready yet</p>
        <p className="text-sm text-muted-foreground">
          We&apos;re still setting it up. Forwarding codes appear here as soon as your number is
          assigned, usually within a minute.
        </p>
        <Button variant="outline" onClick={() => router.refresh()}>
          Check again
        </Button>
      </div>
    );
  }

  const testNumber = displayNumber(callingNumber ?? savedPhone ?? "");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <WizardStepper
        steps={steps}
        current={currentIndex}
        completed={Array.from({ length: currentIndex }, (_, i) => i)}
      />

      {onboarding && stage === "carrier" && (
        <p className="text-center text-sm text-muted-foreground">
          Let&apos;s forward your business number — this takes about 2 minutes.
        </p>
      )}

      {stage === "carrier" && (
        <div className="space-y-4">
          {savedPhone && !editingPhone ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Your business phone</p>
                <p className="font-medium" data-testid="business-phone">
                  {formatPhoneDisplay(savedPhone)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Dial the code below from this phone.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPhoneError(null);
                  setEditingPhone(true);
                }}
              >
                Change
              </Button>
            </div>
          ) : (
            <form
              onSubmit={saveBusinessPhone}
              className="space-y-2 rounded-md border border-border p-3"
              noValidate
            >
              <Label htmlFor="business-phone-input">Your business phone</Label>
              {!savedPhone && (
                <p className="text-xs text-muted-foreground">
                  We&apos;ll call this number to test forwarding, and use it when a caller asks for
                  a person.
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  id="business-phone-input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(262) 755-1967"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  aria-invalid={phoneError ? true : undefined}
                  aria-describedby={phoneError ? "business-phone-error" : undefined}
                />
                <Button type="submit" loading={savingPhone}>
                  Save
                </Button>
                {savedPhone && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setPhoneInput(formatPhoneDisplay(savedPhone));
                      setPhoneError(null);
                      setEditingPhone(false);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
              {phoneError && (
                <p id="business-phone-error" className="text-sm text-destructive" role="alert">
                  {phoneError}
                </p>
              )}
            </form>
          )}

          <div className="grid grid-cols-2 gap-2">
            {CARRIERS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCarrier(c)}
                className={`rounded-md border p-3 text-sm ${carrier === c ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"}`}
              >
                {CARRIER_LABELS[c]}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            On a prepaid or other carrier? Pick the network it runs on: Tello, Mint and Metro use
            T-Mobile; Cricket uses AT&amp;T; Visible uses Verizon.
          </p>

          {carrier === "other_landline" ? (
            // Landline phone companies each use their own "forward when unanswered"
            // code, so only forward-all (*72) is offered; a toggle that changed
            // nothing looked broken.
            <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
              The code below forwards <strong>every</strong> call to your AI receptionist. To keep
              your phone ringing first, ask your phone company to turn on &ldquo;call forwarding on
              no answer&rdquo; to {displayNumber(forwardingNumber)}.
            </p>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm">
              <input
                type="checkbox"
                id="full-forward"
                checked={mode === "full"}
                onChange={(e) => setMode(e.target.checked ? "full" : "conditional")}
              />
              <Label htmlFor="full-forward" className="font-normal">
                Forward all calls instead (faster setup, no fallback if our AI is briefly down)
              </Label>
            </div>
          )}

          <CarrierForwardingCard
            carrier={CARRIER_LABELS[carrier]}
            codes={CARRIER_CODES[carrier][carrier === "other_landline" ? "full" : mode]}
            forwardingNumber={dialableNumber(forwardingNumber)}
          />

          <div className="flex gap-3">
            <Button className="flex-1" disabled={!savedPhone} onClick={() => setStage("verify")}>
              I&apos;ve entered the code
            </Button>
          </div>
          {!savedPhone && (
            <div className="space-y-1 text-center">
              <p className="text-xs text-muted-foreground">
                Save your business phone above so we can test forwarding.
              </p>
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground underline"
                onClick={() => router.push("/dashboard")}
              >
                I don&apos;t have another number — skip
              </button>
            </div>
          )}
          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground underline"
            onClick={() => setStage("port_in")}
          >
            Port your number in instead
          </button>
        </div>
      )}

      {stage === "verify" && (
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            We&apos;ll call {testNumber} from our test line. Don&apos;t answer — let it ring until
            it forwards. Your AI receptionist will pick up and say goodbye.
          </p>
          {testState === "calling" ? (
            <p className="flex items-center justify-center gap-2 text-sm font-medium" role="status">
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
              Calling {testNumber}… don&apos;t answer
            </p>
          ) : (
            <Button
              size="lg"
              className="w-full"
              onClick={() => void startTest()}
              loading={testState === "starting"}
            >
              {testState === "failed" ? "Try again" : "Start test"}
            </Button>
          )}
          {testState === "failed" && testMessage && (
            <p className="text-sm text-destructive" role="alert">
              {testMessage}
            </p>
          )}
          {testState !== "calling" && testState !== "starting" && (
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground underline"
              onClick={() => {
                stopPolling();
                setTestState("idle");
                setTestMessage(null);
                setStage("carrier");
              }}
            >
              Back to the forwarding codes
            </button>
          )}
          {onboarding && (
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground underline"
              onClick={() => router.push("/dashboard")}
            >
              Skip for now — go to my dashboard
            </button>
          )}
        </div>
      )}

      {stage === "success" && (
        <div className="space-y-2 text-center">
          <p className="text-lg font-medium text-success">You&apos;re live!</p>
          <p className="text-sm text-muted-foreground">
            Calls to your number now reach your AI receptionist.
          </p>
        </div>
      )}
    </div>
  );
}
