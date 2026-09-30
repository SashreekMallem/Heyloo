import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "@/test/fake-supabase";
import { renderWithTenant, stubRoutes } from "@/test/render-with-tenant";

vi.mock("@/lib/supabase/browser", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { supabaseBrowserClient: fakeClient() };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { OwnerAlertsCard } from "./owner-alerts-card";

beforeEach(() => fake.reset());
afterEach(() => vi.unstubAllGlobals());

describe("OwnerAlertsCard (SETTINGS-1)", () => {
  it("loads saved recipients and explains the transfer-number fallback", async () => {
    fake.queue("agent_configs:select", {
      data: {
        transfer_number: "+16105550122",
        dynamic_variable_overrides: {
          delivery: {
            sms_enabled: true,
            email_enabled: false,
            notification_email: "o@example.com",
          },
        },
      },
      error: null,
    });
    renderWithTenant(<OwnerAlertsCard tenantId="t1" />);
    expect(await screen.findByLabelText("Alert email")).toHaveValue("o@example.com");
    expect(screen.getByText(/use your transfer number, \(610\) 555-0122/)).toBeInTheDocument();
  });

  it("MSG-3: says texting is off until it's set up, and does not warn about a missing phone to text", async () => {
    fake.queue("agent_configs:select", {
      data: { transfer_number: null, dynamic_variable_overrides: {} },
      error: null,
    });
    renderWithTenant(<OwnerAlertsCard tenantId="t1" />);
    expect(
      await screen.findByText(/Texting is off until it's set up, so every alert is emailed to you/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no phone to text yet/)).not.toBeInTheDocument();
  });

  it("MSG-3: once carriers approve texting the off-notice goes away", async () => {
    fake.queue("agent_configs:select", {
      data: { transfer_number: null, dynamic_variable_overrides: {} },
      error: null,
    });
    renderWithTenant(<OwnerAlertsCard tenantId="t1" textingOn />);
    expect(await screen.findByLabelText("Alert email")).toBeInTheDocument();
    expect(screen.queryByText(/Texting is off until it's set up/)).not.toBeInTheDocument();
  });

  it("QA-1 F-17: warns when both text and email alerts are off, and only then", async () => {
    fake.queue("agent_configs:select", {
      data: {
        transfer_number: null,
        dynamic_variable_overrides: { delivery: { sms_enabled: false, email_enabled: true } },
      },
      error: null,
    });
    renderWithTenant(<OwnerAlertsCard tenantId="t1" textingOn />);
    await screen.findByLabelText("Alert email");
    expect(screen.queryByText(/Both text and email alerts are off/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Email me" }));
    expect(await screen.findByText(/Both text and email alerts are off/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Text me" }));
    expect(screen.queryByText(/Both text and email alerts are off/)).not.toBeInTheDocument();
  });

  it("QA-1 F-5: a member sees the alert settings read-only (disabled, no Save)", async () => {
    fake.queue("agent_configs:select", {
      data: { transfer_number: null, dynamic_variable_overrides: {} },
      error: null,
    });
    renderWithTenant(<OwnerAlertsCard tenantId="t1" textingOn />, { canWrite: false });
    expect(await screen.findByTestId("read-only-note")).toBeInTheDocument();
    expect(screen.getByLabelText("Alert email")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Text me" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save alert settings" })).not.toBeInTheDocument();
  });

  it("blocks an invalid email inline without calling the route", async () => {
    fake.queue("agent_configs:select", {
      data: { transfer_number: null, dynamic_variable_overrides: {} },
      error: null,
    });
    const routes = stubRoutes({
      "/api/tenant/settings/notifications": () => ({ body: { ok: true } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<OwnerAlertsCard tenantId="t1" textingOn />);
    await userEvent.click(await screen.findByLabelText("Alert email"));
    await userEvent.paste("not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Save alert settings" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(routes.calls).toHaveLength(0);
    // No transfer number and no alert phone: the owner is warned texts have nowhere to go.
    expect(screen.getByText(/no phone to text yet/)).toBeInTheDocument();
  });

  it("posts the alert phone as typed-then-normalized E.164 and the email", async () => {
    fake.queue("agent_configs:select", {
      data: { transfer_number: null, dynamic_variable_overrides: {} },
      error: null,
    });
    const routes = stubRoutes({
      "/api/tenant/settings/notifications": () => ({ body: { ok: true } }),
    });
    vi.stubGlobal("fetch", routes.fetchMock);
    renderWithTenant(<OwnerAlertsCard tenantId="t1" />);
    await userEvent.click(await screen.findByLabelText("Alert phone"));
    await userEvent.paste("6105550199");
    await userEvent.click(screen.getByLabelText("Alert email"));
    await userEvent.paste("owner@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Save alert settings" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(routes.calls[0]?.body).toEqual({
      sms_enabled: true,
      email_enabled: true,
      alert_phone: "+16105550199",
      notification_email: "owner@example.com",
    });
  });
});
