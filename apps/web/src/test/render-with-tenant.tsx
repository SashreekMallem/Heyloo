import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { TenantIdProvider } from "@/lib/tenant/tenant-context";

// Radix Switch/Checkbox render a hidden "bubble" input inside a <form> that
// measures itself with ResizeObserver, which jsdom lacks.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

/** SETTINGS-1 test helper: render inside a fresh QueryClient + TenantIdProvider("t1"). `canWrite: false` renders as a `member` (QA-1). */
export function renderWithTenant(
  ui: ReactElement,
  options: { canWrite?: boolean; isOwner?: boolean } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TenantIdProvider
        tenantId="t1"
        canWrite={options.canWrite ?? true}
        isOwner={options.isOwner ?? options.canWrite ?? true}
      >
        {ui}
      </TenantIdProvider>
    </QueryClientProvider>,
  );
}

type Handler = (body: unknown, init: RequestInit | undefined) => { status?: number; body: unknown };

/** Stubs `fetch` by URL suffix; records every JSON body posted. */
export function stubRoutes(routes: Record<string, Handler>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    const key = Object.keys(routes).find((suffix) => url.endsWith(suffix));
    if (!key) return new Response("{}", { status: 404 });
    const result = (routes[key] as Handler)(body, init);
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200 });
  };
  return { fetchMock, calls };
}
