import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Radix's <Slider> (used by @heyloo/ui's <AudioPlayer>, rendered once a
// signed URL comes back) reads element size via `ResizeObserver` — jsdom
// doesn't implement it and this repo's shared `vitest.setup.ts` has no
// global polyfill, so it's stubbed locally, scoped to this file only.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// Assigned directly (not via `vi.stubGlobal`) so `afterEach`'s
// `vi.unstubAllGlobals()` below — needed to reset the per-test `fetch`
// mock — doesn't also remove it between tests.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import {
  CallDetailClient,
  type CallDetailData,
  keyValueEntries,
  noRecordingMessage,
} from "./call-detail-client";

const BASE: CallDetailData = {
  id: "call-1",
  callerNumber: "+15125551000",
  startedAt: "2026-09-29T15:30:00Z",
  customer: null,
  classification: "new_booking",
  transcript: [],
  stateTrace: [],
  hasStereoRecording: false,
  recordingStatus: "none",
  durationSeconds: 90,
  linkedBookingId: null,
  urgencyFlag: false,
  callSummary: null,
  sentiment: null,
  followUpNeeded: false,
  legalAdviceGiven: false,
  outcome: null,
  messageText: null,
  structuredPayload: null,
  extractedEntities: null,
};

describe("CallDetailClient — recording (DASH-1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the not-available copy when the row has no recording, without ever calling the signing route", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CallDetailClient call={{ ...BASE, recordingStatus: "none" }} />);
    expect(await screen.findByText(/No recording/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the processing copy while still within the retry window, without calling the signing route", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CallDetailClient call={{ ...BASE, recordingStatus: "processing" }} />);
    expect(await screen.findByText(/Still processing/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a graceful 'not available' state when the signing route fails, and never exposes a raw src", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "sign_failed" }), { status: 502 })),
    );
    const { container } = render(<CallDetailClient call={{ ...BASE, recordingStatus: "ready" }} />);
    expect(await screen.findByText(/Recording not available yet/i)).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting NO <audio> is ever mounted (the raw path must never leak into the DOM) has no role/text query equivalent
    expect(container.querySelector("audio")).not.toBeInTheDocument();
  });

  it("fetches a signed URL on mount and renders the player with it once ready", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/tenant/calls/call-1/recording");
      return new Response(JSON.stringify({ url: "https://signed.example/x", expires_in: 300 }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<CallDetailClient call={{ ...BASE, recordingStatus: "ready" }} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- <audio> has no accessible role/text for a Testing-Library query
    await waitFor(() => expect(container.querySelector("audio")).toBeInTheDocument());
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- asserting the signed URL landed on the <audio src>, which has no role/text query equivalent
    expect(container.querySelector("audio")).toHaveAttribute("src", "https://signed.example/x");
  });

  it("also requests the stereo channel when the call has a stereo recording", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return new Response(
          JSON.stringify({ url: "https://signed.example/mono-or-stereo", expires_in: 300 }),
          { status: 200 },
        );
      }),
    );
    render(
      <CallDetailClient call={{ ...BASE, recordingStatus: "ready", hasStereoRecording: true }} />,
    );

    await waitFor(() => expect(requested).toHaveLength(2));
    expect(requested).toContain("/api/tenant/calls/call-1/recording");
    expect(requested).toContain("/api/tenant/calls/call-1/recording?channel=stereo");
  });
});

