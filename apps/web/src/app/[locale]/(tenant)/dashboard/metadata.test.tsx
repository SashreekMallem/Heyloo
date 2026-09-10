import { describe, expect, it, vi } from "vitest";

// A couple of the page modules under test pull in client components that
// import `@/i18n/navigation` (next-intl's typed Link/useRouter) — mocked
// the same way `test-agent-client.test.tsx` / `setup-progress-panel.test.tsx`
// do, since importing the real module in this test environment hits an
// unrelated next-intl/vitest ESM resolution issue.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Overview/Calls pull in client components with a module-scope Supabase
// browser client singleton (`@/lib/supabase/browser`) that needs real env
// vars to construct — irrelevant to this test (it only checks the
// exported `metadata`), so it's mocked the same way `billing/page.test.tsx`
// mocks it rather than needing real Supabase config in the test environment.
vi.mock("@/lib/supabase/browser", () => ({ supabaseBrowserClient: { from: vi.fn() } }));

/**
 * Every (tenant)/dashboard route needs a real <title> — a "use client"
 * leaf page.tsx can't export `metadata` itself, so those routes get a
 * thin Server Component `layout.tsx` sibling that exports it instead
 * (round-5/6 tenant design review, medium: every tab showed the app's
 * generic fallback title). Spot-checks a representative page-exported
 * title, a couple of layout-exported titles (the pattern this round
 * added), and one of the tabbed Agent Settings sub-routes.
 */
describe("(tenant)/dashboard routes export a real <title>", () => {
  it("dashboard root (Overview) exports a page-level title", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Overview — Heyloo");
  }, 15000);

  it("Calls exports a page-level title", async () => {
    const { metadata } = await import("./calls/page");
    expect(metadata.title).toBe("Calls — Heyloo");
  }, 15000);

  it("Customers (a 'use client' page) gets its title from a layout.tsx sibling", async () => {
    const { metadata } = await import("./customers/layout");
    expect(metadata.title).toBe("Customers — Heyloo");
  });

  it("Billing (a 'use client' page) gets its title from a layout.tsx sibling", async () => {
    const { metadata } = await import("./billing/layout");
    expect(metadata.title).toBe("Billing — Heyloo");
  });

  it("Bookings (a 'use client' page) gets its title from a layout.tsx sibling", async () => {
    const { metadata } = await import("./bookings/layout");
    expect(metadata.title).toBe("Bookings — Heyloo");
  });

  it("Agent Settings -> Hours (tabbed sub-route) gets its own distinct title, not the shared Agent Settings tab bar's", async () => {
    const { metadata } = await import("./agent/hours/layout");
    expect(metadata.title).toBe("Hours — Heyloo");
  });

  it("Agent Settings -> AI Instructions gets its own distinct title", async () => {
    const { metadata } = await import("./agent/instructions/layout");
    expect(metadata.title).toBe("AI Instructions — Heyloo");
  });
});
