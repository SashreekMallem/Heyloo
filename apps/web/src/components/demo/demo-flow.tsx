"use client";

import {
  type DemoRequest,
  demoEmailCaptureSchema,
  demoRequestSchema,
} from "@heyloo/canonical-types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mic, PhoneCall } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";

type AgentSummary = { business_name: string; hours_detected: string; services_detected: string[] };

type Step =
  | { name: "form" }
  | { name: "loading" }
  | { name: "scrape_failed" }
  | { name: "confirm"; demoSessionId: string; summary: AgentSummary }
  | {
      name: "active";
      demoSessionId: string;
      callToken: string;
      demoPhone: string;
      summary: AgentSummary;
    };

type CallState = "idle" | "requesting-mic" | "connecting" | "active" | "ended" | "error";

/** Multi-step client state machine hosting the whole `/demo` flow inside one route (FRONTEND_SPEC.md §3.4). */
export function DemoFlow({ initialVertical }: { initialVertical?: string | undefined }) {
  const [step, setStep] = useState<Step>({ name: "form" });

  const form = useForm<DemoRequest>({
    resolver: zodResolver(demoRequestSchema),
    defaultValues: { business_name: "", website_url: "" },
  });

  async function onSubmit(values: DemoRequest) {
    setStep({ name: "loading" });
    try {
      const res = await fetch("/api/demo/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, vertical: initialVertical }),
      });
      if (!res.ok) {
        setStep({ name: "scrape_failed" });
        return;
      }
      const body = (await res.json()) as { demo_session_id: string; agent_summary: AgentSummary };
      setStep({
        name: "confirm",
        demoSessionId: body.demo_session_id,
        summary: body.agent_summary,
      });
    } catch {
      setStep({ name: "scrape_failed" });
    }
  }

  if (step.name === "form" || step.name === "scrape_failed") {
    return (
      <div className="mx-auto max-w-md">
        {step.name === "scrape_failed" && (
          <ErrorState
            className="mb-6"
            message="We couldn't read that site — try the URL again, or just tell us about your business below."
          />
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="business_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Business name</FormLabel>
                  <FormControl>
                    <Input placeholder="Riverside Auto Repair" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="website_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" size="lg">
              Build my demo agent
            </Button>
          </form>
        </Form>
      </div>
    );
  }

  if (step.name === "loading") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
        <Loader2 className="size-8 animate-spin text-primary" />
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Reading your website…</p>
          <p>Finding your services…</p>
          <p>Sanitizing scraped content…</p>
          <p>Building your AI receptionist…</p>
        </div>
      </div>
    );
  }

  if (step.name === "confirm") {
    return (
      <ConfirmStep
        demoSessionId={step.demoSessionId}
        summary={step.summary}
        onActivate={(callToken, demoPhone, summary) =>
          setStep({
            name: "active",
            demoSessionId: step.demoSessionId,
            callToken,
            demoPhone,
            summary,
          })
        }
      />
    );
  }

  return (
    <ActiveStep
      demoSessionId={step.demoSessionId}
      callToken={step.callToken}
      demoPhone={step.demoPhone}
      summary={step.summary}
    />
  );
}

