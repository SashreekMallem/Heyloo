import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NotificationCenter, type NotificationItem } from "./notification-center.js";

const items: NotificationItem[] = [
  {
    id: "b1",
    title: "Jamie Cruz booked",
    description: "Thu, Oct 1, 10:00 AM",
    createdAt: "2026-09-29T10:00:00Z",
    read: false,
    href: "/dashboard/bookings?booking=b1",
  },
];

beforeAll(() => {
  // jsdom has no ResizeObserver; Radix's ScrollArea needs one.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe("NotificationCenter (QA-1 F-04)", () => {
  it("calls onOpenChange when the popover opens, so the shell can mark everything read", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <NotificationCenter
        items={items}
        unreadCount={1}
        onOpen={() => {}}
        onOpenChange={onOpenChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /notifications/i }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(await screen.findByText("Jamie Cruz booked")).toBeInTheDocument();
    expect(screen.getByText("Thu, Oct 1, 10:00 AM")).toBeInTheDocument();
  });

  it("invokes onOpen with the clicked item and closes the popover", async () => {
    const onOpen = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <NotificationCenter
        items={items}
        unreadCount={1}
        onOpen={onOpen}
        onOpenChange={onOpenChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /notifications/i }));
    await user.click(await screen.findByText("Jamie Cruz booked"));
    expect(onOpen).toHaveBeenCalledWith(items[0]);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText("Jamie Cruz booked")).not.toBeInTheDocument();
  });
});
