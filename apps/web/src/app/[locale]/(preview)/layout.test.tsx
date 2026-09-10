import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PreviewLayout from "./layout.js";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

const ORIGINAL_UI_PREVIEW_MODE = process.env["UI_PREVIEW_MODE"];
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setEnv(uiPreviewMode: string | undefined, nodeEnv: string) {
  if (uiPreviewMode === undefined) delete process.env["UI_PREVIEW_MODE"];
  else process.env["UI_PREVIEW_MODE"] = uiPreviewMode;
  // biome-ignore lint/suspicious/noExplicitAny: NODE_ENV is readonly-typed; tests need to flip it.
  (process.env as any).NODE_ENV = nodeEnv;
}

describe("(preview) route group layout — unreachable outside UI Preview Mode", () => {
  afterEach(() => {
    setEnv(ORIGINAL_UI_PREVIEW_MODE, ORIGINAL_NODE_ENV ?? "test");
    notFound.mockClear();
  });

  it("calls notFound() when UI_PREVIEW_MODE is unset", () => {
    setEnv(undefined, "development");
    expect(() => render(<PreviewLayout>content</PreviewLayout>)).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("calls notFound() in production even if UI_PREVIEW_MODE=1", () => {
    setEnv("1", "production");
    expect(() => render(<PreviewLayout>content</PreviewLayout>)).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("renders children when both conditions hold", () => {
    setEnv("1", "development");
    render(<PreviewLayout>preview content</PreviewLayout>);
    expect(screen.getByText("preview content")).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
  });
});