describe("CallDetailClient — custom question answers (INTAKE-Q-1)", () => {
  it("shows the caller's answers to the owner's questions in their own card, not as [object Object] in 'Captured on the call'", () => {
    render(
      <CallDetailClient
        call={{
          ...BASE,
          structuredPayload: {
            reason: "Consult",
            custom_answers: [
              { question_id: "q_a", question: "What is the gate code?", answer: "4471" },
              { question_id: "q_b", question: "Any pets?", answer: "One dog" },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("Answers to your questions")).toBeInTheDocument();
    expect(screen.getByText("What is the gate code?")).toBeInTheDocument();
    expect(screen.getByText("4471")).toBeInTheDocument();
    expect(screen.getByText("Any pets?")).toBeInTheDocument();
    expect(screen.getByText("One dog")).toBeInTheDocument();
    expect(screen.getByText("Captured on the call")).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it("renders nothing extra when there are no answers", () => {
    render(<CallDetailClient call={{ ...BASE, structuredPayload: { reason: "Consult" } }} />);
    expect(screen.queryByText("Answers to your questions")).not.toBeInTheDocument();
  });

  it("shows only the answers card when the payload holds nothing else", () => {
    render(
      <CallDetailClient
        call={{
          ...BASE,
          structuredPayload: {
            custom_answers: [{ question_id: "q_a", question: "Any pets?", answer: "None" }],
          },
        }}
      />,
    );
    expect(screen.getByText("Answers to your questions")).toBeInTheDocument();
    expect(screen.queryByText("Captured on the call")).not.toBeInTheDocument();
  });
});

describe("CallDetailClient — header (QA-1 F-06)", () => {
  it("identifies the caller by number with date and duration when there is no customer record", () => {
    render(<CallDetailClient call={{ ...BASE, durationSeconds: 62 }} />);
    expect(screen.getByRole("heading", { name: "(512) 555-1000" })).toBeInTheDocument();
    expect(screen.queryByText("Call detail")).not.toBeInTheDocument();
    expect(screen.getByText("1m 2s")).toBeInTheDocument();
    expect(
      screen.getByText(new Date(BASE.startedAt as string).toLocaleString()),
    ).toBeInTheDocument();
  });

  it("uses the customer's name as the title, shows the number and links to the customer", () => {
    render(<CallDetailClient call={{ ...BASE, customer: { id: "cust-9", name: "Jamie Cruz" } }} />);
    expect(screen.getByRole("heading", { name: "Jamie Cruz" })).toBeInTheDocument();
    expect(screen.getByText("(512) 555-1000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View customer" })).toHaveAttribute(
      "href",
      "/dashboard/customers/cust-9",
    );
  });

  it("falls back to 'Unknown caller' with no number", () => {
    render(<CallDetailClient call={{ ...BASE, callerNumber: null, startedAt: null }} />);
    expect(screen.getByRole("heading", { name: "Unknown caller" })).toBeInTheDocument();
    expect(screen.getByText("Call in progress")).toBeInTheDocument();
  });

  it("renders normalised transcript speakers as 'AI assistant' / 'Caller' with real timestamps", () => {
    render(
      <CallDetailClient
        call={{
          ...BASE,
          transcript: [
            { speaker: "AI assistant", text: "Hello, thanks for calling.", ts: 0.5 },
            { speaker: "Caller", text: "I need an appointment.", ts: 75 },
          ],
        }}
      />,
    );
    expect(screen.getByText("AI assistant · 0:00")).toBeInTheDocument();
    expect(screen.getByText("Caller · 1:15")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

describe("CallDetailClient — payload rendering (QA-1 F-18)", () => {
  it("flattens nested objects, hides id fields and never prints [object Object]", () => {
    expect(
      keyValueEntries({
        booking_id: "465a5f63-aaaa-bbbb-cccc-1234567890ab",
        reason: "Consult",
        nested: { inner_value: "x", deeper: { leaf: 3 }, question_id: "q1" },
        tags: ["a", "b"],
        urgent: true,
        empty: "",
      }),
    ).toEqual([
      ["reason", "Consult"],
      ["nested inner value", "x"],
      ["nested deeper leaf", "3"],
      ["tags", "a, b"],
      ["urgent", "Yes"],
    ]);
  });

  it("does not show the raw booking id and deep-links 'View booking' to that booking", () => {
    render(
      <CallDetailClient
        call={{
          ...BASE,
          linkedBookingId: "465a5f63-1111-2222-3333-444455556666",
          structuredPayload: {
            booking_id: "465a5f63-1111-2222-3333-444455556666",
            reason: "Consult",
            nested: { a: "b" },
          },
        }}
      />,
    );
    expect(screen.queryByText(/465a5f63/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
    expect(screen.getByText("nested a")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View booking" })).toHaveAttribute(
      "href",
      "/dashboard/bookings?booking=465a5f63-1111-2222-3333-444455556666",
    );
  });

  it("words the no-recording message by reason instead of claiming 'very short/spam calls aren't archived'", () => {
    expect(noRecordingMessage(4)).toMatch(/ended before there was anything to record/);
    expect(noRecordingMessage(null)).toMatch(/ended before there was anything to record/);
    expect(noRecordingMessage(62)).not.toMatch(/short|spam/i);
    expect(noRecordingMessage(62)).toMatch(/contact support/);
    render(<CallDetailClient call={{ ...BASE, durationSeconds: 62, recordingStatus: "none" }} />);
    expect(screen.queryByText(/very short\/spam/)).not.toBeInTheDocument();
  });
});
