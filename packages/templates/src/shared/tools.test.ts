import { describe, expect, it } from "vitest";
import {
  checkAvailabilityTool,
  createBookingTool,
  createOrderTool,
  joinWaitlistTool,
  listOfferingsTool,
  takeMessageTool,
} from "./tools.js";

describe("checkAvailabilityTool", () => {
  it("declares room_type alongside resource_type (GAP_REGISTER.md §2 Motel item 2)", () => {
    const tool = checkAvailabilityTool();
    expect(tool.parameters.properties?.["room_type"]).toBeDefined();
    expect(tool.parameters.properties?.["resource_type"]).toBeDefined();
  });
});

describe("listOfferingsTool", () => {
  it("is read-only (authorization scope none) and declares an optional category filter", () => {
    const tool = listOfferingsTool();
    expect(tool.name).toBe("list_offerings");
    expect(tool.authorization).toEqual({ scope: "none" });
    expect(tool.parameters.properties?.["category"]).toBeDefined();
  });
});

describe("createBookingTool", () => {
  it("defaults structured_payload to a bare object when no vertical is given (non-breaking for existing call sites)", () => {
    const tool = createBookingTool("test");
    expect(tool.parameters.properties?.["structured_payload"]).toEqual({ type: "object" });
  });

  it("surfaces the vertical's typed structured_payload properties when a vertical is given", () => {
    const tool = createBookingTool("test", "auto");
    const structuredPayload = tool.parameters.properties?.["structured_payload"] as {
      type: string;
      properties?: Record<string, unknown>;
    };
    expect(structuredPayload.type).toBe("object");
    expect(structuredPayload.properties?.["vehicle_make"]).toBeDefined();
    expect(structuredPayload.properties?.["vehicle_model"]).toBeDefined();
  });

  it("declares consent (GAP_REGISTER.md §1.9)", () => {
    const tool = createBookingTool("test");
    expect(tool.parameters.properties?.["consent"]).toBeDefined();
  });
});

describe("createOrderTool", () => {
  it("declares allergies + special_instructions (GAP_REGISTER.md §2 Restaurant item 2)", () => {
    const tool = createOrderTool();
    expect(tool.parameters.properties?.["allergies"]).toEqual({
      type: "array",
      items: { type: "string" },
      description: "Every allergy the caller mentioned — always ask explicitly.",
    });
    expect(tool.parameters.properties?.["special_instructions"]).toBeDefined();
  });

  it("still declares consent", () => {
    const tool = createOrderTool();
    expect(tool.parameters.properties?.["consent"]).toBeDefined();
  });
});

describe("takeMessageTool", () => {
  it("defaults structured_payload to a bare object when no vertical is given", () => {
    const tool = takeMessageTool();
    expect(tool.parameters.properties?.["structured_payload"]).toEqual({ type: "object" });
  });

  it("surfaces the vertical's typed structured_payload properties when a vertical is given", () => {
    const tool = takeMessageTool("legal");
    const structuredPayload = tool.parameters.properties?.["structured_payload"] as {
      properties?: Record<string, unknown>;
    };
    expect(structuredPayload.properties?.["matter_type"]).toBeDefined();
  });
});

describe("joinWaitlistTool (GAP_REGISTER.md §1.2)", () => {
  it("declares the expected shape", () => {
    const tool = joinWaitlistTool();
    expect(tool.name).toBe("join_waitlist");
    expect(tool.parameters.required).toEqual(
      expect.arrayContaining(["customer", "preferred_window_start", "preferred_window_end"]),
    );
    expect(tool.authorization.scope).toBe("none");
  });
});
