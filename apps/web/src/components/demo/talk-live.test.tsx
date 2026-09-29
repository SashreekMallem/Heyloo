import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { TalkLive } = await import("./talk-live");
const { DemoCallGrantError } = await import("./use-demo-call");
type DemoWebClient = import("./use-demo-call").DemoWebClient;

class FakeClient implements DemoWebClient {
  handlers = new Map<string, (payload?: unknown) => void>();
  startCall = vi.fn(async () => {
    this.emit("call_started");
  });
  stopCall = vi.fn();
  on(event: string, listener: (payload?: unknown) => void) {
    this.handlers.set(event, listener);
    return this;
  }
  emit(event: string, payload?: unknown) {
    act(() => this.handlers.get(event)?.(payload));
  }
}

function setMic(impl: (() => Promise<unknown>) | null) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: impl ? { getUserMedia: impl } : undefined,
  });
}

let client: FakeClient;

function renderTalk(props: Partial<React.ComponentProps<typeof TalkLive>> = {}) {
  client = new FakeClient();
  return render(
    <TalkLive
      fetchGrant={async () => ({ token: "tok_1" })}
      loadClient={async () => client}
      {...props}
    />,
  );
}

beforeEach(() => {
  setMic(async () => ({ getTracks: () => [] }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TalkLive: before the call", () => {
  it("prints the AI + recording disclosure and the time limit before the button is pressed", () => {
    renderTalk();
    const card = screen.getByTestId("talk-live");
    expect(within(card).getByText(/talking to an AI assistant/)).toHaveTextContent("recorded");
    expect(within(card).getByText(/microphone/)).toBeInTheDocument();
    expect(within(card).getByText(/2 minutes/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /Talk to Heyloo/ })).toBeEnabled();
    expect(within(card).getByText("Ready when you are.")).toBeInTheDocument();
  });

  it("always offers the demo page, and the phone number when one is configured", () => {
    const { unmount } = renderTalk({ demoPhone: "+15125550100" });
    expect(screen.getByRole("link", { name: "(512) 555-0100" })).toHaveAttribute(
      "href",
      "tel:+15125550100",
    );
    expect(screen.getByRole("link", { name: /own business/ })).toHaveAttribute("href", "/demo");
    unmount();
    renderTalk();
    expect(screen.queryByRole("link", { name: /555/ })).toBeNull();
    expect(screen.getByRole("link", { name: /own business/ })).toHaveAttribute("href", "/demo");
  });
});

describe("TalkLive: a call", () => {
  it("goes connecting, live (with countdown and live transcript), then ends on request", async () => {
    const user = userEvent.setup();
    renderTalk();
    await user.click(screen.getByRole("button", { name: /Talk to Heyloo/ }));

    await screen.findByText("Listening. Go ahead and talk.");
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByTestId("talk-clock")).toHaveTextContent(/^1:5\d left$/);
    expect(client.startCall).toHaveBeenCalledWith({ accessToken: "tok_1" });

    client.emit("update", {
      transcript: [
        { role: "agent", content: "Thanks for calling Riverside Auto Repair." },
        { role: "user", content: "Do you fix brakes?" },
      ],
    });
    const log = screen.getByRole("log", { name: "Live transcript" });
    expect(within(log).getByText("Thanks for calling Riverside Auto Repair.")).toBeInTheDocument();
    expect(within(log).getByText("Do you fix brakes?")).toBeInTheDocument();
    expect(within(log).getByText("Heyloo")).toBeInTheDocument();
    expect(within(log).getByText("You")).toBeInTheDocument();

    client.emit("agent_start_talking");
    expect(screen.getByText("Heyloo is speaking.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "End call" }));
    expect(screen.getByText(/Call ended/)).toBeInTheDocument();
    expect(client.stopCall).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Talk again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
    // the transcript stays readable after the call
    expect(screen.getByRole("log")).toBeInTheDocument();
  });

  it("shows the time limit message when the hard limit hangs up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTalk();
    await user.click(screen.getByRole("button", { name: /Talk to Heyloo/ }));
    await screen.findByText("Listening. Go ahead and talk.");
    await act(async () => {
      vi.advanceTimersByTime(117_000);
    });
    expect(await screen.findByText(/2 minute limit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Talk again" })).toBeInTheDocument();
  });

  it("can be cancelled while it is still connecting", async () => {
    const user = userEvent.setup();
    let release: (v: { token: string }) => void = () => {};
    renderTalk({ fetchGrant: () => new Promise((resolve) => (release = resolve)) });
    await user.click(screen.getByRole("button", { name: /Talk to Heyloo/ }));
    expect(await screen.findByRole("button", { name: "Connecting…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => release({ token: "late" }));
    expect(client.startCall).not.toHaveBeenCalled();
  });
});

describe("TalkLive: when it cannot start", () => {
  it("microphone blocked: says how to fix it, keeps the phone and demo page, lets them retry", async () => {
    setMic(async () => {
      throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
    });
    const user = userEvent.setup();
    renderTalk({ demoPhone: "+15125550100" });
    await user.click(screen.getByRole("button", { name: /Talk to Heyloo/ }));
    expect(await screen.findByText(/Microphone access is blocked/)).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "(512) 555-0100" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /own business/ })).toHaveAttribute("href", "/demo");
    expect(screen.getByRole("button", { name: "Talk again" })).toBeEnabled();
  });

  it("no microphone", async () => {
    setMic(async () => {
      throw Object.assign(new Error("none"), { name: "NotFoundError" });
    });
    const user = userEvent.setup();
    renderTalk();
    await user.click(screen.getByRole("button", { name: /Talk to Heyloo/ }));
    expect(await screen.findByText(/No microphone was found/)).toBeInTheDocument();
  });

  it("unsupported browser: no start button, the phone and demo page remain", async () => {
    setMic(null);
    const user = userEvent.setup();
    renderTalk({ demoPhone: "+15125550100" });
    await user.click(screen.getByRole("button", { name: /Talk to Heyloo/ }));
    expect(await screen.findByText(/can’t start a voice call/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Talk/ })).toBeNull();
    expect(screen.getByRole("link", { name: "(512) 555-0100" })).toBeInTheDocument();
  });

  it("rate limited", async () => {
    const user = userEvent.setup();
    renderTalk({
      fetchGrant: async () => {
        throw new DemoCallGrantError("rate-limited");
      },
    });
    await user.click(screen.getByRole("button", { name: /Talk to Heyloo/ }));
    expect(await screen.findByText(/A lot of people are talking to Heyloo/)).toBeInTheDocument();
  });

  it("token service down", async () => {
    const user = userEvent.setup();
    renderTalk({
      fetchGrant: async () => {
        throw new DemoCallGrantError("unavailable");
      },
    });
    await user.click(screen.getByRole("button", { name: /Talk to Heyloo/ }));
    expect(await screen.findByText(/isn’t available right now/)).toBeInTheDocument();
  });

  it("SDK failure mid-call", async () => {
    const user = userEvent.setup();
    renderTalk();
    await user.click(screen.getByRole("button", { name: /Talk to Heyloo/ }));
    await screen.findByText("Listening. Go ahead and talk.");
    client.emit("error", "Error starting call");
    expect(await screen.findByText(/didn’t connect/)).toBeInTheDocument();
  });
});
