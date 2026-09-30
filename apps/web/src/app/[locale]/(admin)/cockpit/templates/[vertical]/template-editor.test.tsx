import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

const { TemplateEditor } = await import("./template-editor");

/** The real `GET admin-templates/:vertical` shape: the row is wrapped in `{ template }`. */
const TEMPLATE = {
  id: "3f2a9c1e-0000-4000-8000-000000000001",
  vertical: "auto",
  name: "Auto repair receptionist",
  version: 3,
  is_active: false,
  system_prompt: "You are the shop's phone assistant.",
  states: [{ name: "greeting" }, { name: "intake" }],
  transitions: [],
  tools: [],
};

type Call = { url: string; method: string; body: string | null };

function stubApi(
  publishResponse: () => Response = () =>
    Response.json({
      published: true,
      template_id: TEMPLATE.id,
      retell_agent_id: "agent_1",
      retell_flow_id: "flow_1",
    }),
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      if (String(url).endsWith("/publish")) return publishResponse();
      if (init?.method === "PATCH") return Response.json({ template: TEMPLATE });
      return Response.json({ template: TEMPLATE });
    }),
  );
  return calls;
}

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TemplateEditor vertical="auto" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  toastError.mockClear();
  toastSuccess.mockClear();
});

describe("TemplateEditor", () => {
  it("F04: prefills the system prompt and states from the { template } response", async () => {
    stubApi();
    renderEditor();
    const prompt = await screen.findByLabelText("System prompt");
    expect(prompt).toHaveValue("You are the shop's phone assistant.");
    expect(screen.getByLabelText("States (JSON)")).toHaveValue(
      JSON.stringify(TEMPLATE.states, null, 2),
    );
    expect(screen.getByText("Auto repair receptionist")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("F05: the publish button is labelled honestly and asks for confirmation before anything is sent", async () => {
    const calls = stubApi();
    renderEditor();
    await screen.findByLabelText("System prompt");
    expect(screen.queryByRole("button", { name: /publish gate/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Publish to Retell" }));
    expect(await screen.findByText("Publish auto v3 to Retell?")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(false);
  });

  it("F05: confirming saves unsaved edits by uuid first, then publishes", async () => {
    const calls = stubApi();
    renderEditor();
    const prompt = await screen.findByLabelText("System prompt");
    await userEvent.clear(prompt);
    await userEvent.type(prompt, "New prompt");

    await userEvent.click(screen.getByRole("button", { name: "Publish to Retell" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish live" }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/publish"))).toBe(true));
    const mutations = calls.filter((c) => c.method !== "GET");
    expect(mutations.map((c) => `${c.method} ${c.url}`)).toEqual([
      `PATCH /api/admin/admin-templates/${TEMPLATE.id}`,
      `POST /api/admin/admin-templates/${TEMPLATE.id}/publish`,
    ]);
    expect(JSON.parse(mutations[0]?.body ?? "{}")).toEqual({
      system_prompt: "New prompt",
      states: TEMPLATE.states,
    });
    expect(await screen.findByText("Published to Retell")).toBeInTheDocument();
  });

  it("F05: a non-JSON 500 shows the real failure, not 'isn't available yet'", async () => {
    stubApi(() => new Response("Internal Server Error", { status: 500 }));
    renderEditor();
    await screen.findByLabelText("System prompt");
    await userEvent.click(screen.getByRole("button", { name: "Publish to Retell" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish live" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const message = String(toastError.mock.calls[0]?.[0]);
    expect(message).toContain("HTTP 500");
    expect(message).toContain("Check Retell");
    expect(message).not.toContain("isn't available yet");
  });

  it("blocks save and publish while the states JSON is invalid, and never sends it as []", async () => {
    const calls = stubApi();
    renderEditor();
    const states = await screen.findByLabelText("States (JSON)");
    await userEvent.clear(states);
    await userEvent.type(states, "not json");
    expect(screen.getByRole("alert")).toHaveTextContent("valid JSON");
    expect(screen.getByRole("button", { name: "Publish to Retell" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });
});
