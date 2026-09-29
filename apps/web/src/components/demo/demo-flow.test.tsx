import { render, screen } from "@testing-library/react";
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
