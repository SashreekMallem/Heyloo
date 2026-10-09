import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake } from "@/test/fake-supabase";
import { renderWithTenant, stubRoutes } from "@/test/render-with-tenant";

vi.mock("@/lib/supabase/browser", async () => {
  const { fakeClient } = await import("@/test/fake-supabase");
  return { supabaseBrowserClient: fakeClient() };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OUTBOUND_EVENT_TYPES } from "@heyloo/canonical-types";
import { toast } from "sonner";
import {
  destinationHealth,
  normalizeWebhookUrl,
  type WebhookDestination,
  WebhooksCard,
  webhookErrorMessage,
} from "./webhooks-card";

const ZAP_ID = "6f1c1f6e-2f4b-4f5e-9a51-0d6c1a2b3c4d";
const GONE_ID = "7a2d2f6e-2f4b-4f5e-9a51-0d6c1a2b3c4e";

function destination(overrides: Partial<WebhookDestination> = {}): WebhookDestination {
  return {
    id: ZAP_ID,
    name: "Zapier orders",
    url: "https://hooks.zapier.com/hooks/catch/1/abc",
    event_types: ["order.created", "order.cancelled"],
    enabled: true,
    disabled_reason: null,
    consecutive_failures: 0,
    last_success_at: "2026-10-09T17:00:00Z",
    last_failure_at: null,
    last_error: null,
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function seed(
  destinations: WebhookDestination[],
  deliveries: Record<string, unknown>[] = [],
  events: Record<string, unknown>[] = [],
) {
  fake.queue("outbound_destinations:select", { data: destinations, error: null });
  fake.queue("outbound_deliveries:select", { data: deliveries, error: null });
  fake.queue("outbound_events:select", { data: events, error: null });
}

/** The card also GETs `/api/tenant/webhooks` (its write rule) on mount; assertions look at the writes. */
function posts(calls: Array<{ method: string; body: unknown }>) {
  return calls.filter((c) => c.method === "POST");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function delivery(overrides: Record<string, unknown>) {
  return {
    id: "d1",
    destination_id: ZAP_ID,
    event_id: "e1",
    status: "delivered",
    attempt_count: 1,
    next_attempt_at: "2026-10-09T17:00:00Z",
    last_status_code: 200,
    last_error: null,
    delivered_at: "2026-10-09T17:00:01Z",
    created_at: "2026-10-09T17:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  fake.reset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("WebhooksCard (OUTBOUND-1)", () => {
  it("reads destinations and deliveries through RLS with an explicit tenant filter, never the secret id", async () => {
    seed([destination()]);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    expect(await screen.findByText("Zapier orders")).toBeInTheDocument();
    const destinationRead = fake.callsTo("outbound_destinations", "select")[0];
    expect(destinationRead?.columns).not.toContain("signing_secret");
    expect(destinationRead?.filters).toContainEqual(["eq", "tenant_id", "t1"]);
    await waitFor(() =>
      expect(fake.callsTo("outbound_deliveries", "select")[0]?.filters).toEqual(
        expect.arrayContaining([
          ["eq", "tenant_id", "t1"],
          ["limit", 50],
        ]),
      ),
    );
  });

  it("lists a destination's host, health and events, and explains a 410 auto-disable", async () => {
    seed([
      destination(),
      destination({
        id: GONE_ID,
        name: "Old n8n",
        url: "https://n8n.example.com/webhook/x",
        event_types: ["booking.created"],
        enabled: false,
        disabled_reason: "gone_410",
      }),
    ]);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    expect(await screen.findByText("hooks.zapier.com")).toBeInTheDocument();
    expect(screen.getByText(/Working — last delivered/)).toBeInTheDocument();
    expect(screen.getByText("Sends: New order, Order cancelled")).toBeInTheDocument();
    expect(
      screen.getByText(/Turned off: the receiving app said the URL is gone/),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Send events to Old n8n" })).not.toBeChecked();
  });

  it("shows the recent-deliveries log with event names, status and Retry only where it applies", async () => {
    seed(
      [destination()],
      [
        delivery({ id: "d1", event_id: "e1", status: "delivered" }),
        delivery({
          id: "d2",
          event_id: "e2",
          status: "failed",
          attempt_count: 8,
          last_status_code: 500,
          last_error: "HTTP 500",
        }),
      ],
      [
        { id: "e1", event_type: "booking.created" },
        { id: "e2", event_type: "message.taken" },
      ],
    );
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    const table = await screen.findByRole("table");
    const rows = await within(table).findAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(table).getByText("New booking")).toBeInTheDocument();
    expect(within(table).getByText("Message taken")).toBeInTheDocument();
    expect(within(table).getByText("Delivered")).toBeInTheDocument();
    expect(within(table).getByText("Failed")).toBeInTheDocument();
    expect(within(table).getByText("HTTP 500")).toBeInTheDocument();
    expect(within(table).getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(fake.callsTo("outbound_events", "select")[0]?.filters).toContainEqual([
      "in",
      "id",
      ["e1", "e2"],
    ]);
  });

  it("retries a failed delivery", async () => {
    seed(
      [destination()],
      [delivery({ id: "0b9f7a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b", status: "failed" })],
      [{ id: "e1", event_type: "order.created" }],
    );
    const { fetchMock, calls } = stubRoutes({
      "/api/tenant/webhooks": () => ({ body: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(posts(calls)[0]?.body).toEqual({
        action: "retry",
        delivery_id: "0b9f7a8e-1c2d-4e3f-8a9b-0c1d2e3f4a5b",
      }),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("adds a destination (https:// added to a bare host) and shows the signing secret once", async () => {
    seed([]);
    const { fetchMock, calls } = stubRoutes({
      "/api/tenant/webhooks": () => ({
        body: { destination: { id: ZAP_ID, name: "Make" }, signing_secret: "whsec_c2VjcmV0" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    expect(await screen.findByText("No destinations yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add destination" }));
    await userEvent.type(screen.getByLabelText("Name"), "Make");
    await userEvent.type(screen.getByLabelText("Webhook URL"), "hook.us1.make.com/abc");
    await userEvent.click(screen.getByLabelText("Message taken"));
    const form = screen.getByRole("form", { name: "Add a webhook destination" });
    await userEvent.click(within(form).getByRole("button", { name: "Add destination" }));

    await waitFor(() =>
      expect(posts(calls)[0]?.body).toEqual({
        action: "create",
        name: "Make",
        url: "https://hook.us1.make.com/abc",
        event_types: OUTBOUND_EVENT_TYPES.filter((t) => t !== "message.taken"),
      }),
    );
    expect(await screen.findByLabelText("Signing secret")).toHaveValue("whsec_c2VjcmV0");
    expect(screen.getByText(/it won't be shown again/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done, I've saved it" }));
    expect(screen.queryByLabelText("Signing secret")).not.toBeInTheDocument();
  });

  it("refuses an http:// URL and an empty event list before calling the server", async () => {
    seed([]);
    const { fetchMock, calls } = stubRoutes({});
    vi.stubGlobal("fetch", fetchMock);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Add destination" }));
    await userEvent.type(screen.getByLabelText("Name"), "Insecure");
    await userEvent.type(screen.getByLabelText("Webhook URL"), "http://example.com/hook");
    for (const label of [
      "New booking",
      "Booking changed",
      "Booking cancelled",
      "New order",
      "Order status changed",
      "Order cancelled",
      "Message taken",
    ]) {
      await userEvent.click(screen.getByLabelText(label));
    }
    const form = screen.getByRole("form", { name: "Add a webhook destination" });
    await userEvent.click(within(form).getByRole("button", { name: "Add destination" }));
    expect(
      await screen.findByText("Enter a web address that starts with https://"),
    ).toBeInTheDocument();
    expect(screen.getByText("Pick at least one event to send.")).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(0);
  });

  it("sends a test and reports the receiving app's answer", async () => {
    seed([destination()]);
    // The list refetches after the first test; keep the destination there.
    fake.queue("outbound_destinations:select", { data: [destination()], error: null });
    let answer: unknown = { ok: true, status_code: 200, error: null };
    const { fetchMock, calls } = stubRoutes({ "/api/tenant/webhooks": () => ({ body: answer }) });
    vi.stubGlobal("fetch", fetchMock);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Send test" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Test delivered to Zapier orders."),
    );
    expect(posts(calls)[0]?.body).toEqual({ action: "send_test", id: ZAP_ID });

    answer = { ok: false, status_code: 500, error: "HTTP 500" };
    await userEvent.click(await screen.findByRole("button", { name: "Send test" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Test to Zapier orders failed: HTTP 500."),
    );
  });

  it("turns a destination off", async () => {
    seed([destination()]);
    const { fetchMock, calls } = stubRoutes({ "/api/tenant/webhooks": () => ({ body: {} }) });
    vi.stubGlobal("fetch", fetchMock);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    await userEvent.click(
      await screen.findByRole("switch", { name: "Send events to Zapier orders" }),
    );
    await waitFor(() =>
      expect(posts(calls)[0]?.body).toEqual({ action: "update", id: ZAP_ID, enabled: false }),
    );
  });

  it("deletes only after confirming", async () => {
    seed([destination()]);
    const { fetchMock, calls } = stubRoutes({ "/api/tenant/webhooks": () => ({ body: {} }) });
    vi.stubGlobal("fetch", fetchMock);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete Zapier orders?")).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(posts(calls)[0]?.body).toEqual({ action: "delete", id: ZAP_ID }));
  });

  it("rotates the signing secret after confirming and shows the new one", async () => {
    seed([destination()]);
    const { fetchMock, calls } = stubRoutes({
      "/api/tenant/webhooks": () => ({ body: { signing_secret: "whsec_bmV3" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    await userEvent.click(await screen.findByRole("button", { name: "New signing secret" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Make new secret" }));
    await waitFor(() =>
      expect(posts(calls)[0]?.body).toEqual({ action: "rotate_secret", id: ZAP_ID }),
    );
    expect(await screen.findByLabelText("Signing secret")).toHaveValue("whsec_bmV3");
  });

  it("shows a friendly error when the server refuses", async () => {
    seed([destination()]);
    const { fetchMock } = stubRoutes({
      "/api/tenant/webhooks": () => ({ status: 503, body: { error: "webhooks_unavailable" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Send test" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Webhooks are unavailable right now — please try again in a minute.",
      ),
    );
  });

  it("is read-only for a member: no add, test, delete or retry, and the switch is disabled", async () => {
    seed(
      [destination()],
      [delivery({ status: "failed" })],
      [{ id: "e1", event_type: "order.created" }],
    );
    const { fetchMock, calls } = stubRoutes({});
    vi.stubGlobal("fetch", fetchMock);
    renderWithTenant(<WebhooksCard tenantId="t1" />, { canWrite: false });
    expect(await screen.findByText("hooks.zapier.com")).toBeInTheDocument();
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByTestId("read-only-note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add destination" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send test" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Send events to Zapier orders" })).toBeDisabled();
    // A member is already read-only: no need to ask the route.
    expect(calls).toHaveLength(0);
  });

  it.each([
    {
      reason: "read_only_session",
      text: "This support session is read-only — turn on edit mode to change webhooks.",
    },
    {
      reason: "owner_or_admin_required",
      text: "Only your account owner or an admin can change where events are sent.",
    },
  ])(
    "hides every write when the route says this session can't change webhooks ($reason)",
    async ({ reason, text }) => {
      seed(
        [destination()],
        [delivery({ status: "failed" })],
        [{ id: "e1", event_type: "order.created" }],
      );
      const { fetchMock, calls } = stubRoutes({
        "/api/tenant/webhooks": () => ({ body: { can_manage: false, reason } }),
      });
      vi.stubGlobal("fetch", fetchMock);
      // The layout's hint says "can write" (a platform admin, or a support session).
      renderWithTenant(<WebhooksCard tenantId="t1" />, { canWrite: true });
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(await screen.findByText("Failed")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add destination" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Send test" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Send events to Zapier orders" })).toBeDisabled();
      expect(calls.map((c) => c.method)).toEqual(["GET"]);
    },
  );

  it("keeps a row busy until its own action finishes, even when another row's finishes first", async () => {
    const rows = [destination(), destination({ id: GONE_ID, name: "Make orders" })];
    seed(rows);
    for (let i = 0; i < 4; i += 1) {
      fake.queue("outbound_destinations:select", { data: rows, error: null });
    }
    const posted: unknown[] = [];
    const answers: Array<(res: Response) => void> = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return jsonResponse({}, 404);
      posted.push(JSON.parse(String(init.body)));
      return new Promise<Response>((resolve) => answers.push(resolve));
    });
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    const [zapTest, makeTest] = await screen.findAllByRole("button", { name: "Send test" });
    await userEvent.click(zapTest as HTMLElement);
    await userEvent.click(makeTest as HTMLElement);
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted).toEqual([
      { action: "send_test", id: ZAP_ID },
      { action: "send_test", id: GONE_ID },
    ]);

    answers[0]?.(jsonResponse({ ok: true, status_code: 200, error: null }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Test delivered to Zapier orders."),
    );
    const [zapAfter, makeAfter] = screen.getAllByRole("button", { name: "Send test" });
    expect(zapAfter).toBeEnabled();
    expect(makeAfter).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Send events to Make orders" })).toBeDisabled();

    answers[1]?.(jsonResponse({ ok: true, status_code: 200, error: null }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Send test" })[1]).toBeEnabled(),
    );
    expect(posted).toHaveLength(2);
  });

  it("stops offering Add at five destinations", async () => {
    seed(
      Array.from({ length: 5 }, (_, i) =>
        destination({ id: `00000000-0000-4000-8000-00000000000${i}`, name: `Hook ${i}` }),
      ),
    );
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    expect(await screen.findByText("Hook 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add destination" })).toBeDisabled();
    expect(screen.getByText(/You can have up to 5 destinations/)).toBeInTheDocument();
  });
});

describe("signing secret copy button", () => {
  const realClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    if (realClipboard) Object.defineProperty(navigator, "clipboard", realClipboard);
    else Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, "clipboard", { value, configurable: true });
  }

  async function revealSecret() {
    seed([destination()]);
    const { fetchMock } = stubRoutes({
      "/api/tenant/webhooks": () => ({ body: { signing_secret: "whsec_bmV3" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithTenant(<WebhooksCard tenantId="t1" />);
    await userEvent.click(await screen.findByRole("button", { name: "New signing secret" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Make new secret" }));
    return screen.findByLabelText("Signing secret");
  }

  it("says copied only after the clipboard took the secret", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await revealSecret();
    await userEvent.click(screen.getByRole("button", { name: "Copy signing secret" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Secret copied"));
    expect(writeText).toHaveBeenCalledWith("whsec_bmV3");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    {
      why: "the browser refuses the write",
      clipboard: () => ({
        writeText: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")),
      }),
    },
    { why: "there is no clipboard API (non-secure page)", clipboard: () => undefined },
  ])("never says copied when $why, and selects the secret instead", async ({ clipboard }) => {
    setClipboard(clipboard());
    const field = await revealSecret();
    await userEvent.click(screen.getByRole("button", { name: "Copy signing secret" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't copy")),
    );
    expect(toast.success).not.toHaveBeenCalledWith("Secret copied");
    expect(field).toHaveFocus();
    expect(screen.getByLabelText("Signing secret")).toHaveValue("whsec_bmV3");
  });
});

describe("webhooks-card helpers", () => {
  it("normalizeWebhookUrl adds https:// only to a bare host", () => {
    expect(normalizeWebhookUrl(" hooks.zapier.com/x ")).toBe("https://hooks.zapier.com/x");
    expect(normalizeWebhookUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(normalizeWebhookUrl("http://a.example/x")).toBe("http://a.example/x");
    expect(normalizeWebhookUrl("")).toBe("");
  });

  it("destinationHealth explains failing destinations in owner words", () => {
    expect(
      destinationHealth(
        destination({
          consecutive_failures: 3,
          last_failure_at: "2026-10-09T17:00:00Z",
          last_error: "Timed out after 5s",
        }),
      ),
    ).toMatchObject({ tone: "warning", text: expect.stringContaining("Timed out after 5s") });
    expect(destinationHealth(destination({ enabled: false })).text).toBe(
      "Turned off — nothing is sent here.",
    );
    expect(destinationHealth(destination({ last_success_at: null })).tone).toBe("muted");
  });

  it("webhookErrorMessage maps statuses to owner-facing text", () => {
    expect(webhookErrorMessage({ status: 403, error: "owner_or_admin_required" })).toMatch(
      /owner or admin/,
    );
    expect(webhookErrorMessage({ status: 403, error: "read_only_session" })).toMatch(
      /support session is read-only/,
    );
    expect(webhookErrorMessage({ status: 422, error: "invalid_request" })).toMatch(/https:\/\//);
    expect(webhookErrorMessage({ status: 409, error: "destination_limit" })).toBe(
      "You can have up to 5 destinations.",
    );
    expect(webhookErrorMessage({ status: 500, error: "webhooks_failed" })).toBe(
      "Couldn't save — please try again.",
    );
    expect(
      webhookErrorMessage({
        status: 422,
        error: "url_not_allowed",
        body: { error: "url_not_allowed", message: "Use a public address." },
      }),
    ).toBe("Use a public address.");
    expect(webhookErrorMessage({ status: 409, error: "destination_disabled" })).toMatch(
      /back on first/,
    );
    expect(webhookErrorMessage({ status: 409, error: "not_retryable" })).toMatch(
      /can't be retried/,
    );
  });
});
