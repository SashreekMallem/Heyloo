import { describe, expect, it } from "vitest";
import { getMissingRequiredFields, REQUIRED_INTAKE_FIELDS } from "./vertical-intake.ts";

describe("REQUIRED_INTAKE_FIELDS (CALL-8 required-field matrix)", () => {
  it("declares create_booking requirements for every vertical except legal (take_message-only intake)", () => {
    for (const [vertical, spec] of Object.entries(REQUIRED_INTAKE_FIELDS)) {
      if (vertical === "legal") {
        expect(spec.create_booking).toBeUndefined();
        continue;
      }
      expect(spec.create_booking, `${vertical} should declare create_booking fields`).toBeDefined();
      expect(spec.create_booking?.length).toBeGreaterThan(0);
    }
  });

  it("declares a non-empty take_message baseline for every vertical (every vertical takes after-hours messages)", () => {
    for (const [vertical, spec] of Object.entries(REQUIRED_INTAKE_FIELDS)) {
      expect(spec.take_message.length, vertical).toBeGreaterThan(0);
      const paths = spec.take_message.map((f) => f.path);
      expect(paths).toEqual(
        expect.arrayContaining(["caller_name", "caller_phone", "message_text"]),
      );
    }
  });

  it("only declares create_order for restaurant (the only vertical whose template grants create_order)", () => {
    for (const [vertical, spec] of Object.entries(REQUIRED_INTAKE_FIELDS)) {
      if (vertical === "restaurant") {
        expect(spec.create_order).toBeDefined();
      } else {
        expect(spec.create_order, vertical).toBeUndefined();
      }
    }
  });

  it("dental deliberately does NOT require insurance (SYSTEM_DESIGN §4.3 PHI deferral — see this file's own header comment)", () => {
    const paths = REQUIRED_INTAKE_FIELDS.dental.create_booking?.map((f) => f.path) ?? [];
    expect(paths.some((p) => p.includes("insurance"))).toBe(false);
    expect(paths).toContain("structured_payload.new_or_existing");
    expect(paths).toContain("structured_payload.reason_for_visit");
  });
});

describe("getMissingRequiredFields", () => {
  it("returns [] when every required field is present", () => {
    const missing = getMissingRequiredFields("auto", "create_booking", {
      customer: { name: "Jamie Rivera", phone: "+15552010199" },
      start: "2026-01-05T15:00:00Z",
      end: "2026-01-05T15:30:00Z",
      structured_payload: {
        vehicle_year: 2019,
        vehicle_make: "Honda",
        vehicle_model: "Civic",
        symptom_category: "oil_change",
      },
    });
    expect(missing).toEqual([]);
  });

  it("reports exactly the missing dot-paths, nested and top-level alike", () => {
    const missing = getMissingRequiredFields("vet", "create_booking", {
      customer: { name: "Morgan Ellis" },
      start: "2026-01-05T15:00:00Z",
      end: "2026-01-05T15:30:00Z",
      structured_payload: { pet_name: "Bella" },
    });
    const paths = missing.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "customer.phone",
        "structured_payload.species",
        "structured_payload.visit_reason",
      ]),
    );
    expect(paths).not.toContain("customer.name");
    expect(paths).not.toContain("structured_payload.pet_name");
  });

  it("treats an empty string / whitespace-only value as missing, not present", () => {
    const missing = getMissingRequiredFields("generic", "create_booking", {
      customer: { name: "  ", phone: "+15552010199" },
      start: "2026-01-05T15:00:00Z",
      end: "2026-01-05T15:30:00Z",
      structured_payload: { reason: "" },
    });
    const paths = missing.map((f) => f.path);
    expect(paths).toContain("customer.name");
    expect(paths).toContain("structured_payload.reason");
  });

  it("returns [] for a (vertical, tool) pair with no declared requirements (e.g. create_order on a non-restaurant vertical) rather than throwing", () => {
    expect(getMissingRequiredFields("auto", "create_order", {})).toEqual([]);
  });

  it("returns [] for an unrecognized vertical rather than throwing", () => {
    expect(getMissingRequiredFields("not_a_real_vertical", "create_booking", {})).toEqual([]);
  });

  it("restaurant's create_booking (reservation) requires party_size, a top-level arg, not a structured_payload key", () => {
    const missing = getMissingRequiredFields("restaurant", "create_booking", {
      customer: { name: "Alex Kim", phone: "+15552010110" },
      start: "2026-01-05T19:00:00Z",
      end: "2026-01-05T20:00:00Z",
    });
    expect(missing.map((f) => f.path)).toContain("party_size");
  });
});
