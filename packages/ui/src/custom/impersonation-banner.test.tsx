import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImpersonationBanner } from "./impersonation-banner.js";

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

describe("ImpersonationBanner", () => {
  it("shows read-only state and an 'Enable edits' button when editMode is false", () => {
    const onToggleEdit = vi.fn();
    render(
      <ImpersonationBanner
        tenantName="Acme"
        adminEmail="admin@heyloo.ai"
        expiresAt={futureIso(10)}
        editMode={false}
        onEnd={vi.fn()}
        onToggleEdit={onToggleEdit}
      />,
    );
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Enable edits/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onToggleEdit).toHaveBeenCalledTimes(1);
  });

  it("hides the 'Enable edits' button once editMode is true", () => {
    render(
      <ImpersonationBanner
        tenantName="Acme"
        adminEmail="admin@heyloo.ai"
        expiresAt={futureIso(10)}
        editMode={true}
        onEnd={vi.fn()}
        onToggleEdit={vi.fn()}
      />,
    );
    expect(screen.getByText(/edits enabled/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enable edits/i })).not.toBeInTheDocument();
  });

  it("disables the toggle when no onToggleEdit handler is supplied (e.g. a request already in flight)", () => {
    render(
      <ImpersonationBanner
        tenantName="Acme"
        adminEmail="admin@heyloo.ai"
        expiresAt={futureIso(10)}
        editMode={false}
        onEnd={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Enable edits/i })).toBeDisabled();
  });

  it("calls onEnd when 'End impersonation' is clicked", () => {
    const onEnd = vi.fn();
    render(
      <ImpersonationBanner
        tenantName="Acme"
        adminEmail="admin@heyloo.ai"
        expiresAt={futureIso(10)}
        editMode={false}
        onEnd={onEnd}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /End impersonation/i }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
