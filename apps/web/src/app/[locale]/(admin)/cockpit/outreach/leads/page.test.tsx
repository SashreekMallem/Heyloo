import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import LeadsPage from "./page";
import { buildLeadsQueryString } from "./query";

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <LeadsPage />
    </QueryClientProvider>,
  );
}

// OUTREACH-2: Score column + sort/filter (admin outreach leads UI).
describe("LeadsPage — phone-complaint score", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the raw snake_case API row into the Score column", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          leads: [
            {
              id: "l1",
              company_name: "Acme Auto",
              contact_name: "Jane Doe",
              email: "jane@acme.example",
              status: "new",
              phone_complaint_score: 0.75,
            },
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText("75%")).toBeInTheDocument();
  });

  it("shows a dash for an unscored lead", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          leads: [
            {
              id: "l1",
              company_name: "Acme Auto",
              contact_name: "Jane Doe",
              email: "jane@acme.example",
              status: "new",
              phone_complaint_score: null,
            },
          ],
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText("—")).toBeInTheDocument();
  });

  it("refetches with a min_score query param when a minimum is typed", async () => {
    const fetchMock = vi.fn(async () => Response.json({ leads: [] }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await screen.findByText("No leads fetched yet");

    await userEvent.type(screen.getByLabelText("Min score"), "0.6");

    await vi.waitFor(() => {
      const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
      expect(calls.some((c) => String(c[0]).includes("min_score=0.6"))).toBe(true);
    });
  });
});

describe("buildLeadsQueryString", () => {
  it("omits both params for the default newest/no-filter state", () => {
    expect(buildLeadsQueryString("newest", "")).toBe("");
  });

  it("sets sort=score when sorting by highest score", () => {
    expect(buildLeadsQueryString("score", "")).toBe("sort=score");
  });

  it("sets min_score when a minimum is given, trimming whitespace", () => {
    expect(buildLeadsQueryString("newest", " 0.6 ")).toBe("min_score=0.6");
  });

  it("combines both when sorting by score with a minimum set", () => {
    expect(buildLeadsQueryString("score", "0.5")).toBe("sort=score&min_score=0.5");
  });

  it("ignores a blank/whitespace-only min score", () => {
    expect(buildLeadsQueryString("newest", "   ")).toBe("");
  });
});
