import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { PortInForm } from "./port-in-form";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast.error).mockClear();
});

describe("PortInForm (QA-1 F-15)", () => {
  it("has a label for every field and no PIN field", () => {
    render(<PortInForm onBack={() => {}} />);
    expect(screen.getByLabelText("Current business number")).toBeInTheDocument();
    expect(screen.getByLabelText("Current carrier")).toBeInTheDocument();
    expect(screen.getByLabelText("Carrier account number")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/PIN/i)).not.toBeInTheDocument();
    expect(screen.getByText(/don't need to enter your account PIN/)).toBeInTheDocument();
  });

  it("shows per-field errors instead of one generic toast, and sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PortInForm onBack={() => {}} />);
    await userEvent.type(screen.getByLabelText("Current business number"), "12345");
    await userEvent.click(screen.getByRole("button", { name: "Request port-in" }));
    expect(await screen.findByText(/Enter a full phone number/)).toBeInTheDocument();
    expect(screen.getByText("Account number is required.")).toBeInTheDocument();
    expect(screen.getByText("Choose your current carrier.")).toBeInTheDocument();
    expect(screen.getByLabelText("Current business number")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("posts the number as E.164 with carrier and account number, then confirms honestly", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<PortInForm onBack={() => {}} />);
    await userEvent.type(screen.getByLabelText("Current business number"), "(610) 555-0122");
    await userEvent.selectOptions(screen.getByLabelText("Current carrier"), "verizon");
    await userEvent.type(screen.getByLabelText("Carrier account number"), "998877");
    await userEvent.click(screen.getByRole("button", { name: "Request port-in" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/phone/port-in");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      current_number: "+16105550122",
      account_number: "998877",
      carrier: "verizon",
    });
    expect(await screen.findByText("Port-in requested")).toBeInTheDocument();
    expect(screen.getByText(/ask for your carrier account PIN securely/)).toBeInTheDocument();
  });

  it("maps a server 422 back onto the field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "invalid_request",
              issues: [{ path: ["account_number"], message: "Account number is required" }],
            }),
            { status: 422 },
          ),
      ),
    );
    render(<PortInForm onBack={() => {}} />);
    await userEvent.type(screen.getByLabelText("Current business number"), "6105550122");
    await userEvent.selectOptions(screen.getByLabelText("Current carrier"), "att");
    await userEvent.type(screen.getByLabelText("Carrier account number"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Request port-in" }));
    expect(await screen.findByText("Account number is required")).toBeInTheDocument();
  });
});
