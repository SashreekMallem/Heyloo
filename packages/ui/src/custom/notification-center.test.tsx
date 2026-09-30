import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NotificationCenter } from "./notification-center.js";

describe("NotificationCenter (QA-1 MAP-11)", () => {
  it("opens a popover dialog that has an accessible name", async () => {
    const user = userEvent.setup();
    render(<NotificationCenter items={[]} unreadCount={0} onOpen={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
  });
});