function ConfirmStep({
  demoSessionId,
  summary,
  onActivate,
}: {
  demoSessionId: string;
  summary: AgentSummary;
  onActivate: (callToken: string, demoPhone: string, summary: AgentSummary) => void;
}) {
  const [businessName, setBusinessName] = useState(summary.business_name);
  const [hours, setHours] = useState(summary.hours_detected);
  const [services, setServices] = useState(summary.services_detected.join(", "));
  const [activating, setActivating] = useState(false);
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function activate() {
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    setActivating(true);
    const edits = {
      business_name: businessName,
      hours_detected: hours,
      services_detected: services
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    try {
      const res = await fetch("/api/demo/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ demo_session_id: demoSessionId, edits }),
      });
      const body = (await res.json()) as {
        retell_call_token?: string;
        demo_phone_e164?: string;
        agent_summary?: AgentSummary;
      };
      if (!res.ok || !body.retell_call_token || !body.demo_phone_e164) {
        toast.error("We couldn't activate your demo — please try again.");
        setActivating(false);
        return;
      }
      onActivate(body.retell_call_token, body.demo_phone_e164, body.agent_summary ?? edits);
    } catch {
      toast.error("We couldn't activate your demo — please try again.");
      setActivating(false);
    }
  }

  // Auto-advance after ~8s of no interaction (FRONTEND_SPEC.md §3.4).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-once; activate is recreated every render
  useEffect(() => {
    autoAdvanceRef.current = setTimeout(() => {
      void activate();
    }, 8000);
    return () => {
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-once; activate is recreated every render
  }, []);

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Here&apos;s what we found — anything wrong?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label htmlFor="demo-business-name" className="block space-y-1 text-sm">
          <span className="font-medium">Business name</span>
          <Input
            id="demo-business-name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </label>
        <label htmlFor="demo-hours" className="block space-y-1 text-sm">
          <span className="font-medium">Hours</span>
          <Input id="demo-hours" value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <label htmlFor="demo-services" className="block space-y-1 text-sm">
          <span className="font-medium">Services (comma-separated)</span>
          <Input
            id="demo-services"
            value={services}
            onChange={(e) => setServices(e.target.value)}
          />
        </label>
        <Button className="w-full" size="lg" disabled={activating} onClick={activate}>
          Looks good, activate my demo
        </Button>
      </CardContent>
    </Card>
  );
}

function ActiveStep({
  demoSessionId,
  callToken,
  demoPhone,
  summary,
}: {
  demoSessionId: string;
  callToken: string;
  demoPhone: string;
  summary: AgentSummary;
}) {
  const [callState, setCallState] = useState<CallState>("idle");
  const clientRef = useRef<import("retell-client-js-sdk").RetellWebClient | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [email, setEmail] = useState("");

  async function startCall() {
    setCallState("requesting-mic");
    try {
      const { RetellWebClient } = await import("retell-client-js-sdk");
      const client = new RetellWebClient();
      clientRef.current = client;
      client.on("call_started", () => setCallState("active"));
      client.on("call_ended", () => setCallState("ended"));
      client.on("error", () => setCallState("error"));
      setCallState("connecting");
      await client.startCall({ accessToken: callToken });
    } catch {
      setCallState("error");
    }
  }

  function endCall() {
    clientRef.current?.stopCall();
    setCallState("ended");
  }

  async function submitEmail() {
    const parsed = demoEmailCaptureSchema.safeParse({ email });
    if (!parsed.success) {
      toast.error("Enter a valid email address.");
      return;
    }
    await fetch("/api/demo/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, demo_session_id: demoSessionId }),
    });
    setEmailSent(true);
    toast.success("We'll send you a link to this demo.");
  }

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>{summary.business_name}&apos;s AI receptionist is ready</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Talk to it right in your browser, or call the demo number yourself.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              className="flex-1"
              onClick={startCall}
              disabled={callState === "connecting" || callState === "active"}
            >
              <Mic className="size-4" />
              {callState === "active" ? "Call in progress…" : "Talk to it now"}
            </Button>
            <Button size="lg" variant="outline" className="flex-1" asChild>
              <a href={`tel:${demoPhone}`}>
                <PhoneCall className="size-4" /> {demoPhone}
              </a>
            </Button>
          </div>
          {callState === "active" && (
            <Button variant="ghost" onClick={endCall}>
              End call
            </Button>
          )}
          {callState === "error" && (
            <ErrorState message="We couldn't start the web call — try calling the demo number instead." />
          )}
          {callState === "requesting-mic" && (
            <p className="text-xs text-muted-foreground">
              Allow microphone access in your browser to talk to the demo.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email me this demo</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          {emailSent ? (
            <p className="text-sm text-success">Sent — check your inbox shortly.</p>
          ) : (
            <>
              <Input
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button onClick={submitEmail}>Send</Button>
            </>
          )}
        </CardContent>
      </Card>

      <div className="text-center">
        <Button size="lg" asChild>
          <Link href={`/signup?demo_id=${demoSessionId}`}>Sign up with this agent</Link>
        </Button>
      </div>
    </div>
  );
}
