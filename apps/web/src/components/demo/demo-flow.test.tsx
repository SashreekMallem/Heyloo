import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const { DemoFlow } = await import("./demo-flow");

afterEach(() => {
  vi.unstubAllGlobals();
});

async function submitForm(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "not_configured" }, { status })),
  );
  const user = userEvent.setup();
  render(<DemoFlow />);
  await user.type(screen.getByLabelText("Business name"), "Acme Auto");
  await user.type(screen.getByLabelText("Website URL"), "https://acme.example");
  await user.click(screen.getByRole("button", { name: "Build my demo agent" }));
}

describe("DemoFlow: building a demo from a website", () => {
  it("says building from a website is unavailable, not that the URL was bad, when the server is not configured for it", async () => {
    await submitForm(503);
    expect(await screen.findByText(/isn't available right now/)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't read that site/)).toBeNull();
  });

  it("still blames the site for an ordinary failure", async () => {
    await submitForm(502);
    expect(await screen.findByText(/couldn't read that site/)).toBeInTheDocument();
  });
});

const summary = {
  business_name: "Acme Auto",
  hours_detected: "Mon-Fri 8-5",
  services_detected: ["Oil change", "Brakes"],
};

async function reachConfirmStep(confirmBody: unknown = { error: "nope" }, confirmStatus = 500) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === "/api/demo/generate") {
      return Response.json({ demo_session_id: "s1", agent_summary: summary });
    }
    return Response.json(confirmBody, { status: confirmStatus });
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = vi.isFakeTimers()
    ? userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    : userEvent.setup();
  render(<DemoFlow />);
  await user.type(screen.getByLabelText("Business name"), "Acme Auto");
  await user.type(screen.getByLabelText("Website URL"), "https://acme.example");
  await user.click(screen.getByRole("button", { name: "Build my demo agent" }));
  await screen.findByText(/anything wrong\?/);
  return { fetchMock, user };
}

describe("DemoFlow confirm step (F-10, F-11, SEC-06)", () => {
  afterEach(() => vi.useRealTimers());

  it("does not auto-activate after 8 seconds, so typed edits are never discarded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchMock } = await reachConfirmStep();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/demo/confirm")).toHaveLength(0);
  });

  it("sends the edited values when the visitor confirms", async () => {
    const { fetchMock, user } = await reachConfirmStep();
    const name = screen.getByLabelText("Business name");
    await user.clear(name);
    await user.type(name, "Acme Motors");
    await user.click(screen.getByRole("button", { name: /looks good/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => u === "/api/demo/confirm")).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([u]) => u === "/api/demo/confirm");
    const sent = JSON.parse(String(call?.[1]?.body)) as {
      edits: { business_name: string };
    };
    expect(sent.edits.business_name).toBe("Acme Motors");
  });

  it("no longer promises an emailed link the server can't send", async () => {
    const { user } = await reachConfirmStep(
      { retell_call_token: "tok", demo_phone_e164: "+15555550100", agent_summary: summary },
      200,
    );
    await user.click(screen.getByRole("button", { name: /looks good/i }));
    await screen.findByText(/AI receptionist is ready/);
    expect(screen.queryByText(/email me this demo/i)).toBeNull();
    expect(screen.queryByPlaceholderText("you@example.com")).toBeNull();
  });
});
