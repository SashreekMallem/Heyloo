import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataList } from "./data-list.js";

describe("DataList", () => {
  it("renders every label/value pair", () => {
    render(
      <DataList
        items={[
          { label: "Phone", value: "+1 512 555 0101", mono: true },
          { label: "Status", value: "Confirmed" },
        ]}
      />,
    );
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByText("+1 512 555 0101")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });
});
