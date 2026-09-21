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

import { CallDetailClient, type CallDetailData } from "./call-detail-client";

const BASE: CallDetailData = {
  id: "call-1",
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
    expect(await screen.findByText(/No recording for this call/i)).toBeInTheDocument();
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
