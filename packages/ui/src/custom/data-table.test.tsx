import type { ColumnDef } from "@tanstack/react-table";
import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./data-table.js";

interface Row {
  id: string;
  name: string;
}

const COLUMNS: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Name" },
  {
    id: "action",
    header: "Action",
    cell: ({ row }) => <button type="button">Edit {row.original.id}</button>,
  },
];
const DATA: Row[] = [
  { id: "a", name: "Acme" },
  { id: "b", name: "Bolt" },
];

describe("DataTable clickable rows (QA-1 COCKPIT-F18)", () => {
  it("makes each row focusable and keeps the row role", () => {
    render(<DataTable columns={COLUMNS} data={DATA} onRowClick={() => {}} />);
    const row = screen.getByRole("row", { name: /Acme/ });
    expect(row).toHaveAttribute("tabindex", "0");
  });

  it("activates the row with Enter and Space", async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(<DataTable columns={COLUMNS} data={DATA} onRowClick={onRowClick} />);
    screen.getByRole("row", { name: /Bolt/ }).focus();
    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenLastCalledWith(DATA[1]);
    await user.keyboard(" ");
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it("leaves keys pressed on a control inside the row to that control", () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={COLUMNS} data={DATA} onRowClick={onRowClick} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Edit a" }), { key: "Enter" });
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("does not add tab stops to rows when nothing is clickable", () => {
    render(<DataTable columns={COLUMNS} data={DATA} />);
    expect(screen.getByRole("row", { name: /Acme/ })).not.toHaveAttribute("tabindex");
  });
});

describe("DataTable scroll-shadow surface (QA-1 F-25)", () => {
  it("fades to the page background, not the (white) card color", () => {
    const { container } = render(<DataTable columns={COLUMNS} data={DATA} />);
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the scroll wrapper has no role
    const wrapper = container.querySelector<HTMLElement>(".overflow-x-auto");
    const style = wrapper?.getAttribute("style") ?? "";
    expect(style).toContain("--color-background");
    expect(style).not.toContain("--color-card");
  });
});
