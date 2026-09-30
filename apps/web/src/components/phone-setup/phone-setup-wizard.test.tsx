import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { PhoneSetupWizard, forwardingFailureMessage } = await import("./phone-setup-wizard");

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

  it("landline: no do-nothing toggle — explains *72 forwards every call and how to keep ringing first", async () => {
    const user = userEvent.setup();
    render(<PhoneSetupWizard tenantId="t1" forwardingNumber="+12627551967" onboarding />);
    expect(screen.getByLabelText(/forward all calls instead/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Other / landline" }));
    expect(screen.queryByLabelText(/forward all calls instead/i)).not.toBeInTheDocument();
    expect(screen.getByText(/call forwarding on no answer/i)).toHaveTextContent("(262) 755-1967");
    expect(screen.getByText("*722627551967")).toBeInTheDocument();
  });

  it("keeps the prepaid-carrier hint", () => {
    render(<PhoneSetupWizard tenantId="t1" forwardingNumber="+15551230000" onboarding />);
    expect(screen.getByText(/Cricket uses AT&T/)).toBeInTheDocument();
  });
});

type Reply = { status?: number; body: unknown };

/** Routes the wizard's fetches: forwarding-test by `action`, business-phone saves by URL. */
function stubApi(handlers: {
  start?: () => Reply;
  status?: Reply[];
  save?: (body: Record<string, unknown>) => Reply;
}) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const statusQueue = [...(handlers.status ?? [])];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    let reply: Reply = { status: 500, body: {} };
    if (url === "/api/tenant/settings/business-phone" && handlers.save) {
      reply = handlers.save(body);
    } else if (url === "/api/phone/forwarding-test" && body["action"] === "start") {
      if (handlers.start) reply = handlers.start();
    } else if (url === "/api/phone/forwarding-test" && body["action"] === "status") {
      // The last queued reply repeats.
      reply = (statusQueue.length > 1 ? statusQueue.shift() : statusQueue[0]) ?? reply;
    }
    return Response.json(reply.body, { status: reply.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const STARTED: Reply = {
  body: { started: true, calling: "+12627551967", expires_at: "2026-09-30T16:02:00Z" },
};

function renderWizard(props: Partial<Parameters<typeof PhoneSetupWizard>[0]> = {}) {
  return render(
    <PhoneSetupWizard
      tenantId="t1"
      forwardingNumber="+15551230000"
      onboarding
      businessPhone="+12627551967"
      pollIntervalMs={5}
      {...props}
    />,
  );
}

describe("PhoneSetupWizard — business phone on the carrier step", () => {
  beforeEach(() => push.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("shows the saved business phone formatted, and proceeds to verify", async () => {
    const user = userEvent.setup();
    renderWizard();
    expect(screen.getByTestId("business-phone")).toHaveTextContent("(262) 755-1967");
    await user.click(screen.getByRole("button", { name: /entered the code/i }));
    expect(screen.getByRole("button", { name: "Start test" })).toBeInTheDocument();
  });

  it("with no business phone: explains why, blocks verify until saved, and offers a skip", async () => {
    const user = userEvent.setup();
    renderWizard({ businessPhone: null });
    expect(
      screen.getByText(/call this number to test forwarding, and use it when a caller asks/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /entered the code/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /don.t have another number/i }));
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("saves a friendly number through the settings route, then lets the owner continue", async () => {
    const user = userEvent.setup();
    const api = stubApi({ save: () => ({ body: { ok: true, business_phone: "+12627551967" } }) });
    renderWizard({ businessPhone: null });
    await user.type(screen.getByLabelText("Your business phone"), "262-755-1967");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("business-phone")).toHaveTextContent("(262) 755-1967");
    expect(api.calls[0]).toEqual({
      url: "/api/tenant/settings/business-phone",
      body: { business_phone: "262-755-1967" },
    });
    expect(screen.getByRole("button", { name: /entered the code/i })).toBeEnabled();
  });

  it("rejects an invalid number inline without a request, and shows a server-side issue", async () => {
    const user = userEvent.setup();
    const api = stubApi({
      save: () => ({
        status: 422,
        body: {
          error: "invalid_request",
          issues: [{ path: ["business_phone"], message: "That's your Heyloo number." }],
        },
      }),
    });
    renderWizard({ businessPhone: null });
    const input = screen.getByLabelText("Your business phone");
    await user.type(input, "755-1967");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/US or Canadian business number/);
    expect(api.calls).toHaveLength(0);

    await user.clear(input);
    await user.type(input, "555-223-0000");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That's your Heyloo number.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /entered the code/i })).toBeDisabled();
  });

  it("can change a saved number inline", async () => {
    const user = userEvent.setup();
    stubApi({ save: () => ({ body: { ok: true, business_phone: "+14145550100" } }) });
    renderWizard();
    await user.click(screen.getByRole("button", { name: "Change" }));
    const input = screen.getByLabelText("Your business phone");
    expect(input).toHaveValue("(262) 755-1967");
    await user.clear(input);
    await user.type(input, "(414) 555-0100");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("business-phone")).toHaveTextContent("(414) 555-0100");
  });
});

describe("PhoneSetupWizard — verify step (start + poll)", () => {
  beforeEach(() => push.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  async function toVerify() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /entered the code/i }));
    return user;
  }

  it("idle: explains the outbound test call and keeps the skip link", async () => {
    renderWizard();
    await toVerify();
    expect(
      screen.getByText(
        "We'll call (262) 755-1967 from our test line. Don't answer — let it ring until it forwards. Your AI receptionist will pick up and say goodbye.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start test" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
  });

  it("start -> calling (spinner) -> pending -> verified: shows the success state", async () => {
    const api = stubApi({
      start: () => STARTED,
      status: [{ body: { state: "pending" } }, { body: { state: "verified" } }],
    });
    renderWizard({ pollIntervalMs: 30 });
    const user = await toVerify();
    await user.click(screen.getByRole("button", { name: "Start test" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Calling (262) 755-1967… don't answer",
    );
    expect(await screen.findByText("You're live!")).toBeInTheDocument();
    const start = api.calls.find((c) => c.body["action"] === "start");
    expect(start?.body).toEqual({ tenant_id: "t1", action: "start", carrier_hint: "att" });
    const polls = api.calls.filter((c) => c.body["action"] === "status");
    expect(polls).toHaveLength(2);
    expect(polls[0]?.body).toEqual({ tenant_id: "t1", action: "status" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"), { timeout: 3000 });
  });

  it.each([
    ["answered", /picked up instead of forwarding/],
    ["no_answer", /rang but never forwarded/],
    ["busy", /line was busy/],
    ["invalid_number", /couldn.t reach that number/],
    ["not_forwarded", /didn.t reach your AI receptionist/],
    ["unknown", /didn.t reach your AI receptionist/],
  ])("failed (%s): shows the reason-specific message and Try again", async (reason, message) => {
    stubApi({ start: () => STARTED, status: [{ body: { state: "failed", reason } }] });
    renderWizard();
    const user = await toVerify();
    await user.click(screen.getByRole("button", { name: "Start test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    [422, { error: "business_phone_missing" }, /don.t have your business phone/],
    [422, { error: "business_phone_not_allowed" }, /US or Canadian business number/],
    [429, { error: "test_in_progress", retry_after_s: 42 }, /already running.*42 seconds/],
    [502, { error: "call_failed" }, /couldn.t place the test call/],
    [404, { error: "tenant_number_not_found" }, /Heyloo number isn.t ready/],
  ])("start %i %o: plain message, no polling", async (status, body, message) => {
    const api = stubApi({ start: () => ({ status, body }) });
    renderWizard();
    const user = await toVerify();
    await user.click(screen.getByRole("button", { name: "Start test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(api.calls.some((c) => c.body["action"] === "status")).toBe(false);
  });

  it("stops polling after the client-side timeout with the not-forwarded message", async () => {
    const api = stubApi({ start: () => STARTED, status: [{ body: { state: "pending" } }] });
    renderWizard({ pollTimeoutMs: 40 });
    const user = await toVerify();
    await user.click(screen.getByRole("button", { name: "Start test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/didn.t reach your AI receptionist/);
    const pollsAtFailure = api.calls.filter((c) => c.body["action"] === "status").length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.calls.filter((c) => c.body["action"] === "status")).toHaveLength(pollsAtFailure);
  });

  it("keeps polling through a transient server error", async () => {
    stubApi({
      start: () => STARTED,
      status: [
        { status: 502, body: { error: "forwarding_verify_unreachable" } },
        { body: { state: "verified" } },
      ],
    });
    renderWizard();
    const user = await toVerify();
    await user.click(screen.getByRole("button", { name: "Start test" }));
    expect(await screen.findByText("You're live!")).toBeInTheDocument();
  });

  it("a 404 no_test_running while polling fails the test instead of spinning", async () => {
    stubApi({
      start: () => STARTED,
      status: [{ status: 404, body: { error: "no_test_running" } }],
    });
    renderWizard();
    const user = await toVerify();
    await user.click(screen.getByRole("button", { name: "Start test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ended before we got a result/);
  });

  it("Try again starts a fresh test", async () => {
    let starts = 0;
    stubApi({
      start: () => {
        starts += 1;
        return STARTED;
      },
      status: [{ body: { state: "failed", reason: "busy" } }],
    });
    renderWizard();
    const user = await toVerify();
    await user.click(screen.getByRole("button", { name: "Start test" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(starts).toBe(2));
  });
});

describe("forwardingFailureMessage", () => {
  it("falls back to the not-forwarded copy for anything unrecognized", () => {
    expect(forwardingFailureMessage("carrier_exploded")).toMatch(/didn.t reach/);
    expect(forwardingFailureMessage(undefined)).toMatch(/didn.t reach/);
  });
});
