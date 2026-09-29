import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { PhoneSetupWizard } = await import("./phone-setup-wizard");

describe("PhoneSetupWizard — never renders a code without a number (SIGNUP-BILL-FIX C)", () => {
  beforeEach(() => refresh.mockReset());

  it("with no number yet shows 'not ready' and no forwarding code (was: a bare '*71')", async () => {
    render(<PhoneSetupWizard tenantId="t1" forwardingNumber="" onboarding />);
    expect(screen.getByTestId("number-not-ready")).toBeInTheDocument();
    expect(screen.queryByText(/\*71/)).not.toBeInTheDocument();
    expect(screen.queryByText(/AT&T forwarding codes/i)).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /check again/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("with a number renders the carrier codes containing that number", () => {
    render(<PhoneSetupWizard tenantId="t1" forwardingNumber="+15551230000" onboarding />);
    expect(screen.queryByTestId("number-not-ready")).not.toBeInTheDocument();
    // QA-1 F-2: AT&T (the preselected carrier) gets its own GSM code and the
    // 10-digit national number, never "+1".
    expect(screen.getByText("*004*5551230000*11#")).toBeInTheDocument();
    expect(screen.getByText("##004#")).toBeInTheDocument();
    expect(screen.queryByText(/\+1/)).not.toBeInTheDocument();
  });

  it("switching carrier shows that carrier's codes", async () => {
    const user = userEvent.setup();
    render(<PhoneSetupWizard tenantId="t1" forwardingNumber="+15551230000" onboarding />);
    await user.click(screen.getByRole("button", { name: "Verizon" }));
    expect(screen.getByText("*715551230000")).toBeInTheDocument();
    expect(screen.getByText("*73")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "T-Mobile" }));
    expect(screen.getByText("**004*5551230000#")).toBeInTheDocument();
  });
});
