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
    expect(screen.getByText("*71+15551230000")).toBeInTheDocument();
  });
});
