import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataState } from "./data-state.js";

describe("DataState", () => {
  it("renders a loading skeleton when isPending", () => {
    const { container } = render(
      <DataState
        query={{ isPending: true, isError: false, data: undefined }}
        empty={{ title: "No data" }}
        render={() => <p>content</p>}
      />,
    );
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders ErrorState with retry when isError, distinct from empty", () => {
    const refetch = vi.fn();
    render(
      <DataState
        query={{
          isPending: false,
          isError: true,
          error: new Error("boom"),
          data: undefined,
          refetch,
        }}
        empty={{ title: "No data" }}
        render={() => <p>content</p>}
      />,
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders EmptyState for an empty array, distinct from error", () => {
    render(
      <DataState
        query={{ isPending: false, isError: false, data: [] }}
        empty={{ title: "No calls yet", description: "Once forwarded, calls land here." }}
        render={() => <p>content</p>}
      />,
    );
    expect(screen.getByText("No calls yet")).toBeInTheDocument();
    expect(screen.getByText("Once forwarded, calls land here.")).toBeInTheDocument();
  });

  it("renders success content for non-empty data", () => {
    render(
      <DataState
        query={{ isPending: false, isError: false, data: [1, 2, 3] }}
        empty={{ title: "No data" }}
        render={(data) => <p>count:{data.length}</p>}
      />,
    );
    expect(screen.getByText("count:3")).toBeInTheDocument();
  });

  it("uses a custom isEmpty predicate when data is not array-shaped", () => {
    render(
      <DataState
        query={{ isPending: false, isError: false, data: { total: 0 } }}
        empty={{ title: "Nothing here", isEmpty: (data) => data.total === 0 }}
        render={(data) => <p>total:{data.total}</p>}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});
