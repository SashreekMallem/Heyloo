import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { ResumeCheckoutClient } = await import("./resume-checkout-client");

describe("ResumeCheckoutClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts Checkout once with the plan saved before the email trip, and says where it is going", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "x" }, { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ResumeCheckoutClient annual={false} whiteGlove={true} businessName="Joe's Garage" />);
    expect(screen.getByRole("status")).toHaveTextContent("Joe's Garage");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/checkout/session");
    expect(JSON.parse(String(init.body))).toMatchObject({ annual: false, white_glove: true });
  });

  it("shows the failure and retries on request instead of dead-ending", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "checkout_failed" }, { status: 502 }))
      .mockResolvedValue(Response.json({ error: "checkout_failed" }, { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ResumeCheckoutClient annual={false} whiteGlove={false} businessName="Joe's Garage" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't start the payment step/i);
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
