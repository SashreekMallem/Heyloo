import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import OrderNotFound from "./not-found";

describe("orders/[id]/not-found (QA-1 MAP-13)", () => {
  it("explains the missing order and links back to Orders", () => {
    render(<OrderNotFound />);
    expect(screen.getByText("Order not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to orders" })).toHaveAttribute(
      "href",
      "/dashboard/orders",
    );
  });
});
