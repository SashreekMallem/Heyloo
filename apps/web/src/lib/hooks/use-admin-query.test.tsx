import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminQueryError, adminQueryErrorMessage, useAdminQuery } from "./use-admin-query";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.unstubAllGlobals());

// COCKPIT-F17: the raw `admin_query_failed:404` string used to reach the page.
describe("useAdminQuery errors", () => {
  it.each([
    [404, "Not found."],
    [500, "Something went wrong. Please retry."],
    [502, "Something went wrong. Please retry."],
    [422, "That request isn't valid."],
    [403, "You don't have access to this."],
  ])("maps HTTP %i to a human message", (status, message) => {
    expect(adminQueryErrorMessage(status)).toBe(message);
    expect(new AdminQueryError(status).message).toBe(message);
  });

  it("surfaces a friendly message and the status, never admin_query_failed:NNN", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const { result } = renderHook(() => useAdminQuery("x", ["a"], "admin-tenants/nope"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Not found.");
    expect((result.current.error as AdminQueryError).status).toBe(404);
    expect(result.current.error?.message).not.toContain("admin_query_failed");
  });
});
