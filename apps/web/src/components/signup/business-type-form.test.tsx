import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

const { BusinessTypeForm } = await import("./business-type-form");

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("BusinessTypeForm (F-12)", () => {
  it("shows an error instead of looking dead when saving the draft fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "boom" }, { status: 500 })),
    );
    render(<BusinessTypeForm initialBusinessName="Joe's Garage" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save your details/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the same error when the network call throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    render(<BusinessTypeForm initialBusinessName="Joe's Garage" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("navigates to the plan step when the draft is saved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true })),
    );
    render(<BusinessTypeForm initialBusinessName="Joe's Garage" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signup/plan"));
  });

  it("sends a friendly business phone as E.164 and a bare website with https://", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BusinessTypeForm initialBusinessName="Joe's Garage" />);
    await user.type(screen.getByLabelText("Business phone number"), "262-755-1967");
    await user.type(screen.getByLabelText("Website (optional)"), "joesgarage.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signup/plan"));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      business_type: "generic",
      business_name: "Joe's Garage",
      business_phone: "+12627551967",
      website_url: "https://joesgarage.com",
    });
    // Read back the way we'd say it once the field loses focus.
    expect(screen.getByLabelText("Business phone number")).toHaveValue("(262) 755-1967");
  });

  it("lets the customer continue with no business phone or website (both optional)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BusinessTypeForm initialBusinessName="Brand New Co" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signup/plan"));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.business_phone).toBeUndefined();
    expect(body.website_url).toBeUndefined();
  });

  it("shows a field error and does not submit for an invalid phone or website", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<BusinessTypeForm initialBusinessName="Joe's Garage" />);
    await user.type(screen.getByLabelText("Business phone number"), "755-1967");
    await user.type(screen.getByLabelText("Website (optional)"), "joes garage");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/US or Canadian business number/)).toBeInTheDocument();
    expect(screen.getByText(/Enter your website/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefills the business phone (formatted) and website from the saved draft", () => {
    render(
      <BusinessTypeForm
        initialBusinessName="Joe's Garage"
        initialBusinessPhone="+12627551967"
        initialWebsiteUrl="https://joesgarage.com"
      />,
    );
    expect(screen.getByLabelText("Business phone number")).toHaveValue("(262) 755-1967");
    expect(screen.getByLabelText("Website (optional)")).toHaveValue("https://joesgarage.com");
  });

  it("prefills the business name and vertical from the saved draft", () => {
    render(<BusinessTypeForm initialVertical="dental" initialBusinessName="Bright Smiles" />);
    expect(screen.getByLabelText("Business name")).toHaveValue("Bright Smiles");
    expect(screen.getByRole("button", { name: /dental/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /veterinary/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
