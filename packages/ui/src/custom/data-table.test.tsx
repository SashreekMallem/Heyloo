import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "./data-table.js";

interface Row {
  name: string;
}

describe("DataTable scroll region (QA-1 MAP-15)", () => {
  it("makes the horizontally scrollable wrapper keyboard-focusable and labelled", () => {
    render(
      <DataTable<Row>
        label="Calls"
        columns={[{ accessorKey: "name", header: "Name" }]}
        data={[{ name: "Ada" }]}
      />,
    );
    const region = screen.getByRole("region", { name: "Calls (scrollable)" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-x-auto");
  });

  it("falls back to a generic label", () => {
    render(<DataTable<Row> columns={[{ accessorKey: "name", header: "Name" }]} data={[]} />);
    expect(screen.getByRole("region", { name: "Data table (scrollable)" })).toBeInTheDocument();
  });
});
